const app = getApp()

const SHARE_TITLE = '风语纪<电波有痕，风语为纪> - 记录您的每一次通联'
const VIBRATE_TYPE = 'medium'

Page({
  data: {
    userCallsign: '',
    userAvatarUrl: '',
    userNickName: '',
    stats: {
      totalLogs: 0,
      todayLogs: 0,
      weekLogs: 0,
      monthLogs: 0,
      bandCount: 0
    },
    recentLogs: [],
    currentTheme: 'radio'
  },

  // 统一获取 contactLogs，使用内存缓存避免重复同步读取
  _getContactLogsFromCache() {
    if (this._cache.contactLogs === null) {
      this._cache.contactLogs = wx.getStorageSync('contactLogs') || []
    }
    return this._cache.contactLogs
  },

  // 更新 contactLogs 并同步到 Storage 和缓存
  _updateContactLogsCache(logs) {
    this._cache.contactLogs = logs
    wx.setStorageSync('contactLogs', logs)
  },

  onLoad() {
    // 初始化内存缓存 - 避免在 Page 对象中定义非简单值
    this._cache = {
      appTheme: null,
      myCallSign: null,
      wxMineAvatarUrl: null,
      wxMineNickName: null,
      contactLogs: null
    }
    
    this.loadTheme()
    this.loadUserInfo()
    this.loadStats()
    this.loadRecentLogs()
  },

  onShow() {
    // 清理 contactLogs 缓存，确保获取最新数据
    this._cache.contactLogs = null
    this.loadTheme()
    this.loadUserInfo()
    this.loadStats()
    this.loadRecentLogs()
  },

  loadTheme() {
    try {
      // 使用缓存，避免重复同步读取
      if (this._cache.appTheme === null) {
        this._cache.appTheme = wx.getStorageSync('appTheme') || 'radio'
      }
      const savedTheme = this._cache.appTheme
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

  loadUserInfo() {
    try {
      // 使用缓存，避免重复同步读取
      if (this._cache.myCallSign === null) {
        this._cache.myCallSign = wx.getStorageSync('myCallSign') || ''
      }
      if (this._cache.wxMineAvatarUrl === null) {
        this._cache.wxMineAvatarUrl = wx.getStorageSync('wxMineAvatarUrl') || ''
      }
      if (this._cache.wxMineNickName === null) {
        this._cache.wxMineNickName = wx.getStorageSync('wxMineNickName') || ''
      }
      this.setData({
        userCallsign: this._cache.myCallSign || '设置呼号',
        userAvatarUrl: this._cache.wxMineAvatarUrl,
        userNickName: this._cache.wxMineNickName
      })
    } catch (e) {
      console.error('加载用户信息失败', e)
    }
  },

  goToMine() {
    wx.vibrateShort({ type: VIBRATE_TYPE })
    wx.navigateTo({
      url: '/pages/mine/mine'
    })
  },

  goToQSO() {
    wx.vibrateShort({ type: VIBRATE_TYPE })
    wx.navigateTo({
      url: '/pages/logs/logs'
    })
  },

  goToAddQSO() {
    wx.vibrateShort({ type: VIBRATE_TYPE })
    wx.navigateTo({
      url: '/pages/logs/logs?tab=add'
    })
  },

  goToSSTV() {
    wx.vibrateShort({ type: VIBRATE_TYPE })
    wx.navigateTo({
      url: '/pages/sstv/sstv'
    })
  },

  // 跳转到今日通联日志
  goToTodayLogs() {
    wx.vibrateShort({ type: VIBRATE_TYPE })
    wx.navigateTo({
      url: '/pages/logs/logs?filter=today'
    })
  },

  // 跳转到本周通联日志
  goToWeekLogs() {
    wx.vibrateShort({ type: VIBRATE_TYPE })
    wx.navigateTo({
      url: '/pages/logs/logs?filter=week'
    })
  },

  // 跳转到本月通联日志
  goToMonthLogs() {
    wx.vibrateShort({ type: VIBRATE_TYPE })
    wx.navigateTo({
      url: '/pages/logs/logs?filter=month'
    })
  },

  loadStats() {
    try {
      const logs = this._getContactLogsFromCache()
      const now = new Date()
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
      const weekStart = todayStart - (now.getDay() || 7) * 24 * 60 * 60 * 1000
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime()

      const todayLogs = logs.filter(log => {
        const logTime = this.getLogTime(log)
        return logTime >= todayStart
      }).length

      const weekLogs = logs.filter(log => {
        const logTime = this.getLogTime(log)
        return logTime >= weekStart
      }).length

      const monthLogs = logs.filter(log => {
        const logTime = this.getLogTime(log)
        return logTime >= monthStart
      }).length

      // 统计不同频段数
      const bands = new Set()
      logs.forEach(log => {
        if (log.frequency) {
          const freq = parseFloat(log.frequency)
          if (!isNaN(freq)) {
            bands.add(this.getBand(freq))
          }
        }
      })

      this.setData({
        stats: {
          totalLogs: logs.length,
          todayLogs,
          weekLogs,
          monthLogs,
          bandCount: bands.size
        }
      })
    } catch (e) {
      console.error('加载统计数据失败', e)
    }
  },

  getLogTime(log) {
    if (log.contactInstantMs) {
      return log.contactInstantMs
    }
    if (log.date && log.btcTime) {
      return new Date(`${log.date}T${log.btcTime}:00+08:00`).getTime()
    }
    if (log.createdAt) {
      return new Date(log.createdAt).getTime()
    }
    return 0
  },

  getBand(freq) {
    if (freq >= 1.8 && freq <= 2.0) return '160m'
    if (freq >= 3.5 && freq <= 4.0) return '80m'
    if (freq >= 5.3 && freq <= 5.4) return '60m'
    if (freq >= 7.0 && freq <= 7.3) return '40m'
    if (freq >= 10.1 && freq <= 10.15) return '30m'
    if (freq >= 14.0 && freq <= 14.35) return '20m'
    if (freq >= 18.068 && freq <= 18.168) return '17m'
    if (freq >= 21.0 && freq <= 21.45) return '15m'
    if (freq >= 24.89 && freq <= 24.99) return '12m'
    if (freq >= 28.0 && freq <= 29.7) return '10m'
    if (freq >= 50 && freq <= 54) return '6m'
    if (freq >= 144 && freq <= 148) return '2m'
    if (freq >= 420 && freq <= 450) return '70cm'
    return '其他'
  },

  loadRecentLogs() {
    try {
      const logs = this._getContactLogsFromCache()
      // 按时间排序，取前5条
      const sortedLogs = logs
        .sort((a, b) => {
          const timeA = this.getLogTime(a)
          const timeB = this.getLogTime(b)
          return timeB - timeA
        })
        .slice(0, 5)

      this.setData({
        recentLogs: sortedLogs
      })
    } catch (e) {
      console.error('加载最近通联失败', e)
    }
  },

  onShareAppMessage() {
    return {
      title: SHARE_TITLE,
      path: '/pages/index/index',
      imageUrl: '/images/cover.jpg'
    }
  },

  onShareTimeline() {
    return {
      title: SHARE_TITLE,
      query: 'page=index',
      imageUrl: '/images/cover.jpg'
    }
  }
})
