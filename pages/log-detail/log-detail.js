const app = getApp()
const SHARE_TITLE_PREFIX = '风语纪: '
const VIBRATE_TYPE = 'medium'

function pad2(n) {
  return String(n).padStart(2, '0')
}

function instantFromBjtWall(dateStr, timeStr) {
  if (!dateStr) return null
  const t = ((timeStr || '') + '').trim().slice(0, 5) || '00:00'
  const ms = new Date(`${dateStr}T${t}:00+08:00`).getTime()
  return isNaN(ms) ? null : ms
}

// 判断是否为数字
function isNumeric(value) {
  if (!value) return false
  return /^\d+(\.\d+)?$/.test(String(value).trim())
}

// 获取功率显示文本
function getPowerDisplay(power) {
  if (!power) return ''
  const trimmed = String(power).trim()
  if (isNumeric(trimmed)) {
    return trimmed + ' W'
  } else {
    return trimmed + ' 功率'
  }
}

function formatUtcDateTime(ms) {
  const d = new Date(ms)
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`
}

function buildBjtDateTimeFull(log) {
  const d = log.date || ''
  const t = (log.btcTime || log.bjcTime || '').trim() || '00:00'
  const timePart = t.slice(0, 5)
  return d ? `${d} ${timePart}` : timePart
}

function buildUtcDateTimeFull(log) {
  const ms = instantFromBjtWall(log.date, log.btcTime || log.bjcTime)
  if (ms != null) return formatUtcDateTime(ms)
  const u = (log.utcTime || '').trim().slice(0, 5)
  return u ? `— ${u}` : '—'
}

Page({
  data: {
    log: null,
    myRst: '',
    theirRst: '',
    bjtDateTimeFull: '',
    utcDateTimeFull: '',
    showCopyToast: false,
    copyToastMsg: ''
  },

  onLoad(options) {
    // 初始化内存缓存 - 避免在 Page 对象中定义非简单值
    this._cache = {
      appTheme: null,
      contactLogs: null
    }
    
    // 检查是否有传递完整的日志数据（从分享列表进入）
    if (options.logData) {
      try {
        const log = JSON.parse(decodeURIComponent(options.logData))
        this.setData({ log: log })
        this.processLogData(log)
        this.loadTheme()
        return
      } catch (e) {
        console.error('解析日志数据失败', e)
      }
    }
    
    // 检查是否是分享的日志
    if (options.shareId && options.logId) {
      this.loadSharedLogDetail(options.shareId, options.logId)
      this.loadTheme()
      return
    }
    
    // 普通本地日志
    const logId = parseInt(options.id)
    this.loadLogDetail(logId)
    this.loadTheme()
  },

  onShow() {
    if (this.data.log) {
      // 如果是分享的日志，不重新加载
      if (this.data.isSharedLog) {
        this.loadTheme()
        return
      }
      this.loadLogDetail(this.data.log.id)
    }
    this.loadTheme()
  },

  // 获取日志缓存
  _getLogsFromCache() {
    if (this._cache.contactLogs === null) {
      this._cache.contactLogs = wx.getStorageSync('contactLogs') || []
    }
    return this._cache.contactLogs
  },

  // 更新日志缓存
  _updateLogsCache(logs) {
    this._cache.contactLogs = logs
    wx.setStorageSync('contactLogs', logs)
  },

  loadTheme() {
    try {
      if (this._cache.appTheme === null) {
        this._cache.appTheme = wx.getStorageSync('appTheme') || 'radio'
      }
      const savedTheme = this._cache.appTheme
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

  // 处理日志数据（通用方法）
  processLogData(log) {
    let myRst = ''
    let theirRst = ''
    
    if (log.rst) {
      if (log.rst.myRst) {
        myRst = `${log.rst.myRst.r || '-'}${log.rst.myRst.s || '-'}`
        if (log.rst.myRst.t) {
          myRst += log.rst.myRst.t
        }
      } else if (log.rst.r || log.rst.s || log.rst.t) {
        myRst = `${log.rst.r || '-'}${log.rst.s || '-'}`
        if (log.rst.t) {
          myRst += log.rst.t
        }
      }
      
      if (log.rst.theirRst) {
        theirRst = `${log.rst.theirRst.r || '-'}${log.rst.theirRst.s || '-'}`
        if (log.rst.theirRst.t) {
          theirRst += log.rst.theirRst.t
        }
      }
    }
    
    let recordTime = ''
    if (log.createdAt) {
      recordTime = this.formatDate(log.createdAt)
    } else if (log.date && log.btcTime) {
      recordTime = `${log.date} ${log.btcTime}`
    } else {
      recordTime = this.formatDate(new Date().toISOString())
    }
    
    const weatherIcon = this.getWeatherIcon(log.weather)
    const weatherText = this.getWeatherText(log.weather)
    const bjtDateTimeFull = buildBjtDateTimeFull(log)
    const utcDateTimeFull = buildUtcDateTimeFull(log)
    const powerDisplay = getPowerDisplay(log.power)

    this.setData({
      log: log,
      myRst: myRst,
      theirRst: theirRst,
      recordTime: recordTime,
      weatherIcon: weatherIcon,
      weatherText: weatherText,
      bjtDateTimeFull: bjtDateTimeFull,
      utcDateTimeFull: utcDateTimeFull,
      powerDisplay: powerDisplay,
      isSharedLog: true  // 标记为分享的日志
    })
  },

  // 从分享数据加载单条日志详情
  loadSharedLogDetail(shareId, logId) {
    wx.showLoading({ title: '加载中...' })
    
    const db = wx.cloud.database()
    db.collection('shareLogs').doc(shareId).get().then(res => {
      wx.hideLoading()
      
      if (res.data && res.data.logs) {
        // 从分享的日志列表中找到对应的日志
        const log = res.data.logs.find(item => item.id == logId)
        
        if (log) {
          this.processLogData(log)
        } else {
          wx.showToast({
            title: '日志不存在',
            icon: 'none'
          })
          setTimeout(() => {
            wx.navigateBack()
          }, 1500)
        }
      } else {
        wx.showToast({
          title: '日志不存在',
          icon: 'none'
        })
        setTimeout(() => {
          wx.navigateBack()
        }, 1500)
      }
    }).catch(err => {
      wx.hideLoading()
      console.error('加载分享日志详情失败', err)
      wx.showToast({
        title: '加载失败',
        icon: 'none'
      })
    })
  },

  loadLogDetail(logId) {
    try {
      const logs = this._getLogsFromCache()
      const log = logs.find(item => item.id === logId)
      
      if (log) {
        let myRst = ''
        let theirRst = ''
        
        if (log.rst) {
          if (log.rst.myRst) {
            myRst = `${log.rst.myRst.r || '-'}${log.rst.myRst.s || '-'}`
            if (log.rst.myRst.t) {
              myRst += log.rst.myRst.t
            }
          } else if (log.rst.r || log.rst.s || log.rst.t) {
            myRst = `${log.rst.r || '-'}${log.rst.s || '-'}`
            if (log.rst.t) {
              myRst += log.rst.t
            }
          }
          
          if (log.rst.theirRst) {
            theirRst = `${log.rst.theirRst.r || '-'}${log.rst.theirRst.s || '-'}`
            if (log.rst.theirRst.t) {
              theirRst += log.rst.theirRst.t
            }
          }
        }
        
        let recordTime = ''
        if (log.createdAt) {
          recordTime = this.formatDate(log.createdAt)
        } else if (log.date && log.btcTime) {
          recordTime = `${log.date} ${log.btcTime}`
        } else {
          recordTime = this.formatDate(new Date().toISOString())
        }
        
        const weatherIcon = this.getWeatherIcon(log.weather)
        const weatherText = this.getWeatherText(log.weather)
        const bjtDateTimeFull = buildBjtDateTimeFull(log)
        const utcDateTimeFull = buildUtcDateTimeFull(log)
        const powerDisplay = getPowerDisplay(log.power)

        this.setData({
          log: log,
          myRst: myRst,
          theirRst: theirRst,
          recordTime: recordTime,
          weatherIcon: weatherIcon,
          weatherText: weatherText,
          bjtDateTimeFull: bjtDateTimeFull,
          utcDateTimeFull: utcDateTimeFull,
          powerDisplay: powerDisplay,
          isSharedLog: false
        })
      } else {
        wx.showToast({
          title: '日志不存在',
          icon: 'none'
        })
        setTimeout(() => {
          wx.navigateBack()
        }, 1500)
      }
    } catch (e) {
      console.error('加载日志详情失败', e)
      wx.showToast({
        title: '加载失败',
        icon: 'none'
      })
    }
  },

  getWeatherIcon(value) {
    const icons = {
      'sunny': '☀️',
      'cloudy': '⛅',
      'rainy': '🌧️',
      'stormy': '⛈️',
      'snowy': '🌨️',
      'foggy': '🌫️',
      'windy': '💨',
      'night': '🌙'
    }
    return icons[value] || ''
  },

  getWeatherText(value) {
    const texts = {
      'sunny': '晴天',
      'cloudy': '多云',
      'rainy': '雨天',
      'stormy': '雷雨',
      'snowy': '雪天',
      'foggy': '雾天',
      'windy': '大风',
      'night': '夜晚'
    }
    return texts[value] || ''
  },

  formatDate(dateString) {
    if (!dateString) return '未知'
    try {
      const date = new Date(dateString)
      if (isNaN(date.getTime())) return '未知'
      const year = date.getFullYear()
      const month = String(date.getMonth() + 1).padStart(2, '0')
      const day = String(date.getDate()).padStart(2, '0')
      const hours = String(date.getHours()).padStart(2, '0')
      const minutes = String(date.getMinutes()).padStart(2, '0')
      return `${year}-${month}-${day} ${hours}:${minutes}`
    } catch (e) {
      return '未知'
    }
  },

  // 显示复制成功提示
  showCopyFeedback(msg) {
    this.setData({
      showCopyToast: true,
      copyToastMsg: msg || '已复制'
    })
    // 1.5秒后自动隐藏
    if (this._copyToastTimer) clearTimeout(this._copyToastTimer)
    this._copyToastTimer = setTimeout(() => {
      this.setData({ showCopyToast: false })
    }, 1500)
  },

  // 复制完整日志（结构化文本格式）
  copyFullLog() {
    wx.vibrateShort({ type: VIBRATE_TYPE })
    const log = this.data.log
    if (!log) return

    // 获取我的呼号
    const myCallSign = wx.getStorageSync('myCallSign') || ''

    // 如果未设置呼号，提醒用户去设置
    if (!myCallSign) {
      wx.showModal({
        title: '未设置个人呼号',
        content: '复制的日志中将不包含您的呼号。是否前往"我的"页面设置？',
        confirmText: '去设置',
        cancelText: '继续复制',
        success: (res) => {
          if (res.confirm) {
            wx.switchTab({
              url: '/pages/mine/mine'
            })
          } else {
            // 用户选择继续复制（无个人呼号）
            this.doCopyFullLog('')
          }
        }
      })
      return
    }

    this.doCopyFullLog(myCallSign)
  },

  // 执行完整日志复制
  doCopyFullLog(myCallSign) {
    const log = this.data.log

    const lines = [
      `=== 通联日志 ===`,
      ``,
      `我的呼号: ${myCallSign || '-'}`,
      `对方呼号: ${log.callSign || '-'}`,
      `日期(BJT): ${this.data.bjtDateTimeFull || '-'}`,
      `日期(UTC): ${this.data.utcDateTimeFull || '-'}`,
      `频率: ${log.frequency || '-'} MHz`,
      `模式: ${log.mode || '-'}`,
      `己方RST: ${this.data.myRst || '-'}`,
      `对方RST: ${this.data.theirRst || '-'}`
    ]

    if (log.qth) lines.push(`位置: ${log.qth}`)
    if (log.equipment) lines.push(`设备: ${log.equipment}`)
    if (log.antenna) lines.push(`天线: ${log.antenna}`)
    if (this.data.powerDisplay) lines.push(`功率: ${this.data.powerDisplay}`)
    if (log.weather) lines.push(`天气: ${this.data.weatherText || log.weather}`)
    if (log.notes) lines.push(`备注: ${log.notes}`)
    
    lines.push(``)
    lines.push(`记录时间: ${this.data.recordTime || ''}`)

    const text = lines.join('\n')

    wx.setClipboardData({
      data: text,
      success: () => {
        this.showCopyFeedback('完整日志已复制')
      },
      fail: () => {
        wx.showToast({ title: '复制失败', icon: 'none' })
      }
    })
  },

  // 复制单个字段
  copyField(e) {
    wx.vibrateShort({ type: VIBRATE_TYPE })
    const dataset = e.currentTarget.dataset
    const label = dataset.label || '字段'
    
    // 优先使用 data-value，否则从 log 中取
    let value = dataset.value
    if (!value && this.data.log) {
      value = this.data.log[dataset.field]
    }
    if (!value) value = ''

    const text = String(value)

    wx.setClipboardData({
      data: text,
      success: () => {
        this.showCopyFeedback(`${label} 已复制`)
      },
      fail: () => {
        wx.showToast({ title: '复制失败', icon: 'none' })
      }
    })
  },

  deleteLog() {
    wx.vibrateShort({ type: VIBRATE_TYPE })
    wx.showModal({
      title: '确认删除',
      content: '确定要删除这条日志吗？此操作不可恢复。',
      confirmColor: '#ff4d4f',
      success: (res) => {
        if (res.confirm) {
          const logId = this.data.log.id
          const cloudSyncEnabled = app.isCloudSyncEnabled()
          
          wx.showLoading({ title: '删除中...' })
          
          // 定义删除本地日志的函数
          const deleteLocalLog = () => {
            try {
              let logs = this._getLogsFromCache()
              logs = logs.filter(item => item.id !== logId)
              this._updateLogsCache(logs)
              
              wx.hideLoading()
              wx.showToast({
                title: '删除成功',
                icon: 'success'
              })
              
              setTimeout(() => {
                wx.navigateBack()
              }, 1500)
            } catch (e) {
              console.error('删除本地日志失败', e)
              wx.hideLoading()
              wx.showToast({
                title: '删除失败',
                icon: 'none'
              })
            }
          }
          
          // 如果云同步开启，先从云端删除
          if (cloudSyncEnabled) {
            const db = wx.cloud.database()
            const collection = db.collection(app.CLOUD_LOGS_CONFIG.collectionName)
            
            // 查询云端是否有匹配的日志
            collection.where({ id: logId }).get().then(res => {
              if (res.data && res.data.length > 0) {
                // 删除云端记录
                const deleteTasks = res.data.map(log => 
                  collection.doc(log._id).remove()
                )
                return Promise.all(deleteTasks)
              }
            }).then(() => {
              // 删除本地日志
              deleteLocalLog()
            }).catch(err => {
              console.error('删除云端日志失败', err)
              // 即使云端删除失败，也删除本地
              deleteLocalLog()
            })
          } else {
            // 云同步未开启，直接删除本地
            deleteLocalLog()
          }
        }
      }
    })
  },

  onShareAppMessage() {
    const log = this.data.log
    const title = log ? SHARE_TITLE_PREFIX + log.callSign : SHARE_TITLE_PREFIX
    return {
      title: title,
      path: '/pages/logs/logs',
      imageUrl: '/images/cover.jpg'
    }
  },

  onShareTimeline() {
    const log = this.data.log
    if (!log) {
      return { title: SHARE_TITLE_PREFIX, query: '', imageUrl: '/images/cover.jpg' }
    }
    return {
      title: SHARE_TITLE_PREFIX + log.callSign,
      query: `page=log-detail&id=${log.id}`,
      imageUrl: '/images/cover.jpg'
    }
  }
})