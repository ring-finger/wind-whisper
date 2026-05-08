const VIBRATE_TYPE = 'medium'

class SSTVEncoder {
  constructor() {
    this.sampleRate = 44100
    this.freqMin = 300
    this.freqMax = 2300
    this.hSyncFreq = 1200
    this.vSyncFreq = 900
    this.scanLineTime = 30
  }

  rgbToFrequency(r, g, b) {
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
    return this.freqMin + luminance * (this.freqMax - this.freqMin)
  }

  generateTone(freq, durationMs) {
    const samples = Math.floor((durationMs / 1000) * this.sampleRate)
    const result = new Float32Array(samples)
    const omega = 2 * Math.PI * freq / this.sampleRate
    
    for (let i = 0; i < samples; i++) {
      result[i] = Math.sin(omega * i) * 0.5
    }
    return result
  }

  async imageToAudio(imageData, width, height) {
    const audioData = []
    
    audioData.push(...this.generateTone(this.vSyncFreq, 100))
    
    for (let y = 0; y < height; y++) {
      audioData.push(...this.generateTone(this.hSyncFreq, 10))
      
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4
        const r = imageData[idx]
        const g = imageData[idx + 1]
        const b = imageData[idx + 2]
        const freq = this.rgbToFrequency(r, g, b)
        audioData.push(...this.generateTone(freq, this.scanLineTime / width))
      }
      
      audioData.push(...this.generateTone(this.hSyncFreq, 5))
    }
    
    audioData.push(...this.generateTone(this.vSyncFreq, 100))
    
    const floatArray = new Float32Array(audioData.length)
    for (let i = 0; i < audioData.length; i++) {
      floatArray[i] = audioData[i]
    }
    
    return floatArray
  }

  floatTo16BitPCM(output, offset, input) {
    for (let i = 0; i < input.length; i++, offset += 2) {
      const s = Math.max(-1, Math.min(1, input[i]))
      output.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true)
    }
  }

  encodeWav(samples) {
    const buffer = new ArrayBuffer(44 + samples.length * 2)
    const view = new DataView(buffer)
    
    const writeString = (offset, string) => {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i))
      }
    }
    
    writeString(0, 'RIFF')
    view.setUint32(4, 32 + samples.length * 2, true)
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
    view.setUint32(40, samples.length * 2, true)
    
    this.floatTo16BitPCM(view, 44, samples)
    
    return buffer
  }
}

class SSTVDecoder {
  constructor() {
    this.sampleRate = 44100
    this.freqMin = 300
    this.freqMax = 2300
    this.hSyncFreq = 1200
    this.vSyncFreq = 900
    this.imageWidth = 320
    this.imageHeight = 240
    this.reset()
  }

  reset() {
    this.currentLine = 0
    this.currentPixel = 0
    this.imageData = new Uint8ClampedArray(this.imageWidth * this.imageHeight * 4)
    this.audioBuffer = []
    this.isDecoding = false
    this.onProgress = null
    this.onComplete = null
  }

  processAudioFrame(frameBuffer) {
    if (!this.isDecoding) return
    
    this.audioBuffer.push(...frameBuffer)
    
    // 每累积足够的数据处理一次
    if (this.audioBuffer.length >= 4410) { // 100ms 的数据
      this.processAudioData()
    }
  }

  processAudioData() {
    if (!this.isDecoding || this.audioBuffer.length < 512) return
    
    const samples = this.audioBuffer.splice(0, 4410)
    const segment = samples.slice(0, 512)
    const freq = this.fftFrequency(segment)
    
    // 检测同步信号
    if (freq >= 850 && freq <= 950) {
      // 垂直同步信号，新图像开始
      this.currentLine = 0
      this.currentPixel = 0
      return
    }
    
    if (freq >= 1100 && freq <= 1300) {
      // 水平同步信号，新行开始
      this.currentLine++
      this.currentPixel = 0
      return
    }
    
    // 处理像素数据
    if (this.currentLine > 0 && this.currentLine <= this.imageHeight && this.currentPixel < this.imageWidth) {
      const luminance = this.frequencyToLuminance(freq)
      const val = Math.floor(luminance * 255)
      const idx = (this.currentLine * this.imageWidth + this.currentPixel) * 4
      
      this.imageData[idx] = val     // R
      this.imageData[idx + 1] = val // G
      this.imageData[idx + 2] = val // B
      this.imageData[idx + 3] = 255 // A
      
      this.currentPixel++
      
      // 更新进度
      if (this.onProgress) {
        const progress = Math.floor((this.currentLine / this.imageHeight) * 100)
        this.onProgress(progress, this.currentLine)
      }
      
      // 检查是否完成
      if (this.currentLine === this.imageHeight && this.currentPixel === this.imageWidth) {
        this.isDecoding = false
        if (this.onComplete) {
          this.onComplete(this.imageData, this.imageWidth, this.imageHeight)
        }
      }
    }
  }

  frequencyToLuminance(freq) {
    return Math.min(1, Math.max(0, (freq - this.freqMin) / (this.freqMax - this.freqMin)))
  }

  // 改进的频率检测算法 - 使用 Goertzel 算法
  fftFrequency(buffer) {
    const N = buffer.length
    
    // 计算 RMS 能量
    let rmsEnergy = 0
    for (let i = 0; i < N; i++) {
      rmsEnergy += buffer[i] * buffer[i]
    }
    rmsEnergy = Math.sqrt(rmsEnergy / N)
    
    // 信号太弱，返回中间频率
    if (rmsEnergy < 0.01) {
      return (this.freqMin + this.freqMax) / 2
    }
    
    // 使用 Goertzel 算法检测关键频率
    const targetFreqs = [
      { freq: this.vSyncFreq, name: 'VSYNC' },
      { freq: this.hSyncFreq, name: 'HSYNC' },
      { freq: 1500, name: 'BLACK' },
      { freq: 1900, name: 'GRAY' },
      { freq: 2300, name: 'WHITE' }
    ]
    
    let bestFreq = (this.freqMin + this.freqMax) / 2
    let bestScore = 0
    
    for (const target of targetFreqs) {
      const score = this.goertzel(buffer, target.freq, this.sampleRate)
      if (score > bestScore) {
        bestScore = score
        bestFreq = target.freq
      }
    }
    
    // 如果最佳分数不够，进行 FFT 分析
    if (bestScore < 0.1) {
      return this.fftAnalyze(buffer)
    }
    
    return bestFreq
  }

  // Goertzel 算法 - 快速检测单一频率
  goertzel(buffer, targetFreq, sampleRate) {
    const N = buffer.length
    const k = Math.round(0.5 + (N * targetFreq) / sampleRate)
    const w = (2 * Math.PI * k) / N
    const coeff = 2 * Math.cos(w)
    
    let s0 = 0, s1 = 0
    
    for (let i = 0; i < N; i++) {
      const s = buffer[i] + coeff * s1 - s0
      s0 = s1
      s1 = s
    }
    
    const power = s1 * s1 + s0 * s0 - coeff * s1 * s0
    return Math.sqrt(power) / N
  }

  // 简化的 FFT 频率分析
  fftAnalyze(buffer) {
    const N = buffer.length
    const minBin = Math.floor((this.freqMin * N) / this.sampleRate)
    const maxBin = Math.ceil((this.freqMax * N) / this.sampleRate)
    
    let maxMag = 0
    let maxIdx = minBin
    
    // 使用加窗的 FFT
    for (let k = minBin; k < maxBin && k < Math.floor(N / 2); k++) {
      let real = 0
      let imag = 0
      
      // 汉宁窗
      for (let n = 0; n < Math.min(256, N); n++) {
        const idx = (k - 128 + n + N) % N
        const window = 0.5 * (1 - Math.cos((2 * Math.PI * n) / 255))
        const angle = -2 * Math.PI * k * n / 256
        real += buffer[idx] * window * Math.cos(angle)
        imag += buffer[idx] * window * Math.sin(angle)
      }
      
      const mag = Math.sqrt(real * real + imag * imag)
      if (mag > maxMag) {
        maxMag = mag
        maxIdx = k
      }
    }
    
    return maxIdx * this.sampleRate / N
  }

  async audioToImage(audioBuffer) {
    const samples = audioBuffer.getChannelData(0)
    const pixels = []
    const samplesPerPixel = Math.floor(this.sampleRate * 0.0001)
    const samplesPerLine = this.imageWidth * samplesPerPixel
    
    let lineCount = 0
    let inLine = false
    let pixelCount = 0
    
    for (let i = 0; i < samples.length - 1024; i += samplesPerPixel) {
      const segment = samples.slice(i, i + 512)
      const freq = this.fftFrequency(segment)
      
      if (freq < this.vSyncFreq + 150 && freq > this.vSyncFreq - 150) {
        inLine = false
        lineCount = 0
        pixelCount = 0
        continue
      }
      
      if (freq < this.hSyncFreq + 150 && freq > this.hSyncFreq - 150) {
        if (!inLine) {
          inLine = true
          lineCount++
          pixelCount = 0
        }
        continue
      }
      
      if (inLine && lineCount <= this.imageHeight && pixelCount < this.imageWidth) {
        const luminance = this.frequencyToLuminance(freq)
        const val = Math.floor(luminance * 255)
        pixels.push(val, val, val, 255)
        pixelCount++
      }
    }
    
    while (pixels.length < this.imageWidth * this.imageHeight * 4) {
      pixels.push(0, 0, 0, 255)
    }
    
    return new Uint8ClampedArray(pixels)
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
    decodedImage: '',
    decodeProgress: 0,
    scanLine: 0,
    waveformData: [],
    sstvEncoder: null,
    sstvDecoder: null,
    recorderManager: null,
    audioContext: null,
    currentTheme: 'radio'
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

  onUnload() {
    if (this.data.audioContext) {
      this.data.audioContext.close()
    }
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
    this.waveformFrameCount = 0
    this.waveformBuffer = []
    recorderManager.onFrameRecorded((res) => {
      const { frameBuffer } = res
      if (this.data.isDecoding && this.decoder) {
        this.decoder.processAudioFrame(frameBuffer)
        // 收集音频帧用于波形显示
        this.waveformBuffer.push(...frameBuffer)
        this.waveformFrameCount++
        // 每 5 帧更新一次波形（约每 100ms）
        if (this.waveformFrameCount >= 5) {
          this.waveformFrameCount = 0
          this.updateWaveform()
        }
      }
    })
    this.recorderManager = recorderManager
  },

  updateWaveform() {
    if (this.waveformBuffer.length < 32) return
    const waveform = []
    const step = Math.floor(this.waveformBuffer.length / 32)
    for (let i = 0; i < 32; i++) {
      const startIdx = i * step
      const endIdx = Math.min(startIdx + step, this.waveformBuffer.length)
      // 计算 RMS 能量
      let sum = 0
      let count = 0
      for (let j = startIdx; j < endIdx; j++) {
        sum += Math.abs(this.waveformBuffer[j])
        count++
      }
      const avg = sum / count
      // 归一化到 20-80 范围
      const value = Math.min(80, Math.max(20, avg * 100))
      waveform.push(value)
    }
    this.setData({ waveformData: waveform })
    // 保留最新部分数据，避免内存增长
    const keepLength = 4410 // 保留约 100ms 数据
    if (this.waveformBuffer.length > keepLength) {
      this.waveformBuffer = this.waveformBuffer.slice(-keepLength)
    }
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
            this.resizeImage(tempFilePath, info.width, info.height)
          }
        })
      }
    })
    wx.vibrateShort({ type: VIBRATE_TYPE })
  },

  resizeImage(path, width, height) {
    const targetWidth = 320
    const targetHeight = 240
    const query = wx.createSelectorQuery()
    query.select('#resizeCanvas')
      .node((res) => {
        const canvas = res.node
        canvas.width = targetWidth
        canvas.height = targetHeight
        const ctx = canvas.getContext('2d')
        ctx.drawImage(path, 0, 0, targetWidth, targetHeight)
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

    try {
      const query = wx.createSelectorQuery()
      query.select('#encodeCanvas')
        .node((res) => {
          const canvas = res.node
          canvas.width = 320
          canvas.height = 240
          const ctx = canvas.getContext('2d')
          ctx.drawImage(this.data.uploadImage, 0, 0, 320, 240)
          
          // 使用 ImageData API 获取像素数据
          const imageData = ctx.getImageData(0, 0, 320, 240)
          const encoder = this.encoder
          if (!encoder) {
            wx.hideLoading()
            this.setData({ isEncoding: false })
            wx.showToast({ title: '编码器初始化失败', icon: 'none' })
            return
          }
          encoder.imageToAudio(imageData.data, 320, 240).then((samples) => {
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
                this.setData({ audioFilePath: filePath })
                wx.hideLoading()
                wx.showToast({ title: '生成成功', icon: 'success' })
              },
              fail: (err) => {
                wx.hideLoading()
                wx.showToast({ title: '保存失败', icon: 'none' })
                console.error(err)
              }
            })
          }).catch((err) => {
            wx.hideLoading()
            wx.showToast({ title: '编码失败', icon: 'none' })
            console.error(err)
          })
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
    wx.authorize({ scope: 'scope.record' })
    this.waveformBuffer = [] // 重置波形缓冲区
    this.waveformFrameCount = 0
    this.setData({ isDecoding: true, decodedImage: '', decodeProgress: 0, scanLine: 0, waveformData: [] })
    const decoder = this.decoder
    if (decoder) {
      decoder.reset()
      decoder.onProgress = (progress, scanLine) => {
        this.setData({ decodeProgress: progress, scanLine })
      }
      decoder.onComplete = (imageData, width, height) => {
        this.renderDecodedImage(imageData, width, height).then((filePath) => {
          this.setData({ decodedImage: filePath })
        })
      }
    }
    this.recorderManager.start({
      duration: 60000,
      sampleRate: 44100,
      numberOfChannels: 1,
      encodeBitRate: 64000,
      format: 'raw'
    })
    wx.showToast({ title: '开始监听', icon: 'success' })
  },

  stopDecode() {
    this.recorderManager.stop()
    this.setData({ isDecoding: false, waveformData: [] })
    wx.showToast({ title: '已停止', icon: 'success' })
  },

  async renderDecodedImage(imageData, width, height) {
    return new Promise((resolve, reject) => {
      const query = wx.createSelectorQuery()
      query.select('#decodeCanvas')
        .node((res) => {
          const canvas = res.node
          canvas.width = width
          canvas.height = height
          const ctx = canvas.getContext('2d')
          const imageDataArray = new Uint8ClampedArray(imageData)
          
          // 使用 ImageData 对象直接绘制
          const imgData = ctx.createImageData(width, height)
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
            success: (res) => resolve(res.tempFilePath),
            fail: reject
          })
        })
      query.exec()
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
  }
})