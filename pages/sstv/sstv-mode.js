/** SSTV 模式基类，包含通用编码方法 */
class SSTVMode {
  constructor(sampleRate = 48000) {
    this.sampleRate = sampleRate
    this.audioBuffer = null
    this.bufferIndex = 0
    this.currentPhase = 0  // 保持相位连续，避免音频不连续
    this.elapsedMs = 0     // 已编码累计时长(ms)，用于累加器式定位每个音的起止采样
  }

  calculateTotalSamples(width, height) {
    throw new Error('calculateTotalSamples must be implemented by subclass')
  }

  encodeFromImageData(imageData) {
    throw new Error('encodeFromImageData must be implemented by subclass')
  }

  /**
   * 生成指定频率的单频音，保持相位连续
   *
   * 时序采用「累加器定位」：每个音的起止采样由累计时长换算（start / end 各取整一次），
   * 取整误差不会跨音累积。若对每个音单独 Math.round，0.275ms 像素音（= 13.2 采样）
   * 每音亏 0.2 采样，每行累计短 96 采样（2ms）——解码端按名义时序取频时，
   * 行尾的取频窗会整窗落进下一行的 1200Hz 同步音，色度被钳为 0，
   * 表现为解码图片最右侧出现一列绿色色块。
   */
  addTone(freq, durationMs) {
    const startSample = Math.round(this.elapsedMs * this.sampleRate / 1000)
    this.elapsedMs += durationMs
    const endSample = Math.round(this.elapsedMs * this.sampleRate / 1000)
    const sampleCount = endSample - startSample
    const angularVelocity = 2 * Math.PI * freq / this.sampleRate

    for (let i = 0; i < sampleCount; i++) {
      const sample = Math.sin(this.currentPhase) * 0.8
      this.currentPhase += angularVelocity

      if (this.bufferIndex < this.audioBuffer.length) {
        this.audioBuffer[this.bufferIndex++] = sample
      }
    }

    this.currentPhase = this.currentPhase % (2 * Math.PI)
  }

  floatTo16BitPCM(output, offset, input) {
    for (let i = 0; i < input.length; i++, offset += 2) {
      const clamped = Math.max(-1, Math.min(1, input[i]))
      const intValue = clamped < 0
        ? clamped * 0x8000
        : clamped * 0x7FFF
      output.setInt16(offset, intValue, true)
    }
  }

  encodeWav(samples) {
    const dataSize = samples.length * 2
    const buffer = new ArrayBuffer(44 + dataSize)
    const view = new DataView(buffer)

    const writeString = (offset, str) => {
      for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i))
      }
    }

    writeString(0, 'RIFF')
    view.setUint32(4, 36 + dataSize, true)
    writeString(8, 'WAVE')
    writeString(12, 'fmt ')
    view.setUint32(16, 16, true)
    view.setUint16(20, 1, true)
    view.setUint16(22, 1, true)
    view.setUint32(24, this.sampleRate, true)
    view.setUint32(28, this.sampleRate * 2, true)
    view.setUint16(32, 2, true)
    view.setUint16(34, 16, true)
    writeString(36, 'data')
    view.setUint32(40, dataSize, true)

    this.floatTo16BitPCM(view, 44, samples)

    return buffer
  }

  /** 兼容旧接口 */
  async imageToAudio(imageData, width, height) {
    const { data } = imageData
    const mockImageData = { width, height, data }
    return this.encodeFromImageData(mockImageData)
  }
}

module.exports = SSTVMode
