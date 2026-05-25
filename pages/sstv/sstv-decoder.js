/**
 * SSTV Robot36 解码器
 * 基于 xdsopl/robot36 (https://github.com/xdsopl/robot36) 的 C 实现移植
 *
 * 核心算法: 双通道 Digital Down Conversion (DDC) + 相位差瞬时频率估计
 *   - 控制通道: 1200Hz 载波, 200Hz 带宽 → 行同步 + VIS 解码
 *   - 数据通道: 1900Hz 载波, 800Hz 带宽 → 像素值 (Y/U/V)
 *   - 通道幅度竞争: 幅度大的通道获胜，另一方钳位到默认值
 *
 * 关键时序 (Robot36 标准, 每行 150ms, 总 240 行 ≈ 36s):
 *   H-Sync(1200Hz,9ms) + SyncPorch(1500Hz,3ms) + Y(1500-2300Hz,88ms/320px)
 *   + Separator(1500/2300Hz,4.5ms) + Porch(1900Hz,1.5ms) + UV(1500-2300Hz,44ms/160px)
 *   偶数行: Y + B-Y(U), 奇数行: Y + R-Y(V), 两行合并一扫描线
 */

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
// 颜色转换 (BT.601 SD, 对应 C 版本 yuv.c)
// ============================================================================

const BT601_Y_SCALE = 298.082
const BT601_RV_SCALE = 408.583   // R = Y + 1.371*Cr
const BT601_GU_SCALE = -100.291  // G component for U
const BT601_GV_SCALE = -208.12   // G component for V
const BT601_BU_SCALE = 516.411   // B = Y + 1.731*Cb
const BT601_FACTOR = 0.003906  // 1/256

function R_YUV(Y, U, V) {
  return clampf(BT601_FACTOR * (BT601_Y_SCALE * (Y - 16) + BT601_RV_SCALE * (V - 128)), 0, 255)
}

function G_YUV(Y, U, V) {
  return clampf(BT601_FACTOR * (BT601_Y_SCALE * (Y - 16) + BT601_GU_SCALE * (U - 128) + BT601_GV_SCALE * (V - 128)), 0, 255)
}

function B_YUV(Y, U, V) {
  return clampf(BT601_FACTOR * (BT601_Y_SCALE * (Y - 16) + BT601_BU_SCALE * (U - 128)), 0, 255)
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
  const Q = 1.0 / Math.SQRT2 // Butterworth Q
  const omega = 2.0 * Math.PI * cutoffHz / sampleRate
  const sinW = Math.sin(omega)
  const cosW = Math.cos(omega)
  const alpha = sinW / (2.0 * Q)

  // biquad coefficients
  const b0 = (1.0 - cosW) / 2.0
  const b1 = 1.0 - cosW
  const b2 = (1.0 - cosW) / 2.0
  const a0 = 1.0 + alpha
  const a1 = -2.0 * cosW
  const a2 = 1.0 - alpha

  // 归一化
  const invA0 = 1.0 / a0
  const nb0 = b0 * invA0
  const nb1 = b1 * invA0
  const nb2 = b2 * invA0
  const na1 = a1 * invA0
  const na2 = a2 * invA0

  // 延迟寄存器 (复数)
  let x1 = { re: 0, im: 0 }, x2 = { re: 0, im: 0 }
  let y1 = { re: 0, im: 0 }, y2 = { re: 0, im: 0 }

  return function(input) {
    // y = b0*x + b1*x1 + b2*x2 - a1*y1 - a2*y2
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
// 对应 C 版本 ddc.c + decode.c 的 demodulate()
// ============================================================================

function createDDCChannel(carrierFreq, bwHz, sampleRate) {
  // 混频器: 乘以 e^(-j*2π*f_c*n/fs) 将信号搬移到 DC
  let phase = 0
  const phaseStep = (2.0 * Math.PI * carrierFreq) / sampleRate

  // 2阶 Butterworth LPF (截止频率 = bwHz)
  const lpf = createButterworthLPF(bwHz, sampleRate)

  let lastOut = null

  return {
    process(sample) {
      // 下混频
      const cosVal = Math.cos(-phase)
      const sinVal = Math.sin(-phase)
      const mixed = {
        re: sample * cosVal - 0 * sinVal,
        im: sample * sinVal + 0 * cosVal
      }
      phase += phaseStep
      if (phase > 2.0 * Math.PI) phase -= 2.0 * Math.PI

      // 低通滤波
      const filtered = lpf(mixed)
      lastOut = filtered
      return filtered
    },

    /** 获取瞬时频率: fc + angle(out_n * conj(out_n-1)) / (2π*Ts) */
    getInstantFreq(prevOut) {
      if (!lastOut || !prevOut) return carrierFreq
      const cross = cmul(lastOut, { re: prevOut.re, im: -prevOut.im })
      const dstep = 1.0 / sampleRate
      return carrierFreq + carg(cross) / (2.0 * Math.PI * dstep)
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
// 主解码器
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

    // -- 状态机 (对应 C 版本 main()) --
    // 阶段: 0=搜寻校准头, 1=VIS解码, 2=图像数据
    this._phase = 0
    // 图像解码是否就绪 (收到合法 VIS 才设置)
    this._imgReady = false
    // 解码完成
    this._completed = false

    // -- 校准头检测 (cal_header) --
    this._calAvg = 1900.0
    this._calBreakTicks = 0
    this._calLeaderTicks = 0
    this._calTicks = -1
    this._calGotBreak = false
    this._calFound = false
    this._calFreqAcc = 0
    this._calFreqAccCnt = 0

    // -- VIS 解码 (vis_code) --
    this._visSS = 0     // start/stop ticks
    this._visLo = 0     // 1300Hz ticks
    this._visHi = 0     // 1100Hz ticks
    this._visTicks = -1
    this._visBit = -1
    this._visByte = 0
    this._visDone = false

    // -- 行解码 (decode) --
    this._initTiming()
    this._resetLineState()

    // 静音检测
    this.lastAudioTime = 0
    this.silenceCount = 0

    // 进度上报
    this._lastProgressLine = 0

    // 日志计数器
    this._sampleCount = 0
    this._logInterval = this.sampleRate * 2 // 每 2 秒输出一次状态

    // DDC 振幅统计 (诊断用)
    this._cntMagSum = 0
    this._datMagSum = 0
    this._cntWinCount = 0
    this._cntWins = false
    this._frameCount = 0
    this._rawAmpSum = 0
    this._rawAmpPeak = 0
    // datFreq 原始采样分布统计
    this._datFreqMin = 3000
    this._datFreqMax = 0
    this._datFreqSum = 0
    this._datFreqCount = 0
  }

  // 初始化时序参数 (ms → samples)
  _initTiming() {
    const r = this.sampleRate
    this._syncPorchLen = Math.round(0.003 * r)     // 3ms
    this._porchLen = Math.round(0.0015 * r)         // 1.5ms
    this._yLen = Math.round(0.088 * r)              // 88ms
    this._uvLen = Math.round(0.044 * r)             // 44ms
    this._horLen = Math.round(0.15 * r)             // 150ms
    this._horSyncLen = Math.round(0.009 * r)        // 9ms
    this._sepLen = Math.round(0.0045 * r)           // 4.5ms

    this._yWidth = this._yLen     // Y: 1 sample = 1 pixel
    this._uvWidth = this._uvLen   // UV: 1 sample = 1 pixel (sub-sampled 2:1)

    // 像素缓冲 (2行)
    this._yPixels = new Uint8Array(this._yWidth * 2)
    this._uvPixels = new Uint8Array(this._uvWidth * 2)
  }

  _resetLineState() {
    this._horTicks = 0
    this._latchSync = false
    this._initDone = false
    this._lineY = 0
    this._odd = 0           // 0=even(U), 1=odd(V)
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

    // 第一期帧时输出音频信号强度
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

    // 批量处理: 每次处理尽可能多的样本以防止缓冲积压
    // 每帧预期 512 样本 (1KB Int16 @ 8kHz), 处理 2000 保证吞吐量
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
  // 逐样本处理 (对应 C 版本 main() 主循环)
  // ========================================================================

  _processSample(sample) {
    // --- DDC 解调 ---
    const cntOut = this._cntDDC.process(sample)
    const datOut = this._datDDC.process(sample)

    const cntFreq = this._cntDDC.getInstantFreq(this._prevCntOut)
    const datFreq = this._datDDC.getInstantFreq(this._prevDatOut)

    // 通道主导判定 (用平方幅度避免 sqrt)
    const cntMag2 = cntOut.re * cntOut.re + cntOut.im * cntOut.im
    const datMag2 = datOut.re * datOut.re + datOut.im * datOut.im
    const cntWins = cntMag2 > datMag2
    this._cntWins = cntWins

    let finalCntFreq, finalDatFreq
    if (cntWins) {
      finalCntFreq = cntFreq
      finalDatFreq = 1500.0 // 钳位: 无数据
    } else {
      finalCntFreq = 1300.0 // 钳位: 无同步
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
    // datFreq 原始值统计 (仅 dat 胜出时有效)
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
      // 校准头状态
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
            // Robot36 VIS code = 0x88 (mode 8, even parity)
            if (visResult.code === 0x88) {
              this._imgReady = true
              this._resetLineState()
              this._phase = 2
              console.log('[SSTV] 开始解码 Robot36 图像')
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
  // 校准头检测 (对应 C 版本 cal_header)
  // 检测模式: 1900Hz leader + 1200Hz break + 1900Hz leader
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

    // 数据通道频率窗口平均 → 消除相位噪声
    // 每 FRQ_WIN_SAMPLES 个 dat 胜出的样本计算一次均值再送入 EMA
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

    // 1200Hz break 检测 (通过 cnt 通道)
    this._calBreakTicks = (Math.abs(cntFreq - 1200.0) < 80.0)
      ? this._calBreakTicks + 1 : 0

    // 1900Hz leader 检测 (通过 EMA 平滑后的 dat 频率)
    // 放宽到 ±100Hz 容忍声学路径失真
    this._calLeaderTicks = (Math.abs(this._calAvg - 1900.0) < 100.0)
      ? this._calLeaderTicks + 1 : 0

    const sigBreak = this._calBreakTicks >= Math.floor(drate * BREAK_TOL * BREAK_LEN)
    const sigLeader = this._calLeaderTicks >= Math.floor(drate * LEADER_TOL * LEADER_LEN)

    this._calTicks++

    // 检测 leader + break + leader 序列
    if (sigLeader && !sigBreak && this._calGotBreak &&
        this._calTicks >= Math.floor(drate * (LEADER_LEN + BREAK_LEN) * LEADER_TOL) &&
        this._calTicks <= Math.floor(drate * (LEADER_LEN + BREAK_LEN) * (2.0 - LEADER_TOL))) {
      this._calGotBreak = false
      return true
    }

    // 检测 break
    if (sigBreak && !sigLeader &&
        this._calTicks >= Math.floor(drate * BREAK_LEN * BREAK_TOL) &&
        this._calTicks <= Math.floor(drate * BREAK_LEN * (2.0 - BREAK_TOL))) {
      this._calGotBreak = true
    }

    // leader 起始
    if (sigLeader && !sigBreak) {
      if (this._calTicks < 0) {
        console.log('[SSTV] 校准头: 检测到 leader 信号 (1900Hz) calAvg=' + this._calAvg.toFixed(0) + 'Hz')
      }
      this._calTicks = 0
      this._calGotBreak = false
    }

    // 检测到 break (1200Hz)
    if (sigBreak && !sigLeader && !this._calGotBreak) {
      console.log('[SSTV] 校准头: 检测到 break 信号 (1200Hz), ticks=' + this._calTicks +
        ' cntFreq=' + cntFreq.toFixed(0) + 'Hz')
    }

    return false
  }

  // ========================================================================
  // VIS 解码 (对应 C 版本 vis_code)
  // VIS 帧: Start(1200Hz) + 7 data + Parity + Stop(1200Hz), 每 bit 30ms
  // 参考 Robot36: 偶数校验, VIS code = 8 (二进制 0001000 → 0x88 including parity)
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

    // 频率计数
    this._visSS = (Math.abs(cntFreq - 1200.0) < 50.0) ? this._visSS + 1 : 0
    this._visLo = (Math.abs(cntFreq - 1300.0) < 50.0) ? this._visLo + 1 : 0
    this._visHi = (Math.abs(cntFreq - 1100.0) < 50.0) ? this._visHi + 1 : 0

    const thresh = Math.floor(drate * TOLERANCE * LENGTH)
    const sigSS = this._visSS >= thresh
    const sigLo = this._visLo >= thresh
    const sigHi = this._visHi >= thresh

    // 复位计数器 (边沿检测)
    if (sigSS) this._visSS = 0
    if (sigLo) this._visLo = 0
    if (sigHi) this._visHi = 0

    this._visTicks++

    // 等待 Start bit
    if (this._visBit < 0) {
      if (sigSS) {
        this._visTicks = 0
        this._visByte = 0
        this._visBit = 0
        console.log('[SSTV] VIS: 检测到 Start bit')
      }
      return null
    }

    // bit 窗口内
    const maxTicks = Math.floor(drate * 10.0 * LENGTH * (2.0 - TOLERANCE))
    if (this._visTicks <= maxTicks) {
      if (sigSS) {
        // Stop bit: 返回解码结果
        const code = this._visByte
        this._visBit = -1
        console.log('[SSTV] VIS: Stop bit, 解码完成 code=0x' + code.toString(16) + ' (bin=' + code.toString(2).padStart(8, '0') + ')')
        return { code, valid: true }
      }
      if (this._visBit < 8) {
        const prevBit = this._visBit
        if (sigLo) {
          // bit = 0 → 计数但不设置
          this._visBit++
          console.log('[SSTV] VIS: bit[' + prevBit + '] = 0 (Lo/1300Hz) ticks=' + this._visTicks)
        }
        if (sigHi) {
          // bit = 1 → LSB first
          this._visByte |= (1 << this._visBit)
          const oldBit = this._visBit
          this._visBit++
          console.log('[SSTV] VIS: bit[' + oldBit + '] = 1 (Hi/1100Hz) ticks=' + this._visTicks + ' byte=0x' + this._visByte.toString(16))
        }
      }
      return null
    }

    // 超时
    const code = this._visByte
    const hadEnoughBits = this._visBit >= 8
    this._visBit = -1
    console.warn('[SSTV] VIS: 超时 after ' + this._visTicks + ' ticks, bits=' + (this._visBit + 1) + ' byte=0x' + code.toString(16) + ' valid=' + hadEnoughBits)
    return { code, valid: hadEnoughBits }
  }

  // ========================================================================
  // 图像行解码 (对应 C 版本 decode)
  // ========================================================================

  _decodeLine(cntFreq, datFreq, drate) {
    const SYNC_TOL = 0.7
    const SYNC_FREQ = 1200.0

    // 1200Hz 同步脉冲计数
    this._horTicks = (Math.abs(cntFreq - SYNC_FREQ) < 50.0) ? this._horTicks + 1 : 0

    // 下降沿检测 (脉冲结束)
    if (this._horTicks > Math.floor(SYNC_TOL * this._horSyncLen)) {
      this._latchSync = true
    }
    const horSync = (cntFreq > 1299.0) && this._latchSync
    if (horSync) this._latchSync = false

    // 等待第一次行同步 (图像起始)
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

    // 过早的行同步 → 重置本行
    if (horSync && this._lineTicks < (this._horLen - this._syncPorchLen)) {
      console.warn('[SSTV] 行解码: 过早的行同步脉冲, 行=' + this._lineY + ' ticks=' + this._lineTicks + ' (期望≥' + (this._horLen - this._syncPorchLen) + '), 重置行')
      this._lineTicks = 0
      this._yPixelX = 0
      this._uvPixelX = 0
    }

    // 正常行同步: 结束上一行, 开始新行
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

    // 行同步丢失 → 外推
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

    // 间隔检测: 修正偶数/奇数行
    // 偶数行分隔符=1500Hz (<1900), 奇数行分隔符=2300Hz (>1900)
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

    // --- Y 通道采样 ---
    if (this._yPixelX < this._yWidth && this._lineTicks >= this._syncPorchLen) {
      const yVal = clampf(255.0 * (datFreq - 1500.0) / 800.0, 0.0, 255.0)
      this._yPixels[this._yPixelX + (this._lineY % 2) * this._yWidth] = Math.round(yVal)
      this._yPixelX++
    }

    // --- UV 通道采样 ---
    const uvStart = this._syncPorchLen + this._yLen + this._sepLen + this._porchLen
    if (this._uvPixelX < this._uvWidth && this._lineTicks >= uvStart) {
      const uvVal = clampf(255.0 * (datFreq - 1500.0) / 800.0, 0.0, 255.0)
      this._uvPixels[this._uvPixelX + this._odd * this._uvWidth] = Math.round(uvVal)
      this._uvPixelX++
    }
  }

  // ========================================================================
  // 行合并与 RGB 转换 (对应 C 版本 process_line)
  // Robot36: 两行合一扫描线
  //   偶数行(lineY-1): Y + B-Y(U), 数据在 uvPixels[0..uvWidth-1]
  //   奇数行(lineY):   Y + R-Y(V), 数据在 uvPixels[uvWidth..2*uvWidth-1]
  // ========================================================================

  _processLine() {
    if (this._lineY % 2 === 0) return // 只在奇数行处理

    // 每 20 行输出进度
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

      // Y 来自 lineY-1 (l=0) 或 lineY (l=1)
      const yOffset = l * yWidth
      // U 始终来自偶数行的 UV (offset uvWidth)
      // V 始终来自奇数行的 UV (offset 0)
      // 对应 C: U = uv_pixel[x/2 + uv_width], V = uv_pixel[x/2]
      const uOffset = uvWidth  // lineY-1 (偶数) 的数据存这里
      const vOffset = 0        // lineY (奇数) 的数据存这里

      for (let x = 0; x < width; x++) {
        // 浮点坐标 (用于插值处理尺寸差异)
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
        this.imageData[px] = Math.round(R_YUV(Y, U, V))
        this.imageData[px + 1] = Math.round(G_YUV(Y, U, V))
        this.imageData[px + 2] = Math.round(B_YUV(Y, U, V))
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
