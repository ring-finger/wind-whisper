const VIBRATE_TYPE = 'medium'
// 导入拆分后的模块 (对应 Java SSTVEncoder2 项目结构)
const { createMode } = require('./sstv-factory')
const SSTVDecoder = require('./sstv-decoder')

Page({
  data: {
    currentTab: 'encode',
    uploadImage: '',
    imageWidth: 0,
    imageHeight: 0,
    quality: 80,  // 对应 app.wxss 中的默认质量
    sensitivity: 50,  // 对应 app.wxss 中的默认灵敏度
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
    audioFormat: 'WAV',  // 对应 app.wxss 中的音频格式
    decodedImage: '',
    decodeProgress: 0,
    scanLine: 0,
    recorderManager: null,
    audioContext: null,
    currentTheme: 'radio',
    // 呼号相关
    callsign: '',
    showCallsign: false,
    showCallsignInput: false,
    callsignX: 20,  // 默认左下角内侧 (距离左边20px)
    callsignY: 200,  // 默认左下角内侧 (距离底部40px = 240-40)
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
      
      // 根据主题设置导航栏颜色
      const app = getApp()
      const themeConfig = app.THEMES[savedTheme] || app.THEMES.radio
      
      // 确保导航栏文字颜色是有效的（微信小程序要求只能是 #ffffff 或 #000000）
      let navText = '#000000'
      if (savedTheme === 'dark') {
        navText = '#ffffff'
      }
      
      wx.setNavigationBarColor({
        frontColor: navText,
        backgroundColor: themeConfig.navBg || '#F9F7F4',
        animation: {
          duration: 0,
          timingFunc: 'linear'
        }
      })
      
      // 动态设置页面背景色，确保与主题一致
      wx.setBackgroundColor({
        backgroundColor: themeConfig.bgPrimary || '#F4F7FA',
        backgroundColorTop: themeConfig.bgPrimary || '#F4F7FA',
        backgroundColorBottom: themeConfig.bgPrimary || '#F4F7FA'
      })
    } catch (e) {
      console.error('加载主题失败', e)
    }
  },

  initSSTV() {
    // 使用工厂方法创建编码器实例 (对应 Java 的 ModeFactory)
    this.encoder = createMode('Robot36')
    this.decoder = new SSTVDecoder()
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
        }, 500) // 500ms 防抖，减少UI更新频率
      }
      decoder.onComplete = (imageData, width, height) => {
        this.hasCompletedDecoding = true
        this.decodedImageData = imageData
        
        // 立即停止录音
        this.forceStopRecording()
        
        // 解码完成后才渲染图片
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