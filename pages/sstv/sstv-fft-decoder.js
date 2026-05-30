/**
 * SSTV FFT 全量解码器
 *
 * 移植自 sstv-decoder-main (https://github.com/colaclanth/sstv)
 *
 * 解码策略：全量音频 + FFT 滑动窗口
 *   - 输入：完整音频 PCM 样本 (Float32Array)
 *   - 头部检测：滑动窗口 FFT，4 点频率匹配
 *   - VIS 解码：FFT 逐 bit 频率识别
 *   - 图像解码：逐像素 Hann 窗 FFT + barycentric 峰值插值
 *   - 输出：RGBA Uint8ClampedArray
 *
 * 当前支持模式：Robot 36 Color (VIS code = 8)
 */

// ============================================================================
// 1. FFT 类（移植自 fft.js，适配 CommonJS）
// ============================================================================

class FFT {
  constructor(bufferSize, sampleRate) {
    this.bufferSize = bufferSize
    this.sampleRate = sampleRate
    this.bandwidth = ((2 / bufferSize) * sampleRate) / 2

    this.spectrum = new Float64Array(bufferSize / 2)
    this.real = new Float64Array(bufferSize)
    this.imag = new Float64Array(bufferSize)

    this.peakBand = 0
    this.peak = 0

    // 位反转表
    this.reverseTable = new Uint32Array(bufferSize)
    let limit = 1
    let bit = bufferSize >> 1
    while (limit < bufferSize) {
      for (let i = 0; i < limit; i++) {
        this.reverseTable[i + limit] = this.reverseTable[i] + bit
      }
      limit = limit << 1
      bit = bit >> 1
    }

    // 旋转因子表
    this.sinTable = new Float64Array(bufferSize)
    this.cosTable = new Float64Array(bufferSize)
    for (let i = 0; i < bufferSize; i++) {
      this.sinTable[i] = Math.sin(-Math.PI / i)
      this.cosTable[i] = Math.cos(-Math.PI / i)
    }
  }

  forward(buffer) {
    const bufferSize = this.bufferSize
    const cosTable = this.cosTable
    const sinTable = this.sinTable
    const reverseTable = this.reverseTable
    const real = this.real
    const imag = this.imag
    const spectrum = this.spectrum

    if (bufferSize !== buffer.length) {
      throw new Error('Supplied buffer size mismatch: expected ' + bufferSize + ' got ' + buffer.length)
    }

    // 位反转重排
    for (let i = 0; i < bufferSize; i++) {
      real[i] = buffer[reverseTable[i]]
      imag[i] = 0
    }

    // 蝶形运算（in-place Cooley-Tukey）
    let halfSize = 1
    while (halfSize < bufferSize) {
      const phaseShiftStepReal = cosTable[halfSize]
      const phaseShiftStepImag = sinTable[halfSize]

      let currentPhaseShiftReal = 1
      let currentPhaseShiftImag = 0

      for (let fftStep = 0; fftStep < halfSize; fftStep++) {
        let i = fftStep
        while (i < bufferSize) {
          const off = i + halfSize
          const tr = currentPhaseShiftReal * real[off] - currentPhaseShiftImag * imag[off]
          const ti = currentPhaseShiftReal * imag[off] + currentPhaseShiftImag * real[off]

          real[off] = real[i] - tr
          imag[off] = imag[i] - ti
          real[i] += tr
          imag[i] += ti

          i += halfSize << 1
        }

        const tmpReal = currentPhaseShiftReal
        currentPhaseShiftReal = tmpReal * phaseShiftStepReal - currentPhaseShiftImag * phaseShiftStepImag
        currentPhaseShiftImag = tmpReal * phaseShiftStepImag + currentPhaseShiftImag * phaseShiftStepReal
      }

      halfSize = halfSize << 1
    }

    // 计算幅度谱（单边）
    const bSi = 2 / bufferSize
    this.peak = 0
    for (let i = 0; i < bufferSize / 2; i++) {
      const rval = real[i]
      const ival = imag[i]
      const mag = bSi * Math.sqrt(rval * rval + ival * ival)

      if (mag > this.peak) {
        this.peakBand = i
        this.peak = mag
      }
      spectrum[i] = mag
    }

    return spectrum
  }
}

// ============================================================================
// 2. 工具函数（移植自 utils.js）
// ============================================================================

/** Hann 窗函数 */
function hannWindow(length) {
  const window = new Array(length)
  for (let i = 0; i < length; i++) {
    window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (length - 1)))
  }
  return window
}

/** Barycentric 峰值插值（亚 bin 精度） */
function barycentricPeakInterp(bins, x) {
  const y1 = x <= 0 ? bins[x] : bins[x - 1]
  const y2 = bins[x]
  const y3 = x + 1 >= bins.length ? bins[x] : bins[x + 1]

  const denom = y1 + y2 + y3
  if (denom === 0) return x

  return x + (y3 - y1) / (2 * denom)
}

/** 频率 → 亮度 (1500-2300Hz → 0-255) */
function freqToLum(freq) {
  const lum = Math.round((freq - 1500) / 3.1372549)
  return Math.min(Math.max(lum, 0), 255)
}

/** YUV → RGB（BT.601 SD） */
function yuvToRgb(y, u, v) {
  const U = u - 128
  const V = v - 128
  let r = y + 1.402 * V
  let g = y - 0.344136 * U - 0.714136 * V
  let b = y + 1.772 * U
  r = Math.max(0, Math.min(255, Math.round(r)))
  g = Math.max(0, Math.min(255, Math.round(g)))
  b = Math.max(0, Math.min(255, Math.round(b)))
  return [r, g, b]
}

/** FFT 包装函数：padding + Hann + 计算幅度谱 */
function fft(data, sampleRate, fftSizeHint) {
  const nextPow2 = Math.pow(2, Math.ceil(Math.log2(data.length)))
  const fftSize = Math.max(fftSizeHint || 64, nextPow2)

  const padded = new Float32Array(fftSize)
  padded.set(data)

  const fftInst = new FFT(fftSize, sampleRate)
  fftInst.forward(padded)

  const spectrum = fftInst.spectrum.slice()
  const n = spectrum.length
  for (let i = 1; i < n - 1; i++) {
    spectrum[i] *= 2  // 补偿单边谱
  }
  return spectrum
}

// ============================================================================
// 3. Robot36 模式参数（移植自 spec.js）
// ============================================================================

const COL_FMT = { RGB: 'RGB', GBR: 'GBR', YUV: 'YUV', BW: 'BW' }

const R36 = {
  NAME: 'Robot 36',
  COLOR: COL_FMT.YUV,
  LINE_WIDTH: 320,
  LINE_COUNT: 240,
  SCAN_TIME: 0.088,
  HALF_SCAN_TIME: 0.044,
  SYNC_PULSE: 0.009,
  SYNC_PORCH: 0.003,
  SEP_PULSE: 0.0045,
  SEP_PORCH: 0.0015,
  CHAN_COUNT: 2,
  CHAN_SYNC: 0,
  CHAN_OFFSETS: [],
  HAS_START_SYNC: false,
  HAS_HALF_SCAN: true,
  HAS_ALT_SCAN: true,
}
R36.CHAN_TIME = R36.SEP_PULSE + R36.SCAN_TIME
R36.CHAN_OFFSETS = [R36.SYNC_PULSE + R36.SYNC_PORCH]
R36.CHAN_OFFSETS.push(R36.CHAN_OFFSETS[0] + R36.CHAN_TIME + R36.SEP_PORCH)
R36.LINE_TIME = R36.CHAN_OFFSETS[1] + R36.HALF_SCAN_TIME
R36.PIXEL_TIME = R36.SCAN_TIME / R36.LINE_WIDTH
R36.HALF_PIXEL_TIME = R36.HALF_SCAN_TIME / R36.LINE_WIDTH
R36.WINDOW_FACTOR = 7.7

// ============================================================================
// 4. 头部检测全局参数（移植自 spec.js）
// ============================================================================

const BREAK_OFFSET = 0.3
const LEADER_OFFSET = 0.01 + BREAK_OFFSET   // = 0.31
const VIS_START_OFFSET_VAL = 0.3 + LEADER_OFFSET  // = 0.61
const HDR_SIZE = 0.03 + VIS_START_OFFSET_VAL       // = 0.64
const HDR_WINDOW_SIZE = 0.01
const VIS_BIT_SIZE = 0.03

const VIS_MAP = {
  8: R36,
  // 未来可扩展更多模式
  // 12: R72, 40: M2, 44: M1, 56: S2, 60: S1, 76: SDX,
}

// ============================================================================
// 5. SSTV 全量 FFT 解码器
// ============================================================================

class SSTVFFTDecoder {
  /**
   * @param {Float32Array} audioBuffer - 归一化音频样本 [-1, +1]
   * @param {number} sampleRate - 采样率 (Hz)
   * @param {Object} [options]
   * @param {number} [options.fftSize=512] - FFT 大小
   * @param {Function} [options.onProgress] - 进度回调 (percent: 0-100)
   */
  constructor(audioBuffer, sampleRate, options = {}) {
    this.samples = audioBuffer
    this.sampleRate = sampleRate
    this.fftSize = options.fftSize || 512
    this.onProgress = options.onProgress || null
    this.mode = null
  }

  // ========== 主入口 ==========

  /**
   * 执行完整解码流程
   * @returns {{ buffer: Uint8ClampedArray, width: number, height: number }}
   */
  decode() {
    console.log('[FFT-Decoder] 开始解码, 采样数=' + this.samples.length +
      ', 采样率=' + this.sampleRate + ', FFT大小=' + this.fftSize)

    // Phase 1: 头部检测
    const headerEnd = this._findHeader()
    if (headerEnd < 0) {
      throw new Error('未在音频中找到 SSTV 信号头')
    }
    this._reportProgress(5)

    // Phase 2: VIS 解码
    this.mode = this._decodeVIS(headerEnd)
    this._reportProgress(10)

    // Phase 3: 图像数据解码
    const visEnd = headerEnd + Math.round(VIS_BIT_SIZE * 9 * this.sampleRate)
    const imageData = this._decodeImageData(visEnd)

    // Phase 4: 生成 RGBA 缓冲区
    return this._generateImageBuffer(imageData)
  }

  _reportProgress(percent) {
    if (this.onProgress) {
      try { this.onProgress(percent) } catch (e) { /* ignore */ }
    }
  }

  // ========== 频率测量 ==========

  /**
   * 对一段音频数据做 Hann 窗 + FFT + barycentric 插值，返回峰值频率 (Hz)
   */
  _peakFreq(data) {
    if (!data || data.length < 2) return 0

    const window = hannWindow(data.length)
    const windowedData = []
    for (let i = 0; i < data.length; i++) {
      windowedData.push(data[i] * window[i])
    }

    const spectrum = fft(windowedData, this.sampleRate, this.fftSize)

    // 找最大 bin
    let maxIndex = 0
    let maxVal = spectrum[0]
    for (let i = 1; i < spectrum.length; i++) {
      if (spectrum[i] > maxVal) {
        maxVal = spectrum[i]
        maxIndex = i
      }
    }

    const interpBin = barycentricPeakInterp(spectrum, maxIndex)
    return (interpBin * this.sampleRate) / (2 * spectrum.length)
  }

  // ========== 头部检测 ==========

  /**
   * 滑动窗口 FFT 检测 SSTV 校准头
   *
   * 检测 4 个关键位置的频率:
   *   f1: 窗口 0~10ms    → 期望 1900Hz (Leader1)
   *   f2: 窗口 300~310ms  → 期望 1200Hz (Break)
   *   f3: 窗口 310~320ms  → 期望 1900Hz (Leader2)
   *   f4: 窗口 610~620ms  → 期望 1200Hz (VIS Start Bit)
   *
   * @returns {number} VIS 数据位起始的样本索引（跳过了 VIS Start Bit）
   */
  _findHeader() {
    const sr = this.sampleRate
    const headerSize = Math.round(HDR_SIZE * sr)            // 0.64 * sr
    const windowSize = Math.round(HDR_WINDOW_SIZE * sr)     // 0.01 * sr
    const jumpSize = Math.round(0.002 * sr)                 // 2ms jump

    const leader1Start = 0
    const leader1End = leader1Start + windowSize
    const breakStart = Math.round(BREAK_OFFSET * sr)        // 0.3 * sr
    const breakEnd = breakStart + windowSize
    const leader2Start = Math.round(LEADER_OFFSET * sr)     // 0.31 * sr
    const leader2End = leader2Start + windowSize
    const visStart = Math.round(VIS_START_OFFSET_VAL * sr)  // 0.61 * sr
    const visEnd = visStart + windowSize

    const totalSamples = this.samples.length
    let lastLogOffset = -1

    for (let offset = 0; offset < totalSamples - headerSize; offset += jumpSize) {
      const chunk = this.samples.slice(offset, offset + headerSize)

      const f1 = this._peakFreq(chunk.slice(leader1Start, leader1End))
      const f2 = this._peakFreq(chunk.slice(breakStart, breakEnd))
      const f3 = this._peakFreq(chunk.slice(leader2Start, leader2End))
      const f4 = this._peakFreq(chunk.slice(visStart, visEnd))

      if (lastLogOffset < 0 || (offset - lastLogOffset) / sr > 2.0) {
        console.log('[FFT-Decoder] 搜寻头部: offset=' + (offset / sr).toFixed(1) + 's' +
          ' f1=' + f1.toFixed(0) + ' f2=' + f2.toFixed(0) +
          ' f3=' + f3.toFixed(0) + ' f4=' + f4.toFixed(0))
        lastLogOffset = offset
      }

      if (
        Math.abs(f1 - 1900) < 50 &&
        Math.abs(f2 - 1200) < 50 &&
        Math.abs(f3 - 1900) < 50 &&
        Math.abs(f4 - 1200) < 50
      ) {
        console.log('[FFT-Decoder] ★ 头部已找到! offset=' + (offset / sr).toFixed(2) + 's' +
          ' (样本#' + offset + ')')
        // headerEnd = offset + 0.64*sr = VIS Start Bit 结束 = 数据位开始的位置
        return offset + headerSize
      }
    }

    console.error('[FFT-Decoder] 未找到 SSTV 头部')
    return -1
  }

  // ========== VIS 解码 ==========

  /**
   * 从指定位置解码 VIS 码（8 位：7 数据 + 1 偶校验）
   * @param {number} visStart - 数据位起始样本索引（已跳过 Start bit）
   * @returns {Object} 匹配的模式对象
   */
  _decodeVIS(visStart) {
    const sr = this.sampleRate
    const bitSize = Math.round(VIS_BIT_SIZE * sr)  // 30ms * sr
    const visBits = []

    let bitLog = ''
    for (let i = 0; i < 8; i++) {
      const start = visStart + i * bitSize
      const section = this.samples.slice(start, start + bitSize)
      const freq = this._peakFreq(section)
      const bit = freq <= 1200 ? 1 : 0
      visBits.push(bit)
      bitLog += ' [' + i + ']=' + freq.toFixed(0) + 'Hz→' + bit
    }

    // 偶校验
    const parity = visBits.reduce((a, b) => a + b, 0) % 2 === 0
    console.log('[FFT-Decoder] VIS 位:' + bitLog + ' 偶校验=' + (parity ? '✓' : '✗'))

    if (!parity) {
      throw new Error('VIS 偶校验失败')
    }

    // 组合 7 位数据码 (big-endian: bit[6] MSB → bit[0] LSB)
    let visCode = 0
    for (let i = 6; i >= 0; i--) {
      visCode = (visCode << 1) | visBits[i]
    }

    const mode = VIS_MAP[visCode]
    if (!mode) {
      throw new Error('不支持的 VIS 代码: 0x' + visCode.toString(16) + ' (' + visCode + ')')
    }

    console.log('[FFT-Decoder] 检测到 SSTV 模式: ' + mode.NAME + ' (VIS=0x' + visCode.toString(16) + ')')
    return mode
  }

  // ========== 同步对齐 ==========

  /**
   * 从 alignStart 开始搜索同步脉冲 (1200Hz)
   * @param {number} alignStart - 搜索起始样本索引
   * @param {boolean} [startOfSync=true] - true 返回脉冲起始，false 返回结束
   * @returns {number|null} 对齐后的样本索引
   */
  _alignSync(alignStart, startOfSync) {
    if (startOfSync === undefined) startOfSync = true
    const mode = this.mode
    const sr = this.sampleRate
    const syncWindow = Math.round(mode.SYNC_PULSE * 1.4 * sr)
    const alignStop = this.samples.length - syncWindow

    if (alignStop <= alignStart) return null

    for (let i = alignStart; i < alignStop; i++) {
      const section = this.samples.slice(i, i + syncWindow)
      const freq = this._peakFreq(section)
      if (freq > 1350) {
        const syncEnd = i + Math.floor(syncWindow / 2)
        return startOfSync
          ? syncEnd - Math.round(mode.SYNC_PULSE * sr)
          : syncEnd
      }
    }
    return null
  }

  // ========== 图像数据解码 ==========

  /**
   * 逐行逐像素解码图像数据
   * @param {number} imageStart - 图像数据起始样本索引
   * @returns {Array<Array<Array<number>>>} imageData[line][channel][pixel]
   */
  _decodeImageData(imageStart) {
    const mode = this.mode
    const width = mode.LINE_WIDTH
    const height = mode.LINE_COUNT
    const channels = mode.CHAN_COUNT
    const windowFactor = mode.WINDOW_FACTOR

    // 初始化 3D 数组: [line][channel][pixel]
    const imageData = new Array(height)
    for (let y = 0; y < height; y++) {
      imageData[y] = new Array(channels)
      for (let c = 0; c < channels; c++) {
        imageData[y][c] = new Array(width).fill(0)
      }
    }

    let seqStart = imageStart

    // 部分模式需要初始同步对齐（Robot36 不需要）
    if (mode.HAS_START_SYNC) {
      const aligned = this._alignSync(seqStart, false)
      if (aligned !== null) seqStart = aligned
    }

    const totalLines = height
    for (let line = 0; line < height; line++) {
      // 进度回调（每 5 行报告一次）
      if (this.onProgress && line % 5 === 0) {
        const percent = 10 + Math.round((line / totalLines) * 90)
        this._reportProgress(percent)
      }

      // 某些模式第一个 channel 有特殊位置（Scottie 类）
      if (mode.CHAN_SYNC > 0 && line === 0) {
        const syncOffset = mode.CHAN_OFFSETS[mode.CHAN_SYNC]
        seqStart -= Math.round((syncOffset + mode.SCAN_TIME) * this.sampleRate)
      }

      for (let chan = 0; chan < channels; chan++) {
        // 同步脉冲对齐
        if (chan === mode.CHAN_SYNC) {
          if (line > 0 || chan > 0) {
            seqStart += Math.round(mode.LINE_TIME * this.sampleRate)
          }
          const aligned = this._alignSync(seqStart)
          if (aligned !== null) seqStart = aligned
        }

        // 逐像素 FFT
        for (let px = 0; px < width; px++) {
          const pixelTime = (mode.HAS_HALF_SCAN && chan > 0)
            ? mode.HALF_PIXEL_TIME
            : mode.PIXEL_TIME

          const windowHalf = (pixelTime * windowFactor) / 2
          const chanOffset = mode.CHAN_OFFSETS[chan]

          const pxCenter = seqStart + (chanOffset + px * pixelTime) * this.sampleRate
          const pxStart = Math.round(pxCenter - windowHalf * this.sampleRate)
          const pxEnd = Math.round(pxCenter + windowHalf * this.sampleRate)

          if (pxEnd >= this.samples.length) {
            console.warn('[FFT-Decoder] 音频数据不足 (line=' + line + ' chan=' + chan + ' px=' + px + ')')
            return imageData
          }

          const pixelArea = this.samples.slice(Math.max(0, pxStart), pxEnd)
          const freq = this._peakFreq(pixelArea)
          imageData[line][chan][px] = freqToLum(freq)
        }
      }
    }

    return imageData
  }

  // ========== RGBA 缓冲区生成 ==========

  /**
   * 将 3D 图像数据转为 RGBA Uint8ClampedArray
   */
  _generateImageBuffer(imageData) {
    const mode = this.mode
    const width = mode.LINE_WIDTH
    const height = mode.LINE_COUNT
    const channels = mode.CHAN_COUNT
    const buffer = new Uint8ClampedArray(width * height * 4)

    for (let y = 0; y < height; y++) {
      const oddLine = y % 2

      for (let x = 0; x < width; x++) {
        let r = 0, g = 0, b = 0

        if (channels === 2 && mode.HAS_ALT_SCAN && mode.COLOR === COL_FMT.YUV) {
          // Robot36: YUV 隔行扫描
          // 偶行(0,2,4...): Y + U(B-Y)  奇行(1,3,5...): Y + V(R-Y)
          // Y 来自当前行 channel[0]，U 来自上一行 channel[1]，V 来自上两行 channel[1]
          const yVal = imageData[y][0] ? imageData[y][0][x] : 0
          const cbLine = y - (oddLine === 1 ? 0 : 1)
          const crLine = y - oddLine
          const cbVal = (cbLine >= 0 && imageData[cbLine] && imageData[cbLine][1])
            ? imageData[cbLine][1][x] : 128
          const crVal = (crLine >= 0 && imageData[crLine] && imageData[crLine][1])
            ? imageData[crLine][1][x] : 128
          ;[r, g, b] = yuvToRgb(yVal, cbVal, crVal)
        } else if (channels === 3) {
          if (mode.COLOR === COL_FMT.GBR) {
            r = imageData[y][2][x]
            g = imageData[y][0][x]
            b = imageData[y][1][x]
          } else if (mode.COLOR === COL_FMT.YUV) {
            const yVal = imageData[y][0][x]
            const cbVal = imageData[y][1][x]
            const crVal = imageData[y][2][x]
            ;[r, g, b] = yuvToRgb(yVal, cbVal, crVal)
          } else if (mode.COLOR === COL_FMT.RGB) {
            r = imageData[y][0][x]
            g = imageData[y][1][x]
            b = imageData[y][2][x]
          }
        }

        const idx = (y * width + x) * 4
        buffer[idx] = r
        buffer[idx + 1] = g
        buffer[idx + 2] = b
        buffer[idx + 3] = 255
      }
    }

    console.log('[FFT-Decoder] ✨ 解码完成: ' + width + 'x' + height +
      ' (' + (width * height) + ' 像素)')
    this._reportProgress(100)

    return { buffer, width, height }
  }
}

module.exports = SSTVFFTDecoder
