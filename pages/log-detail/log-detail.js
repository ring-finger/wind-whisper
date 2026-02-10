const app = getApp()

// 分享标题常量
const SHARE_TITLE_PREFIX = '风语纪: '

Page({
  data: {
    log: null,
    myRst: '',
    theirRst: ''
  },

  onLoad(options) {
    const logId = parseInt(options.id)
    this.loadLogDetail(logId)
  },

  onShow() {
    if (this.data.log) {
      this.loadLogDetail(this.data.log.id)
    }
  },

  loadLogDetail(logId) {
    try {
      const logs = wx.getStorageSync('contactLogs') || []
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
        
        // 计算天气图标和文本
        const weatherIcon = this.getWeatherIcon(log.weather)
        const weatherText = this.getWeatherText(log.weather)
        
        this.setData({
          log: log,
          myRst: myRst,
          theirRst: theirRst,
          recordTime: recordTime,
          weatherIcon: weatherIcon,
          weatherText: weatherText
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

  deleteLog() {
    wx.showModal({
      title: '确认删除',
      content: '确定要删除这条日志吗？此操作不可恢复。',
      confirmColor: '#ff4d4f',
      success: (res) => {
        if (res.confirm) {
          try {
            let logs = wx.getStorageSync('contactLogs') || []
            logs = logs.filter(item => item.id !== this.data.log.id)
            wx.setStorageSync('contactLogs', logs)
            
            wx.showToast({
              title: '删除成功',
              icon: 'success'
            })
            
            setTimeout(() => {
              wx.navigateBack()
            }, 1500)
          } catch (e) {
            console.error('删除日志失败', e)
            wx.showToast({
              title: '删除失败',
              icon: 'none'
            })
          }
        }
      }
    })
  },

  onShareAppMessage() {
    return {
      title: SHARE_TITLE_PREFIX + this.data.log.callSign,
      path: '/pages/logs/logs',
      imageUrl: '/images/cover.jpg'
    }
  },

  onShareTimeline() {
    return {
      title: SHARE_TITLE_PREFIX + this.data.log.callSign,
      query: `page=log-detail&id=${this.data.log.id}`,
      imageUrl: '/images/cover.jpg'
    }
  }
})