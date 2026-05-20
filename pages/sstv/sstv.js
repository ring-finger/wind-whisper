const VIBRATE_TYPE = 'medium'

class SSTVEncoder {
  constructor(sampleRate = 48000) {  // Robot36 标准采样率 48000Hz
    this.sampleRate = sampleRate
    this.audioBuffer = null
    this.bufferIndex = 0
    this.currentPhase = 0  // 跟踪当前相位，避免相位不连续
  }

  // 计算所需的总采样数 (Robot36: 每行 150ms)
  calculateTotalSamples(width, height) {
    // Robot36 标准时序 (单位: ms)
    // 头部
    const V_SYNC_DURATION = 300       // V-sync (1200Hz)
    const VIS_BIT_DURATION = 30       // 每个 VIS 位 (1200/1300Hz)
    const VIS_BITS = 10               // VIS 码位数 (起始位 + 8数据位 + 停止位)
    const LEADER_DURATION = 1000      // Leader tone (1900Hz) - 1秒

    // 每行 (150ms) - Robot36 分行发送 R 和 B
    const H_SYNC_DURATION = 9         // 行同步脉冲 (1200Hz)
    const SYNC_PORCH_DURATION = 3     // 同步门廊 (1900Hz)
    const Y_DURATION = 88             // Y 通道 (亮度, 320 像素)
    const SEP_DURATION = 4.5          // 通道间隔 (1500Hz)
    const PORCH_DURATION = 1.5        // 色度门廊 (1900Hz)
    const CR_CB_DURATION = 44         // R/B 通道 (色度, 160 像素)

    // 每行持续时间 (150ms)
    const lineDuration = H_SYNC_DURATION + SYNC_PORCH_DURATION +
                         Y_DURATION +
                         SEP_DURATION + PORCH_DURATION +
                         CR_CB_DURATION

    // 头部采样数
    let totalSamples = 0
    totalSamples += Math.floor(this.sampleRate * (V_SYNC_DURATION / 1000))
    totalSamples += Math.floor(this.sampleRate * (VIS_BIT_DURATION / 1000)) * VIS_BITS
    totalSamples += Math.floor(this.sampleRate * (LEADER_DURATION / 1000))

    // 所有行采样数
    totalSamples += Math.floor(this.sampleRate * (lineDuration / 1000)) * height

    // 多预留 10%
    return Math.floor(totalSamples * 1.1)
  }

  // 主入口：从 ImageData 生成 PCM 音频 (Robot36 标准)
  encodeFromImageData(imageData) {
    let { width, height, data } = imageData
    if (!ArrayBuffer.isView(data) && !Array.isArray(data)) {
      console.error('ImageData.data 不是数组:', typeof data)
      return new Float32Array(0)
    }

    if (data.buffer && data.BYTES_PER_ELEMENT) {
      data = new Uint8Array(data.buffer)
    }

    const halfWidth = Math.floor(width / 2)

    // Robot36 标准时序 (ms) - 必须与 calculateTotalSamples() 保持一致
    const V_SYNC_DURATION = 300        // V-sync (1200Hz)
    const VIS_BIT_DURATION = 30        // VIS 位 (1200/1300Hz)
    const LEADER_DURATION = 1000        // Leader tone (1900Hz)
    const H_SYNC_DURATION = 9           // 行同步脉冲 (1200Hz)
    const SYNC_PORCH_DURATION = 3       // 同步门廊 (1900Hz)
    const Y_DURATION = 88               // Y 通道 (亮度, 320 像素)
    const SEP_DURATION = 4.5           // 通道间隔 (1500Hz)
    const PORCH_DURATION = 1.5         // 色度门廊 (1900Hz)
    const CR_CB_DURATION = 44           // R/B 通道 (色度, 160 像素)

    const Y_PIXEL_TIME = Y_DURATION / width
    const CR_CB_PIXEL_TIME = CR_CB_DURATION / halfWidth

    // 预分配音频缓冲区
    const totalSamples = this.calculateTotalSamples(width, height)
    console.log('[SSTV] 预分配采样数:', totalSamples)
    this.audioBuffer = new Float32Array(totalSamples)
    this.bufferIndex = 0

    // 1. 头部信号 (标准 SSTV 头部)
    // 标准格式: V-sync(1200Hz, 300ms) + VIS(1200/1300Hz, 10 bits) + Leader(1900Hz, 1s)
    // 参考: https://www.sstv-handbook.com/

    // 1.1 垂直同步 (V-sync): 1200Hz, 300ms
    this.addTone(1200, 300)

    // 1.2 VIS 信号 (Robot36 模式代码: 8 = 0b01000)
    // 格式: 起始位(1200Hz) + 8位数据(LSB first) + 停止位(1200Hz)
    // 注意: 数据位 1=1300Hz, 0=1200Hz (标准 SSTV 定义)
    // Robot36 VIS 码 = 8 = 00001000 (binary, LSB first transmission)
    const visCode = 8  // Robot36 mode code

    this.addTone(1200, VIS_BIT_DURATION)  // 起始位 (1200Hz)
    for (let i = 0; i < 8; i++) {       // 数据位 (LSB first)
      const bit = (visCode >> i) & 1
      const freq = bit ? 1300 : 1200  // 1=1300Hz, 0=1200Hz
      this.addTone(freq, VIS_BIT_DURATION)
    }
    this.addTone(1200, VIS_BIT_DURATION)  // 停止位 (1200Hz)

    // 1.3 Leader tone: 1900Hz, 1000ms (帮助解码器稳定)
    this.addTone(1900, 1000)

    // 2. 逐行编码 (Robot36: 分行发送 Y+B 和 Y+R)
    // 偶数行: Y + B
    // 奇数行: Y + R
    // 两行合并成一个完整扫描线
    for (let row = 0; row < height; row++) {
      // 2.1 行同步脉冲 + 门廊
      this.addTone(1200, H_SYNC_DURATION)       // 同步脉冲 (1200Hz)
      this.addTone(1900, SYNC_PORCH_DURATION)   // 同步门廊 (1900Hz)

      // 2.2 发送 Y 通道 (亮度)
      for (let col = 0; col < width; col++) {
        const idx = (row * width + col) * 4
        let pixelValue
        if (idx + 2 >= data.length) {
          pixelValue = 0
        } else {
          // 正确使用亮度公式: Y = 0.299*R + 0.587*G + 0.114*B
          const r = data[idx]
          const g = data[idx + 1]
          const b = data[idx + 2]
          pixelValue = Math.round(0.299 * r + 0.587 * g + 0.114 * b)
        }
        const freq = 1500 + (pixelValue / 255) * 800  // 1500-2300Hz
        this.addTone(freq, Y_PIXEL_TIME)
      }

      // 2.3 间隔 + 门廊
      this.addTone(1500, SEP_DURATION)      // 间隔 (1500Hz)
      this.addTone(1900, PORCH_DURATION)    // 色度门廊 (1900Hz)

      // 2.4 发送色度通道 (R 或 B, 子采样)
      // 偶数行: B 通道 (映射到奇数列: 1, 3, 5, ...)
      // 奇数行: R 通道 (映射到偶数列: 0, 2, 4, ...)
      const isEvenRow = (row % 2 === 0)
      for (let col = 0; col < halfWidth; col++) {
        let srcCol
        if (isEvenRow) {
          // B 通道: 奇数列
          srcCol = Math.min(col * 2 + 1, width - 1)
        } else {
          // R 通道: 偶数列
          srcCol = Math.min(col * 2, width - 1)
        }

        const idx = (row * width + srcCol) * 4
        let pixelValue
        if (idx + 2 >= data.length) {
          pixelValue = 0
        } else {
          pixelValue = isEvenRow ? data[idx + 2] : data[idx]  // B 或 R
        }

        const freq = 1500 + (pixelValue / 255) * 800  // 1500-2300Hz
        this.addTone(freq, CR_CB_PIXEL_TIME)
      }
    }

    console.log('[SSTV] 实际生成采样数:', this.bufferIndex)
    console.log('[SSTV] 缓冲区使用率:', (this.bufferIndex / totalSamples * 100).toFixed(2) + '%')

    return this.audioBuffer.slice(0, this.bufferIndex)
  }

  // 添加 VIS 位 (标准 SSTV: 1=1300Hz, 0=1200Hz)
  addVisBit(bit, durationMs) {
    const freq = bit ? 1300 : 1200  // bit 1 = 1300Hz, bit 0 = 1200Hz
    this.addTone(freq, durationMs)
  }

  // 生成指定频率的单频音 (保持相位连续)
  addTone(frequency, durationMs) {
    const sampleCount = Math.round(this.sampleRate * (durationMs / 1000))
    const angularVelocity = 2 * Math.PI * frequency / this.sampleRate

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

  // 兼容旧接口
  async imageToAudio(imageData, width, height) {
    const { data } = imageData
    const mockImageData = { width, height, data }
    return this.encodeFromImageData(mockImageData)
  }

  floatTo16BitPCM(output, offset, input) {
    for (let i = 0; i < input.length; i++, offset += 2) {
      const val = input[i]
      const clamped = Math.max(-1, Math.min(1, val))
      // 将 [-1, 1] 浮点数转换为 16-bit PCM
      // 负数: [-1, 0) -> [-32768, 0)
      // 正数: [0, 1] -> [0, 32767]
      let intValue
      if (clamped < 0) {
        intValue = Math.floor(clamped * 0x8000)  // -32768 to 0
      } else {
        intValue = Math.floor(clamped * 0x7FFF)  // 0 to 32767
      }
      output.setInt16(offset, intValue, true)  // 小端序
    }
  }

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
    
    // RIFF 头 (偏移 0-11)
    writeString(0, 'RIFF')
    // Chunk size = 文件总大小 - 8
    view.setUint32(4, 36 + dataSize, true)  // 小端序
    
    // WAVE 头 (偏移 8-11)
    writeString(8, 'WAVE')
    
    // fmt 子块 (偏移 12-35)
    writeString(12, 'fmt ')
    view.setUint32(16, 16, true)        // fmt 块大小 (PCM = 16)
    view.setUint16(20, 1, true)          // 音频格式 (PCM = 1)
    view.setUint16(22, 1, true)          // 声道数 (单声道 = 1)
    view.setUint32(24, this.sampleRate, true) // 采样率
    view.setUint32(28, this.sampleRate * 2, true) // 字节率 = SampleRate * NumChannels * BitsPerSample/8
    view.setUint16(32, 2, true)          // 块对齐 = NumChannels * BitsPerSample/8
    view.setUint16(34, 16, true)         // 位深度 (16 bits)
    
    // data 子块 (偏移 36-43)
    writeString(36, 'data')
    view.setUint32(40, dataSize, true)    // 数据大小
    
    // 写入音频数据 (偏移 44 开始)
    this.floatTo16BitPCM(view, 44, samples)
    
    console.log('[SSTV] WAV文件生成完成')
    console.log('[SSTV] 文件大小:', buffer.byteLength, '字节')
    console.log('[SSTV] 数据大小:', dataSize, '字节')
    console.log('[SSTV] 采样数:', samples.length)
    
    return buffer
  }
}

class SSTVDecoder {
  constructor() {
    this.sampleRate = 8000
    this.SYNC_FREQ = 1200
    this.BLANK_FREQ = 1500
    this.PORCH_FREQ = 1900
    this.COLOR_MIN = 1500
    this.COLOR_MAX = 2300

    // Robot36 标准时序 (ms) - 每行 150ms
    this.H_SYNC_TIME = 9       // 行同步脉冲
    this.SYNC_PORCH_TIME = 3   // 同步门廊
    this.Y_TIME = 88           // Y 通道 (亮度, 320 像素)
    this.SEP_TIME = 4.5        // 通道间隔
    this.PORCH_TIME = 1.5      // 色度门廊
    this.CR_CB_TIME = 44       // R/B 通道 (色度, 160 像素)

    // 每行持续时间 (150ms)
    this.LINE_TIME = this.H_SYNC_TIME + this.SYNC_PORCH_TIME +
                     this.Y_TIME + this.SEP_TIME + this.PORCH_TIME +
                     this.CR_CB_TIME

    this.imageWidth = 320
    this.imageHeight = 240
    this.currentFormat = 'Robot36'

    this.reset()
  }

  reset() {
    this.currentLine = 0
    this.imageData = new Uint8ClampedArray(this.imageWidth * this.imageHeight * 4)
    this.audioBuffer = []
    this.isDecoding = false
    this.onProgress = null
    this.onComplete = null

    // 状态机: SEARCHING -> SYNC -> IMAGE
    this.state = 'SEARCHING'
    this.lineStartSample = 0
    this.sampleCount = 0
    this.totalSamples = 0

    // 行内像素采样 (Robot36: 每行 Y + (R 或 B))
    this.currentChannel = 'Y'
    this.channelPixelIndex = 0
    this.yPixels = []       // Y 通道像素
    this.redPixels = []     // R 通道像素 (奇数行)
    this.bluePixels = []    // B 通道像素 (偶数行)
    this.prevLinePixels = null  // 前一行的像素，用于合并

    // 同步检测
    this.consecutiveSync = 0
    this.syncSamples = 0
    this.lastFreq = 0

    // 音频结束检测
    this.lastAudioTime = 0
    this.silenceCount = 0

    // VIS 检测
    this.visDetected = false
  }

  processAudioFrame(frameBuffer) {
    if (!this.isDecoding) return
    if (!frameBuffer || frameBuffer.length === 0) return

    this.lastAudioTime = Date.now()
    this.audioBuffer.push(...frameBuffer)
    this.totalSamples += frameBuffer.length

    while (this.audioBuffer.length >= 32) {
      this.processAudioData()
    }
  }

  processAudioData() {
    if (!this.isDecoding) return
    if (this.audioBuffer.length < 32) return

    const windowSize = 32
    const samples = this.audioBuffer.splice(0, windowSize)
    this.sampleCount += windowSize

    const freq = this.detectFrequency(samples)
    const isSync = Math.abs(freq - this.SYNC_FREQ) < 100

    switch (this.state) {
      case 'SEARCHING':
        // 寻找连续的 1200Hz 同步信号（行同步）
        if (isSync) {
          this.consecutiveSync++
          this.syncSamples += windowSize
          // 行同步约 9ms，在 8kHz 采样率下约 72 个采样
          if (this.consecutiveSync >= 3) {
            this.state = 'SYNC'
            this.lineStartSample = this.sampleCount
            this.currentLine = 0
            this.consecutiveSync = 0
            this.syncSamples = 0
            this.visDetected = true
          }
        } else {
          this.consecutiveSync = Math.max(0, this.consecutiveSync - 1)
          if (this.consecutiveSync === 0) this.syncSamples = 0
        }
        break

      case 'SYNC':
        // 等待同步脉冲结束
        if (!isSync) {
          const samplesSinceSync = this.sampleCount - this.lineStartSample
          const timeSinceSync = (samplesSinceSync / this.sampleRate) * 1000

          if (timeSinceSync > 3) {  // 同步脉冲结束，开始图像行
            this.state = 'IMAGE'
            this.currentChannel = 'GREEN'
            this.channelPixelIndex = 0
            this.greenPixels = []
            this.redPixels = []
            this.bluePixels = []
            this.lineStartSample = this.sampleCount
          }
        }
        break

      case 'IMAGE':
        const samplesInLine = this.sampleCount - this.lineStartSample
        const timeInLine = (samplesInLine / this.sampleRate) * 1000

        // 检测新行同步
        if (isSync) {
          if (this.consecutiveSync === 0) {
            this.saveCurrentLine()

            this.currentLine++
            this.consecutiveSync = 1

            if (this.currentLine >= this.imageHeight) {
              this.isDecoding = false
              if (this.onComplete) {
                this.onComplete(this.imageData, this.imageWidth, this.imageHeight)
              }
              this.state = 'SEARCHING'
              return
            }

            if (this.onProgress) {
              const progress = Math.floor((this.currentLine / this.imageHeight) * 100)
              this.onProgress(progress, this.currentLine)
            }

            this.currentChannel = 'GREEN'
            this.channelPixelIndex = 0
            this.greenPixels = []
            this.redPixels = []
            this.bluePixels = []
            this.lineStartSample = this.sampleCount
          }
          return
        }

        this.consecutiveSync = Math.max(0, this.consecutiveSync - 1)
        this.samplePixel(freq, timeInLine)
        break
    }

    this.lastFreq = freq

    if (this.audioBuffer.length === 0) {
      this.silenceCount++
      if (this.silenceCount > 100 && this.currentLine > 10) {
        this.isDecoding = false
        if (this.onComplete) {
          this.onComplete(this.imageData, this.imageWidth, this.imageHeight)
        }
        this.state = 'SEARCHING'
      }
    } else {
      this.silenceCount = 0
    }
  }

  samplePixel(freq, timeInLine) {
    // Robot36: 每行只有 Y + (R 或 B)，两行合并成一个完整扫描线
    // 偶数行: Y + B
    // 奇数行: Y + R
    let channelStart, channelEnd

    if (this.currentChannel === 'Y') {
      channelStart = this.H_SYNC_TIME + this.SYNC_PORCH_TIME
      channelEnd = channelStart + this.Y_TIME
      if (timeInLine >= channelEnd) {
        this.currentChannel = 'CR_CB'  // 色度通道 (R 或 B)
        this.channelPixelIndex = 0
        return
      }
    } else {
      // 色度通道
      channelStart = this.H_SYNC_TIME + this.SYNC_PORCH_TIME + this.Y_TIME + this.SEP_TIME + this.PORCH_TIME
      channelEnd = channelStart + this.CR_CB_TIME
    }

    if (timeInLine < channelStart) return

    const channelTime = timeInLine - channelStart
    const pixelsPerChannel = this.currentChannel === 'Y' ? this.imageWidth : this.imageWidth / 2

    const pixelIndex = Math.floor((channelTime / this.getChannelDuration(this.currentChannel)) * pixelsPerChannel)

    if (pixelIndex > this.channelPixelIndex && pixelIndex < pixelsPerChannel) {
      const gray = this.frequencyToGray(freq)

      if (this.currentChannel === 'Y') {
        this.yPixels.push(gray)
      } else {
        // 色度通道: 偶数行是 B, 奇数行是 R
        if (this.currentLine % 2 === 0) {
          this.bluePixels.push(gray)  // 偶数行: B
        } else {
          this.redPixels.push(gray)   // 奇数行: R
        }
      }

      this.channelPixelIndex = pixelIndex
    }
  }

  getChannelDuration(channel) {
    if (channel === 'Y') return this.Y_TIME
    return this.CR_CB_TIME
  }

  saveCurrentLine() {
    // Robot36: 两行合并成一个完整扫描线
    // 偶数行: Y + B
    // 奇数行: Y + R
    // 合并: 使用偶数行的 Y+B 和奇数行的 Y+R

    if (this.currentLine >= this.imageHeight) return

    const lineIndex = Math.floor(this.currentLine / 2)  // 两行合并成一行
    const width = this.imageWidth

    // 如果是偶数行，保存 Y 和 B
    if (this.currentLine % 2 === 0) {
      if (this.yPixels.length === 0) return

      this.prevLinePixels = {
        y: [...this.yPixels],
        b: [...this.bluePixels]
      }

      // 偶数行先不保存到 imageData，等奇数行到了再合并
      // 但是第一行（偶数行）需要单独处理
      if (this.currentLine === 0 && this.yPixels.length > 0) {
        // 第一行：只保存 Y，R 和 B 暂时用 Y 代替
        for (let x = 0; x < width; x++) {
          const idx = (lineIndex * width + x) * 4
          const yIdx = Math.floor(x * this.yPixels.length / width)
          const y = this.yPixels[Math.min(yIdx, this.yPixels.length - 1)] || 0
          this.imageData[idx] = y      // R 暂时用 Y
          this.imageData[idx + 1] = y  // G = Y
          this.imageData[idx + 2] = y  // B 暂时用 Y
          this.imageData[idx + 3] = 255
        }
      }
    } else {
      // 奇数行: 有 Y 和 R，与前一行的 Y 和 B 合并
      if (!this.prevLinePixels || this.yPixels.length === 0) return

      const prevY = this.prevLinePixels.y
      const prevB = this.prevLinePixels.b
      const currY = this.yPixels
      const currR = this.redPixels

      for (let x = 0; x < width; x++) {
        const idx = (lineIndex * width + x) * 4

        // 使用当前行的 Y（或者前一行的 Y，取哪个？）
        // 从 Java 代码看，它使用了当前行的 Y
        const yIdx = Math.floor(x * currY.length / width)
        const y = currY[Math.min(yIdx, currY.length - 1)] || 0

        // R: 从当前行获取（子采样）
        let r = y
        if (currR.length > 0) {
          const rIdx = Math.floor((x / 2) * currR.length / (width / 2))
          r = currR[Math.min(rIdx, currR.length - 1)] || y
        }

        // B: 从前一行获取（子采样）
        let b = y
        if (prevB.length > 0) {
          const bIdx = Math.floor(((x + 1) / 2) * prevB.length / (width / 2))
          b = prevB[Math.min(bIdx, prevB.length - 1)] || y
        }

        this.imageData[idx] = r
        this.imageData[idx + 1] = y
        this.imageData[idx + 2] = b
        this.imageData[idx + 3] = 255
      }
    }

    // 重置像素数组
    this.yPixels = []
    this.redPixels = []
    this.bluePixels = []
  }

  detectFrequency(samples) {
    const N = samples.length
    let maxEnergy = 0
    let bestFreq = 1900

    for (let freq = 1200; freq <= 2300; freq += 25) {
      const energy = this.goertzel(samples, freq, N)
      if (energy > maxEnergy) {
        maxEnergy = energy
        bestFreq = freq
      }
    }

    return bestFreq
  }

  goertzel(samples, targetFreq, N) {
    const k = Math.round(0.5 + (N * targetFreq) / this.sampleRate)
    const w = (2 * Math.PI * k) / N
    const coeff = 2 * Math.cos(w)

    let s0 = 0, s1 = 0

    for (let i = 0; i < N; i++) {
      const s2 = samples[i] + coeff * s1 - s0
      s0 = s1
      s1 = s2
    }

    const power = s1 * s1 + s0 * s0 - coeff * s1 * s0
    return power / N
  }

  frequencyToGray(freq) {
    if (freq < this.COLOR_MIN) return 0
    if (freq > this.COLOR_MAX) return 255
    const ratio = (freq - this.COLOR_MIN) / (this.COLOR_MAX - this.COLOR_MIN)
    return Math.floor(ratio * 255)
  }
}

Page({
  data: {
    currentTab: 'encode',
    uploadImage: '',
    imageWidth: 0,
    imageHeight: 0,
    quality: 80,
    sensitivity: 50,
    isEncoding: false,
    isDecoding: false,
    audioFilePath: '',
    isPlaying: false,
    audioDuration: 0,
    audioCurrentTime: 0,
    audioProgress: 0,
    audioDurationStr: '0:00',
    audioCurrentTimeStr: '0:00',
    audioFileSize: '',
    audioFormat: 'WAV',
    decodedImage: '',
    decodeProgress: 0,
    scanLine: 0,
    sstvEncoder: null,
    sstvDecoder: null,
    recorderManager: null,
    audioContext: null,
    currentTheme: 'radio',
    // 呼号相关
    callsign: '',
    showCallsign: false,
    showCallsignInput: false,
    callsignX: 10,  // 默认左下角内侧 (距离左边10px)
    callsignY: 210,  // 默认左下角内侧 (距离底部30px = 240-30)
    callsignTouchStartX: 0,
    callsignTouchStartY: 0
  },

  onLoad() {
    this.loadTheme()
    wx.setNavigationBarTitle({ title: 'SSTV图像传输' })
    this.initSSTV()
    this.initRecorder()
  },

  onShow() {
    this.loadTheme()
  },

  onHide() {
    // 页面隐藏时停止录音，防止页面卡死
    if (this.data.isDecoding) {
      this.forceStopRecording()
      this.setData({ isDecoding: false })
    }
    
    // 停止音频播放
    if (this.audioContext) {
      this.audioContext.stop()
      this.audioContext.destroy()
      this.audioContext = null
      this.setData({ 
        isPlaying: false,
        audioCurrentTime: 0,
        audioCurrentTimeStr: '0:00',
        audioProgress: 0
      })
    }
    
    console.log('页面隐藏，录音已停止')
  },

  onUnload() {
    // 页面卸载时清理资源
    if (this.data.isDecoding) {
      this.forceStopRecording()
    }
    
    // 清理定时器
    if (this.updateTimer) {
      clearTimeout(this.updateTimer)
    }
    
    // 关闭音频上下文
    if (this.audioContext) {
      this.audioContext.stop()
      this.audioContext.destroy()
      this.audioContext = null
    }
    
    console.log('页面卸载，资源已清理')
  },

  loadTheme() {
    try {
      const savedTheme = wx.getStorageSync('appTheme') || 'radio'
      this.setData({ currentTheme: savedTheme })
      // 设置统一的导航栏背景色
      wx.setNavigationBarColor({
        frontColor: '#000000',
        backgroundColor: '#F9F7F4',
        animation: {
          duration: 0,
          timingFunc: 'linear'
        }
      })
    } catch (e) {
      console.error('加载主题失败', e)
    }
  },

  initSSTV() {
    // 只保存类引用，不通过 setData 传输（避免大量数据传输）
    this.encoder = new SSTVEncoder()
    this.decoder = new SSTVDecoder()
    // 如果需要访问，使用 this.encoder 和 this.decoder
  },

  initRecorder() {
    const recorderManager = wx.getRecorderManager()
    
    // 录音开始事件
    recorderManager.onStart(() => {
      console.log('录音已开始')
      wx.showToast({ title: '录音已开始', icon: 'success' })
    })
    
    // 录音帧数据回调 - 关键！需要设置frameSize才会触发
    recorderManager.onFrameRecorded((res) => {
      const { frameBuffer } = res
      if (!frameBuffer || frameBuffer.byteLength === 0) {
        console.log('空帧数据')
        return
      }
      
      if (this.data.isDecoding && this.decoder) {
        try {
          // 将 ArrayBuffer 转换为 Float32Array
          const floatArray = new Float32Array(frameBuffer)
          
          // 处理音频帧用于解码
          this.decoder.processAudioFrame(floatArray)
        } catch (err) {
          console.error('处理音频帧失败:', err)
        }
      }
    })
    
    // 录音结束事件
    recorderManager.onStop((res) => {
      console.log('录音已停止', res)
    })
    
    // 录音错误处理
    recorderManager.onError((err) => {
      console.error('录音错误:', err)
      console.log('错误详情:', JSON.stringify(err))
      this.setData({ isDecoding: false })
    })
    
    this.recorderManager = recorderManager
  },

  switchTab(e) {
    const tab = e.currentTarget.dataset.tab
    this.setData({ currentTab: tab })
    wx.vibrateShort({ type: VIBRATE_TYPE })
  },

  chooseImage() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const tempFilePath = res.tempFiles[0].tempFilePath
        wx.getImageInfo({
          src: tempFilePath,
          success: (info) => {
            this.setData({
              uploadImage: tempFilePath,
              imageWidth: info.width,
              imageHeight: info.height
            })
            this.resizeImage(tempFilePath)
          }
        })
      }
    })
    wx.vibrateShort({ type: VIBRATE_TYPE })
  },

  resizeImage(path) {
    const targetWidth = 320
    const targetHeight = 240
    const query = wx.createSelectorQuery()
    query.select('#resizeCanvas')
      .node((res) => {
        const canvas = res.node
        canvas.width = targetWidth
        canvas.height = targetHeight
        const ctx = canvas.getContext('2d')
        const img = canvas.createImage()
        img.onload = () => {
          ctx.drawImage(img, 0, 0, targetWidth, targetHeight)
        }
        img.src = path
      })
    query.exec()
  },

  onQualityChange(e) {
    this.setData({ quality: e.detail.value })
  },

  onSensitivityChange(e) {
    this.setData({ sensitivity: e.detail.value })
  },

  async startEncode() {
    if (!this.data.uploadImage) {
      wx.showToast({ title: '请先选择图片', icon: 'none' })
      return
    }

    this.setData({ isEncoding: true, audioFilePath: '' })
    wx.showLoading({ title: '正在生成...' })

    // 正常编码模式：从图片生成 SSTV 音频
    try {
      const query = wx.createSelectorQuery()
      query.select('#encodeCanvas')
        .node((res) => {
          const canvas = res.node
          canvas.width = 320
          canvas.height = 240
          const ctx = canvas.getContext('2d')
          
          // 使用 createImage 加载图片
          const img = canvas.createImage()
          img.onload = () => {
            // 先绘制图片到 canvas
            ctx.drawImage(img, 0, 0, 320, 240)
            
            // 如果显示呼号，绘制呼号文字到 canvas
            if (this.data.showCallsign && this.data.callsign) {
              ctx.save()
              ctx.font = 'bold 24px monospace'
              ctx.fillStyle = '#FFFFFF'
              ctx.strokeStyle = '#000000'
              ctx.lineWidth = 3
              ctx.textBaseline = 'top'
              
              // 绘制描边文字（提高可读性）
              ctx.strokeText(this.data.callsign, this.data.callsignX, this.data.callsignY)
              ctx.fillText(this.data.callsign, this.data.callsignX, this.data.callsignY)
              ctx.restore()
            }
            
            // 等待一小段时间确保绘制完成
            setTimeout(() => {
              try {
                // 使用 ImageData API 获取像素数据
                const imageData = ctx.getImageData(0, 0, 320, 240)
                
                const encoder = this.encoder
                if (!encoder) {
                  wx.hideLoading()
                  this.setData({ isEncoding: false })
                  wx.showToast({ title: '编码器初始化失败', icon: 'none' })
                  return
                }
                
                // 使用新的 encodeFromImageData 方法
                const samples = encoder.encodeFromImageData(imageData)
                
                // 调试：打印音频缓冲区信息
                console.log('[SSTV] 编码完成，采样点数:', samples.length)
                console.log('[SSTV] 采样率:', encoder.sampleRate)
                console.log('[SSTV] 理论音频时长(秒):', samples.length / encoder.sampleRate)
                
                // 计算音频时长（秒）
                const audioDuration = Math.round(samples.length / encoder.sampleRate)
                console.log('[SSTV] 音频时长(取整):', audioDuration, '秒')
                
                // 计算预期文件大小
                const expectedFileSize = 44 + samples.length * 2
                console.log('[SSTV] 预期WAV文件大小:', expectedFileSize, '字节')
                
                const wavBuffer = encoder.encodeWav(samples)
                const arrayBuffer = new ArrayBuffer(wavBuffer.byteLength)
                const view = new Uint8Array(arrayBuffer)
                view.set(new Uint8Array(wavBuffer))
                const fileManager = wx.getFileSystemManager()
                const filePath = wx.env.USER_DATA_PATH + '/sstv_encode.wav'
                fileManager.writeFile({
                  filePath,
                  data: arrayBuffer,
                  success: () => {
                    // 获取文件大小
                    const fileManager = wx.getFileSystemManager()
                    try {
                      const fileStats = fileManager.statSync(filePath)
                      const fileSize = fileStats.size
                      const fileSizeKB = (fileSize / 1024).toFixed(1)
                      const fileSizeMB = (fileSize / (1024 * 1024)).toFixed(2)
                      const displaySize = fileSize > 1024 * 1024 
                        ? fileSizeMB + ' MB' 
                        : fileSizeKB + ' KB'
                      
                      // 调试：对比预期和实际文件大小
                      console.log('[SSTV] 实际文件大小:', fileSize, '字节')
                      console.log('[SSTV] 预期文件大小:', expectedFileSize, '字节')
                      console.log('[SSTV] 文件大小是否匹配:', fileSize === expectedFileSize)
                      
                      // 根据实际文件大小计算真实时长
                      const actualSamples = (fileSize - 44) / 2
                      const actualDuration = Math.round(actualSamples / encoder.sampleRate)
                      console.log('[SSTV] 实际音频采样数:', actualSamples)
                      console.log('[SSTV] 实际音频时长:', actualDuration, '秒')
                      
                      this.setData({ 
                        audioFilePath: filePath,
                        isEncoding: false,
                        audioFileSize: displaySize,
                        audioDuration: actualDuration,  // 使用实际计算的时长
                        audioDurationStr: this.formatTime(actualDuration)
                      })
                      console.log('[SSTV] 音频文件已保存，时长设置为:', actualDuration, '秒')
                    } catch (e) {
                      this.setData({ 
                        audioFilePath: filePath,
                        isEncoding: false,
                        audioFileSize: '未知大小',
                        audioDuration: audioDuration,
                        audioDurationStr: this.formatTime(audioDuration)
                      })
                    }
                    wx.hideLoading()
                    wx.showToast({ title: '生成成功', icon: 'success' })
                  },
                  fail: (err) => {
                    wx.hideLoading()
                    this.setData({ isEncoding: false })
                    wx.showToast({ title: '保存失败', icon: 'none' })
                    console.error(err)
                  }
                })
              } catch (err) {
                wx.hideLoading()
                this.setData({ isEncoding: false })
                wx.showToast({ title: '编码失败', icon: 'none' })
                console.error(err)
              }
            }, 100)  // 等待 100ms 确保绘制完成
          }
          img.onerror = (err) => {
            wx.hideLoading()
            this.setData({ isEncoding: false })
            wx.showToast({ title: '图片加载失败', icon: 'none' })
            console.error('图片加载失败:', err)
          }
          img.src = this.data.uploadImage
        })
      query.exec()
    } catch (err) {
      wx.hideLoading()
      this.setData({ isEncoding: false })
      wx.showToast({ title: '编码失败', icon: 'none' })
      console.error(err)
    }
  },

  toggleDecode() {
    if (this.data.isDecoding) {
      this.stopDecode()
    } else {
      this.startDecode()
    }
  },

  startDecode() {
    // 检查权限
    wx.getSetting({
      success: (res) => {
        if (!res.authSetting['scope.record']) {
          wx.authorize({
            scope: 'scope.record',
            success: () => {
              this._startDecoding()
            },
            fail: () => {
              wx.showModal({
                title: '需要麦克风权限',
                content: '请在设置中开启麦克风权限',
                success: (res) => {
                  if (res.confirm) {
                    wx.openSetting()
                  }
                }
              })
            }
          })
        } else {
          this._startDecoding()
        }
      }
    })
  },

  _startDecoding() {
    this.decodedImageData = null // 保存解码后的图片数据
    this.hasCompletedDecoding = false // 标记是否完成解码
    
    // 保持屏幕常量 - 防止息屏
    wx.setKeepScreenOn({
      keepScreenOn: true,
      success: () => {
        console.log('屏幕保持常亮成功')
      },
      fail: () => {
        console.error('屏幕保持常亮失败')
      }
    })
    
    // 初始化
    this.setData({ 
      isDecoding: true, 
      decodedImage: '', 
      decodeProgress: 0, 
      scanLine: 0
    })
    
    const decoder = this.decoder
    if (decoder) {
      decoder.reset()
      decoder.isDecoding = true // 确保解码器处于活动状态
      decoder.onProgress = (progress, scanLine) => {
        // 使用防抖更新UI，避免过于频繁的setData
        if (this.updateTimer) {
          clearTimeout(this.updateTimer)
        }
        this.updateTimer = setTimeout(() => {
          this.setData({ decodeProgress: progress, scanLine })
          
          // 实时更新预览图片 - 降低频率，每20行更新一次
          if (decoder.imageData && scanLine > 0 && scanLine % 20 === 0) {
            this.decodedImageData = decoder.imageData
            this.renderDecodedImage(
              decoder.imageData, 
              decoder.imageWidth, 
              decoder.imageHeight
            ).then((filePath) => {
              this.setData({ decodedImage: filePath })
            }).catch((err) => {
              console.error('实时预览失败:', err)
              // 失败时不重复尝试
            })
          }
        }, 200) // 200ms 防抖
      }
      decoder.onComplete = (imageData, width, height) => {
        this.hasCompletedDecoding = true
        this.decodedImageData = imageData
        
        // 立即停止录音
        this.forceStopRecording()
        
        this.renderDecodedImage(imageData, width, height).then((filePath) => {
          this.setData({ 
            isDecoding: false,
            decodedImage: filePath,
            decodeProgress: 100
          })
          wx.showToast({ title: '解码完成', icon: 'success' })
        }).catch((err) => {
          console.error('渲染解码图片失败:', err)
          this.setData({ isDecoding: false })
          wx.showToast({ title: '解码失败', icon: 'none' })
        })
      }
    } else {
      console.error('解码器未初始化')
      wx.showToast({ title: '解码器初始化失败', icon: 'none' })
      wx.setKeepScreenOn({ keepScreenOn: false }) // 关闭屏幕常量
      return
    }
    
    // 尝试使用不同的音频格式和参数
    const recordOptions = {
      duration: 300000, // 5分钟，足以覆盖完整的音频
      sampleRate: 8000,  // 降低采样率以提高兼容性
      numberOfChannels: 1,
      encodeBitRate: 16000,
      format: 'pcm',  // 使用PCM格式，避免AAC编码问题
      frameSize: 1  // 关键：设置frameSize才能触发onFrameRecorded
    }
    
    try {
      this.recorderManager.start(recordOptions)
      wx.showToast({ title: '开始监听', icon: 'success' })
    } catch (err) {
      console.error('启动录音失败:', err)
      this.setData({ isDecoding: false })
      wx.setKeepScreenOn({ keepScreenOn: false }) // 关闭屏幕常量
      wx.showToast({ title: '启动录音失败', icon: 'none' })
    }
  },
  
  // 强制停止录音（用于解码完成或停止按钮）
  forceStopRecording() {
    try {
      if (this.recorderManager) {
        this.recorderManager.stop()
        console.log('录音已停止')
      }
    } catch (err) {
      console.error('停止录音失败:', err)
    }
    
    // 关闭屏幕常量
    wx.setKeepScreenOn({ keepScreenOn: false })
    
    // 停止解码器
    if (this.decoder) {
      this.decoder.isDecoding = false
    }
  },

  stopDecode() {
    console.log('停止监听被调用')
    
    // 强制停止录音
    this.forceStopRecording()
    
    // 立即更新页面状态 - 关键！否则UI不会更新
    this.setData({ isDecoding: false })
    
    // 检查是否解码成功（或者已经有实时预览）
    const hasDecodedImage = this.data.decodedImage && this.data.decodedImage.length > 0
    const wasCompleted = this.hasCompletedDecoding
    
    if (hasDecodedImage || wasCompleted) {
      wx.showToast({ title: '已停止，可以保存图片', icon: 'success' })
    } else {
      wx.showToast({ title: '已停止，未检测到有效信号', icon: 'none' })
      // 如果没有解码成功，清空结果
      this.setData({ decodedImage: '', decodeProgress: 0, scanLine: 0 })
    }
  },

  async renderDecodedImage(imageData, width, height) {
    return new Promise((resolve, reject) => {
      try {
        const query = wx.createSelectorQuery()
        query.select('#decodeCanvas')
          .fields({
            node: true,
            context: true
          })
          .exec((res) => {
            // 获取canvas节点
            const canvasRes = res[0]
            let canvas
            
            // 尝试多种方式获取canvas
            if (canvasRes && canvasRes.node) {
              canvas = canvasRes.node
            } else if (canvasRes && canvasRes.context) {
              // 如果node方式失败，尝试使用context方式
              canvas = canvasRes.context
            } else {
              reject(new Error('Canvas节点和上下文都获取失败'))
              return
            }
            
            // 如果是node方式，需要设置canvas尺寸
            if (canvas.width !== width || canvas.height !== height) {
              canvas.width = width
              canvas.height = height
            }
            
            // 获取绘图上下文
            const ctx = canvas.getContext ? canvas.getContext('2d') : canvas
            
            // 清除画布
            ctx.clearRect(0, 0, width, height)
            
            // 创建ImageData并绘制
            const imgData = ctx.createImageData(width, height)
            const imageDataArray = new Uint8ClampedArray(imageData)
            imgData.data.set(imageDataArray)
            ctx.putImageData(imgData, 0, 0)
            
            // 导出为图片
            wx.canvasToTempFilePath({
              canvas: canvas,
              x: 0,
              y: 0,
              width: width,
              height: height,
              destWidth: width,
              destHeight: height,
              fileType: 'png',
              quality: 1.0,
              success: (res) => {
                console.log('图像渲染成功:', res.tempFilePath)
                resolve(res.tempFilePath)
              },
              fail: (err) => {
                console.error('导出图片失败:', err)
                reject(err)
              }
            })
          })
      } catch (err) {
        console.error('渲染图像异常:', err)
        reject(err)
      }
    })
  },

  saveToAlbum() {
    if (!this.data.decodedImage) {
      wx.showToast({ title: '没有可保存的图片', icon: 'none' })
      return
    }

    wx.saveImageToPhotosAlbum({
      filePath: this.data.decodedImage,
      success: () => {
        wx.showToast({ title: '保存成功', icon: 'success' })
      },
      fail: () => {
        wx.showToast({ title: '保存失败', icon: 'none' })
      }
    })
    wx.vibrateShort({ type: VIBRATE_TYPE })
  },

  clearResult() {
    this.setData({ decodedImage: '', decodeProgress: 0 })
    wx.vibrateShort({ type: VIBRATE_TYPE })
  },

  // 点击呼号按钮：直接获取"我的"页面中设置的呼号
  toggleCallsignInput() {
    // 先从本地存储获取呼号
    let myCallSign = ''
    try {
      myCallSign = wx.getStorageSync('myCallSign') || ''
    } catch (e) {
      console.error('读取呼号失败', e)
    }
    
    if (!myCallSign) {
      wx.showModal({
        title: '未设置呼号',
        content: '请先在"我的"页面设置您的呼号',
        showCancel: false,
        confirmText: '知道了'
      })
      return
    }
    
    // 获取到呼号，显示/隐藏呼号
    if (this.data.showCallsign) {
      // 如果已显示，则隐藏
      this.setData({
        showCallsign: false
      })
    } else {
      // 如果未显示，则显示
      this.setData({
        callsign: myCallSign,
        showCallsign: true
      })
      wx.showToast({ title: '呼号已添加', icon: 'success' })
    }
  },

  // 呼号拖动 - 触摸开始
  onCallsignTouchStart(e) {
    const touch = e.touches[0]
    // 使用 pageX/pageY（相对于页面的坐标）
    this.setData({
      callsignTouchStartX: touch.pageX,
      callsignTouchStartY: touch.pageY
    })
  },

  // 呼号拖动 - 触摸移动
  onCallsignTouchMove(e) {
    const touch = e.touches[0]
    const deltaX = touch.pageX - this.data.callsignTouchStartX
    const deltaY = touch.pageY - this.data.callsignTouchStartY
    
    let newX = this.data.callsignX + deltaX
    let newY = this.data.callsignY + deltaY
    
    // 限制边界 (图片320x240，呼号文字大约120px宽，30px高)
    const callsignWidth = 120  // 估算呼号宽度
    const callsignHeight = 30  // 估算呼号高度
    newX = Math.max(0, Math.min(320 - callsignWidth, newX))
    newY = Math.max(0, Math.min(240 - callsignHeight, newY))
    
    this.setData({
      callsignX: newX,
      callsignY: newY,
      callsignTouchStartX: touch.pageX,
      callsignTouchStartY: touch.pageY
    })
  },

  // 移除已选择的图片
  removeImage() {
    this.setData({
      uploadImage: '',
      imageWidth: 0,
      imageHeight: 0,
      audioFilePath: '',
      isPlaying: false,
      audioDuration: 0,
      audioCurrentTime: 0,
      audioProgress: 0,
      audioDurationStr: '0:00',
      audioCurrentTimeStr: '0:00',
      audioFileSize: '',
      audioFormat: 'WAV',
      // 同时清除呼号显示
      callsign: '',
      showCallsign: false
    })
    
    // 停止音频播放
    if (this.audioContext) {
      this.audioContext.stop()
      this.audioContext.destroy()
      this.audioContext = null
    }
    
    wx.showToast({ title: '已移除图片', icon: 'none' })
  },

  // 切换音频播放/暂停
  togglePlayAudio() {
    if (this.data.isPlaying) {
      // 停止播放
      if (this.audioContext) {
        this.audioContext.stop()
        this.audioContext.destroy()
        this.audioContext = null
      }
      this.setData({ 
        isPlaying: false,
        audioCurrentTime: 0,
        audioCurrentTimeStr: '0:00',
        audioProgress: 0
      })
    } else {
      // 开始播放 - 每次都创建新的音频上下文
      const audioContext = wx.createInnerAudioContext()
      
      // 先设置 src
      audioContext.src = this.data.audioFilePath
      
      // 设置事件监听
      audioContext.onCanplay(() => {
        console.log('音频可以播放')
        audioContext.play()
      })
      
      audioContext.onPlay(() => {
        // 优先使用预先计算的时长，而不是依赖 audioContext.duration
        let duration = this.data.audioDuration
        if (!duration || duration <= 0) {
          duration = Math.round(audioContext.duration) || 0
        }
        console.log('[SSTV] 播放开始，音频时长:', duration, '秒')
        if (duration > 0) {
          this.setData({ 
            isPlaying: true,
            audioDuration: duration,
            audioDurationStr: this.formatTime(duration)
          })
        } else {
          this.setData({ 
            isPlaying: true
          })
        }
      })
      
      audioContext.onTimeUpdate(() => {
        const currentTime = Math.round(audioContext.currentTime)
        const duration = this.data.audioDuration || Math.round(audioContext.duration || 0)
        const progress = duration > 0 ? (currentTime / duration * 100) : 0
        this.setData({ 
          audioCurrentTime: currentTime,
          audioCurrentTimeStr: this.formatTime(currentTime),
          audioProgress: progress
        })
      })
      
      audioContext.onEnded(() => {
        if (this.audioContext) {
          this.audioContext.destroy()
          this.audioContext = null
        }
        this.setData({ 
          isPlaying: false,
          audioCurrentTime: 0,
          audioCurrentTimeStr: '0:00',
          audioProgress: 0
        })
      })
      
      audioContext.onError((err) => {
        console.error('[SSTV] 音频播放错误:', err)
        // 打印更多信息
        if (this.audioContext) {
          console.error('[SSTV] 音频当前时间:', this.audioContext.currentTime)
          console.error('[SSTV] 音频总时长:', this.audioContext.duration)
          this.audioContext.destroy()
          this.audioContext = null
        }
        this.setData({ isPlaying: false })
        wx.showToast({ title: '播放失败', icon: 'none' })
      })
      
      // 添加 onStop 监听，查看是否触发了停止事件
      audioContext.onStop(() => {
        console.log('[SSTV] 音频播放停止事件触发')
        console.log('[SSTV] 停止时当前时间:', audioContext.currentTime)
        console.log('[SSTV] 停止时总时长:', audioContext.duration)
      })
      
      // 尝试立即播放（如果已经可以播放）
      setTimeout(() => {
        if (audioContext && this.audioContext === audioContext) {
          audioContext.play()
        }
      }, 100)
      
      this.audioContext = audioContext
      this.setData({ isPlaying: true })
    }
  },

  // 格式化时间（秒 -> MM:SS）
  formatTime(seconds) {
    if (!seconds || isNaN(seconds)) return '0:00'
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    const secsStr = secs < 10 ? '0' + secs : '' + secs
    return mins + ':' + secsStr
  },

  // 下载/保存音频文件
  downloadAudio() {
    const filePath = this.data.audioFilePath
    if (!filePath) {
      wx.showToast({ title: '音频文件不存在', icon: 'none' })
      return
    }

    wx.showLoading({ title: '正在保存...' })

    // 使用 wx.shareFileMessage 分享/保存文件
    wx.shareFileMessage({
      filePath: filePath,
      fileName: 'sstv_robot36.wav',
      success: () => {
        wx.hideLoading()
        wx.showToast({ title: '保存成功', icon: 'success' })
      },
      fail: (err) => {
        wx.hideLoading()
        console.error('保存音频失败:', err)
        
        // 如果分享失败，尝试使用 saveFileToDisk (部分设备支持)
        if (err.errMsg && err.errMsg.includes('cancel')) {
          // 用户取消，不提示
          return
        }
        
        // 尝试复制到剪贴板或提示用户
        wx.showModal({
          title: '保存提示',
          content: '无法自动保存，文件路径已复制到剪贴板，可手动保存',
          showCancel: false,
          success: () => {
            // 复制文件路径到剪贴板
            wx.setClipboardData({
              data: filePath,
              success: () => {
                wx.showToast({ title: '路径已复制', icon: 'success' })
              }
            })
          }
        })
      }
    })
  }
})