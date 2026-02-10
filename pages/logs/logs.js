const app = getApp()

// 分享标题常量
const SHARE_TITLE = '风语纪<电波有痕，风语为纪> - 查看我的通联记录'

Page({
  data: {
    logs: [],
    filteredLogs: [],
    searchCallSign: '',
    startDate: '',
    endDate: '',
    searchExpanded: false
  },

  onLoad() {
    this.loadLogs()
  },

  onShow() {
    this.loadLogs()
  },

  loadLogs() {
    try {
      const logs = wx.getStorageSync('contactLogs') || []
      const formattedLogs = logs.map(log => {
        if (log.rst && !log.rst.myRst && !log.rst.theirRst) {
          var result = {}
          for (var key in log) {
            result[key] = log[key]
          }
          result.rst = {
            myRst: { r: log.rst.r || '', s: log.rst.s || '', t: log.rst.t || '' },
            theirRst: { r: '', s: '', t: '' }
          }
          return result
        }
        return log
      })
      this.setData({
        logs: formattedLogs,
        filteredLogs: formattedLogs
      })
    } catch (e) {
      console.error('加载日志失败', e)
      this.setData({
        logs: [],
        filteredLogs: []
      })
    }
  },

  onSearchCallSign(e) {
    this.setData({
      searchCallSign: e.detail.value.toUpperCase()
    })
  },

  onStartDateChange(e) {
    this.setData({
      startDate: e.detail.value
    })
  },

  onEndDateChange(e) {
    this.setData({
      endDate: e.detail.value
    })
  },

  handleSearch() {
    const logs = this.data.logs
    const searchCallSign = this.data.searchCallSign
    const startDate = this.data.startDate
    const endDate = this.data.endDate
    let filtered = logs

    if (searchCallSign) {
      filtered = filtered.filter(log => 
        log.callSign.toUpperCase().includes(searchCallSign.toUpperCase())
      )
    }

    if (startDate) {
      filtered = filtered.filter(log => log.date >= startDate)
    }

    if (endDate) {
      filtered = filtered.filter(log => log.date <= endDate)
    }

    this.setData({
      filteredLogs: filtered
    })

    if (filtered.length === 0) {
      wx.showToast({
        title: '未找到匹配的日志',
        icon: 'none'
      })
    }
  },

  handleReset() {
    this.setData({
      searchCallSign: '',
      startDate: '',
      endDate: '',
      filteredLogs: this.data.logs
    })
  },

  toggleSearch() {
    this.setData({
      searchExpanded: !this.data.searchExpanded
    })
  },

  getWeatherIcon(value) {
    const icons = {
      'sunny': '☀️',
      'cloudy': '⛅',
      'rainy': '🌧️',
      'stormy': '⛈️',
      'snowy': '❄️',
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

  viewLogDetail(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({
      url: '/pages/log-detail/log-detail?id=' + id
    })
  },

  onPullDownRefresh() {
    this.loadLogs()
    wx.stopPullDownRefresh()
  },

  onShareAppMessage() {
    return {
      title: SHARE_TITLE,
      path: '/pages/logs/logs',
      imageUrl: '/images/cover.jpg'
    }
  },

  onShareTimeline() {
    return {
      title: SHARE_TITLE,
      query: 'page=logs',
      imageUrl: '/images/cover.jpg'
    }
  }
})
