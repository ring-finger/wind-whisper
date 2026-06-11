const app = getApp()
const db = require('../../utils/db')

const SHARE_TITLE = '风语纪 电波有痕,风语为纪 - 记录您的每一次通联'
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
    currentTheme: 'radio',
    // 通联统计
    statsTab: 'personal',
    personalMonths: [],
    rankPeriod: 'month',
    rankList: [],
    rankLoading: false
  },

  /** 统一获取 contactLogs，使用内存缓存避免重复同步读取 */
  _getContactLogsFromCache() {
    if (this._cache.contactLogs === null) {
      this._cache.contactLogs = wx.getStorageSync('contactLogs') || []
    }
    return this._cache.contactLogs
  },

  /** 更新 contactLogs 并同步到 Storage 和缓存 */
  _updateContactLogsCache(logs) {
    this._cache.contactLogs = logs
    wx.setStorageSync('contactLogs', logs)
  },

  onLoad() {
    this._cache = {
      appTheme: null,
      myCallSign: null,
      wxMineAvatarUrl: null,
      wxMineNickName: null,
      contactLogs: null,
      personalStatsSig: null
    }

    this.loadTheme()
    this.loadUserInfo()
    this.loadStats()
    this.loadPersonalStats()
  },

  onShow() {
    this._cache.contactLogs = null
    this._cache.appTheme = null
    this._cache.myCallSign = null
    this._cache.wxMineAvatarUrl = null
    this._cache.wxMineNickName = null
    this.loadTheme()
    this.loadUserInfo()
    this.loadStats()
    this.loadPersonalStats()
    this.loadPlatformStats()
    this._syncStatsToCloud()
  },

  loadTheme() {
    try {
      if (this._cache.appTheme === null) {
        this._cache.appTheme = wx.getStorageSync('appTheme') || 'radio'
      }
      const savedTheme = this._cache.appTheme
      this.setData({ currentTheme: savedTheme })
      const themeConfig = app.THEMES[savedTheme] || app.THEMES.radio
      wx.setNavigationBarColor({
        frontColor: themeConfig.navText,
        backgroundColor: themeConfig.navBg,
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
      if (this._cache.myCallSign === null) {
        this._cache.myCallSign = wx.getStorageSync('myCallSign') || ''
      }
      if (this._cache.wxMineAvatarUrl === null) {
        const stored = wx.getStorageSync('wxMineAvatarUrl') || ''
        // 校验头像文件是否存在，避免引用已删除的旧路径
        if (stored) {
          try {
            wx.getFileSystemManager().accessSync(stored)
          } catch (e) {
            wx.removeStorageSync('wxMineAvatarUrl')
            this._cache.wxMineAvatarUrl = ''
            return this.setData({ userAvatarUrl: '' })
          }
        }
        this._cache.wxMineAvatarUrl = stored
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

  goToMaidenhead() {
    wx.vibrateShort({ type: VIBRATE_TYPE })
    wx.navigateTo({
      url: '/pages/maidenhead/maidenhead'
    })
  },

  goToAllLogs() {
    wx.vibrateShort({ type: VIBRATE_TYPE })
    wx.switchTab({
      url: '/pages/logs/logs'
    })
  },

  /** 跳转到今日通联日志 */
  goToTodayLogs() {
    wx.vibrateShort({ type: VIBRATE_TYPE })
    wx.navigateTo({
      url: '/pages/logs/logs?filter=today'
    })
  },

  /** 跳转到本周通联日志 */
  goToWeekLogs() {
    wx.vibrateShort({ type: VIBRATE_TYPE })
    wx.navigateTo({
      url: '/pages/logs/logs?filter=week'
    })
  },

  /** 跳转到本月通联日志 */
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

  /**
   * 将聚合后的每月通联数量同步到云端，供后续多维图表使用
   */
  _syncStatsToCloud() {
    try {
      const logs = this._getContactLogsFromCache()
      db.syncStatsFromLocalLogs(logs)
      // 触发云端排行榜重建（fire-and-forget，不阻塞 UI）
      db.triggerRebuildRankings()
    } catch (e) {
      console.error('同步统计到云端失败', e)
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

  // ==================== 通联统计 ====================

  /** 切换个人维度 / 平台维度 */
  switchStatsTab(e) {
    const tab = e.currentTarget.dataset.tab
    if (this.data.statsTab === tab) return
    this.setData({ statsTab: tab })
    if (tab === 'platform') {
      this.loadPlatformStats()
    }
  },

  /** 切换当月排行 / 当年排行 */
  switchRankPeriod(e) {
    const period = e.currentTarget.dataset.period
    if (this.data.rankPeriod === period) return
    this.setData({ rankPeriod: period, rankList: [], rankLoading: true })
    this.loadPlatformStats()
  },

  /** 个人维度：近6个月迷你柱状图（带缓存，避免重复计算） */
  loadPersonalStats() {
    try {
      const logs = this._getContactLogsFromCache()

      // 计算数据签名（总数 + 最大时间戳），签名不变则跳过计算
      let maxTs = 0
      logs.forEach(log => {
        const t = this.getLogTime(log)
        if (t && t > maxTs) maxTs = t
      })
      const sig = logs.length + '_' + maxTs
      if (sig === this._cache.personalStatsSig) return
      this._cache.personalStatsSig = sig

      const now = new Date()
      const months = []

      // 生成最近6个月（含当月），label 使用纯数字避免编码问题
      for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
        const y = d.getFullYear()
        const m = d.getMonth() + 1
        months.push({
          year: y,
          month: m,
          label: (m < 10 ? '0' + m : '' + m) + '\u6708',
          monthKey: y + '-' + (m < 10 ? '0' + m : m),
          count: 0
        })
      }

      // 统计每个月的通联数
      logs.forEach(log => {
        const t = this.getLogTime(log)
        if (!t) return
        const logDate = new Date(t)
        const logYear = logDate.getFullYear()
        const logMonth = logDate.getMonth() + 1
        const m = months.find(item => item.year === logYear && item.month === logMonth)
        if (m) m.count++
      })

      const maxCount = Math.max(1, ...months.map(m => m.count))

      const personalMonths = months.map(item => ({
        ...item,
        percent: Math.round((item.count / maxCount) * 100)
      }))

      // 汇总统计：近6个月 / 今年 / 总共
      const personalTotal6 = months.reduce((s, m) => s + m.count, 0)
      const thisYear = now.getFullYear()
      let totalThisYear = 0
      logs.forEach(log => {
        const t = this.getLogTime(log)
        if (t && new Date(t).getFullYear() === thisYear) totalThisYear++
      })
      const totalAll = logs.length

      this.setData({ personalMonths, personalTotal6, totalThisYear, totalAll })
    } catch (e) {
      console.error('加载个人统计失败', e)
    }
  },

  /** 点击柱状图查看月度详情 */
  onBarTap(e) {
    const { year, month, count } = e.currentTarget.dataset
    if (!count) return
    const m = month < 10 ? '0' + month : '' + month
    wx.showModal({
      title: '通联详情',
      content: year + '年' + m + '月，你通联了' + count + '次',
      showCancel: false,
      confirmText: '知道了'
    })
  },

  /** 平台维度：通联排行榜 */
  loadPlatformStats() {
    const now = new Date()
    const year = now.getFullYear()
    const month = this.data.rankPeriod === 'month' ? (now.getMonth() + 1) : null

    this.setData({ rankLoading: true })
    db.getPlatformStats(year, month).then(list => {
      this.setData({ rankList: list, rankLoading: false })
    }).catch(() => {
      this.setData({ rankList: [], rankLoading: false })
    })
  },

  // ==================== 通联统计结束 ====================

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
      path: '/pages/index/index',
      imageUrl: '/images/cover.jpg'
    }
  }
})
