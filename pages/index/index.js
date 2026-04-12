const app = getApp()

const SHARE_TITLE = '风语纪<电波有痕，风语为纪> - 记录您的每一次通联'
const VIBRATE_TYPE = 'medium'

const BJT_OFFSET_MS = 8 * 60 * 60 * 1000

function pad2(n) {
  return String(n).padStart(2, '0')
}

function ymdFromParts(y, m, day) {
  return `${y}-${pad2(m)}-${pad2(day)}`
}

function hmFromParts(h, min) {
  return `${pad2(h)}:${pad2(min)}`
}

/** BJT 墙钟分量（与存储 log.date / bjcTime 一致） */
function bjtWallFromInstant(ms) {
  const wd = new Date(ms + BJT_OFFSET_MS)
  return {
    y: wd.getUTCFullYear(),
    m: wd.getUTCMonth() + 1,
    day: wd.getUTCDate(),
    h: wd.getUTCHours(),
    min: wd.getUTCMinutes()
  }
}

function utcWallFromInstant(ms) {
  const wd = new Date(ms)
  return {
    y: wd.getUTCFullYear(),
    m: wd.getUTCMonth() + 1,
    day: wd.getUTCDate(),
    h: wd.getUTCHours(),
    min: wd.getUTCMinutes()
  }
}

function instantFromBjt(dateStr, timeStr) {
  if (!dateStr || !timeStr) return null
  const t = new Date(`${dateStr}T${timeStr}:00+08:00`).getTime()
  return isNaN(t) ? null : t
}

function instantFromUtc(dateStr, timeStr) {
  if (!dateStr || !timeStr) return null
  const t = new Date(`${dateStr}T${timeStr}:00Z`).getTime()
  return isNaN(t) ? null : t
}

/** 与界面、落库字段一致的时间快照（不含 utcDate） */
function buildTimeFields(ms) {
  const b = bjtWallFromInstant(ms)
  const u = utcWallFromInstant(ms)
  return {
    contactInstantMs: ms,
    date: ymdFromParts(b.y, b.m, b.day),
    utcDate: ymdFromParts(u.y, u.m, u.day),
    bjcTime: hmFromParts(b.h, b.min),
    utcTime: hmFromParts(u.h, u.min)
  }
}

Page({
  data: {
    contactInstantMs: 0,
    formData: {
      date: '',
      utcDate: '',
      bjcTime: '',
      utcTime: '',
      callSign: '',
      weather: '',
      frequency: '',
      mode: '',
      equipment: '',
      antenna: '',
      rst: {
        myRst: { r: '', s: '', t: '' },
        theirRst: { r: '', s: '', t: '' }
      },
      qth: '',
      power: '',
      notes: ''
    },
    currentTimeType: 'BJT',
    weatherIcons: [
      { emoji: '☀️', label: '晴', value: 'sunny' },
      { emoji: '⛅', label: '多云', value: 'cloudy' },
      { emoji: '🌧️', label: '雨', value: 'rainy' },
      { emoji: '⛈️', label: '雷雨', value: 'stormy' },
      { emoji: '🌨️', label: '雪', value: 'snowy' },
      { emoji: '🌫️', label: '雾', value: 'foggy' },
      { emoji: '💨', label: '大风', value: 'windy' },
      { emoji: '🌙', label: '夜间', value: 'night' }
    ],
    modes: ['SSB', 'CW', 'FM', 'AM', 'PSK31', 'FT8', 'RTTY', 'SSTV', 'ATV'],
    callSuggestions: [],
    frequencySuggestions: [],
    isUHF: false,
    isVHF: false,
    rstPlusSelected: {
      myRst: false,
      theirRst: false
    }
  },

  onLoad() {
    this.initDateTime()
  },

  onShow() {
    this.loadCallSuggestions()
  },

  initDateTime() {
    this.syncTimeFromInstant(Date.now())
  },

  /** 由绝对时刻同步 BJT/UTC 的日期与时间（单一真相） */
  syncTimeFromInstant(ms) {
    const t = buildTimeFields(ms)
    this.setData({
      contactInstantMs: t.contactInstantMs,
      'formData.date': t.date,
      'formData.utcDate': t.utcDate,
      'formData.bjcTime': t.bjcTime,
      'formData.utcTime': t.utcTime
    })
  },

  onDateChange(e) {
    wx.vibrateShort({ type: VIBRATE_TYPE })
    const cal = e.detail.value
    const { currentTimeType, formData } = this.data
    const timeStr =
      currentTimeType === 'BJT'
        ? formData.bjcTime || '00:00'
        : formData.utcTime || '00:00'
    const ms =
      currentTimeType === 'BJT'
        ? instantFromBjt(cal, timeStr)
        : instantFromUtc(cal, timeStr)
    if (ms == null) return
    this.syncTimeFromInstant(ms)
  },

  onBjcTimeChange(e) {
    wx.vibrateShort({ type: VIBRATE_TYPE })
    const { formData } = this.data
    const ms = instantFromBjt(formData.date, e.detail.value)
    if (ms == null) return
    this.syncTimeFromInstant(ms)
  },

  onUtcTimeChange(e) {
    wx.vibrateShort({ type: VIBRATE_TYPE })
    const { formData } = this.data
    const ms = instantFromUtc(formData.utcDate, e.detail.value)
    if (ms == null) return
    this.syncTimeFromInstant(ms)
  },

  refreshTime() {
    wx.vibrateShort({ type: VIBRATE_TYPE })
    this.syncTimeFromInstant(Date.now())
  },

  setTimeType(e) {
    const type = e.currentTarget.dataset.type
    if (!type || this.data.currentTimeType === type) return
    wx.vibrateShort({ type: VIBRATE_TYPE })
    this.setData({
      currentTimeType: type
    })
  },

  onCallSignInput(e) {
    const value = e.detail.value.toUpperCase()

    if (value && /[^A-Z0-9]/.test(value)) {
      wx.showToast({
        title: '呼号只能包含字母和数字',
        icon: 'none',
        duration: 2000
      })
      return
    }

    this.setData({
      'formData.callSign': value
    })

    wx.vibrateShort({ type: VIBRATE_TYPE })

    if (value.length > 0) {
      this.filterCallSuggestions(value)
    } else {
      this.setData({
        callSuggestions: []
      })
    }
  },

  filterCallSuggestions(input) {
    const history = app.globalData.callHistory || []
    const filtered = history.filter(item =>
      item.toUpperCase().includes(input.toUpperCase())
    ).slice(0, 5)

    this.setData({
      callSuggestions: filtered
    })
  },

  loadCallSuggestions() {
    const history = app.globalData.callHistory || []
    this.setData({
      callSuggestions: history.slice(0, 5)
    })
  },

  selectCallSign(e) {
    const callSign = e.currentTarget.dataset.callsign
    this.setData({
      'formData.callSign': callSign,
      callSuggestions: []
    })
    wx.vibrateShort({ type: VIBRATE_TYPE })
  },

  selectWeather(e) {
    const value = e.currentTarget.dataset.value
    const currentWeather = this.data.formData.weather
    const newWeather = currentWeather === value ? '' : value
    this.setData({
      'formData.weather': newWeather
    })
    wx.vibrateShort({ type: VIBRATE_TYPE })
  },

  onFrequencyInput(e) {
    let value = e.detail.value
    value = value.replace(/[^\d.]/g, '')
    const parts = value.split('.')
    if (parts.length > 2) {
      value = parts[0] + '.' + parts.slice(1).join('')
    }
    if (parts[1] && parts[1].length > 3) {
      value = parts[0] + '.' + parts[1].substring(0, 3)
    }

    this.setData({
      'formData.frequency': value
    })

    this.updateFrequencyRangeStatus(value)

    wx.vibrateShort({ type: VIBRATE_TYPE })

    if (value.length > 0) {
      this.filterFrequencySuggestions(value)
    } else {
      this.setData({
        frequencySuggestions: [],
        isUHF: false,
        isVHF: false
      })
    }
  },

  filterFrequencySuggestions(input) {
    try {
      const logs = wx.getStorageSync('contactLogs') || []
      const frequencySet = new Set(logs.map(log => log.frequency).filter(f => f))
      const frequencies = Array.from(frequencySet)
      const filtered = frequencies.filter(freq =>
        freq.includes(input)
      ).slice(0, 5)

      this.setData({
        frequencySuggestions: filtered
      })
    } catch (e) {
      console.error('加载频率历史失败', e)
    }
  },

  selectFrequency(e) {
    const frequency = e.currentTarget.dataset.frequency
    this.setData({
      'formData.frequency': frequency,
      frequencySuggestions: []
    })

    this.updateFrequencyRangeStatus(frequency)

    wx.vibrateShort({ type: VIBRATE_TYPE })
  },

  updateFrequencyRangeStatus(frequency) {
    const freq = parseFloat(frequency)
    const isUHF = !isNaN(freq) && freq >= 300 && freq <= 3000
    const isVHF = !isNaN(freq) && freq >= 30 && freq < 300

    this.setData({
      isUHF: isUHF,
      isVHF: isVHF
    })
  },

  selectMode(e) {
    const mode = e.currentTarget.dataset.mode
    const currentMode = this.data.formData.mode
    const newMode = currentMode === mode ? '' : mode
    this.setData({
      'formData.mode': newMode
    })
    wx.vibrateShort({ type: VIBRATE_TYPE })
  },

  onEquipmentInput(e) {
    this.setData({
      'formData.equipment': e.detail.value
    })
    wx.vibrateShort({ type: VIBRATE_TYPE })
  },

  onAntennaInput(e) {
    this.setData({
      'formData.antenna': e.detail.value
    })
    wx.vibrateShort({ type: VIBRATE_TYPE })
  },

  stepRst(e) {
    wx.vibrateShort({ type: VIBRATE_TYPE })
    const type = e.currentTarget.dataset.type
    const field = e.currentTarget.dataset.field
    const delta = parseInt(e.currentTarget.dataset.delta, 10) || 0
    const { isUHF, isVHF, formData } = this.data

    if (field === 't' && isUHF) return

    const rst = {
      myRst: { ...formData.rst.myRst },
      theirRst: { ...formData.rst.theirRst }
    }
    const cur = { ...rst[type] }

    if (field === 'r') {
      const n = cur.r === '' ? 0 : parseInt(cur.r, 10)
      let next = n
      if (delta > 0) {
        next = n < 1 ? 1 : Math.min(5, n + 1)
      } else {
        next = n <= 1 ? 0 : n - 1
      }
      cur.r = next === 0 ? '' : String(next)
    } else if (field === 's') {
      const n = cur.s === '' ? 0 : parseInt(cur.s, 10)
      let next = n
      if (delta > 0) {
        next = n < 1 ? 1 : Math.min(9, n + 1)
      } else {
        next = n <= 1 ? 0 : n - 1
      }
      cur.s = next === 0 ? '' : String(next)
    } else if (field === 't' && isVHF) {
      const n = cur.t === '' ? 0 : parseInt(cur.t, 10)
      let next = n
      if (delta > 0) {
        next = n < 1 ? 1 : Math.min(9, n + 1)
      } else {
        next = n <= 1 ? 0 : n - 1
      }
      cur.t = next === 0 ? '' : String(next)
    } else if (field === 't' && !isUHF) {
      const order = ['', '1', '2', '3', '4', '5', '6', '7', '8', '9', '+']
      let idx = order.indexOf(cur.t)
      if (idx < 0) idx = 0
      idx = (idx + delta + order.length) % order.length
      cur.t = order[idx]
    }

    if (isUHF && (cur.r !== '5' || cur.s !== '9')) {
      cur.t = ''
    }

    rst[type] = cur

    const patch = { 'formData.rst': rst }
    if (isUHF && (cur.r !== '5' || cur.s !== '9')) {
      patch['rstPlusSelected.' + type] = false
    }

    this.setData(patch)
  },

  toggleRstPlus(e) {
    const type = e.currentTarget.dataset.type
    const isSelected = this.data.rstPlusSelected[type]
    const data = {}
    data['rstPlusSelected.' + type] = !isSelected

    const tDataKey = 'formData.rst.' + type + '.t'
    data[tDataKey] = !isSelected ? '+' : ''

    this.setData(data)
    wx.vibrateShort({ type: VIBRATE_TYPE })
  },

  onQthInput(e) {
    this.setData({
      'formData.qth': e.detail.value
    })
    wx.vibrateShort({ type: VIBRATE_TYPE })
  },

  onPowerInput(e) {
    this.setData({
      'formData.power': e.detail.value
    })
    wx.vibrateShort({ type: VIBRATE_TYPE })
  },

  onNotesInput(e) {
    this.setData({
      'formData.notes': e.detail.value
    })
    wx.vibrateShort({ type: VIBRATE_TYPE })
  },

  submitLog() {
    const ms = this.data.contactInstantMs || Date.now()
    const timeSnap = buildTimeFields(ms)
    const formData = {
      ...this.data.formData,
      date: timeSnap.date,
      utcDate: timeSnap.utcDate,
      bjcTime: timeSnap.bjcTime,
      utcTime: timeSnap.utcTime
    }

    if (!formData.callSign) {
      wx.showToast({
        title: '请输入呼号',
        icon: 'none'
      })
      return
    }

    if (!formData.frequency) {
      wx.showToast({
        title: '请输入频率',
        icon: 'none'
      })
      return
    }

    if (!formData.mode) {
      wx.showToast({
        title: '请选择工作模式',
        icon: 'none'
      })
      return
    }

    if (!formData.rst.myRst.r || !formData.rst.myRst.s) {
      wx.showToast({
        title: '请填写己方信号报告RS',
        icon: 'none'
      })
      return
    }

    if (!formData.rst.theirRst.r || !formData.rst.theirRst.s) {
      wx.showToast({
        title: '请填写对方信号报告RS',
        icon: 'none'
      })
      return
    }

    var log = {}
    for (var key in formData) {
      if (key === 'utcDate') continue
      log[key] = formData[key]
    }
    log.btcTime = formData.bjcTime
    log.id = Date.now()
    log.createdAt = new Date().toISOString()

    this.saveLog(log)
    app.saveCallHistory(formData.callSign)

    wx.vibrateShort({ type: VIBRATE_TYPE })
    wx.showToast({
      title: '保存成功',
      icon: 'success'
    })

    this.resetForm()
  },

  saveLog(log) {
    try {
      let logs = wx.getStorageSync('contactLogs') || []
      logs.unshift(log)
      if (logs.length > 1000) {
        logs = logs.slice(0, 1000)
      }
      wx.setStorageSync('contactLogs', logs)
    } catch (e) {
      console.error('保存日志失败', e)
      wx.showToast({
        title: '保存失败',
        icon: 'none'
      })
    }
  },

  resetForm() {
    this.initDateTime()
    this.setData({
      currentTimeType: 'BJT',
      'formData.callSign': '',
      'formData.weather': '',
      'formData.frequency': '',
      'formData.mode': '',
      'formData.equipment': '',
      'formData.antenna': '',
      'formData.rst': {
        myRst: { r: '', s: '', t: '' },
        theirRst: { r: '', s: '', t: '' }
      },
      'formData.qth': '',
      'formData.power': '',
      'formData.notes': '',
      callSuggestions: [],
      frequencySuggestions: [],
      isUHF: false,
      isVHF: false,
      rstPlusSelected: {
        myRst: false,
        theirRst: false
      }
    })
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
