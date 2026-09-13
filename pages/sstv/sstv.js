const VIBRATE_TYPE = 'medium'
const Robot36 = require('./sstv-robot36')
const Scottie1 = require('./sstv-scottie1')
const SSTVFFTDecoder = require('./sstv-fft-decoder')

// 呼号文字字号（px）。预览区与画布共用同一坐标系（320x240），
// 预览样式、画布绘制、拖拽收边三处必须使用同一个字号，才能保证所见即所得。
const CALLSIGN_FONT_SIZE = 24
// monospace 单字符宽度约为字号的 0.6 倍，用于拖拽收边估算
const CALLSIGN_CHAR_WIDTH_RATIO = 0.6

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
    isEncoding: false,
    isDecoding: false,
    // 选图后的内容安全校验等待期（覆盖"上传云存储 + 云函数审核"这段空白期）
    isCheckingImage: false,
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
    // 当前解码模式的总行数（由解码器识别出的模式决定，Robot 240 / Martin、Scottie 256）
    decodeTotalLines: 240,
    audioContext: null,
    // 呼号相关
    callsign: '',
    showCallsign: false,
    callsignX: 20,
    callsignY: 200,
    isDraggingCallsign: false,
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

    // 预生成分享图片（保存句柄，页面提前卸载时清理，避免回调在卸载后执行）
    this._shareCardTimer = setTimeout(() => {
      this._shareCardTimer = null
      this._generateShareCard()
    }, 1000)
  },

  onShow() {
  },

  onHide() {
    // 解码中离开页面：按取消解码处理，避免阻塞导致卡顿
    this._cancelDecoding(false)
    this._stopAudio()

    console.log('页面隐藏')
  },

  onUnload() {
    // 解码中返回：按取消解码处理，避免阻塞导致卡顿
    this._cancelDecoding(false)

    if (this.updateTimer) {
      clearTimeout(this.updateTimer)
    }
    if (this._shareCardTimer) {
      clearTimeout(this._shareCardTimer)
      this._shareCardTimer = null
    }
    if (this._checkingTimer) {
      clearTimeout(this._checkingTimer)
      this._checkingTimer = null
    }
    // 卸载时不再回写 UI 状态
    this._stopAudio(false)

    console.log('页面卸载，资源已清理')
  },

  /**
   * 停止并释放当前音频播放器
   * @param {boolean} [withUi=true] - 是否同步复位播放相关 UI 状态
   */
  _stopAudio(withUi) {
    if (this.audioContext) {
      try {
        this.audioContext.stop()
      } catch (e) { /* 上下文已销毁，忽略 */ }
      try {
        this.audioContext.destroy()
      } catch (e) { /* 忽略 */ }
      this.audioContext = null
    }
    if (withUi === false) return
    this.setData({
      isPlaying: false,
      audioCurrentTime: 0,
      audioCurrentTimeStr: '0:00',
      audioProgress: 0
    })
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
      scanLine: 0,
      decodeTotalLines: 240
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
            const decoder = new SSTVFFTDecoder(samples, sampleRate, {
              fftSize: 512,
              onProgress: (percent) => {
                // 已取消则不再更新进度
                if (!this.data.isDecoding) return
                // 总行数按解码器实际识别出的模式取（Martin / Scottie 为 256 行，Robot 为 240 行）
                const cur = this.decoder
                const totalLines = (cur && cur.mode && cur.mode.LINE_COUNT) || 240
                this.setData({
                  decodeProgress: percent,
                  scanLine: Math.round(percent / 100 * totalLines),
                  decodeTotalLines: totalLines
                })
              }
            })
            // 保存实例，供取消解码 / 页面返回时中止
            this.decoder = decoder

            decoder.decode().then((result) => {
              const { buffer, width, height } = result
              // 音频中途用尽时解码会被截断（图片底部为黑），不能当成功结果提示
              const truncated = !!decoder.truncated
              wx.hideLoading()

              this.renderDecodedImage(buffer, width, height).then((imagePath) => {
                this.setData({
                  isDecoding: false,
                  decodedImage: imagePath,
                  decodeProgress: 100,
                  scanLine: this.data.decodeTotalLines || 240
                })
                if (truncated) {
                  wx.showToast({ title: '解码完成，但音频不完整', icon: 'none', duration: 2500 })
                } else {
                  wx.showToast({ title: '解码完成', icon: 'success' })
                }
              }).catch((err) => {
                console.error('渲染解码图片失败:', err)
                this.setData({ isDecoding: false })
                wx.showToast({ title: '渲染失败', icon: 'none' })
              })
            }).catch((err) => {
              wx.hideLoading()
              // 主动取消：静默处理（stopDecode 已给出提示）
              if (err && err.cancelled) {
                console.log('[SSTV] 解码已取消')
                return
              }
              console.error('[SSTV] 解码失败:', err)
              this.setData({ isDecoding: false })
              wx.showModal({
                title: '解码失败',
                content: err.message || '未知错误',
                showCancel: false
              })
            }).then(() => {
              this.decoder = null
            })
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

  // 取消解码（按钮显示"取消解码"）
  stopDecode() {
    this._cancelDecoding(true)
  },

  /**
   * 统一的取消解码逻辑：中止解码器、复位状态、关闭 loading
   * @param {boolean} showToast - 是否提示"已取消解码"
   */
  _cancelDecoding(showToast) {
    if (!this.data.isDecoding) return
    if (this.decoder) {
      this.decoder.cancel()
    }
    wx.hideLoading()
    this.setData({ isDecoding: false, decodeProgress: 0, scanLine: 0 })
    if (showToast) {
      wx.showToast({ title: '已取消解码', icon: 'none' })
    }
  },

  switchTab(e) {
    const tab = e.currentTarget.dataset.tab
    this.setData({ currentTab: tab })
    wx.vibrateShort({ type: VIBRATE_TYPE })
  },

  chooseImage() {
    const app = getApp()
    if (!app || typeof app.requireCallSign !== 'function') {
      wx.showToast({ title: '初始化中，请稍后再试', icon: 'none' })
      return
    }
    // 呼号拦截校验前置：未设置则弹窗提示；SSTV 场景允许"看激励广告临时使用一次"
    if (!app.requireCallSign({
      allowRewardedAd: true,
      onReward: () => this._startChooseImage()
    })) return

    this._startChooseImage()
  },

  // 实际的选图/审核流程，供"已设置呼号"与"看完广告放行"两条路径复用
  _startChooseImage() {
    const app = getApp()
    if (!app || typeof app.checkImageSafety !== 'function') {
      wx.showToast({ title: '初始化中，请稍后再试', icon: 'none' })
      return
    }
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const tempFilePath = res.tempFiles[0].tempFilePath
        this._verifyAndProcessImage(tempFilePath)
      },
      fail: (err) => {
        const msg = (err && err.errMsg) || ''
        // 用户主动取消不算失败
        if (msg.indexOf('cancel') >= 0) return
        console.error('[SSTV] 选择图片失败:', err)
        // 权限被拒（相册/相机）时引导去设置页开启
        if (msg.indexOf('auth') >= 0 || msg.indexOf('authorize') >= 0 || msg.indexOf('permission') >= 0) {
          wx.showModal({
            title: '无法访问相册/相机',
            content: '请在设置中允许使用相册与相机后重试',
            confirmText: '去设置',
            success: (r) => {
              if (r.confirm) wx.openSetting()
            }
          })
          return
        }
        wx.showToast({ title: '选择图片失败', icon: 'none' })
      }
    })
    wx.vibrateShort({ type: VIBRATE_TYPE })
  },

  /**
   * 内容安全校验 → 处理图片
   * 选图后到图片真正就绪之间存在"上传云存储 + 云函数审核"的等待期，
   * 期间展示校验提示，直到图片渲染完成或校验结束才收起。
   */
  _verifyAndProcessImage(tempFilePath) {
    const app = getApp()
    // 审核关闭时链路是同步放行的，不必闪一下提示
    const needCheck = typeof app.getContentCheckEnabled === 'function'
      ? app.getContentCheckEnabled()
      : true
    if (needCheck) this._beginImageChecking()

    app.checkImageSafety(tempFilePath).then((safe) => {
      if (!safe) {
        // 违规：app.checkImageSafety 内部已给出提示
        this._endImageChecking()
        return
      }
      this._processChosenImage(tempFilePath)
    }).catch((err) => {
      // 审核链路异常按放行处理（与 checkImageSafety 的 fail-open 策略保持一致），
      // 仅记录日志，避免用户"选完图没反应"
      console.error('[SSTV] 图片校验异常，按放行处理:', err)
      this._processChosenImage(tempFilePath)
    })
  },

  /** 展示"正在校验图片"提示 */
  _beginImageChecking() {
    if (this._checkingTimer) {
      clearTimeout(this._checkingTimer)
      this._checkingTimer = null
    }
    this.setData({ isCheckingImage: true })
    // 兜底：审核链路若异常挂起，10s 后自动收起，避免遮罩长期挡住页面
    this._checkingTimer = setTimeout(() => {
      this._checkingTimer = null
      this._endImageChecking()
    }, 10000)
  },

  /** 收起"正在校验图片"提示 */
  _endImageChecking() {
    if (this._checkingTimer) {
      clearTimeout(this._checkingTimer)
      this._checkingTimer = null
    }
    if (this.data.isCheckingImage) {
      this.setData({ isCheckingImage: false })
    }
  },

  _processChosenImage(tempFilePath) {
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
            // 图片已就绪，收起校验提示
            this._endImageChecking()
          },
      fail: (err) => {
        console.error('[SSTV] 读取图片信息失败:', err)
        this._endImageChecking()
        wx.showToast({ title: '图片读取失败，请换一张', icon: 'none' })
      }
    })
  },

  onEncodeTap() {
    if (!this.data.uploadImage || this.data.isEncoding) return
    this.startEncode()
  },

  async startEncode() {

    // 重新生成会覆盖同名 wav 文件，先停掉正在播放的音频，避免边写边播
    this._stopAudio()
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
              ctx.font = 'bold ' + CALLSIGN_FONT_SIZE + 'px monospace'
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

  /** 呼号在画布坐标系下的估算尺寸（用于拖拽收边，保证文字完整落在 320x240 画面内） */
  _callsignBoxSize() {
    const len = (this.data.callsign || '').length || 1
    return {
      width: Math.min(320, Math.round(len * CALLSIGN_FONT_SIZE * CALLSIGN_CHAR_WIDTH_RATIO)),
      height: CALLSIGN_FONT_SIZE
    }
  },

  // 呼号拖动 - 触摸开始
  onCallsignTouchStart(e) {
    const touch = e.touches[0]
    // 使用 pageX/pageY（相对于页面的坐标）
    this.setData({
      isDraggingCallsign: true,
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
    
    // 限制边界：按呼号实际宽高收边，避免拖出画面（出图时被裁掉）
    const box = this._callsignBoxSize()
    newX = Math.max(0, Math.min(320 - box.width, newX))
    newY = Math.max(0, Math.min(240 - box.height, newY))
    
    this.setData({
      callsignX: newX,
      callsignY: newY,
      callsignTouchStartX: touch.pageX,
      callsignTouchStartY: touch.pageY
    })
  },

  // 呼号拖动 - 触摸结束：退出拖拽高亮，恢复与出图一致的观感
  onCallsignTouchEnd() {
    if (this.data.isDraggingCallsign) {
      this.setData({ isDraggingCallsign: false })
    }
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
    this._stopAudio(false)

    wx.showToast({ title: '已移除图片', icon: 'none' })
  },

  // 切换音频播放/暂停
  togglePlayAudio() {
    if (this.data.isPlaying) {
      // 停止播放
      this._stopAudio()
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

  // 打开编码项目仓库（复制链接由系统提示，无需再补一条 toast）
  openEncoderRepo() {
    wx.setClipboardData({
      data: 'https://github.com/olgamiller/SSTVEncoder2'
    })
  },

  // 打开解码项目仓库：本页解码器移植自 colaclanth/sstv（见 sstv-fft-decoder.js 头部说明）
  openDecoderRepo() {
    wx.setClipboardData({
      data: 'https://github.com/colaclanth/sstv'
    })
  },

  // ==================== 分享功能 ====================

  /** 生成SSTV分享卡片（canvas 2d 接口） */
  _generateShareCard() {
    const query = wx.createSelectorQuery()
    query.select('#shareCanvas')
      .fields({ node: true, size: true })
      .exec((res) => {
        const canvasRes = res && res[0]
        if (!canvasRes || !canvasRes.node) {
          console.error('[SSTV] 未获取到 shareCanvas 节点')
          return
        }
        const canvas = canvasRes.node
        // 导出为 2 倍清晰度（对应旧接口 destWidth/destHeight 1000x800）
        const scale = 2
        canvas.width = 500 * scale
        canvas.height = 400 * scale
        const ctx = canvas.getContext('2d')
        ctx.scale(scale, scale)

        // Canvas 尺寸（逻辑坐标，与旧代码一致）
        const W = 500
        const H = 400
        const pad = 30
        const cardW = W - pad * 2
        const cardH = 200
        const cardX = pad
        const cardY = 100

        // 1. 页面背景色
        ctx.fillStyle = '#F5F6FA'
        ctx.fillRect(0, 0, W, H)

        // 2. 标题区域
        ctx.fillStyle = '#1A2B42'
        ctx.font = 'normal bold 24px sans-serif'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText('SSTV 图像传输', W / 2, 40)

        // 3. 绘制SSTV卡片预览
        // 卡片阴影
        ctx.shadowOffsetX = 0
        ctx.shadowOffsetY = 4
        ctx.shadowBlur = 20
        ctx.shadowColor = 'rgba(58, 85, 130, 0.15)'

        // 卡片背景（渐变）
        const cardGrad = ctx.createLinearGradient(cardX, cardY, cardX + cardW, cardY + cardH)
        cardGrad.addColorStop(0, '#E8F5E9')
        cardGrad.addColorStop(1, '#FFFFFF')
        ctx.fillStyle = cardGrad

        // 圆角矩形
        const r = 12
        ctx.beginPath()
        ctx.moveTo(cardX + r, cardY)
        ctx.lineTo(cardX + cardW - r, cardY)
        ctx.arcTo(cardX + cardW, cardY, cardX + cardW, cardY + r, r)
        ctx.lineTo(cardX + cardW, cardY + cardH - r)
        ctx.arcTo(cardX + cardW, cardY + cardH, cardX + cardW - r, cardY + cardH, r)
        ctx.lineTo(cardX + r, cardY + cardH)
        ctx.arcTo(cardX, cardY + cardH, cardX, cardY + cardH - r, r)
        ctx.lineTo(cardX, cardY + r)
        ctx.arcTo(cardX, cardY, cardX + r, cardY, r)
        ctx.closePath()
        ctx.fill()
        // 清除阴影
        ctx.shadowColor = 'transparent'
        ctx.shadowBlur = 0
        ctx.shadowOffsetX = 0
        ctx.shadowOffsetY = 0

        // 4. 绘制SSTV图标和文字
        // 左侧图标
        const iconGrad = ctx.createLinearGradient(cardX + 40, cardY + 60, cardX + 100, cardY + 120)
        iconGrad.addColorStop(0, '#388E3C')
        iconGrad.addColorStop(1, '#D84315')
        ctx.fillStyle = iconGrad
        ctx.fillRect(cardX + 40, cardY + 60, 60, 60)

        ctx.fillStyle = '#FFFFFF'
        ctx.font = '32px sans-serif'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText('🖼️', cardX + 70, cardY + 90)

        // 右侧文字
        ctx.fillStyle = '#1A2B42'
        ctx.font = 'normal bold 18px sans-serif'
        ctx.textAlign = 'left'
        ctx.fillText('慢扫描电视', cardX + 130, cardY + 75)

        ctx.fillStyle = '#5B697F'
        ctx.font = 'normal normal 13px sans-serif'
        ctx.fillText('编码 Robot36 · 解码 7 种模式', cardX + 130, cardY + 105)
        ctx.fillText('编码图片为音频信号', cardX + 130, cardY + 130)
        ctx.fillText('解码音频为图片', cardX + 130, cardY + 155)

        // 底部提示
        ctx.fillStyle = '#8E99A8'
        ctx.font = 'normal normal 13px sans-serif'
        ctx.textAlign = 'center'
        ctx.fillText('图片与声音的转换 · SSTV编码解码', W / 2, H - 40)

        // 导出图片（2d 为即时绘制，少量延迟确保 emoji 字形就绪）
        setTimeout(() => {
          wx.canvasToTempFilePath({
            canvas: canvas,
            x: 0,
            y: 0,
            width: 500 * scale,
            height: 400 * scale,
            destWidth: 500 * scale,
            destHeight: 400 * scale,
            fileType: 'png',
            quality: 1,
            success: (res) => {
              this._shareImagePath = res.tempFilePath
              console.log('SSTV分享卡片生成成功:', res.tempFilePath)
            },
            fail: (err) => {
              console.error('生成SSTV分享卡片失败', err)
            }
          })
        }, 50)
      })
  },

  onShareAppMessage() {
    const shareImagePath = this._shareImagePath || ''
    return {
      title: 'SSTV图像传输 - 风语纪',
      path: '/pages/sstv/sstv',
      imageUrl: shareImagePath || '/images/cover.jpg'
    }
  },

  onShareTimeline() {
    const shareImagePath = this._shareImagePath || ''
    return {
      title: 'SSTV图像传输 - 风语纪',
      query: '',
      imageUrl: shareImagePath || '/images/cover.jpg'
    }
  }
})