/**
 * SSTV 模式基类（对应 Java 的 Mode.java）
 * 包含通用方法：addTone, encodeWav, floatTo16BitPCM 等
 */
class SSTVMode {
  constructor(sampleRate = 48000) {
    this.sampleRate = sampleRate
    this.audioBuffer = null
    this.bufferIndex = 0
    this.currentPhase = 0  // 跟踪当前相位，避免相位不连续
  }

  /**
   * 计算所需的总采样数（需要子类实现）
   */
  calculateTotalSamples(width, height) {
    throw new Error('calculateTotalSamples must be implemented by subclass')
  }

  /**
   * 从 ImageData 生成 PCM 音频（需要子类实现）
   */
  encodeFromImageData(imageData) {
    throw new Error('encodeFromImageData must be implemented by subclass')
  }

  /**
   * 生成指定频率的单频音（保持相位连续）
   * 对应 Java 的 setTone 方法
   */
  addTone(freq, durationMs) {
    const sampleCount = Math.round(this.sampleRate * (durationMs / 1000))
    const angularVelocity = 2 * Math.PI * freq / this.sampleRate

    for (let i = 0; i < sampleCount; i++) {
      const sample = Math.sin(this.currentPhase) * 0.8
      this.currentPhase += angularVelocity

      if (this.bufferIndex < this.audioBuffer.length) {
        this.audioBuffer[this.bufferIndex++] = sample
      }
    }

    // 保持相位在合理范围内，避免溢出
    this.currentPhase = this.currentPhase % (2 * Math.PI)
  }

  /**
   * 将 Float32 转换为 16-bit PCM
   * 对应 Java 的 Output.write 方法
   */
  floatTo16BitPCM(output, offset, input) {
    for (let i = 0; i < input.length; i++, offset += 2) {
      const clamped = Math.max(-1, Math.min(1, input[i]))
      const intValue = clamped < 0
        ? clamped * 0x8000  // -32768 to 0
        : clamped * 0x7FFF  // 0 to 32767
      output.setInt16(offset, intValue, true)
    }
  }

  /**
   * 编码为 WAV 格式
   * 对应 Java 的 WaveFileOutput 类
   */
  encodeWav(samples) {
    const dataSize = samples.length * 2
    const buffer = new ArrayBuffer(44 + dataSize)
    const view = new DataView(buffer)

    // 辅助函数：写入字符串
    const writeString = (offset, str) => {
      for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i))
      }
    }

    // RIFF 头
    writeString(0, 'RIFF')
    view.setUint32(4, 36 + dataSize, true)

    // WAVE 头
    writeString(8, 'WAVE')

    // fmt 子块
    writeString(12, 'fmt ')
    view.setUint32(16, 16, true)
    view.setUint16(20, 1, true)
    view.setUint16(22, 1, true)
    view.setUint32(24, this.sampleRate, true)
    view.setUint32(28, this.sampleRate * 2, true)
    view.setUint16(32, 2, true)
    view.setUint16(34, 16, true)

    // data 子块
    writeString(36, 'data')
    view.setUint32(40, dataSize, true)

    // 写入音频数据
    this.floatTo16BitPCM(view, 44, samples)

    return buffer
  }

  /**
   * 兼容旧接口
   */
  async imageToAudio(imageData, width, height) {
    const { data } = imageData
    const mockImageData = { width, height, data }
    return this.encodeFromImageData(mockImageData)
  }
}

module.exports = SSTVMode
