const VIBRATE_TYPE = 'medium'

class SSTVEncoder {
  constructor() {
    // 基于Web-SSTV标准的参数
    this.sampleRate = 44100
    this.freqMin = 1500      // 颜色频率最小值（匹配解码器）
    this.freqMax = 2300      // 颜色频率最大值
    this.hSyncFreq = 1200    // 水平同步频率
    this.vSyncFreq = 1900    // 垂直同步频率（修正为正确值）
    this.blankFreq = 1500    // 消隐频率
    this.scanLineTime = 30  // 扫描线时间
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
    // Robot36 格式参数 (标准 SSTV 规范)
    this.sampleRate = 8000
    this.SYNC_FREQ = 1200      // 同步脉冲频率
    this.BLANK_FREQ = 1500     // 消隐脉冲频率
    this.COLOR_MIN = 1500      // 颜色频率最小值
    this.COLOR_MAX = 2300      // 颜色频率最大值
    
    // Robot36 每行时序 (单位: 毫秒)
    this.H_SYNC_TIME = 4.35    // 水平同步脉冲时长
    this.H_BLANK_TIME = 0.45   // 水平消隐时长
    this.GREEN_TIME = 87.2     // 绿色通道时长 (320 像素)
    this.RB_TIME = 43.6        // 红/蓝通道时长 (各 160 像素)
    this.LINE_TIME = 135.6     // 一行总时长
    
    // Robot36 图像参数
    this.imageWidth = 320
    this.imageHeight = 240
    this.currentFormat = 'Robot36'
    
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
    
    // 解码状态机
    this.state = 'SEARCHING'  // SEARCHING, SYNC, IMAGE
    this.lineStartSample = 0   // 当前行开始的样本位置
    this.sampleCount = 0        // 总样本计数
    this.totalSamples = 0       // 总样本数
    
    // 行内像素采样
    this.currentChannel = 'GREEN'  // GREEN, RED, BLUE
    this.channelPixelIndex = 0     // 当前通道内的像素索引
    this.greenPixels = []          // 绿色通道像素
    this.redPixels = []            // 红色通道像素
    this.bluePixels = []           // 蓝色通道像素
    
    // 同步检测
    this.consecutiveSync = 0
    this.lastFreq = 0
    
    // 音频结束检测
    this.lastAudioTime = 0
    this.silenceCount = 0
  }

  // 处理音频帧
  processAudioFrame(frameBuffer) {
    if (!this.isDecoding) return
    if (!frameBuffer || frameBuffer.length === 0) return
    
    this.lastAudioTime = Date.now()
    this.audioBuffer.push(...frameBuffer)
    this.totalSamples += frameBuffer.length
    
    // 持续处理音频数据
    while (this.audioBuffer.length >= 32) {
      this.processAudioData()
    }
  }

  // 处理音频数据 - 基于时间的像素采样
  processAudioData() {
    if (!this.isDecoding) return
    if (this.audioBuffer.length < 32) return
    
    // 使用较小的窗口进行频率检测
    const windowSize = 32  // 4ms at 8kHz
    const samples = this.audioBuffer.splice(0, windowSize)
    this.sampleCount += windowSize
    
    // 检测当前频率
    const freq = this.detectFrequency(samples)
    const isSync = Math.abs(freq - this.SYNC_FREQ) < 100
    
    // 状态机处理
    switch (this.state) {
      case 'SEARCHING':
        if (isSync) {
          this.consecutiveSync++
          if (this.consecutiveSync >= 5) {
            console.log('检测到垂直同步信号，开始解码')
            this.state = 'SYNC'
            this.lineStartSample = this.sampleCount
            this.currentLine = 0
            this.consecutiveSync = 0
          }
        } else {
          this.consecutiveSync = Math.max(0, this.consecutiveSync - 1)
        }
        break
        
      case 'SYNC':
        // 等待水平同步结束，开始新行
        if (!isSync) {
          // 计算距离上次同步的时间
          const samplesSinceSync = this.sampleCount - this.lineStartSample
          const timeSinceSync = (samplesSinceSync / this.sampleRate) * 1000
          
          if (timeSinceSync > 5) {  // 同步脉冲结束
            console.log('开始解码第', this.currentLine + 1, '行')
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
        // 基于时间的像素采样
        const samplesInLine = this.sampleCount - this.lineStartSample
        const timeInLine = (samplesInLine / this.sampleRate) * 1000
        
        // 检测同步脉冲 (新行开始)
        if (isSync) {
          if (this.consecutiveSync === 0) {
            // 保存当前行的像素数据
            this.saveCurrentLine()
            
            this.currentLine++
            this.consecutiveSync = 1
            
            if (this.currentLine >= this.imageHeight) {
              console.log('图像解码完成，共', this.currentLine, '行')
              this.isDecoding = false
              if (this.onComplete) {
                this.onComplete(this.imageData, this.imageWidth, this.imageHeight)
              }
              this.state = 'SEARCHING'
              return
            }
            
            // 通知进度
            if (this.onProgress) {
              const progress = Math.floor((this.currentLine / this.imageHeight) * 100)
              this.onProgress(progress, this.currentLine)
            }
            
            // 重置通道
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
        
        // 采样像素数据
        this.samplePixel(freq, timeInLine)
        break
    }
    
    this.lastFreq = freq
    
    // 检测音频结束
    if (this.audioBuffer.length === 0) {
      this.silenceCount++
      if (this.silenceCount > 100 && this.currentLine > 10) {
        console.log('音频结束，停止解码')
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

  // 基于时间采样像素
  samplePixel(freq, timeInLine) {
    // 计算当前在哪个通道
    let channelStart, channelEnd
    
    if (this.currentChannel === 'GREEN') {
      channelStart = this.H_SYNC_TIME + this.H_BLANK_TIME
      channelEnd = channelStart + this.GREEN_TIME
      if (timeInLine >= channelEnd) {
        this.currentChannel = 'RED'
        this.channelPixelIndex = 0
        return
      }
    } else if (this.currentChannel === 'RED') {
      channelStart = this.H_SYNC_TIME + this.H_BLANK_TIME + this.GREEN_TIME
      channelEnd = channelStart + this.RB_TIME
      if (timeInLine >= channelEnd) {
        this.currentChannel = 'BLUE'
        this.channelPixelIndex = 0
        return
      }
    } else {
      channelStart = this.H_SYNC_TIME + this.H_BLANK_TIME + this.GREEN_TIME + this.RB_TIME
      channelEnd = channelStart + this.RB_TIME
    }
    
    if (timeInLine < channelStart) return
    
    // 计算当前像素索引
    const channelTime = timeInLine - channelStart
    let pixelsPerChannel
    if (this.currentChannel === 'GREEN') {
      pixelsPerChannel = this.imageWidth  // 320
    } else {
      pixelsPerChannel = this.imageWidth / 2  // 160
    }
    
    const pixelTime = this.channelPixelIndex > 0 
      ? (channelTime / pixelsPerChannel) 
      : 0
    const pixelIndex = Math.floor(pixelTime)
    
    if (pixelIndex > this.channelPixelIndex) {
      // 采样新像素
      const gray = this.frequencyToGray(freq)
      
      if (this.currentChannel === 'GREEN') {
        this.greenPixels.push(gray)
      } else if (this.currentChannel === 'RED') {
        this.redPixels.push(gray)
      } else {
        this.bluePixels.push(gray)
      }
      
      this.channelPixelIndex = pixelIndex
    }
  }

  // 保存当前行到图像数据
  saveCurrentLine() {
    if (this.currentLine >= this.imageHeight) return
    if (this.greenPixels.length === 0) return
    
    const lineIndex = this.currentLine
    const width = this.imageWidth
    
    for (let x = 0; x < width; x++) {
      const idx = (lineIndex * width + x) * 4
      
      // 获取绿色值
      const greenIdx = Math.floor(x * this.greenPixels.length / width)
      const g = this.greenPixels[Math.min(greenIdx, this.greenPixels.length - 1)] || 0
      
      // 获取红色值 (红色通道映射到左半边)
      let r = g
      if (this.redPixels.length > 0 && x < width / 2) {
        const redIdx = Math.floor((x * 2) * this.redPixels.length / width)
        r = this.redPixels[Math.min(redIdx, this.redPixels.length - 1)]
      }
      
      // 获取蓝色值 (蓝色通道映射到右半边)
      let b = g
      if (this.bluePixels.length > 0 && x >= width / 2) {
        const blueIdx = Math.floor(((x - width / 2) * 2) * this.bluePixels.length / width)
        b = this.bluePixels[Math.min(blueIdx, this.bluePixels.length - 1)]
      }
      
      this.imageData[idx] = r
      this.imageData[idx + 1] = g
      this.imageData[idx + 2] = b
      this.imageData[idx + 3] = 255
    }
  }

  // 使用 Goertzel 算法检测频率
  detectFrequency(samples) {
    const N = samples.length
    let maxEnergy = 0
    let bestFreq = 1900
    
    // 扫描 1200-2300Hz 范围内的频率
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
    // 将频率映射到灰度值 0-255
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
    decodedImage: '',
    decodeProgress: 0,
    scanLine: 0,
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

  onHide() {
    // 页面隐藏时停止录音，防止页面卡死
    if (this.data.isDecoding) {
      this.forceStopRecording()
      this.setData({ isDecoding: false })
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
    if (this.data.audioContext) {
      this.data.audioContext.close()
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
  }
})