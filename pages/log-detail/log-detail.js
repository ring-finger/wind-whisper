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
    utcDateTimeFull: ''
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
        
        const weatherIcon = this.getWeatherIcon(log.weather)
        const weatherText = this.getWeatherText(log.weather)
        const bjtDateTimeFull = buildBjtDateTimeFull(log)
        const utcDateTimeFull = buildUtcDateTimeFull(log)

        this.setData({
          log: log,
          myRst: myRst,
          theirRst: theirRst,
          recordTime: recordTime,
          weatherIcon: weatherIcon,
          weatherText: weatherText,
          bjtDateTimeFull: bjtDateTimeFull,
          utcDateTimeFull: utcDateTimeFull
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

  deleteLog() {
    wx.vibrateShort({ type: VIBRATE_TYPE })
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