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

// 带时间戳的日志辅助函数
const _log = (msg) => {
  const d = new Date()
  const ts = d.getHours().toString().padStart(2, '0') + ':' +
    d.getMinutes().toString().padStart(2, '0') + ':' +
    d.getSeconds().toString().padStart(2, '0') + '.' +
    d.getMilliseconds().toString().padStart(3, '0')
  console.log('[' + ts + '] ' + msg)
}

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

    // ===== 频率历史环形缓冲 (Robot36 scanLineBuffer) =====
    this._FREQ_BUF_SIZE = this.sampleRate * 2  // 2秒
    this._freqBuf = new Float32Array(this._FREQ_BUF_SIZE)
    this._freqBufIdx = 0           // 当前写入位置
    this._freqBufTotal = 0         // 已写入总数
    this._freqBufPhase0Count = 0   // phase=0 期间已写入数量

    // ===== 校准头检测 (Robot36 handleHeader 风格) =====
    this._calBreakBufIdx = -1      // 检测到潜在 break 时的 freqBufIdx
    this._calBreakSamples = 0      // break 持续样本数
    this._calLeaderPreSamples = 0  // break 前的 leader 持续样本数
    this._calLeaderPostStart = 0   // break 后的 leader 开始样本号
    this._calCheckCount = 0        // 尝试验证次数（用于降级日志频率）

    // ===== VIS 解码 (Robot36 风格: 10-bit 含起止位+奇偶校验) =====
    this._visBits = new Int32Array(10)
    this._visBitIdx = 0
    this._visBufStart = 0
    this._visBitsReady = false

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
      _log('[SSTV] 首帧音频: 样本数=' + frameBuffer.length +
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
          _log('[SSTV] 静音超时, 提前结束解码 (lineY=' + this._lineY + ', silenceCount=' + this.silenceCount + ')')
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
        const calStateNames = ['搜寻leader', 'leader确认', 'break中', '等待验证', '???']
        extraInfo = ' calState=' + (calStateNames[this._calState] || '?') +
          ' leaderPre=' + Math.round((this._calLeaderPreSamples || 0) / drate * 1000) + 'ms' +
          ' break=' + Math.round((this._calBreakSamples || 0) / drate * 1000) + 'ms' +
          ' leaderPost=' + Math.round(((this._calLeaderPostSamples || 0)) / drate * 1000) + 'ms'
        // SMA 平均频率（只有 datWins时更新）
        if (this._calDatSMA && this._calDatSMA.cnt > 0) {
          const smaAvg = this._calDatSMA.sum / this._calDatSMA.cnt
          extraInfo += ' datAvgSMA=' + smaAvg.toFixed(0) + 'Hz SMAcnt=' + this._calDatSMA.cnt + '/200'
        }
        if (this._calLeaderStart) {
          extraInfo += ' leadAcc=' + this._calLeaderStart + '/' + Math.floor(0.1 * drate)
        }
        if (this._datFreqCount > 0) {
          extraInfo += ' datFreq[' + this._datFreqMin.toFixed(0) + '~' +
            (this._datFreqSum / this._datFreqCount).toFixed(0) + '~' +
            this._datFreqMax.toFixed(0) + '] n=' + this._datFreqCount
        }
        // 环形缓冲统计
        if (this._freqBufTotal > 0) {
          extraInfo += ' freqBuf=' + (this._freqBufTotal / drate).toFixed(1) + 's'
        }
      }
      _log('[SSTV] 状态: phase=' + phaseNames[this._phase] + ' lineY=' + this._lineY +
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

    // --- 频率历史环形缓冲 ---
    // 写入归一化频率: (freq - 1900) / 400 → 1500→-1, 1900→0, 2300→+1
    this._freqBuf[this._freqBufIdx] = (finalDatFreq - 1900.0) / 400.0
    this._freqBufIdx = (this._freqBufIdx + 1) % this._FREQ_BUF_SIZE
    this._freqBufTotal++
    if (this._phase === 0) this._freqBufPhase0Count++

    // --- 状态机 ---
    switch (this._phase) {
      case 0: // 搜寻校准头
        if (this._checkCalHeader(finalCntFreq, finalDatFreq, drate, !cntWins)) {
          // 校准头已确认，暂停并将控制转给 VIS 解码
          this._phase = 1
          this._resetVIS()
        }
        break

      case 1: { // VIS 解码
        const visResult = this._checkVISCode(finalCntFreq, finalDatFreq, drate)
        if (visResult !== null) {
          if (visResult.valid) {
            _log('[SSTV] VIS = 0x' + visResult.code.toString(16) +
              ' (bin=' + visResult.code.toString(2).padStart(8, '0') +
              ') 原始位=' + JSON.stringify(visResult.bits))
            if (visResult.code === 0x88 || visResult.code === 8) {
              this._imgReady = true
              this._modeVisCode = visResult.code & 0x7F  // 去掉校验位
              const mode = _createModeDecoder(this._modeVisCode, this.sampleRate)
              if (mode) {
                _log('[SSTV] 使用模式解码器: ' + mode.getName())
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
              _log('[SSTV] 开始解码图像')
            } else {
              _log('[SSTV] [WARN] VIS 不支持: 0x' + visResult.code.toString(16) + ', 回到校准头搜寻')
              this._phase = 0
            }
          } else {
            _log('[SSTV] [WARN] VIS 校验失败, 回到校准头搜寻')
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
    _log('[SSTV] 创建模式解码器: VIS=' + visCode)

    // Robot 36 Color
    if (visCode === 8) {
      return new Robot36ColorDecoder(sampleRate)
    }

    // TODO: 在此添加更多模式
    // if (visCode === 60) { return new Scottie1Decoder(sampleRate) }
    // if (visCode === 36) { return new Martin1Decoder(sampleRate) }

    _log('[SSTV] [WARN] 不支持的 VIS 代码: ' + visCode)
    return null
  }

  // ========================================================================
  // 校准头检测 (Robot36 handleHeader 风格, 基于频率缓冲区)
  // ========================================================================

  _resetCalHeader() {
    this._calBreakBufIdx = -1
    this._calBreakSamples = 0
    this._calLeaderPreSamples = 0
    this._calLeaderPostStart = 0
    this._calCheckCount = 0
  }

  /**
   * Robot36 风格校准头检测
   *
   * 原理: 不在逐样本 EMA 上检测 leader/break（噪声太大），
   * 而是基于频率环形缓冲区 _freqBuf 做区域平均验证。
   *
   * Robot36 核心参数:
   *   leaderToneFrequency  = 1900 Hz
   *   toleranceFrequency   = 50 Hz   (理想, 手机声学放宽到 100Hz)
   *   stopBitFrequency     = 1200 Hz
   *   pulseThresholdFreq   = 1550 Hz (1900+1200)/2, 下降沿判断
   *   leaderToneSeconds    = 0.3s
   *   leaderToneTolerance  = 0.06s (20%)
   */
  _checkCalHeader(cntFreq, datFreq, drate, datWins) {
    const TRIG_LOW = 1250.0   // Schmitt 下阈值: cntFreq 低于此 → break 激活
    const TRIG_HIGH = 1350.0  // Schmitt 上阈值: cntFreq 高于此 → break 释放
    const LEADER_MIN_AVG = 1800.0  // leader 最低平均频率
    const LEADER_MAX_AVG = 2000.0  // leader 最高平均频率
    const BREAK_MIN_SAMPLES = Math.floor(0.007 * drate)  // 7ms
    const BREAK_MAX_SAMPLES = Math.floor(0.014 * drate)  // 14ms (Break 10ms ± tolerance)
    const LEADER_MIN_SAMPLES = Math.floor(0.2 * drate)   // 200ms (300ms - 33% tolerance)

    // ===== 状态机 =====
    // 0=搜寻leader, 1=检测到leader, 2=break开始, 3=break结束等待验证
    if (!this._calState) this._calState = 0
    if (!this._calLeaderStart) this._calLeaderStart = 0

    // 累计数据通道 SMA —— 只在 datWins 时写入, 避免 cntWins 的 1500Hz 假值污染
    // SMA 窗口 200 样本（25ms@8kHz），足够平滑相位噪声
    const SMA_SIZE = 200
    if (!this._calDatSMA) { this._calDatSMA = { sum: 0, cnt: 0, buf: new Float32Array(SMA_SIZE) }; this._calDatSMAPos = 0 }
    if (datWins) {
      const oldVal = this._calDatSMA.buf[this._calDatSMAPos]
      this._calDatSMA.buf[this._calDatSMAPos] = datFreq
      this._calDatSMAPos = (this._calDatSMAPos + 1) % SMA_SIZE
      if (this._calDatSMA.cnt < SMA_SIZE) { this._calDatSMA.sum += datFreq; this._calDatSMA.cnt++ }
      else { this._calDatSMA.sum += datFreq - oldVal }
    }
    const datAvg = this._calDatSMA.sum / Math.max(1, this._calDatSMA.cnt)

    // 累计控制通道 20样本滑动平均（1.25ms 窗口 — 可检测 10ms break）
    if (!this._calCntSMA) { this._calCntSMA = { sum: 0, cnt: 0, buf: new Float32Array(20) }; this._calCntSMAPos = 0 }
    const oldCnt = this._calCntSMA.buf[this._calCntSMAPos]
    this._calCntSMA.buf[this._calCntSMAPos] = cntFreq
    this._calCntSMAPos = (this._calCntSMAPos + 1) % 20
    if (this._calCntSMA.cnt < 20) { this._calCntSMA.sum += cntFreq; this._calCntSMA.cnt++ }
    else { this._calCntSMA.sum += cntFreq - oldCnt }
    const cntAvg = this._calCntSMA.sum / Math.max(1, this._calCntSMA.cnt)

    // Schmitt trigger for break detection
    if (!this._calTrigger) this._calTrigger = false
    if (cntAvg < TRIG_LOW) this._calTrigger = true
    else if (cntAvg > TRIG_HIGH) this._calTrigger = false

    // 记录 break 前的 leader 持续样本数
    if (datAvg >= LEADER_MIN_AVG && datAvg <= LEADER_MAX_AVG && !this._calTrigger) {
      this._calLeaderPreSamples++
      // 标记 leader 起始（用于 _freqBuf 中定位）
      if (!this._calLeaderBegin) this._calLeaderBegin = this._freqBufTotal
    } else if (this._calTrigger) {
      // 进入 break，记录 leader 起始
      if (!this._calLeaderBegin && this._calLeaderPreSamples > 0) {
        this._calLeaderBegin = this._freqBufTotal - this._calLeaderPreSamples
      }
    }

    // ===== 状态转换 =====
    switch (this._calState) {
      case 0: // 搜寻 leader
        if (datAvg >= LEADER_MIN_AVG && datAvg <= LEADER_MAX_AVG) {
          this._calLeaderStart = (this._calLeaderStart || 0) + 1
          if (this._calLeaderStart >= Math.floor(0.1 * drate)) { // 100ms
            this._calState = 1
            this._calLeaderPreSamples = this._calLeaderStart
            this._calLeaderBegin = this._freqBufTotal - this._calLeaderStart
            _log('[SSTV] 校准头: 检测到 leader 信号 (1900Hz), 持续 ' +
              (this._calLeaderStart / drate * 1000).toFixed(0) + 'ms, datAvg=' + datAvg.toFixed(0) + 'Hz')
          }
        } else {
          this._calLeaderStart = 0
        }
        break

      case 1: { // leader 已确认, 等待 break
        if (datAvg >= LEADER_MIN_AVG && datAvg <= LEADER_MAX_AVG) {
          this._calLeaderPreSamples++
        }

        if (!this._calTrigger) {
          this._calBreakSamples = 0
          break
        }
        this._calBreakSamples++
        if (this._calBreakSamples >= BREAK_MIN_SAMPLES) {
          this._calState = 2
          this._calBreakBufIdx = this._freqBufTotal - this._calBreakSamples
          _log('[SSTV] 校准头: break 下降沿 (cntAvg=' + cntAvg.toFixed(0) +
            'Hz < ' + TRIG_LOW + 'Hz), breakSamples=' + this._calBreakSamples +
            ', 前导leader ' + (this._calLeaderPreSamples / drate * 1000).toFixed(0) + 'ms')
        }
        break
      }

      case 2: { // break 中 —— 不再等待 Schmitt trigger 释放（cntAvg 在 leader 期间升不到 TRIG_HIGH）
        // 直接按 break 持续时间判断：7~14ms 即判定为有效 break 并进入状态3
        this._calBreakSamples++
        if (this._calBreakSamples > BREAK_MAX_SAMPLES) {
          // break 过长, 不是校准头, 重置
          this._logCalFail('break 过长 (' + (this._calBreakSamples / drate * 1000).toFixed(0) + 'ms > ' +
            (BREAK_MAX_SAMPLES / drate * 1000).toFixed(0) + 'ms)')
          this._calState = 0
          this._calLeaderPreSamples = 0
          this._calBreakSamples = 0
          this._calLeaderBegin = 0
          break
        }
        // 在 BREAK_MIN~BREAK_MAX 范围内，进入状态3等待第二个leader
        if (this._calBreakSamples >= BREAK_MIN_SAMPLES) {
          this._calState = 3
          this._calLeaderPostStart = this._freqBufTotal
          this._calBreakBufIdx = this._freqBufTotal - this._calBreakSamples
          _log('[SSTV] 校准头: break 结束 (持续 ' +
            (this._calBreakSamples / drate * 1000).toFixed(0) + 'ms, datAvg=' + datAvg.toFixed(0) +
            ' cntAvg=' + cntAvg.toFixed(0) + '), 等待第二个 leader')
        }
        break
      }

      case 3: { // 等待第二个 leader + 缓冲区验证
        if (datAvg >= LEADER_MIN_AVG && datAvg <= LEADER_MAX_AVG) {
          this._calLeaderPostSamples = (this._calLeaderPostSamples || 0) + 1
        }

        // 累积足够第二个 leader 数据后, 执行 Robot36 缓冲区验证
        const postMinSamples = Math.floor(0.25 * drate)  // 250ms (验证需要200ms, 留余量)
        if ((this._calLeaderPostSamples || 0) >= postMinSamples) {
          const verified = this._verifyCalHeaderFromBuffer(drate)
          if (verified) {
            this._calState = 0
            this._calLeaderPreSamples = 0
            this._calBreakSamples = 0
            this._calLeaderPostSamples = 0
            this._calLeaderBegin = 0
            this._calLeaderStart = 0
            // 计算 VIS 解码在缓冲区中的起始位置
            const breakBufIdx = this._calBreakBufIdx
            this._visBufStart = breakBufIdx + this._calBreakSamples
            this._visBitsReady = true
            return true
          }
          this._calState = 0
          this._calLeaderPreSamples = 0
          this._calBreakSamples = 0
          this._calLeaderPostSamples = 0
          this._calLeaderBegin = 0
          this._calLeaderStart = 0
        }
        break
      }
    }

    return false
  }

  /**
   * Robot36 缓冲区验证: 在频率历史缓冲中验证校准头三件套
   *   1. Break 前 300ms 区域平均频率 ≈ 1900±100Hz
   *   2. Break 后 300ms 区域平均频率 ≈ 1900±100Hz
   *   3. 找到 1550Hz 下降沿
   *
   * @returns {boolean} 验证通过
   */
  _verifyCalHeaderFromBuffer(drate) {
    const buf = this._freqBuf
    const bufSize = this._FREQ_BUF_SIZE
    const total = this._freqBufTotal
    const breakBufIdx = this._calBreakBufIdx  // break 开始的缓冲区位置
    const breakSamples = this._calBreakSamples

    // 计算缓冲区偏移
    const bufIdxToOffset = (idx) => {
      // idx 是绝对写入编号, total 是最新写入的编号
      // offset=0 = 最新写入的样本
      return total - idx - 1
    }

    const readFreq = (bufIdx, offsetFrom, count) => {
      let sum = 0
      let valid = 0
      for (let i = 0; i < count; i++) {
        const sampleIdx = bufIdx + offsetFrom + i
        const offset = bufIdxToOffset(sampleIdx)
        if (offset < 0 || offset >= bufSize) continue
        const ringIdx = (this._freqBufIdx - 1 - offset + bufSize * 2) % bufSize
        sum += buf[ringIdx] * 400.0 + 1900.0  // 反归一化
        valid++
      }
      return valid > 0 ? sum / valid : 0
    }

    const LEADER_LEN_S = 0.3
    const LEADER_TOL_S = 0.06  // 20%
    const TOLERANCE = 100.0
    const BREAK_THRESHOLD = 1550.0  // (1900+1200)/2

    // ===== 1. 验证 break 前的 leader =====
    const preTransition = Math.floor(0.003 * drate)  // 3ms 过渡区
    const preVerSamples = Math.floor(LEADER_TOL_S * drate)
    const preLeaderStart = breakBufIdx - Math.floor(0.03 * drate) - preVerSamples
    const preAvgFreq = readFreq(breakBufIdx, -Math.floor(0.03 * drate) - preVerSamples, preVerSamples)

    if (Math.abs(preAvgFreq - 1900.0) > TOLERANCE) {
      this._logCalFail('break前leader频率偏差: ' + preAvgFreq.toFixed(0) + 'Hz (需 1900±' + TOLERANCE + 'Hz)')
      return false
    }
    _log('[SSTV] 校准头验证: break前leader频率=' + preAvgFreq.toFixed(0) + 'Hz ✓')

    // ===== 2. 验证 break 后的 leader（跳过过渡区域）=====
    const postTransition = Math.floor(0.005 * drate)  // 5ms 过渡
    const postVerSamples = Math.floor(0.2 * drate)  // 200ms
    const postAvgFreq = readFreq(breakBufIdx + breakSamples + postTransition, 0, postVerSamples)

    if (Math.abs(postAvgFreq - 1900.0) > TOLERANCE) {
      this._logCalFail('break后leader频率偏差: ' + postAvgFreq.toFixed(0) + 'Hz (需 1900±' + TOLERANCE + 'Hz)')
      return false
    }
    _log('[SSTV] 校准头验证: break后leader频率=' + postAvgFreq.toFixed(0) + 'Hz ✓')

    // ===== 3. 找到 1550Hz 下降沿（VIS 码起始点）=====
    const searchStart = breakBufIdx + Math.floor(LEADER_LEN_S * drate) - Math.floor(LEADER_TOL_S * drate)
    const searchEnd = breakBufIdx + Math.floor(LEADER_LEN_S * drate) + Math.floor(LEADER_TOL_S * drate) +
      Math.floor(0.03 * drate)  // +1 VIS bit
    let visBeginIdx = -1

    for (let i = searchStart; i < searchEnd; i++) {
      const offset = bufIdxToOffset(i)
      if (offset < 0 || offset >= bufSize) continue
      const ringIdx = (this._freqBufIdx - 1 - offset + bufSize * 2) % bufSize
      const freq = buf[ringIdx] * 400.0 + 1900.0
      if (freq < BREAK_THRESHOLD) {
        visBeginIdx = i
        break
      }
    }

    if (visBeginIdx < 0) {
      this._logCalFail('未找到 1550Hz 下降沿 (breakBufIdx=' + breakBufIdx +
        ' search[' + searchStart + '~' + searchEnd + '])')
      return false
    }

    _log('[SSTV] 校准头验证: 找到1550Hz下降沿 ✓ (visBeginIdx=' + visBeginIdx +
      ', break后leader=' + postAvgFreq.toFixed(0) + 'Hz, 进入校准头检测成功)')
    this._visBufStart = visBeginIdx
    this._visBitsReady = true
    return true
  }

  _logCalFail(reason) {
    // 降级日志: 每 50 次才输出一次
    if (!this._calFailCount) this._calFailCount = 0
    this._calFailCount++
    if (this._calFailCount % 5 === 1) {
      _log('[SSTV] 校准头验证失败 #' + this._calFailCount + ': ' + reason +
        ' (共 ' + (this._freqBufTotal / this.sampleRate).toFixed(1) + ' 秒音频)')
    }
  }

  // ========================================================================
  // VIS 解码 (Robot36 风格: 频率缓冲区 + 起止位 + 奇偶校验)
  // ========================================================================

  _resetVIS() {
    this._visBits.fill(0)
    this._visBitIdx = 0
    this._visBitsReady = true  // 校准头已验证, VIS 已可用
    this._visByte = 0
    this._visDone = false
    // VIS 解码不需要逐样本状态机了, 用缓冲区
    this._visDecoded = false
    _log('[SSTV] VIS解码准备: visBufStart=' + this._visBufStart +
      ' (缓冲中有 ' + (this._freqBufTotal - this._visBufStart) + ' 个后续样本)')
  }

  /**
   * Robot36 风格 VIS 解码: 从频率缓冲区读取
   *
   * VIS 格式: 10 bits × 30ms = 300ms
   *   bit[0]: Start bit = 1200Hz
   *   bit[1-7]: 7 data bits (1100Hz=1, 1300Hz=0)
   *   bit[8]: Parity bit (偶校验)
   *   bit[9]: Stop bit = 1200Hz
   *
   * 容差: ±50Hz
   */
  _checkVISCode(cntFreq, datFreq, drate) {
    // 如果已经解码完成, 不再重复
    if (this._visDecoded) return null

    if (!this._visBitsReady) return null
    this._visBitsReady = false  // 只执行一次

    const visBitSamples = Math.floor(0.03 * drate)  // 30ms per bit
    const transitionSamples = Math.floor(0.003 * drate)  // 3ms 过渡
    const buf = this._freqBuf
    const bufSize = this._FREQ_BUF_SIZE

    // 计算 VIS 解码需要的总样本数
    const totalVisSamples = 10 * visBitSamples
    const available = this._freqBufTotal - this._visBufStart

    if (available < totalVisSamples) {
      _log('[SSTV] [WARN] VIS: 缓冲数据不足 (需要:' + totalVisSamples + ' 可用:' + available + ')')
      return null
    }

    // 辅助函数: 从缓冲区读取指定偏移的频率值（归一化 → 真实频率）
    const readFreqAtOffset = (offset) => {
      const sampleIdx = this._visBufStart + offset
      const bufOffset = this._freqBufTotal - sampleIdx - 1
      if (bufOffset < 0 || bufOffset >= bufSize) return 0
      const ringIdx = (this._freqBufIdx - 1 - bufOffset + bufSize * 2) % bufSize
      return buf[ringIdx] * 400.0 + 1900.0
    }

    // 对每个 bit 积分频率（跳过过渡区）
    const bitFreqs = new Float64Array(10)
    const validSamples = visBitSamples - 2 * transitionSamples

    for (let j = 0; j < 10; j++) {
      let sum = 0
      let cnt = 0
      for (let i = transitionSamples; i < visBitSamples - transitionSamples; i++) {
        const offset = j * visBitSamples + i
        if (offset < totalVisSamples) {
          sum += readFreqAtOffset(offset)
          cnt++
        }
      }
      bitFreqs[j] = cnt > 0 ? sum / cnt : 0
    }

    const STOP_FREQ = 1200.0
    const ONE_FREQ = 1100.0
    const ZERO_FREQ = 1300.0
    const TOLERANCE = 100.0  // 放宽到 100Hz 容忍声学失真

    // 详细位日志
    const bitLabels = ['Start', '0', '1', '2', '3', '4', '5', '6', 'Parity', 'Stop']
    let bitLog = ''
    for (let i = 0; i < 10; i++) {
      bitLog += ' [' + bitLabels[i] + ']=' + bitFreqs[i].toFixed(0) + 'Hz'
    }
    _log('[SSTV] VIS: 10位频率' + bitLog)

    // ===== 1. 起止位验证 =====
    if (Math.abs(bitFreqs[0] - STOP_FREQ) > TOLERANCE) {
      _log('[SSTV] [WARN] VIS失败: Start bit 频率偏差 (期望1200Hz, 实际' + bitFreqs[0].toFixed(0) + 'Hz, 容差' + TOLERANCE + 'Hz)')
      this._visDecoded = true
      return { code: 0, valid: false, bits: Array.from(bitFreqs), failReason: 'START_BIT' }
    }
    if (Math.abs(bitFreqs[9] - STOP_FREQ) > TOLERANCE) {
      _log('[SSTV] [WARN] VIS失败: Stop bit 频率偏差 (期望1200Hz, 实际' + bitFreqs[9].toFixed(0) + 'Hz, 容差' + TOLERANCE + 'Hz)')
      this._visDecoded = true
      return { code: 0, valid: false, bits: Array.from(bitFreqs), failReason: 'STOP_BIT' }
    }

    // ===== 2. 数据位验证（每 bit 必须接近 1100 或 1300）=====
    const dataBits = []
    for (let i = 1; i < 9; i++) {
      const distToOne = Math.abs(bitFreqs[i] - ONE_FREQ)
      const distToZero = Math.abs(bitFreqs[i] - ZERO_FREQ)
      if (distToOne > TOLERANCE && distToZero > TOLERANCE) {
        _log('[SSTV] [WARN] VIS失败: bit[' + (i - 1) + '] 频率模糊 (实际' + bitFreqs[i].toFixed(0) +
          'Hz, 期望1100或1300±' + TOLERANCE + 'Hz)')
        this._visDecoded = true
        return { code: 0, valid: false, bits: Array.from(bitFreqs), failReason: 'BIT_' + (i - 1) + '_AMBIGUOUS' }
      }
      dataBits.push(distToOne < distToZero ? 1 : 0)
    }

    // ===== 3. 组合 7 位数据 + 奇偶校验 =====
    let visCode = 0
    for (let i = 0; i < 7; i++) {
      visCode |= (dataBits[i]) << i
    }
    const parityBit = dataBits[7]

    // 偶校验
    let check = true
    for (let i = 0; i < 7; i++) {
      check ^= ((visCode >> i) & 1) !== 0
    }

    _log('[SSTV] VIS: 7位数据=' + visCode + ' (0x' + visCode.toString(16) +
      ' bin=' + visCode.toString(2).padStart(7, '0') +
      ') 校验位=' + parityBit + ' 偶校验=' + (check ? '✓' : '✗'))

    if (!check) {
      _log('[SSTV] [WARN] VIS失败: 偶校验不通过 (高8位原始码=0x' + (visCode | (parityBit << 7)).toString(16) + ')')
      this._visDecoded = true
      return { code: visCode | (parityBit << 7), valid: false, bits: Array.from(bitFreqs), failReason: 'PARITY' }
    }

    // ===== 4. 成功 =====
    this._visDecoded = true
    const fullCode = visCode | (parityBit << 7)  // 0x88 for Robot36
    const modeName = (visCode === 8) ? 'Robot36 Color' :
      (visCode === 12) ? 'Robot72 Color' :
      (visCode === 60) ? 'Scottie 1' :
      (visCode === 56) ? 'Scottie 2' :
      (visCode === 76) ? 'Scottie DX' :
      (visCode === 44) ? 'Martin 1' :
      (visCode === 40) ? 'Martin 2' : 'Unknown'
    _log('[SSTV] VIS成功: 模式=' + modeName + ' (0x' + fullCode.toString(16) + ')')

    return { code: fullCode, valid: true, bits: Array.from(bitFreqs) }
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
      _log('[SSTV] 图像解码: 收到第一个行同步脉冲, 开始解码图像行')
      return
    }

    this._lineTicks++

    if (horSync && this._lineTicks < (this._horLen - this._syncPorchLen)) {
      _log('[SSTV] [WARN] 行解码: 过早的行同步脉冲, 行=' + this._lineY + ' ticks=' + this._lineTicks + ' (期望≥' + (this._horLen - this._syncPorchLen) + '), 重置行')
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
      _log('[SSTV] [WARN] 行解码: 行同步丢失/外推, 行=' + this._lineY + ' ticks=' + this._lineTicks + ' yPix=' + this._yPixelX + ' uvPix=' + this._uvPixelX)
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
        _log('[SSTV] 行解码: 行列奇偶修正, 行=' + this._lineY + ' odd=' + prevOdd + ' → ' + this._odd + ' sepCount=' + this._sepCount)
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
      _log('[SSTV] 图像解码: ' + this._lineY + '/' + this.imageHeight + ' 行 (' + Math.floor(this._lineY / this.imageHeight * 100) + '%)')
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

    _log('[SSTV] 解码完成:', this._lineY, '行')

    if (this.onComplete) {
      this.onComplete(this.imageData, this.imageWidth, this.imageHeight)
    }
  }
}

module.exports = SSTVDecoder
