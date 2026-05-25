/**
 * SSTV 解码器
 * 独立文件，与编码器分离
 */
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

    // 限制每次处理的样本数，避免阻塞UI线程
    let processed = 0
    while (this.audioBuffer.length >= 32 && processed < 10) {
      this.processAudioData()
      processed++
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
            this.currentChannel = 'Y'
            this.channelPixelIndex = -1
            this.yPixels = []
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

            this.currentChannel = 'Y'
            this.channelPixelIndex = -1
            this.yPixels = []
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

    if (pixelIndex >= this.channelPixelIndex && pixelIndex < pixelsPerChannel) {
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
          const yIdx = Math.min(x, this.yPixels.length - 1)
          const y = this.yPixels[yIdx] || 0
          this.imageData[idx] = y      // R 暂时用 Y
          this.imageData[idx + 1] = y  // G = Y
          this.imageData[idx + 2] = y  // B 暂时用 Y
          this.imageData[idx + 3] = 255
        }
      }
    } else {
      // 奇数行: 有 Y 和 R，与前一行的 Y 和 B 合并
      if (!this.prevLinePixels || this.yPixels.length === 0) return

      const prevB = this.prevLinePixels.b
      const currY = this.yPixels
      const currR = this.redPixels

      for (let x = 0; x < width; x++) {
        const idx = (lineIndex * width + x) * 4

        // Y: 320个音频采样对应320个像素，直接映射
        const yIdx = Math.min(x, currY.length - 1)
        const y = currY[yIdx] || 0

        // R: 从当前行获取（子采样，每2个x像素对应1个R值）
        let r = y
        if (currR.length > 0) {
          const rIdx = Math.min(Math.floor(x / 2), currR.length - 1)
          r = currR[rIdx] || y
        }

        // B: 从前一行获取（子采样，每2个x像素对应1个B值）
        let b = y
        if (prevB.length > 0) {
          const bIdx = Math.min(Math.floor(x / 2), prevB.length - 1)
          b = prevB[bIdx] || y
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

module.exports = SSTVDecoder
