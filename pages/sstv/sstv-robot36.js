/**
 * Robot36 模式实现（对应 Java 的 Robot36.java）
 * 继承 SSTVMode 基类
 */
const SSTVMode = require('./sstv-mode')

class Robot36 extends SSTVMode {
  constructor(sampleRate = 48000) {
    super(sampleRate)
    this.modeName = 'Robot36'
    this.visCode = 8  // Robot36 的 VIS 码

    // Robot36 时序参数（单位：ms）
    // 对应 Java 的 Robot36 构造函数中的参数
    this.lumaScanSamples = 88.0      // Y 通道持续时间
    this.chrominanceScanSamples = 44.0 // 色度通道持续时间
    this.syncPulseSamples = 9.0        // 行同步脉冲
    this.syncPulseFrequency = 1200.0
    this.syncPorchSamples = 3.0         // 同步门廊
    this.syncPorchFrequency = 1500.0
    this.porchSamples = 1.5             // 色度门廊
    this.porchFrequency = 1900.0
    this.separatorSamples = 4.5          // 通道间隔
    this.evenSeparatorFrequency = 1500.0 // 偶数行间隔频率
    this.oddSeparatorFrequency = 2300.0  // 奇数行间隔频率
  }

  /**
   * 计算所需的总采样数
   * 对应 Java 的 getTransmissionSamples 方法
   */
  calculateTotalSamples(width, height) {
    // Robot36 标准时序 (单位: ms)
    // 标准 SSTV 协议不需要前导信号，直接发送标准校准头
    const LEADER1_DURATION = 300        // 先导音 1900Hz
    const BREAK_DURATION = 10           // 短暂脉冲 1200Hz
    const LEADER2_DURATION = 300        // 再次先导音 1900Hz
    const VIS_BIT_DURATION = 30         // VIS 位持续时间
    const VIS_TOTAL_BITS = 10           // VIS 总位数 (Start + 7 data + Parity + Stop)

    // 每行 (150ms)
    const H_SYNC_DURATION = 9           // 行同步脉冲 (1200Hz)
    const SYNC_PORCH_DURATION = 3       // 同步门廊 (1500Hz)
    const Y_DURATION = 88               // Y 通道 (亮度, 320 像素)
    const SEP_DURATION = 4.5            // 通道间隔 (1500Hz or 2300Hz)
    const PORCH_DURATION = 1.5          // 色度门廊 (1900Hz)
    const CR_CB_DURATION = 44           // R/B 通道 (色度, 160 像素)

    // 每行持续时间 (150ms)
    const lineDuration = H_SYNC_DURATION + SYNC_PORCH_DURATION +
                         Y_DURATION +
                         SEP_DURATION + PORCH_DURATION +
                         CR_CB_DURATION

    // 头部采样数（仅标准校准头，不含非标准前导）
    let totalSamples = 0
    totalSamples += Math.round(this.sampleRate * (LEADER1_DURATION / 1000))
    totalSamples += Math.round(this.sampleRate * (BREAK_DURATION / 1000))
    totalSamples += Math.round(this.sampleRate * (LEADER2_DURATION / 1000))
    totalSamples += Math.round(this.sampleRate * (VIS_BIT_DURATION / 1000)) * VIS_TOTAL_BITS

    // 所有行采样数
    totalSamples += Math.round(this.sampleRate * (lineDuration / 1000)) * height

    // 多预留 10%
    return Math.floor(totalSamples * 1.1)
  }

  /**
   * 从 ImageData 生成 PCM 音频 (Robot36 标准)
   * 对应 Java 的 writeEncodedLine 方法
   */
  encodeFromImageData(imageData) {
    let { width, height, data } = imageData
    if (!ArrayBuffer.isView(data) && !Array.isArray(data)) {
      console.error('ImageData.data 不是数组:', typeof data)
      return new Float32Array(0)
    }

    if (data.buffer && data.BYTES_PER_ELEMENT) {
      data = new Uint8Array(data.buffer)
    }

    // Robot36 标准时序 (ms) - 仅标准校准头，不含非标准前导
    const LEADER1_DURATION = 300        // 先导音 1900Hz
    const BREAK_DURATION = 10           // 短暂脉冲 1200Hz
    const LEADER2_DURATION = 300        // 再次先导音 1900Hz
    const VIS_BIT_DURATION = 30         // VIS 位 (1200/1300Hz)
    const H_SYNC_DURATION = 9           // 行同步脉冲 (1200Hz)
    const SYNC_PORCH_DURATION = 3       // 同步门廊 (1500Hz)
    const Y_DURATION = 88               // Y 通道 (亮度, 320 像素)
    const SEP_DURATION = 4.5            // 通道间隔 (1500Hz or 2300Hz)
    const PORCH_DURATION = 1.5          // 色度门廊 (1900Hz)
    const CR_CB_DURATION = 44           // R/B 通道 (色度, 160 像素)

    const Y_PIXEL_TIME = Y_DURATION / width
    const CR_CB_PIXEL_TIME = CR_CB_DURATION / Math.floor(width / 2)

    // 预分配音频缓冲区
    const totalSamples = this.calculateTotalSamples(width, height)
    console.log('[SSTV] 预分配采样数:', totalSamples)
    this.audioBuffer = new Float32Array(totalSamples)
    this.bufferIndex = 0

    // ---------- 0. 标准校准头 ----------
    this.addTone(1900, LEADER1_DURATION)        // Leader1: 1900Hz 300ms
    this.addTone(1200, BREAK_DURATION)          // Break: 1200Hz 10ms
    this.addTone(1900, LEADER2_DURATION)       // Leader2: 1900Hz 300ms

    // VIS 信号 (Robot36 mode code = 8, 7-bit, LSB first)
    // 参考 Mode.java writeCalibrationHeader: (mVISCode >> pos) & 1, pos 0-6
    const visCode = 8
    const visBits = []
    for (let i = 0; i < 7; i++) {
      visBits.push((visCode >> i) & 1)  // LSB first (与 Java 版本一致)
    }
    // 计算偶校验 (XOR 累积，与 Java 的 parity ^= bit 一致)
    let parity = 0
    for (const bit of visBits) {
      parity ^= bit
    }

    // 参考 Java 版本的频率定义: visBitFrequency = {1300.0, 1100.0}
    // bit=0 -> 1300Hz, bit=1 -> 1100Hz
    this.addTone(1200, VIS_BIT_DURATION)  // Start bit (1200Hz)
    for (const bit of visBits) {
      this.addTone(bit ? 1100 : 1300, VIS_BIT_DURATION)  // 参考 Java: 0=1300Hz, 1=1100Hz
    }
    this.addTone(parity ? 1100 : 1300, VIS_BIT_DURATION)  // Parity bit (参考 Java)
    this.addTone(1200, VIS_BIT_DURATION)  // Stop bit (1200Hz)

    // ---------- 2. 预计算图像频率 (参考 SSTVEncoder2 Robot36.java) ----------
    // Robot36 使用 Y-UV (YUV/NV21) 色彩空间，两行一组
    // 偶数行: Y + BY (U)
    // 奇数行: Y + RY (V)
    // 参考: YuvConverter.java 的转换公式
    const preparedImage = []
    for (let row = 0; row < height; row++) {
      const Y = []
      const RY = []  // V component (红色差)
      const BY = []  // U component (蓝色差)
      for (let col = 0; col < width; col++) {
        const idx = (row * width + col) * 4
        const r = data[idx] || 0
        const g = data[idx + 1] || 0
        const b = data[idx + 2] || 0

        // 参考 YuvConverter.java 标准 BT.601 转换
        // Y = 16 + 0.003906 * (65.738*R + 129.057*G + 25.064*B)
        // U = 128 + 0.003906 * (-37.945*R - 74.494*G + 112.439*B)  -> BY
        // V = 128 + 0.003906 * (112.439*R - 94.154*G - 18.285*B)  -> RY
        const Y_val = this.clamp(16.0 + (0.003906 * (65.738 * r + 129.057 * g + 25.064 * b)), 0, 255)
        const BY_val = this.clamp(128.0 + (0.003906 * (-37.945 * r - 74.494 * g + 112.439 * b)), 0, 255)
        const RY_val = this.clamp(128.0 + (0.003906 * (112.439 * r - 94.154 * g - 18.285 * b)), 0, 255)

        Y.push(1500 + Y_val * 3.1372549)    // Y: 1500-2300Hz
        RY.push(1500 + RY_val * 3.1372549)  // RY (V): 1500-2300Hz
        BY.push(1500 + BY_val * 3.1372549)  // BY (U): 1500-2300Hz
      }
      preparedImage.push({ Y, RY, BY })
    }

    // ---------- 3. 逐行编码 (参考 Robot36.java writeEncodedLine) ----------
    for (let row = 0; row < height; row++) {
      // 3.1 行同步脉冲 + 同步门廊 (参考 Java: addSyncPulse + addSyncPorch)
      this.addTone(1200, H_SYNC_DURATION)     // 同步脉冲 1200Hz
      this.addTone(1500, SYNC_PORCH_DURATION) // 同步门廊 1500Hz (Java: mSyncPorchFrequency=1500)

      // 3.2 发送 Y 通道 (亮度, 320 像素, 88ms)
      for (let col = 0; col < width; col++) {
        this.addTone(preparedImage[row].Y[col], Y_PIXEL_TIME)
      }

      // 3.3 间隔 + 门廊 (参考 Java: addSeparator + addPorch)
      // Java 版本: 偶数行 1500Hz, 奇数行 2300Hz
      const sepFreq = (row % 2 === 0) ? 1500 : 2300
      this.addTone(sepFreq, SEP_DURATION)      // 间隔 (偶数行1500Hz, 奇数行2300Hz)
      this.addTone(1900, PORCH_DURATION)  // 色度门廊 1900Hz

      // 3.4 发送色度通道 (子采样 160 像素, 44ms)
      // Robot36: 偶数行发 RY (V), 奇数行发 BY (U) - 参考 Robot36.java 第84-92行
      const chroma = (row % 2 === 0) ? preparedImage[row].RY : preparedImage[row].BY
      const halfW = Math.floor(width / 2)
      for (let col = 0; col < halfW; col++) {
        // 子采样: 取相邻两个像素的色度平均值
        const idx1 = Math.min(col * 2, width - 1)
        const idx2 = Math.min(col * 2 + 1, width - 1)
        const freq = (chroma[idx1] + chroma[idx2]) / 2
        this.addTone(freq, CR_CB_PIXEL_TIME)
      }
    }

    console.log('[SSTV] 实际生成采样数:', this.bufferIndex)
    console.log('[SSTV] 缓冲区使用率:', (this.bufferIndex / totalSamples * 100).toFixed(2) + '%')

    // 返回实际使用的缓冲区
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
