/**
 * SSTV 主解码器（重构版 - 保持向后兼容）
 *
 * 架构设计（参考 xdsopl/robot36 Java 版本）:
 *   - 本类: 保持原有 API，负责 DDC 解调、VIS 解码、同步检测
 *   - 内部委托给具体模式类: 扫描线解码（YUV 重建、RGB 转换）
 *
 * 扩展新 SSTV 模式:
 *   1. 创建模式解码类（实现 SSTVModeDecoder 接口）
 *   2. 在 _createModeDecoder() 中注册
 *
 * 对外 API（保持不变）:
 *   - constructor()
 *   - reset()
 *   - processAudioFrame(frameBuffer)
 *   - isDecoding, onProgress, onComplete, imageData
 *
 * 当前支持的模式:
 *   - Robot 36 Color (VIS code = 8)
 *
 * 解码流程:
 *   音频输入 → DDC 解调 → VIS 解码 → 逐行解码（委托给模式类）→ 图像输出
 */

// ============================================================================
// 引入模式解码器
// ============================================================================

const SSTVModeDecoder = require('./sstv-mode-decoder')
const Robot36ColorDecoder = require('./sstv-robot36-decoder')

// ============================================================================
// 工具函数
// ============================================================================

function clampf(x, min, max) {
  if (x < min) return min
  if (x > max) return max
  return x
}

function lerpf(a, b, x) {
  return a + (b - a) * x
}

// ============================================================================
// 颜色转换 (BT.601 SD)
// 对应 Java ColorConverter.java 和原版 sstv-decoder.js 的 R_YUV/G_YUV/B_YUV
// ============================================================================

const Color = {
  Y_SCALE: 298.082,
  RV_SCALE: 408.583,
  GU_SCALE: -100.291,
  GV_SCALE: -208.12,
  BU_SCALE: 516.411,
  FACTOR: 0.003906,  // 1/256

  R_YUV(Y, U, V) {
    return clampf(this.FACTOR * (this.Y_SCALE * (Y - 16) + this.RV_SCALE * (V - 128)), 0, 255)
  },

  G_YUV(Y, U, V) {
    return clampf(this.FACTOR * (this.Y_SCALE * (Y - 16) + this.GU_SCALE * (U - 128) + this.GV_SCALE * (V - 128)), 0, 255)
  },

  B_YUV(Y, U, V) {
    return clampf(this.FACTOR * (this.Y_SCALE * (Y - 16) + this.BU_SCALE * (U - 128)), 0, 255)
  }
}

// ============================================================================
// 复数运算
// ============================================================================

function cmul(a, b) {
  return { re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re }
}

function cabs(a) {
  return Math.sqrt(a.re * a.re + a.im * a.im)
}

function carg(a) {
  return Math.atan2(a.im, a.re)
}

// ============================================================================
// 2阶 Butterworth 低通滤波器 (双二次滤波, 复数)
// 用于 DDC 混频后的基带低通
// ============================================================================

function createButterworthLPF(cutoffHz, sampleRate) {
  const Q = 1.0 / Math.SQRT2
  const omega = 2.0 * Math.PI * cutoffHz / sampleRate
  const sinW = Math.sin(omega)
  const cosW = Math.cos(omega)
  const alpha = sinW / (2.0 * Q)

  const b0 = (1.0 - cosW) / 2.0
  const b1 = 1.0 - cosW
  const b2 = (1.0 - cosW) / 2.0
  const a0 = 1.0 + alpha
  const a1 = -2.0 * cosW
  const a2 = 1.0 - alpha

  const invA0 = 1.0 / a0
  const nb0 = b0 * invA0
  const nb1 = b1 * invA0
  const nb2 = b2 * invA0
  const na1 = a1 * invA0
  const na2 = a2 * invA0

  let x1 = { re: 0, im: 0 }, x2 = { re: 0, im: 0 }
  let y1 = { re: 0, im: 0 }, y2 = { re: 0, im: 0 }

  return function(input) {
    const out = {
      re: nb0 * input.re + nb1 * x1.re + nb2 * x2.re - na1 * y1.re - na2 * y2.re,
      im: nb0 * input.im + nb1 * x1.im + nb2 * x2.im - na1 * y1.im - na2 * y2.im
    }
    x2 = x1
    x1 = input
    y2 = y1
    y1 = out
    return out
  }
}

// ============================================================================
// DDC 通道: 混频器 + LPF + 瞬时频率估计
// 对应 Java Demodulator.java 的核心逻辑
// ============================================================================

function createDDCChannel(carrierFreq, bwHz, sampleRate) {
  let phase = 0
  const phaseStep = (2.0 * Math.PI * carrierFreq) / sampleRate
  const lpf = createButterworthLPF(bwHz, sampleRate)

  let lastOut = null
  let prevOut = { re: 1, im: 0 }

  return {
    process(sample) {
      const cosVal = Math.cos(-phase)
      const sinVal = Math.sin(-phase)
      const mixed = {
        re: sample * cosVal,
        im: sample * sinVal
      }
      phase += phaseStep
      if (phase > 2.0 * Math.PI) phase -= 2.0 * Math.PI

      const filtered = lpf(mixed)
      prevOut = lastOut || { re: 1, im: 0 }
      lastOut = filtered
      return filtered
    },

    getInstantFreq() {
      if (!lastOut || !prevOut) return carrierFreq
      const cross = cmul(lastOut, { re: prevOut.re, im: -prevOut.im })
      const delta = carg(cross)
      const dstep = 1.0 / sampleRate
      return carrierFreq + delta / (2.0 * Math.PI * dstep)
    },

    getAmplitude() {
      return lastOut ? cabs(lastOut) : 0
    },

    getOutput() {
      return lastOut || { re: 1, im: 0 }
    }
  }
}

// ============================================================================
// 模式工厂（延迟初始化）
// ============================================================================

const MODE_REGISTRY = {
  // VIS code → 模式类（从外部文件加载）
  8: Robot36ColorDecoder
  // 添加更多模式:
  // 36: Scottie1Decoder,
}

let _modeCache = {}

function _createModeDecoder(visCode, sampleRate) {
  if (!_modeCache[visCode]) {
    const ModeClass = MODE_REGISTRY[visCode]
    if (ModeClass) {
      _modeCache[visCode] = new ModeClass(sampleRate)
    }
  }
  return _modeCache[visCode] || null
}

// ============================================================================
// 主解码器类（保持原有 API）
// ============================================================================

class SSTVDecoder {
  constructor() {
    this.sampleRate = 8000
    this.imageWidth = 320
    this.imageHeight = 240
    this.reset()
  }

  reset() {
    this.imageData = new Uint8ClampedArray(this.imageWidth * this.imageHeight * 4)
    this.imageData.fill(0)
    for (let i = 3; i < this.imageData.length; i += 4) this.imageData[i] = 255

    // DDC 通道
    this._cntDDC = createDDCChannel(1200.0, 200.0, this.sampleRate)
    this._datDDC = createDDCChannel(1900.0, 800.0, this.sampleRate)
    this._prevCntOut = { re: 1, im: 0 }
    this._prevDatOut = { re: 1, im: 0 }

    // 音频缓冲
    this.audioBuffer = []

    // 回调
    this.isDecoding = false
    this.onProgress = null
    this.onComplete = null
    this.onVISDecoded = null

    // 状态机
    this._phase = 0  // 0=搜寻校准头, 1=VIS解码, 2=图像数据
    this._imgReady = false
    this._completed = false

    // 校准头检测
    this._calAvg = 1900.0
    this._calBreakTicks = 0
    this._calLeaderTicks = 0
    this._calTicks = -1
    this._calGotBreak = false
    this._calFound = false
    this._calFreqAcc = 0
    this._calFreqAccCnt = 0

    // VIS 解码
    this._visSS = 0
    this._visLo = 0
    this._visHi = 0
    this._visTicks = -1
    this._visBit = -1
    this._visByte = 0
    this._visDone = false

    // 行解码
    this._initTiming()
    this._resetLineState()

    // 模式解码器（延迟创建）
    this._modeDecoder = null
    this._modeVisCode = -1

    // 静音检测
    this.lastAudioTime = 0
    this.silenceCount = 0

    // 进度上报
    this._lastProgressLine = 0

    // 日志计数器
    this._sampleCount = 0
    this._logInterval = this.sampleRate * 2

    // DDC 振幅统计
    this._cntMagSum = 0
    this._datMagSum = 0
    this._cntWinCount = 0
    this._cntWins = false
    this._frameCount = 0
    this._rawAmpSum = 0
    this._rawAmpPeak = 0
    this._datFreqMin = 3000
    this._datFreqMax = 0
    this._datFreqSum = 0
    this._datFreqCount = 0
  }

  // 初始化时序参数
  _initTiming() {
    const r = this.sampleRate
    this._syncPorchLen = Math.round(0.003 * r)
    this._porchLen = Math.round(0.0015 * r)
    this._yLen = Math.round(0.088 * r)
    this._uvLen = Math.round(0.044 * r)
    this._horLen = Math.round(0.15 * r)
    this._horSyncLen = Math.round(0.009 * r)
    this._sepLen = Math.round(0.0045 * r)

    this._yWidth = this._yLen
    this._uvWidth = this._uvLen

    this._yPixels = new Uint8Array(this._yWidth * 2)
    this._uvPixels = new Uint8Array(this._uvWidth * 2)
  }

  _resetLineState() {
    this._horTicks = 0
    this._latchSync = false
    this._initDone = false
    this._lineY = 0
    this._odd = 0
    this._yPixelX = 0
    this._uvPixelX = 0
    this._lineTicks = -1
    this._sepCount = 0
    this._yPixels.fill(0)
    this._uvPixels.fill(0)
    this._lastProgressLine = -1
  }

  // ========================================================================
  // 主入口
  // ========================================================================

  processAudioFrame(frameBuffer) {
    if (!this.isDecoding) return
    if (!frameBuffer || frameBuffer.length === 0) return

    this.lastAudioTime = Date.now()

    // 首帧时输出音频信号强度
    if (this._frameCount === undefined) this._frameCount = 0
    if (this._frameCount === 0) {
      let sum = 0, peak = 0
      for (let i = 0; i < frameBuffer.length; i++) {
        const a = Math.abs(frameBuffer[i])
        sum += a
        if (a > peak) peak = a
      }
      console.log('[SSTV] 首帧音频: 样本数=' + frameBuffer.length +
        ' avgAmp=' + (sum / frameBuffer.length).toFixed(4) +
        ' peak=' + peak.toFixed(4))
    }
    this._frameCount++

    // 防止缓冲无限增长
    const MAX_BUFFER = this.sampleRate * 3
    if (this.audioBuffer.length + frameBuffer.length > MAX_BUFFER) {
      this.audioBuffer.splice(0, this.audioBuffer.length - Math.floor(MAX_BUFFER / 2))
    }

    this.audioBuffer.push(...frameBuffer)

    // 批量处理
    let processed = 0
    const MAX_PER_CALL = 2000
    while (this.audioBuffer.length > 0 && processed < MAX_PER_CALL && !this._completed) {
      this._processSample(this.audioBuffer.shift())
      processed++
    }

    // 静音超时检测
    if (this.audioBuffer.length === 0) {
      this.silenceCount++
      if (this.silenceCount > 50 && this._lineY > 10) {
        if (!this._completed) {
          console.log('[SSTV] 静音超时, 提前结束解码 (lineY=' + this._lineY + ', silenceCount=' + this.silenceCount + ')')
          this._onDecodeComplete()
        }
      }
    } else {
      this.silenceCount = 0
    }
  }

  // ========================================================================
  // 逐样本处理
  // ========================================================================

  _processSample(sample) {
    // --- DDC 解调 ---
    const cntOut = this._cntDDC.process(sample)
    const datOut = this._datDDC.process(sample)

    const cntFreq = this._cntDDC.getInstantFreq(this._prevCntOut)
    const datFreq = this._datDDC.getInstantFreq(this._prevDatOut)

    // 通道主导判定
    const cntMag2 = cntOut.re * cntOut.re + cntOut.im * cntOut.im
    const datMag2 = datOut.re * datOut.re + datOut.im * datOut.im
    const cntWins = cntMag2 > datMag2
    this._cntWins = cntWins

    let finalCntFreq, finalDatFreq
    if (cntWins) {
      finalCntFreq = cntFreq
      finalDatFreq = 1500.0
    } else {
      finalCntFreq = 1300.0
      finalDatFreq = datFreq
    }

    this._prevCntOut = cntOut
    this._prevDatOut = datOut

    finalCntFreq = clampf(finalCntFreq, 1100.0, 1300.0)
    finalDatFreq = clampf(finalDatFreq, 1500.0, 2300.0)

    const drate = this.sampleRate

    // 累积振幅统计
    this._cntMagSum += cntMag2
    this._datMagSum += datMag2
    if (cntWins) this._cntWinCount++
    if (!cntWins) {
      if (datFreq < this._datFreqMin) this._datFreqMin = datFreq
      if (datFreq > this._datFreqMax) this._datFreqMax = datFreq
      this._datFreqSum += datFreq
      this._datFreqCount++
    }
    const rawAmp = Math.abs(sample)
    this._rawAmpSum += rawAmp
    if (rawAmp > this._rawAmpPeak) this._rawAmpPeak = rawAmp

    // 定期状态日志
    this._sampleCount++
    if (this._sampleCount >= this._logInterval) {
      const n = this._sampleCount
      const cntAvgMag = Math.sqrt(this._cntMagSum / n)
      const datAvgMag = Math.sqrt(this._datMagSum / n)
      const cntWinPct = (this._cntWinCount / n * 100).toFixed(0)
      const phaseNames = ['校准头搜寻', 'VIS解码', '图像数据']
      let extraInfo = ''
      if (this._phase === 0) {
        extraInfo = ' calAvg=' + this._calAvg.toFixed(0) + 'Hz leaderTicks=' + this._calLeaderTicks +
          ' breakTicks=' + this._calBreakTicks + ' gotBreak=' + this._calGotBreak
        if (this._datFreqCount > 0) {
          extraInfo += ' datFreq[' + this._datFreqMin.toFixed(0) + '~' +
            (this._datFreqSum / this._datFreqCount).toFixed(0) + '~' +
            this._datFreqMax.toFixed(0) + '] n=' + this._datFreqCount
        }
      }
      console.log('[SSTV] 状态: phase=' + phaseNames[this._phase] + ' lineY=' + this._lineY +
        ' | cntFreq=' + finalCntFreq.toFixed(0) + 'Hz datFreq=' + finalDatFreq.toFixed(0) + 'Hz' +
        ' | DDC幅度 cnt=' + cntAvgMag.toFixed(4) + ' dat=' + datAvgMag.toFixed(4) +
        ' cnt胜率=' + cntWinPct + '%' +
        ' | 音频 inAmp=' + (this._rawAmpSum / n).toFixed(4) + ' peak=' + this._rawAmpPeak.toFixed(4) +
        ' | buf=' + this.audioBuffer.length + extraInfo)
      this._sampleCount = 0
      this._cntMagSum = 0
      this._datMagSum = 0
      this._cntWinCount = 0
      this._rawAmpSum = 0
      this._rawAmpPeak = 0
      this._datFreqMin = 3000
      this._datFreqMax = 0
      this._datFreqSum = 0
      this._datFreqCount = 0
    }

    // --- 状态机 ---
    switch (this._phase) {
      case 0: // 搜寻校准头
        if (this._checkCalHeader(finalCntFreq, finalDatFreq, drate, !cntWins)) {
          console.log('[SSTV] 检测到校准头, 进入 VIS 解码')
          this._phase = 1
          this._resetVIS()
          this._resetCalHeader()
        }
        break

      case 1: { // VIS 解码
        const visResult = this._checkVISCode(finalCntFreq, drate)
        if (visResult !== null) {
          if (visResult.valid) {
            console.log('[SSTV] VIS = 0x' + visResult.code.toString(16))
            if (visResult.code === 0x88 || visResult.code === 8) {
              this._imgReady = true
              this._modeVisCode = visResult.code & 0x7F  // 去掉校验位
              const mode = _createModeDecoder(this._modeVisCode, this.sampleRate)
              if (mode) {
                console.log('[SSTV] 使用模式解码器: ' + mode.getName())
                this._modeDecoder = mode
                this._modeDecoder.resetState()
                if (this._modeDecoder.outputImage) {
                  // 复用现有 imageData
                } else {
                  this._modeDecoder.outputImage = this.imageData
                }
              }
              this._resetLineState()
              this._phase = 2
              console.log('[SSTV] 开始解码图像')
            } else {
              console.warn('[SSTV] VIS 不支持: 0x' + visResult.code.toString(16) + ', 回到校准头搜寻')
              this._phase = 0
            }
          } else {
            console.warn('[SSTV] VIS 解码失败, 回到校准头搜寻')
            this._phase = 0
          }
        }
        break
      }

      case 2: // 图像数据解码
        if (this._imgReady) {
          this._decodeLine(finalCntFreq, finalDatFreq, drate)
        }
        break
    }
  }

  // ========================================================================
  // 模式解码器工厂
  // ========================================================================

  /**
   * 根据 VIS 代码创建对应的模式解码器
   * @param {number} visCode - VIS 代码（已去掉校验位）
   * @param {number} sampleRate - 采样率
   * @returns {SSTVModeDecoder|null} 模式解码器实例，或 null
   */
  _createModeDecoder(visCode, sampleRate) {
    console.log('[SSTV] 创建模式解码器: VIS=' + visCode)

    // Robot 36 Color
    if (visCode === 8) {
      return new Robot36ColorDecoder(sampleRate)
    }

    // TODO: 在此添加更多模式
    // if (visCode === 60) { return new Scottie1Decoder(sampleRate) }
    // if (visCode === 36) { return new Martin1Decoder(sampleRate) }

    console.warn('[SSTV] 不支持的 VIS 代码: ' + visCode)
    return null
  }

  // ========================================================================
  // 校准头检测
  // ========================================================================

  _resetCalHeader() {
    this._calAvg = 1900.0
    this._calBreakTicks = 0
    this._calLeaderTicks = 0
    this._calTicks = -1
    this._calGotBreak = false
    this._calFreqAcc = 0
    this._calFreqAccCnt = 0
  }

  _checkCalHeader(cntFreq, datFreq, drate, datWins) {
    const BREAK_LEN = 0.01
    const LEADER_LEN = 0.3
    const BREAK_TOL = 0.7
    const LEADER_TOL = 0.3

    // 数据通道频率窗口平均
    const FRQ_WIN_SAMPLES = 50
    if (datWins) {
      if (!this._calFreqAcc) { this._calFreqAcc = 0; this._calFreqAccCnt = 0 }
      this._calFreqAcc += datFreq
      this._calFreqAccCnt++
      if (this._calFreqAccCnt >= FRQ_WIN_SAMPLES) {
        const avgFreq = this._calFreqAcc / this._calFreqAccCnt
        const datAlpha = 1.0 / (drate * 0.00238 + 1.0)
        this._calAvg = datAlpha * avgFreq + (1.0 - datAlpha) * this._calAvg
        this._calFreqAcc = 0
        this._calFreqAccCnt = 0
      }
    }

    // 1200Hz break 检测
    this._calBreakTicks = (Math.abs(cntFreq - 1200.0) < 80.0)
      ? this._calBreakTicks + 1 : 0

    // 1900Hz leader 检测
    this._calLeaderTicks = (Math.abs(this._calAvg - 1900.0) < 100.0)
      ? this._calLeaderTicks + 1 : 0

    const sigBreak = this._calBreakTicks >= Math.floor(drate * BREAK_TOL * BREAK_LEN)
    const sigLeader = this._calLeaderTicks >= Math.floor(drate * LEADER_TOL * LEADER_LEN)

    this._calTicks++

    if (sigLeader && !sigBreak && this._calGotBreak &&
        this._calTicks >= Math.floor(drate * (LEADER_LEN + BREAK_LEN) * LEADER_TOL) &&
        this._calTicks <= Math.floor(drate * (LEADER_LEN + BREAK_LEN) * (2.0 - LEADER_TOL))) {
      this._calGotBreak = false
      return true
    }

    if (sigBreak && !sigLeader &&
        this._calTicks >= Math.floor(drate * BREAK_LEN * BREAK_TOL) &&
        this._calTicks <= Math.floor(drate * BREAK_LEN * (2.0 - BREAK_TOL))) {
      this._calGotBreak = true
    }

    if (sigLeader && !sigBreak) {
      if (this._calTicks < 0) {
        console.log('[SSTV] 校准头: 检测到 leader 信号 (1900Hz) calAvg=' + this._calAvg.toFixed(0) + 'Hz')
      }
      this._calTicks = 0
      this._calGotBreak = false
    }

    if (sigBreak && !sigLeader && !this._calGotBreak) {
      console.log('[SSTV] 校准头: 检测到 break 信号 (1200Hz), ticks=' + this._calTicks +
        ' cntFreq=' + cntFreq.toFixed(0) + 'Hz')
    }

    return false
  }

  // ========================================================================
  // VIS 解码
  // ========================================================================

  _resetVIS() {
    this._visSS = 0
    this._visLo = 0
    this._visHi = 0
    this._visTicks = -1
    this._visBit = -1
    this._visByte = 0
    this._visDone = false
  }

  _checkVISCode(cntFreq, drate) {
    const TOLERANCE = 0.9
    const LENGTH = 0.03

    this._visSS = (Math.abs(cntFreq - 1200.0) < 50.0) ? this._visSS + 1 : 0
    this._visLo = (Math.abs(cntFreq - 1300.0) < 50.0) ? this._visLo + 1 : 0
    this._visHi = (Math.abs(cntFreq - 1100.0) < 50.0) ? this._visHi + 1 : 0

    const thresh = Math.floor(drate * TOLERANCE * LENGTH)
    const sigSS = this._visSS >= thresh
    const sigLo = this._visLo >= thresh
    const sigHi = this._visHi >= thresh

    if (sigSS) this._visSS = 0
    if (sigLo) this._visLo = 0
    if (sigHi) this._visHi = 0

    this._visTicks++

    if (this._visBit < 0) {
      if (sigSS) {
        this._visTicks = 0
        this._visByte = 0
        this._visBit = 0
        console.log('[SSTV] VIS: 检测到 Start bit')
      }
      return null
    }

    const maxTicks = Math.floor(drate * 10.0 * LENGTH * (2.0 - TOLERANCE))
    if (this._visTicks <= maxTicks) {
      if (sigSS) {
        const code = this._visByte
        this._visBit = -1
        console.log('[SSTV] VIS: Stop bit, 解码完成 code=0x' + code.toString(16) + ' (bin=' + code.toString(2).padStart(8, '0') + ')')
        return { code, valid: true }
      }
      if (this._visBit < 8) {
        const prevBit = this._visBit
        if (sigLo) {
          this._visBit++
          console.log('[SSTV] VIS: bit[' + prevBit + '] = 0 (Lo/1300Hz) ticks=' + this._visTicks)
        }
        if (sigHi) {
          this._visByte |= (1 << this._visBit)
          const oldBit = this._visBit
          this._visBit++
          console.log('[SSTV] VIS: bit[' + oldBit + '] = 1 (Hi/1100Hz) ticks=' + this._visTicks + ' byte=0x' + this._visByte.toString(16))
        }
      }
      return null
    }

    const code = this._visByte
    const hadEnoughBits = this._visBit >= 8
    this._visBit = -1
    console.warn('[SSTV] VIS: 超时 after ' + this._visTicks + ' ticks, bits=' + (this._visBit + 1) + ' byte=0x' + code.toString(16) + ' valid=' + hadEnoughBits)
    return { code, valid: hadEnoughBits }
  }

  // ========================================================================
  // 图像行解码
  // ========================================================================

  _decodeLine(cntFreq, datFreq, drate) {
    const SYNC_TOL = 0.7
    const SYNC_FREQ = 1200.0

    this._horTicks = (Math.abs(cntFreq - SYNC_FREQ) < 50.0) ? this._horTicks + 1 : 0

    if (this._horTicks > Math.floor(SYNC_TOL * this._horSyncLen)) {
      this._latchSync = true
    }
    const horSync = (cntFreq > 1299.0) && this._latchSync
    if (horSync) this._latchSync = false

    if (!this._initDone) {
      if (!horSync) return
      this._initDone = true
      this._lineTicks = 0
      this._yPixelX = 0
      this._uvPixelX = 0
      this._lineY = 0
      this._odd = 0
      this._sepCount = 0
      this._yPixels.fill(0)
      this._uvPixels.fill(0)
      console.log('[SSTV] 图像解码: 收到第一个行同步脉冲, 开始解码图像行')
      return
    }

    this._lineTicks++

    if (horSync && this._lineTicks < (this._horLen - this._syncPorchLen)) {
      console.warn('[SSTV] 行解码: 过早的行同步脉冲, 行=' + this._lineY + ' ticks=' + this._lineTicks + ' (期望≥' + (this._horLen - this._syncPorchLen) + '), 重置行')
      this._lineTicks = 0
      this._yPixelX = 0
      this._uvPixelX = 0
    }

    if (horSync &&
        this._lineTicks >= (this._horLen - this._syncPorchLen) &&
        this._lineTicks < (this._horLen + this._syncPorchLen)) {
      this._processLine()
      this._lineY++
      this._reportProgress()

      if (this._lineY >= this.imageHeight) {
        this._onDecodeComplete()
        return
      }

      this._odd ^= 1
      this._lineTicks = 0
      this._yPixelX = 0
      this._uvPixelX = 0
    }

    if (this._lineTicks >= (this._horLen + this._syncPorchLen)) {
      console.warn('[SSTV] 行解码: 行同步丢失/外推, 行=' + this._lineY + ' ticks=' + this._lineTicks + ' yPix=' + this._yPixelX + ' uvPix=' + this._uvPixelX)
      this._processLine()
      this._lineY++
      this._reportProgress()

      if (this._lineY >= this.imageHeight) {
        this._onDecodeComplete()
        return
      }

      this._odd ^= 1
      this._lineTicks -= this._horLen
      this._yPixelX = 0
      this._uvPixelX = 0
    }

    // 间隔检测
    if (this._lineTicks > (this._syncPorchLen + this._yLen) &&
        this._lineTicks < (this._syncPorchLen + this._yLen + this._sepLen)) {
      this._sepCount += datFreq < 1900.0 ? 1 : -1
    }
    if (this._sepCount !== 0 && this._lineTicks > (this._syncPorchLen + this._yLen + this._sepLen)) {
      const prevOdd = this._odd
      this._odd = (this._sepCount < 0) ? 1 : 0
      if (this._odd !== prevOdd) {
        console.log('[SSTV] 行解码: 行列奇偶修正, 行=' + this._lineY + ' odd=' + prevOdd + ' → ' + this._odd + ' sepCount=' + this._sepCount)
      }
      this._sepCount = 0
    }

    // --- 使用模式解码器 ---
    if (this._modeDecoder && this._modeDecoder.decodeScanLine) {
      // 收集一行数据到缓冲区，然后调用模式解码器
      // 为简化，仍使用原有逻辑
      this._decodeLineWithMode(cntFreq, datFreq, drate)
    } else {
      // 原有解码逻辑（兼容）
      this._decodeLineOriginal(cntFreq, datFreq, drate)
    }
  }

  /**
   * 使用模式解码器解码（新架构）
   *
   * 正确逻辑:
   *   1. 持续收集采样数据到 _lineBuf
   *   2. 当检测到同步脉冲时，解码 _lineBuf 中的数据（上一行）
   *   3. 清空 _lineBuf，开始收集下一行
   */
  _decodeLineWithMode(cntFreq, datFreq, drate) {
    // 将当前频率数据归一化后存入行缓冲区
    // 归一化: (freq - 1900) / 400 → [-1, +1]
    const normalizedFreq = (datFreq - 1900.0) / 400.0

    if (!this._lineBuf) {
      this._lineBuf = []
    }
    this._lineBuf.push(normalizedFreq)

    // 检测同步脉冲（行开始）
    const SYNC_TOL = 0.7
    const SYNC_FREQ = 1200.0
    const isSyncPulse = (Math.abs(cntFreq - SYNC_FREQ) < 50.0) &&
                        this._horTicks > Math.floor(SYNC_TOL * this._horSyncLen)

    // 当检测到同步脉冲，且缓冲区中有足够数据时，解码上一行
    if (isSyncPulse && this._lineBuf.length > this._horSyncLen) {
      // 将行缓冲区转为 Float32Array
      const buf = new Float32Array(this._lineBuf)

      // 调用模式解码器
      // syncPulseIndex = 0 (同步脉冲在缓冲区开始位置)
      const result = this._modeDecoder.decodeScanLine(
        buf,
        0,                      // 同步脉冲在缓冲区起始位置
        this._lineBuf.length,   // 本行总采样数
        this.sampleRate,
        0                       // frequencyOffset
      )

      if (result) {
        // 更新图像数据
        if (result.pixels && result.line !== undefined) {
          this._updateImageData(result.pixels, result.width, result.height, result.line)
        }

        this._reportProgress()

        if (result.completed) {
          this._onDecodeComplete()
        }
      }

      // 清空缓冲区，开始收集下一行
      this._lineBuf = []
    }
  }

  /**
   * 将模式解码器输出的像素数据更新到 imageData
   */
  _updateImageData(pixels, width, height, line) {
    if (!this.imageData) {
      this.imageWidth = width
      this.imageHeight = height
      this.imageData = new Uint8ClampedArray(width * height * 4)
    }

    // pixels 是 Uint8ClampedArray (RGBA格式)
    if (pixels && pixels.length > 0) {
      // 对于 Robot36，每次解码输出多行数据
      // 这里需要根据具体模式的输出格式来处理
      const lineSize = width * 4
      const srcLineSize = width * 4

      // 复制解码的行到 imageData
      for (let y = 0; y < height && (line + y) < this.imageHeight; y++) {
        const srcOffset = y * srcLineSize
        const dstOffset = (line + y) * lineSize
        for (let x = 0; x < width * 4; x++) {
          if (srcOffset + x < pixels.length) {
            this.imageData[dstOffset + x] = pixels[srcOffset + x]
          }
        }
      }
    }
  }

  /**
   * 原有解码逻辑（兼容保留）
   */
  _decodeLineOriginal(cntFreq, datFreq, drate) {
    // Y 通道采样
    if (this._yPixelX < this._yWidth && this._lineTicks >= this._syncPorchLen) {
      const yVal = clampf(255.0 * (datFreq - 1500.0) / 800.0, 0.0, 255.0)
      this._yPixels[this._yPixelX + (this._lineY % 2) * this._yWidth] = Math.round(yVal)
      this._yPixelX++
    }

    // UV 通道采样
    const uvStart = this._syncPorchLen + this._yLen + this._sepLen + this._porchLen
    if (this._uvPixelX < this._uvWidth && this._lineTicks >= uvStart) {
      const uvVal = clampf(255.0 * (datFreq - 1500.0) / 800.0, 0.0, 255.0)
      this._uvPixels[this._uvPixelX + this._odd * this._uvWidth] = Math.round(uvVal)
      this._uvPixelX++
    }
  }

  // ========================================================================
  // 行合并与 RGB 转换
  // ========================================================================

  _processLine() {
    if (this._lineY % 2 === 0) return

    if (this._lineY % 20 === 1) {
      console.log('[SSTV] 图像解码: ' + this._lineY + '/' + this.imageHeight + ' 行 (' + Math.floor(this._lineY / this.imageHeight * 100) + '%)')
    }

    const width = this.imageWidth
    const height = this.imageHeight
    const yWidth = this._yWidth
    const uvWidth = this._uvWidth

    for (let l = 0; l < 2; l++) {
      const y = this._lineY - 1 + l
      if (y >= height) break

      const yOffset = l * yWidth
      const uOffset = uvWidth
      const vOffset = 0

      for (let x = 0; x < width; x++) {
        const yXF = (x * yWidth) / width
        const uvXF = (x * uvWidth) / width

        const yX0 = Math.floor(yXF)
        const uvX0 = Math.floor(uvXF)
        const yX1 = Math.min(yWidth - 1, yX0 + 1)
        const uvX1 = Math.min(uvWidth - 1, uvX0 + 1)

        const Y = lerpf(
          this._yPixels[yX0 + yOffset], this._yPixels[yX1 + yOffset],
          yXF - yX0
        )

        const U = lerpf(
          this._uvPixels[uvX0 + uOffset], this._uvPixels[uvX1 + uOffset],
          uvXF - uvX0
        )

        const V = lerpf(
          this._uvPixels[uvX0 + vOffset], this._uvPixels[uvX1 + vOffset],
          uvXF - uvX0
        )

        const px = (y * width + x) * 4
        this.imageData[px] = Math.round(Color.R_YUV(Y, U, V))
        this.imageData[px + 1] = Math.round(Color.G_YUV(Y, U, V))
        this.imageData[px + 2] = Math.round(Color.B_YUV(Y, U, V))
        this.imageData[px + 3] = 255
      }
    }
  }

  _reportProgress() {
    const progress = Math.floor((this._lineY / this.imageHeight) * 100)
    if (this.onProgress && progress !== this._lastProgressLine) {
      this._lastProgressLine = progress
      this.onProgress(progress, this._lineY)
    }
  }

  _onDecodeComplete() {
    if (this._completed) return
    this._completed = true
    this.isDecoding = false

    console.log('[SSTV] 解码完成:', this._lineY, '行')

    if (this.onComplete) {
      this.onComplete(this.imageData, this.imageWidth, this.imageHeight)
    }
  }
}

module.exports = SSTVDecoder
