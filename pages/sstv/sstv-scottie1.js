/**
 * Scottie1 模式实现（预留）
 * 继承 SSTVMode 基类
 * 参考 Java 的 Scottie1.java
 */
const SSTVMode = require('./sstv-mode')

class Scottie1 extends SSTVMode {
  constructor(sampleRate = 48000) {
    super(sampleRate)
    this.modeName = 'Scottie1'
    this.visCode = 60  // Scottie1 的 VIS 码
  }

  /**
   * 计算所需的总采样数
   * 对应 Java 的 getTransmissionSamples 方法
   */
  calculateTotalSamples(width, height) {
    // Scottie1 时序参数（单位：ms）
    // TODO: 根据实际 Scottie1 规范调整参数
    const PREAMBLE_LOW_DURATION = 300
    const PREAMBLE_HIGH_DURATION = 3000
    const LEADER1_DURATION = 300
    const BREAK_DURATION = 10
    const LEADER2_DURATION = 300
    const VIS_BIT_DURATION = 30
    const VIS_TOTAL_BITS = 10

    const H_SYNC_DURATION = 9
    const SYNC_PORCH_DURATION = 3
    const Y_DURATION = 88
    const SEP_DURATION = 4.5
    const PORCH_DURATION = 1.5
    const CR_CB_DURATION = 44

    const lineDuration = H_SYNC_DURATION + SYNC_PORCH_DURATION +
                         Y_DURATION +
                         SEP_DURATION + PORCH_DURATION +
                         CR_CB_DURATION

    let totalSamples = 0
    totalSamples += Math.round(this.sampleRate * (PREAMBLE_LOW_DURATION / 1000))
    totalSamples += Math.round(this.sampleRate * (PREAMBLE_HIGH_DURATION / 1000))
    totalSamples += Math.round(this.sampleRate * (LEADER1_DURATION / 1000))
    totalSamples += Math.round(this.sampleRate * (BREAK_DURATION / 1000))
    totalSamples += Math.round(this.sampleRate * (LEADER2_DURATION / 1000))
    totalSamples += Math.round(this.sampleRate * (VIS_BIT_DURATION / 1000)) * VIS_TOTAL_BITS

    totalSamples += Math.round(this.sampleRate * (lineDuration / 1000)) * height

    return Math.floor(totalSamples * 1.1)
  }

  /**
   * 从 ImageData 生成 PCM 音频（Scottie1 标准）
   * TODO: 根据实际 Scottie1 规范实现编码逻辑
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

    // TODO: 实现 Scottie1 特定的编码逻辑
    console.warn('Scottie1 编码尚未实现')
    return new Float32Array(0)
  }
}

module.exports = Scottie1
