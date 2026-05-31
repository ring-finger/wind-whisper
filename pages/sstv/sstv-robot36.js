/** Robot36 模式实现 */

const SSTVMode = require('./sstv-mode')

class Robot36 extends SSTVMode {
  constructor(sampleRate = 48000) {
    super(sampleRate)
    this.modeName = 'Robot36'
    this.visCode = 8

    // Robot36 时序参数 (ms)
    this.lumaScanSamples = 88.0
    this.chrominanceScanSamples = 44.0
    this.syncPulseSamples = 9.0       // 行同步脉冲 1200Hz
    this.syncPulseFrequency = 1200.0
    this.syncPorchSamples = 3.0       // 同步门廊 1500Hz
    this.syncPorchFrequency = 1500.0
    this.porchSamples = 1.5           // 色度门廊 1900Hz
    this.porchFrequency = 1900.0
    this.separatorSamples = 4.5       // 通道间隔 (偶数1500Hz/奇数2300Hz)
    this.evenSeparatorFrequency = 1500.0
    this.oddSeparatorFrequency = 2300.0
  }

  /** 计算所需的总采样数 */
  calculateTotalSamples(width, height) {
    // Robot36 标准校准头时序 (ms)
    const LEADER1_DURATION = 300  // 先导音 1900Hz
    const BREAK_DURATION = 10    // 短暂脉冲 1200Hz
    const LEADER2_DURATION = 300 // 先导音 1900Hz
    const VIS_BIT_DURATION = 30
    const VIS_TOTAL_BITS = 10

    const H_SYNC_DURATION = 9     // 行同步脉冲 1200Hz
    const SYNC_PORCH_DURATION = 3 // 同步门廊 1500Hz
    const Y_DURATION = 88         // Y 通道 320 像素
    const SEP_DURATION = 4.5      // 通道间隔
    const PORCH_DURATION = 1.5    // 色度门廊 1900Hz
    const CR_CB_DURATION = 44     // R/B 通道 160 像素

    const lineDuration = H_SYNC_DURATION + SYNC_PORCH_DURATION +
                         Y_DURATION + SEP_DURATION + PORCH_DURATION + CR_CB_DURATION

    let totalSamples = 0
    totalSamples += Math.round(this.sampleRate * (LEADER1_DURATION / 1000))
    totalSamples += Math.round(this.sampleRate * (BREAK_DURATION / 1000))
    totalSamples += Math.round(this.sampleRate * (LEADER2_DURATION / 1000))
    totalSamples += Math.round(this.sampleRate * (VIS_BIT_DURATION / 1000)) * VIS_TOTAL_BITS
    totalSamples += Math.round(this.sampleRate * (lineDuration / 1000)) * height

    return Math.floor(totalSamples * 1.1)
  }

  /** 从 ImageData 生成 PCM 音频 (Robot36 标准) */
  encodeFromImageData(imageData) {
    let { width, height, data } = imageData
    if (!ArrayBuffer.isView(data) && !Array.isArray(data)) {
      console.error('ImageData.data 不是数组:', typeof data)
      return new Float32Array(0)
    }

    if (data.buffer && data.BYTES_PER_ELEMENT) {
      data = new Uint8Array(data.buffer)
    }

    const LEADER1_DURATION = 300
    const BREAK_DURATION = 10
    const LEADER2_DURATION = 300
    const VIS_BIT_DURATION = 30
    const H_SYNC_DURATION = 9
    const SYNC_PORCH_DURATION = 3
    const Y_DURATION = 88
    const SEP_DURATION = 4.5
    const PORCH_DURATION = 1.5
    const CR_CB_DURATION = 44

    const Y_PIXEL_TIME = Y_DURATION / width
    const CR_CB_PIXEL_TIME = CR_CB_DURATION / Math.floor(width / 2)

    const totalSamples = this.calculateTotalSamples(width, height)
    console.log('[SSTV] 预分配采样数:', totalSamples)
    this.audioBuffer = new Float32Array(totalSamples)
    this.bufferIndex = 0

    // 标准校准头
    this.addTone(1900, LEADER1_DURATION)
    this.addTone(1200, BREAK_DURATION)
    this.addTone(1900, LEADER2_DURATION)

    // VIS 编码 (LSB first, 偶校验)
    const visCode = 8
    const visBits = []
    for (let i = 0; i < 7; i++) {
      visBits.push((visCode >> i) & 1)
    }
    let parity = 0
    for (const bit of visBits) parity ^= bit

    this.addTone(1200, VIS_BIT_DURATION)  // Start bit
    for (const bit of visBits) {
      this.addTone(bit ? 1100 : 1300, VIS_BIT_DURATION)  // 0=1300Hz, 1=1100Hz
    }
    this.addTone(parity ? 1100 : 1300, VIS_BIT_DURATION)  // Parity
    this.addTone(1200, VIS_BIT_DURATION)  // Stop bit

    // 预计算图像频率 (RGB → YUV BT.601)
    // Robot36: 偶数行 = Y + RY(V), 奇数行 = Y + BY(U)
    const preparedImage = []
    for (let row = 0; row < height; row++) {
      const Y = []
      const RY = []
      const BY = []
      for (let col = 0; col < width; col++) {
        const idx = (row * width + col) * 4
        const r = data[idx] || 0
        const g = data[idx + 1] || 0
        const b = data[idx + 2] || 0

        // BT.601 标准 YUV 转换
        const Y_val = this.clamp(16.0 + (0.003906 * (65.738 * r + 129.057 * g + 25.064 * b)), 0, 255)
        const BY_val = this.clamp(128.0 + (0.003906 * (-37.945 * r - 74.494 * g + 112.439 * b)), 0, 255)
        const RY_val = this.clamp(128.0 + (0.003906 * (112.439 * r - 94.154 * g - 18.285 * b)), 0, 255)

        Y.push(1500 + Y_val * 3.1372549)
        RY.push(1500 + RY_val * 3.1372549)
        BY.push(1500 + BY_val * 3.1372549)
      }
      preparedImage.push({ Y, RY, BY })
    }

    // 逐行编码
    for (let row = 0; row < height; row++) {
      this.addTone(1200, H_SYNC_DURATION)
      this.addTone(1500, SYNC_PORCH_DURATION)

      for (let col = 0; col < width; col++) {
        this.addTone(preparedImage[row].Y[col], Y_PIXEL_TIME)
      }

      // 偶数行间隔 1500Hz, 奇数行 2300Hz
      const sepFreq = (row % 2 === 0) ? 1500 : 2300
      this.addTone(sepFreq, SEP_DURATION)
      this.addTone(1900, PORCH_DURATION)

      // 色度通道 (子采样): 偶数行 RY(V), 奇数行 BY(U)
      const chroma = (row % 2 === 0) ? preparedImage[row].RY : preparedImage[row].BY
      const halfW = Math.floor(width / 2)
      for (let col = 0; col < halfW; col++) {
        const idx1 = Math.min(col * 2, width - 1)
        const idx2 = Math.min(col * 2 + 1, width - 1)
        const freq = (chroma[idx1] + chroma[idx2]) / 2
        this.addTone(freq, CR_CB_PIXEL_TIME)
      }
    }

    console.log('[SSTV] 实际生成采样数:', this.bufferIndex)
    console.log('[SSTV] 缓冲区使用率:', (this.bufferIndex / totalSamples * 100).toFixed(2) + '%')

    return this.audioBuffer.slice(0, this.bufferIndex)
  }

  /**
   * 限幅函数
   */
  clamp(value, min, max) {
    return value < min ? min : (value > max ? max : value)
  }
}

module.exports = Robot36
