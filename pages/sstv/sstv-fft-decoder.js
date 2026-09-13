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
 * 支持模式：Robot 36/72、Martin 1/2、Scottie 1/2/DX，共 7 种 (VIS 自动识别)
 */

// 1. FFT 类

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

// 2. 工具函数

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

// 3. SSTV 模式参数（支持全部 7 种模式）

const COL_FMT = { RGB: 'RGB', GBR: 'GBR', YUV: 'YUV', BW: 'BW' }

// --- Robot 36 (VIS=8) ---
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

// --- Robot 72 (VIS=12), 基于 R36 ---
const R72 = Object.assign({}, R36, {
  NAME: 'Robot 72',
  SCAN_TIME: 0.138,
  HALF_SCAN_TIME: 0.069,
  CHAN_COUNT: 3,
  HAS_ALT_SCAN: false,
})
R72.CHAN_TIME = R72.SEP_PULSE + R72.SCAN_TIME
R72.HALF_CHAN_TIME = R72.SEP_PULSE + R72.HALF_SCAN_TIME
R72.CHAN_OFFSETS = [R72.SYNC_PULSE + R72.SYNC_PORCH]
R72.CHAN_OFFSETS.push(R72.CHAN_OFFSETS[0] + R72.CHAN_TIME + R72.SEP_PORCH)
R72.CHAN_OFFSETS.push(R72.CHAN_OFFSETS[1] + R72.HALF_CHAN_TIME + R72.SEP_PORCH)
R72.LINE_TIME = R72.CHAN_OFFSETS[2] + R72.HALF_SCAN_TIME
R72.PIXEL_TIME = R72.SCAN_TIME / R72.LINE_WIDTH
R72.HALF_PIXEL_TIME = R72.HALF_SCAN_TIME / R72.LINE_WIDTH
R72.WINDOW_FACTOR = 4.88

// --- Martin 1 (VIS=44) ---
const M1 = {
  NAME: 'Martin 1',
  COLOR: COL_FMT.GBR,
  LINE_WIDTH: 320,
  LINE_COUNT: 256,
  SCAN_TIME: 0.146432,
  SYNC_PULSE: 0.004862,
  SYNC_PORCH: 0.000572,
  SEP_PULSE: 0.000572,
  CHAN_COUNT: 3,
  CHAN_SYNC: 0,
  CHAN_OFFSETS: [],
  HAS_START_SYNC: false,
  HAS_HALF_SCAN: false,
  HAS_ALT_SCAN: false,
}
M1.CHAN_TIME = M1.SEP_PULSE + M1.SCAN_TIME
M1.CHAN_OFFSETS = [M1.SYNC_PULSE + M1.SYNC_PORCH]
M1.CHAN_OFFSETS.push(M1.CHAN_OFFSETS[0] + M1.CHAN_TIME)
M1.CHAN_OFFSETS.push(M1.CHAN_OFFSETS[1] + M1.CHAN_TIME)
M1.LINE_TIME = M1.SYNC_PULSE + M1.SYNC_PORCH + 3 * M1.CHAN_TIME
M1.PIXEL_TIME = M1.SCAN_TIME / M1.LINE_WIDTH
M1.WINDOW_FACTOR = 2.34

// --- Martin 2 (VIS=40), 基于 M1 ---
const M2 = Object.assign({}, M1, {
  NAME: 'Martin 2',
  SCAN_TIME: 0.073216,
})
M2.CHAN_TIME = M2.SEP_PULSE + M2.SCAN_TIME
M2.CHAN_OFFSETS = [M2.SYNC_PULSE + M2.SYNC_PORCH]
M2.CHAN_OFFSETS.push(M2.CHAN_OFFSETS[0] + M2.CHAN_TIME)
M2.CHAN_OFFSETS.push(M2.CHAN_OFFSETS[1] + M2.CHAN_TIME)
M2.LINE_TIME = M2.SYNC_PULSE + M2.SYNC_PORCH + 3 * M2.CHAN_TIME
M2.PIXEL_TIME = M2.SCAN_TIME / M2.LINE_WIDTH
M2.WINDOW_FACTOR = 4.68

// --- Scottie 1 (VIS=60) ---
const S1 = {
  NAME: 'Scottie 1',
  COLOR: COL_FMT.GBR,
  LINE_WIDTH: 320,
  LINE_COUNT: 256,
  SCAN_TIME: 0.13824,
  SYNC_PULSE: 0.009,
  SYNC_PORCH: 0.0015,
  SEP_PULSE: 0.0015,
  CHAN_COUNT: 3,
  CHAN_SYNC: 2,
  CHAN_OFFSETS: [],
  HAS_START_SYNC: true,
  HAS_HALF_SCAN: false,
  HAS_ALT_SCAN: false,
}
S1.CHAN_TIME = S1.SEP_PULSE + S1.SCAN_TIME
S1.CHAN_OFFSETS = [S1.SYNC_PULSE + S1.SYNC_PORCH + S1.CHAN_TIME]
S1.CHAN_OFFSETS.push(S1.CHAN_OFFSETS[0] + S1.CHAN_TIME)
S1.CHAN_OFFSETS.push(S1.SYNC_PULSE + S1.SYNC_PORCH)
S1.LINE_TIME = S1.SYNC_PULSE + 3 * S1.CHAN_TIME
S1.PIXEL_TIME = S1.SCAN_TIME / S1.LINE_WIDTH
S1.WINDOW_FACTOR = 2.48

// --- Scottie 2 (VIS=56), 基于 S1 ---
const S2 = Object.assign({}, S1, {
  NAME: 'Scottie 2',
  SCAN_TIME: 0.088064,
})
S2.CHAN_TIME = S2.SEP_PULSE + S2.SCAN_TIME
S2.CHAN_OFFSETS = [S2.SYNC_PULSE + S2.SYNC_PORCH + S2.CHAN_TIME]
S2.CHAN_OFFSETS.push(S2.CHAN_OFFSETS[0] + S2.CHAN_TIME)
S2.CHAN_OFFSETS.push(S2.SYNC_PULSE + S2.SYNC_PORCH)
S2.LINE_TIME = S2.SYNC_PULSE + 3 * S2.CHAN_TIME
S2.PIXEL_TIME = S2.SCAN_TIME / S2.LINE_WIDTH
S2.WINDOW_FACTOR = 3.82

// --- Scottie DX (VIS=76), 基于 S2 ---
const SDX = Object.assign({}, S2, {
  NAME: 'Scottie DX',
  SCAN_TIME: 0.3456,
})
SDX.CHAN_TIME = SDX.SEP_PULSE + SDX.SCAN_TIME
SDX.CHAN_OFFSETS = [SDX.SYNC_PULSE + SDX.SYNC_PORCH + SDX.CHAN_TIME]
SDX.CHAN_OFFSETS.push(SDX.CHAN_OFFSETS[0] + SDX.CHAN_TIME)
SDX.CHAN_OFFSETS.push(SDX.SYNC_PULSE + SDX.SYNC_PORCH)
SDX.LINE_TIME = SDX.SYNC_PULSE + 3 * SDX.CHAN_TIME
SDX.PIXEL_TIME = SDX.SCAN_TIME / SDX.LINE_WIDTH
SDX.WINDOW_FACTOR = 0.98

// 4. 头部检测全局参数 + VIS 映射表

const BREAK_OFFSET = 0.3
const LEADER_OFFSET = 0.01 + BREAK_OFFSET   // = 0.31
const VIS_START_OFFSET_VAL = 0.3 + LEADER_OFFSET  // = 0.61
const HDR_SIZE = 0.03 + VIS_START_OFFSET_VAL       // = 0.64
const HDR_WINDOW_SIZE = 0.01
const VIS_BIT_SIZE = 0.03

/** 全部 7 种 SSTV 模式，由 VIS 码自动选择 */
const VIS_MAP = {
  8: R36,
  12: R72,
  40: M2,
  44: M1,
  56: S2,
  60: S1,
  76: SDX,
}

// 5. SSTV 全量 FFT 解码器

/** 解码被主动取消时抛出的错误 */
class DecodeCancelled extends Error {
  constructor() {
    super('DECODE_CANCELLED')
    this.name = 'DecodeCancelled'
    this.cancelled = true
  }
}

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
    this._cancelled = false
    // 音频提前用尽（解码被截断，图片底部为黑）时置位，供上层提示
    this.truncated = false

    // 取频是整帧最热的路径（约 11.5 万次调用），Hann 窗表 / 加窗缓冲 / FFT 实例
    // 全部按尺寸复用，避免每次取频都重建三角函数表与临时数组。
    this._hannCache = Object.create(null)
    this._fftCache = Object.create(null)
    this._windowBuf = null
    this._paddedBuf = null
    this._specBuf = null
  }

  // 取频资源复用
  /** 按长度缓存 Hann 窗 */
  _hann(length) {
    let w = this._hannCache[length]
    if (!w) {
      w = hannWindow(length)
      this._hannCache[length] = w
    }
    return w
  }

  /** 按尺寸缓存 FFT 实例（forward() 每次都会完整重算内部缓冲，复用安全） */
  _fftInstance(fftSize) {
    let inst = this._fftCache[fftSize]
    if (!inst) {
      inst = new FFT(fftSize, this.sampleRate)
      this._fftCache[fftSize] = inst
    }
    return inst
  }

  /**
   * 计算一段数据的幅度谱（Hann 加窗 + FFT + 单边谱补偿）
   * 返回的是内部复用缓冲，调用方只读、不可保存引用。
   */
  _spectrum(data) {
    const len = data.length
    const win = this._hann(len)

    let buf = this._windowBuf
    if (!buf || buf.length < len) {
      buf = new Float32Array(len)
      this._windowBuf = buf
    }
    for (let i = 0; i < len; i++) {
      buf[i] = data[i] * win[i]
    }

    const nextPow2 = Math.pow(2, Math.ceil(Math.log2(len)))
    const fftSize = Math.max(this.fftSize || 64, nextPow2)

    let padded = this._paddedBuf
    if (!padded || padded.length !== fftSize) {
      padded = new Float32Array(fftSize)
      this._paddedBuf = padded
    } else {
      padded.fill(0)
    }
    padded.set(buf.subarray(0, len))

    const inst = this._fftInstance(fftSize)
    inst.forward(padded)

    // 拷贝出谱：后续要缩放单边谱，不能改动 FFT 实例内部缓冲
    const half = fftSize / 2
    let out = this._specBuf
    if (!out || out.length !== half) {
      out = new Float64Array(half)
      this._specBuf = out
    }
    out.set(inst.spectrum)
    for (let i = 1; i < half - 1; i++) {
      out[i] *= 2
    }
    return out
  }

  // 取消 / 让出控制权

  /** 主动取消解码：正在执行的异步循环会在下一个检查点中止 */
  cancel() {
    this._cancelled = true
  }

  /** 让出 JS 线程，避免长时间阻塞导致 UI 卡顿（如取消按钮、页面返回无响应） */
  _yield() {
    return new Promise((resolve) => setTimeout(resolve, 0))
  }

  /** 检查取消标记，已取消则抛出 DecodeCancelled */
  _checkCancel() {
    if (this._cancelled) throw new DecodeCancelled()
  }

  // 主入口

  /**
   * 执行完整解码流程（异步、可取消、分片让出线程）
   * @returns {Promise<{ buffer: Uint8ClampedArray, width: number, height: number }>}
   */
  async decode() {
    console.log('[FFT-Decoder] 开始解码, 采样数=' + this.samples.length +
      ', 采样率=' + this.sampleRate + ', FFT大小=' + this.fftSize)

    // Phase 1: 头部检测
    const headerEnd = await this._findHeader()
    this._checkCancel()
    if (headerEnd < 0) {
      throw new Error('未在音频中找到 SSTV 信号头')
    }
    this._reportProgress(5)

    // Phase 2: VIS 解码
    this.mode = this._decodeVIS(headerEnd)
    this._reportProgress(10)

    // Phase 3: 图像数据解码
    const visEnd = headerEnd + Math.round(VIS_BIT_SIZE * 9 * this.sampleRate)
    const imageData = await this._decodeImageData(visEnd)
    this._checkCancel()

    // Phase 4: 生成 RGBA 缓冲区
    return this._generateImageBuffer(imageData)
  }

  _reportProgress(percent) {
    if (this.onProgress) {
      try { this.onProgress(percent) } catch (e) { /* ignore */ }
    }
  }

  // 频率测量

  /**
   * 对一段音频数据做 Hann 窗 + FFT + barycentric 插值，返回峰值频率 (Hz)
   */
  _peakFreq(data) {
    if (!data || data.length < 2) return 0

    const spectrum = this._spectrum(data)

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

  // 头部检测

  /**
   * 滑动窗口 FFT 检测 SSTV 校准头
   *
   * 检测 4 个关键位置的频率:
   *   f1: 窗口 0~10ms    → 期望 1900Hz (Leader1)
   *   f2: 窗口 300~310ms  → 期望 1200Hz (Break)
   *   f3: 窗口 310~320ms  → 期望 1900Hz (Leader2)
   *   f4: 窗口 610~620ms  → 期望 1200Hz (VIS Start Bit)
   *
   * @returns {Promise<number>} VIS 数据位起始的样本索引（跳过了 VIS Start Bit）
   */
  async _findHeader() {
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
    let iter = 0

    for (let offset = 0; offset < totalSamples - headerSize; offset += jumpSize) {
      // 分片让出线程 + 检查取消（每 40 次迭代）
      if ((++iter % 40) === 0) {
        this._checkCancel()
        await this._yield()
      }

      // 直接用 subarray 取视图（不复制）：此前先整段 slice(0.64s) 再切 4 个小窗，
      // 40s 音频约 2 万次迭代 = 约 2.4GB 无效内存搬运
      const f1 = this._peakFreq(this.samples.subarray(offset + leader1Start, offset + leader1End))
      const f2 = this._peakFreq(this.samples.subarray(offset + breakStart, offset + breakEnd))
      const f3 = this._peakFreq(this.samples.subarray(offset + leader2Start, offset + leader2End))
      const f4 = this._peakFreq(this.samples.subarray(offset + visStart, offset + visEnd))

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

  // VIS 解码

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
      const section = this.samples.subarray(start, start + bitSize)
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

  // 同步对齐

  /**
   * 从 alignStart 开始搜索同步脉冲 (1200Hz)
   *
   * 粗定位：12.6ms 大窗逐样本前移，找到首个峰值 >1350Hz 的位置（此时窗口已含
   * 同步之后的门廊/图像内容）。粗定位偏差随行内容（Y 亮度）漂移，可达 ±1ms。
   *
   * 精定位：在粗定位附近用 2ms 小窗细扫「同步(1200Hz)→门廊(1500Hz)」的跳变沿。
   * 这两个音是固定频率、与图像内容无关，故边界可以定位到采样级精度。
   * 不做精定位时，锚点偏晚会让行尾像素的取频窗越入下一行同步音，
   * 色度被钳为 0 → 解码图片最右列出现绿色色块。
   *
   * @param {number} alignStart - 搜索起始样本索引
   * @param {boolean} [startOfSync=true] - true 返回脉冲起始，false 返回结束
   * @returns {number|null} 对齐后的样本索引
   */
  _alignSync(alignStart, startOfSync) {
    if (startOfSync === undefined) startOfSync = true
    const mode = this.mode
    const sr = this.sampleRate
    const syncWindow = Math.round(mode.SYNC_PULSE * 1.4 * sr)
    // 只在"期望位置"附近一段内搜索。
    // 原实现把上界设为文件末尾（samples.length - syncWindow），一旦某行同步检测失败，
    // 就会逐采样做 FFT 一直扫到音频结尾（可达百万次），表现为页面卡死。
    // 稳态下真实同步位置与名义推进位置相差不超过几毫秒，半行是非常宽的余量。
    const searchSpan = Math.max(syncWindow * 3, Math.round(0.5 * mode.LINE_TIME * sr))
    const alignStop = Math.min(this.samples.length - syncWindow, alignStart + searchSpan)

    if (alignStop <= alignStart) return null

    for (let i = alignStart; i < alignStop; i++) {
      // 长距离搜索时保证"取消解码 / 页面返回"能及时打断
      if (((i - alignStart) & 0x3FF) === 0) this._checkCancel()

      const section = this.samples.subarray(i, i + syncWindow)
      const freq = this._peakFreq(section)
      if (freq > 1350) {
        // ---- 精定位：细扫同步→门廊跳变沿 ----
        // 扫描起点用名义推进位置（alignStart，通常已落在同步脉冲内部），
        // 而非粗触发点 i（其位置随内容漂移）
        const fineWin = Math.round(0.002 * sr)                 // 2ms 小窗
        const step = Math.max(1, Math.round(0.00025 * sr))     // 0.25ms 步进
        const scanFrom = alignStart
        const scanTo = i + Math.floor(syncWindow / 2)

        let lastInSync = -1
        let firstOutSync = -1
        for (let p = scanFrom; p <= scanTo; p += step) {
          const w = this.samples.subarray(p, Math.min(p + fineWin, this.samples.length))
          if (this._peakFreq(w) > 1350) {
            firstOutSync = p
            break
          }
          lastInSync = p
        }

        let syncEnd
        if (firstOutSync > 0 && lastInSync >= 0) {
          // 小窗过半进入门廊时峰值翻转：边界 ≈ 翻转点中点 + 半窗
          syncEnd = Math.round((lastInSync + firstOutSync) / 2 + fineWin / 2)
        } else {
          // 细扫失败（起点已在门廊/图像段，或信噪比差）：退回粗定位
          syncEnd = i + Math.floor(syncWindow / 2)
        }

        return startOfSync
          ? syncEnd - Math.round(mode.SYNC_PULSE * sr)
          : syncEnd
      }
    }
    return null
  }

  // 图像数据解码

  /**
   * 逐行逐像素解码图像数据
   * @param {number} imageStart - 图像数据起始样本索引
   * @returns {Promise<Array<Array<Array<number>>>>} imageData[line][channel][pixel]
   */
  async _decodeImageData(imageStart) {
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
      // 每行让出线程 + 检查取消，保证取消按钮/页面返回即时响应
      this._checkCancel()
      await this._yield()

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

        // 本通道段的起止边界（样本索引）：取频窗不得越出段外，
        // 否则首尾像素的窗口会混入同步音 / 间隔音 / 相邻通道
        // （行尾像素读进下一行 1200Hz 同步音 → 色度钳为 0 → 最右列偏绿的来源之一）
        const chanDuration = (mode.HAS_HALF_SCAN && chan > 0)
          ? mode.HALF_SCAN_TIME
          : mode.SCAN_TIME
        const chanOffset = mode.CHAN_OFFSETS[chan]
        const segStart = Math.round(seqStart + chanOffset * this.sampleRate)
        const segEnd = Math.round(seqStart + (chanOffset + chanDuration) * this.sampleRate)

        // 逐像素 FFT
        for (let px = 0; px < width; px++) {
          const pixelTime = (mode.HAS_HALF_SCAN && chan > 0)
            ? mode.HALF_PIXEL_TIME
            : mode.PIXEL_TIME

          const windowHalf = (pixelTime * windowFactor) / 2

          const pxCenter = seqStart + (chanOffset + px * pixelTime) * this.sampleRate
          let pxStart = Math.round(pxCenter - windowHalf * this.sampleRate)
          let pxEnd = Math.round(pxCenter + windowHalf * this.sampleRate)

          // 窗口平移钳制在本通道段内（首像素窗越入同步/门廊，尾像素窗越入下一段）。
          // 采用整体平移而非截断，保持窗口长度（频率分辨率）不变
          if (pxEnd > segEnd) {
            pxStart -= (pxEnd - segEnd)
            pxEnd = segEnd
          }
          if (pxStart < segStart) {
            pxEnd += (segStart - pxStart)
            pxStart = segStart
          }
          if (pxEnd > segEnd) pxEnd = segEnd // 窗口长于整段时的兜底截断
          if (pxEnd - pxStart < 2) {
            pxStart = segEnd - 2
            pxEnd = segEnd
          }

          if (pxEnd >= this.samples.length) {
            // 音频提前用尽。注意：即使音频完整，最后一行的最后一两个像素的取频窗
            // 也会按设计略微越出音频末端（窗口以像素中心对称展开），这属于正常现象，
            // 因此只有"在最后一行之前就用尽"才判定为音频不完整。
            // 处理上不再整体放弃剩余像素：在可用范围内继续解；可用数据不足半个窗口时
            // 该像素保持 0（黑），避免把噪声当信号解出杂色。
            if (line < height - 1) this.truncated = true
            const nominalLen = pxEnd - pxStart
            pxEnd = this.samples.length
            if (pxEnd - pxStart < Math.max(2, Math.round(nominalLen / 2))) {
              imageData[line][chan][px] = 0
              continue
            }
          }

          const pixelArea = this.samples.subarray(Math.max(0, pxStart), pxEnd)
          const freq = this._peakFreq(pixelArea)
          imageData[line][chan][px] = freqToLum(freq)
        }
      }
    }

    return imageData
  }

  // RGBA 缓冲区生成

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
