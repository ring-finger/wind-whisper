const VIBRATE_TYPE = 'medium'
const Robot36 = require('./sstv-robot36')
const Scottie1 = require('./sstv-scottie1')
const SSTVFFTDecoder = require('./sstv-fft-decoder')

/**
 * SSTV 模式工厂方法
 * @param {string} modeName - 模式名称
 * @param {number} sampleRate - 采样率
 */
function createMode(modeName, sampleRate) {
  switch (modeName) {
    case 'Robot36':
      return new Robot36(sampleRate || 48000)
    case 'Scottie1':
      return new Scottie1(sampleRate || 48000)
    default:
      console.warn('[SSTV] 未知模式:', modeName, '，使用默认模式 Robot36')
      return new Robot36(sampleRate || 48000)
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
    audioContext: null,
    // 呼号相关
    callsign: '',
    showCallsign: false,
    showCallsignInput: false,
    callsignX: 20,
    callsignY: 200,
    callsignTouchStartX: 0,
    callsignTouchStartY: 0
  },

  onLoad() {
    wx.setNavigationBarTitle({ title: 'SSTV图像传输' })
    wx.setNavigationBarColor({
      frontColor: '#000000',
      backgroundColor: '#F9F7F4',
      animation: { duration: 0, timingFunc: 'linear' }
    })
    this.initSSTV()
  },

  onShow() {
  },

  onHide() {
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
    
    console.log('页面隐藏')
  },

  onUnload() {
    if (this.updateTimer) {
      clearTimeout(this.updateTimer)
    }
    if (this.audioContext) {
      this.audioContext.stop()
      this.audioContext.destroy()
      this.audioContext = null
    }
    
    console.log('页面卸载，资源已清理')
  },

  initSSTV() {
    this.encoder = createMode('Robot36')
  },

  /**
   * 解析 WAV 文件头
   * @param {ArrayBuffer} arrayBuffer
   * @returns {{ sampleRate: number, samples: Float32Array, bitDepth: number, channels: number }}
   */
  /**
   * 将 ArrayBuffer 中的 ASCII 字节转为字符串（兼容真机无 TextDecoder）
   */
  _bytesToStr(arrayBuffer, offset, length) {
    let str = ''
    const u8 = new Uint8Array(arrayBuffer, offset, length)
    for (let i = 0; i < u8.length; i++) {
      str += String.fromCharCode(u8[i])
    }
    return str
  },

  parseWavHeader(arrayBuffer) {
    const view = new DataView(arrayBuffer)

    // RIFF header
    const riff = this._bytesToStr(arrayBuffer, 0, 4)
    if (riff !== 'RIFF') throw new Error('不是有效的 WAV 文件: 缺少 RIFF 标识')

    const fileSize = view.getUint32(4, true)
    const wave = this._bytesToStr(arrayBuffer, 8, 4)
    if (wave !== 'WAVE') throw new Error('不是有效的 WAV 文件: 缺少 WAVE 标识')

    let offset = 12
    let sampleRate = 0
    let channels = 1
    let bitDepth = 16
    let dataOffset = -1
    let dataSize = 0

    while (offset < arrayBuffer.byteLength - 8) {
      const chunkId = this._bytesToStr(arrayBuffer, offset, 4)
      const chunkSize = view.getUint32(offset + 4, true)

      if (chunkId === 'fmt ') {
        const audioFormat = view.getUint16(offset + 8, true)
        if (audioFormat !== 1) throw new Error('只支持 PCM 格式 WAV, 当前格式码: ' + audioFormat)
        channels = view.getUint16(offset + 10, true)
        sampleRate = view.getUint32(offset + 12, true)
        bitDepth = view.getUint16(offset + 22, true)
        if (bitDepth !== 8 && bitDepth !== 16) throw new Error('只支持 8/16-bit WAV, 当前: ' + bitDepth)
      } else if (chunkId === 'data') {
        dataOffset = offset + 8
        dataSize = chunkSize
        break
      }

      offset += 8 + chunkSize
      if (chunkSize % 2 !== 0) offset++
    }

    if (dataOffset < 0) throw new Error('WAV 文件缺少 data chunk')

    const bytesPerSample = bitDepth / 8
    const totalSamples = Math.floor(dataSize / bytesPerSample)
    const samples = new Float32Array(totalSamples)

    if (bitDepth === 16) {
      for (let i = 0; i < totalSamples; i++) {
        const bytePos = dataOffset + i * 2
        if (bytePos + 1 >= arrayBuffer.byteLength) break
        samples[i] = view.getInt16(bytePos, true) / 32768.0
      }
    } else { // 8-bit
      for (let i = 0; i < totalSamples; i++) {
        const bytePos = dataOffset + i
        if (bytePos >= arrayBuffer.byteLength) break
        samples[i] = (view.getUint8(bytePos) - 128) / 128.0
      }
    }

    console.log('[WAV-Parser] 采样率=' + sampleRate + ' 通道=' + channels +
      ' 位深=' + bitDepth + ' 样本数=' + totalSamples +
      ' 时长=' + (totalSamples / sampleRate).toFixed(1) + 's')

    if (channels > 1) {
      const monoSamples = new Float32Array(Math.floor(totalSamples / channels))
      for (let i = 0; i < monoSamples.length; i++) {
        monoSamples[i] = samples[i * channels]
      }
      return { sampleRate, samples: monoSamples, bitDepth, channels }
    }

    return { sampleRate, samples: samples, bitDepth, channels }
  },

  /**
   * 从聊天记录选择 SSTV 音频文件进行解码
   */
  chooseAudioForDecode() {
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      extension: ['wav'],
      success: (res) => {
        const filePath = res.tempFiles[0].path
        console.log('[SSTV] 选择了音频文件:', filePath, '大小:', res.tempFiles[0].size)
        this.decodeAudioFile(filePath)
      },
      fail: (err) => {
        if (err.errMsg && err.errMsg.indexOf('cancel') < 0) {
          console.error('[SSTV] 选择文件失败:', err)
          wx.showToast({ title: '选择文件失败', icon: 'none' })
        }
      }
    })
    wx.vibrateShort({ type: VIBRATE_TYPE })
  },

  /**
   * 解码音频文件（核心流程）
   * @param {string} filePath - WAV 文件路径
   */
  decodeAudioFile(filePath) {
    this.setData({
      isDecoding: true,
      decodedImage: '',
      decodeProgress: 0,
      scanLine: 0
    })

    wx.showLoading({ title: '读取音频文件...' })

    const fs = wx.getFileSystemManager()
    fs.readFile({
      filePath: filePath,
      success: (res) => {
        wx.hideLoading()

        try {
          const { sampleRate, samples } = this.parseWavHeader(res.data)

          wx.showLoading({ title: '正在解码 SSTV...' })

          setTimeout(() => {
            try {
              const decoder = new SSTVFFTDecoder(samples, sampleRate, {
                fftSize: 512,
                onProgress: (percent) => {
                  this.setData({
                    decodeProgress: percent,
                    scanLine: Math.round(percent / 100 * 240)
                  })
                }
              })

              const result = decoder.decode()
              const { buffer, width, height } = result

              wx.hideLoading()

              this.renderDecodedImage(buffer, width, height).then((imagePath) => {
                this.setData({
                  isDecoding: false,
                  decodedImage: imagePath,
                  decodeProgress: 100,
                  scanLine: 240
                })
                wx.showToast({ title: '解码完成', icon: 'success' })
              }).catch((err) => {
                console.error('渲染解码图片失败:', err)
                this.setData({ isDecoding: false })
                wx.showToast({ title: '渲染失败', icon: 'none' })
              })
            } catch (err) {
              wx.hideLoading()
              console.error('[SSTV] 解码失败:', err)
              this.setData({ isDecoding: false })
              wx.showModal({
                title: '解码失败',
                content: err.message || '未知错误',
                showCancel: false
              })
            }
          }, 100)

        } catch (err) {
          wx.hideLoading()
          console.error('[SSTV] WAV 解析失败:', err)
          this.setData({ isDecoding: false })
          wx.showModal({
            title: '文件解析失败',
            content: err.message || '无效的音频文件',
            showCancel: false
          })
        }
      },
      fail: (err) => {
        wx.hideLoading()
        console.error('[SSTV] 读取文件失败:', err)
        this.setData({ isDecoding: false })
        wx.showToast({ title: '读取文件失败', icon: 'none' })
      }
    })
  },

  // 保留 stopDecode 用于取消解码（按钮显示"取消解码"）
  stopDecode() {
    this.setData({ isDecoding: false })
    wx.showToast({ title: '已取消解码', icon: 'none' })
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
            // 读取呼号，默认显示为 CQ DE + 个人呼号
            let myCallSign = ''
            let callsign = ''
            let showCallsign = false
            try {
              myCallSign = wx.getStorageSync('myCallSign') || ''
              if (myCallSign) {
                callsign = 'CQ DE ' + myCallSign
                showCallsign = true
              }
            } catch (e) {
              console.error('读取呼号失败', e)
            }

            this.setData({
              uploadImage: tempFilePath,
              imageWidth: info.width,
              imageHeight: info.height,
              callsign: callsign,
              showCallsign: showCallsign
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

  onEncodeTap() {
    if (!this.data.uploadImage || this.data.isEncoding) return
    this.startEncode()
  },

  async startEncode() {

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
          
          const img = canvas.createImage()
          img.onload = () => {
            ctx.drawImage(img, 0, 0, 320, 240)
            
            if (this.data.showCallsign && this.data.callsign) {
              ctx.save()
              ctx.font = 'bold 24px monospace'
              ctx.fillStyle = '#FFFFFF'
              ctx.strokeStyle = '#000000'
              ctx.lineWidth = 3
              ctx.textBaseline = 'top'
              
              ctx.strokeText(this.data.callsign, this.data.callsignX, this.data.callsignY)
              ctx.fillText(this.data.callsign, this.data.callsignX, this.data.callsignY)
              ctx.restore()
            }

            setTimeout(() => {
              try {
                const imageData = ctx.getImageData(0, 0, 320, 240)

                const encoder = this.encoder
                if (!encoder) {
                  wx.hideLoading()
                  this.setData({ isEncoding: false })
                  wx.showToast({ title: '编码器初始化失败', icon: 'none' })
                  return
                }

                const samples = encoder.encodeFromImageData(imageData)

                console.log('[SSTV] 编码完成，采样点数:', samples.length)
                console.log('[SSTV] 采样率:', encoder.sampleRate)
                console.log('[SSTV] 理论音频时长(秒):', samples.length / encoder.sampleRate)

                const audioDuration = Math.round(samples.length / encoder.sampleRate)
                console.log('[SSTV] 音频时长(取整):', audioDuration, '秒')

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
                    try {
                      const fileStats = fileManager.statSync(filePath)
                      const fileSize = fileStats.size
                      const fileSizeKB = (fileSize / 1024).toFixed(1)
                      const fileSizeMB = (fileSize / (1024 * 1024)).toFixed(2)
                      const displaySize = fileSize > 1024 * 1024
                        ? fileSizeMB + ' MB'
                        : fileSizeKB + ' KB'

                      console.log('[SSTV] 实际文件大小:', fileSize, '字节')
                      console.log('[SSTV] 预期文件大小:', expectedFileSize, '字节')
                      console.log('[SSTV] 文件大小是否匹配:', fileSize === expectedFileSize)

                      const actualSamples = (fileSize - 44) / 2
                      const actualDuration = Math.round(actualSamples / encoder.sampleRate)
                      console.log('[SSTV] 实际音频采样数:', actualSamples)
                      console.log('[SSTV] 实际音频时长:', actualDuration, '秒')

                      this.setData({
                        audioFilePath: filePath,
                        isEncoding: false,
                        audioFileSize: displaySize,
                        audioDuration: actualDuration,
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
      // 如果未显示，则显示，格式为 CQ DE + 呼号
      this.setData({
        callsign: 'CQ DE ' + myCallSign,
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
      
      // 保存到实例，用于后续控制
      this.audioContext = audioContext
      
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
  },

  // 打开编码项目仓库
  openEncoderRepo() {
    wx.setClipboardData({
      data: 'https://github.com/olgamiller/SSTVEncoder2',
      success: () => {
        wx.showToast({ title: '链接已复制', icon: 'success' })
      }
    })
  },

  // 打开解码项目仓库
  openDecoderRepo() {
    wx.setClipboardData({
      data: 'https://github.com/xdsopl/robot36',
      success: () => {
        wx.showToast({ title: '链接已复制', icon: 'success' })
      }
    })
  }
})