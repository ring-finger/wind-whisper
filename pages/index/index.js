const app = getApp()

// 分享标题常量
const SHARE_TITLE = '风语纪<电波有痕，风语为纪> - 记录您的每一次通联'
// 振动类型常量
const VIBRATE_TYPE = 'medium'

Page({
  data: {
    formData: {
      date: '',
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
      { icon: '☀️', value: 'sunny' },
      { icon: '⛅', value: 'cloudy' },
      { icon: '🌧️', value: 'rainy' },
      { icon: '⛈️', value: 'stormy' },
      { icon: '❄️', value: 'snowy' },
      { icon: '🌫️', value: 'foggy' },
      { icon: '💨', value: 'windy' },
      { icon: '🌙', value: 'night' }
    ],
    modes: ['SSB', 'CW', 'FM', 'AM', 'PSK31', 'FT8', 'RTTY', 'SSTV', 'ATV'],
    callSuggestions: [],
    frequencySuggestions: [],
    inputFocus: {
      myRstR: false,
      myRstS: false,
      myRstT: false,
      theirRstR: false,
      theirRstS: false,
      theirRstT: false
    },
    // 频率范围判断状态
    isUHF: false, // 300-3000MHz
    isVHF: false, // 30-300MHz
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
    const now = new Date()
    const date = this.formatDate(now)
    const bjcTime = this.formatTime(now)
    const utcTime = this.formatUTCTime(now)

    this.setData({
      'formData.date': date,
      'formData.bjcTime': bjcTime,
      'formData.utcTime': utcTime
    })
  },

  formatDate(date) {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  },

  formatTime(date) {
    const hours = String(date.getHours()).padStart(2, '0')
    const minutes = String(date.getMinutes()).padStart(2, '0')
    return `${hours}:${minutes}`
  },

  formatUTCTime(date) {
    const hours = String(date.getUTCHours()).padStart(2, '0')
    const minutes = String(date.getUTCMinutes()).padStart(2, '0')
    return `${hours}:${minutes}`
  },

  onDateChange(e) {
    this.setData({
      'formData.date': e.detail.value
    })
  },

  onBjcTimeChange(e) {
    this.setData({
      'formData.bjcTime': e.detail.value
    })
  },

  onUtcTimeChange(e) {
    this.setData({
      'formData.utcTime': e.detail.value
    })
  },

  refreshTime() {
    const now = new Date()
    const bjcTime = this.formatTime(now)
    const utcTime = this.formatUTCTime(now)
    this.setData({
      'formData.bjcTime': bjcTime,
      'formData.utcTime': utcTime
    })
  },

  toggleTimeType() {
    const newTimeType = this.data.currentTimeType === 'BJT' ? 'UTC' : 'BJT'
    this.setData({
      currentTimeType: newTimeType
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
    
    // 调用频率范围判断逻辑，更新RST显示方式
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
    
    // 调用频率范围判断逻辑，更新RST显示方式
    this.updateFrequencyRangeStatus(frequency)
    
    wx.vibrateShort({ type: VIBRATE_TYPE })
  },
  
  // 更新频率范围状态
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

  onRstInput(e) {
    const type = e.currentTarget.dataset.type
    const field = e.currentTarget.dataset.field
    let value = e.detail.value
    
    if (field === 't') {
      if (this.data.isVHF) {
        // VHF模式：只允许输入1-9的数字
        value = value.replace(/[^\d]/g, '')
        if (value > 9) value = '9'
      } else if (this.data.isUHF) {
        // UHF模式：不处理输入，通过+号选中状态控制
        return
      } else {
        // 其他情况：允许输入数字和+号
        value = value.replace(/[^\d+]/g, '')
        // 限制为1位数字或+号
        if (value.length > 1) {
          // 如果是'+'号，只保留'+'
          if (value.includes('+')) {
            value = '+'
          } else {
            // 否则只保留第一位数字
            value = value[0]
          }
        }
      }
    } else {
      // 其他字段只允许数字
      value = value.replace(/[^\d]/g, '')
      if (field === 'r' && value > 5) value = '5'
      if (field === 's' && value > 9) value = '9'
    }
    
    const dataKey = 'formData.rst.' + type + '.' + field
    const data = {}
    data[dataKey] = value
    this.setData(data)
    
    wx.vibrateShort({ type: VIBRATE_TYPE })
    
    if (value.length >= 1) {
      if (field === 'r') {
        this.focusNextInput(type, 's')
      } else if (field === 's') {
        this.focusNextInput(type, 't')
      } else if (field === 't' && type === 'myRst' && value !== '+') {
        // 如果最后一项不是'+'，则聚焦到下一个RST的第一个输入框
        this.focusNextInput('theirRst', 'r')
      }
    }
  },
  
  // 切换RST+号选中状态
  toggleRstPlus(e) {
    const type = e.currentTarget.dataset.type
    const isSelected = this.data.rstPlusSelected[type]
    const data = {}
    data['rstPlusSelected.' + type] = !isSelected
    
    // 更新T字段的值
    const tDataKey = 'formData.rst.' + type + '.t'
    data[tDataKey] = !isSelected ? '+' : ''
    
    this.setData(data)
    wx.vibrateShort({ type: VIBRATE_TYPE })
  },

  focusNextInput(type, nextField) {
    const nextFieldFocusKey = 'inputFocus.' + type + this.getFieldUpper(nextField)
    
    const data = {}
    data['inputFocus.myRstR'] = false
    data['inputFocus.myRstS'] = false
    data['inputFocus.myRstT'] = false
    data['inputFocus.theirRstR'] = false
    data['inputFocus.theirRstS'] = false
    data['inputFocus.theirRstT'] = false
    data[nextFieldFocusKey] = true
    this.setData(data)
  },

  getFieldUpper(field) {
    if (field === 'r') return 'R'
    if (field === 's') return 'S'
    if (field === 't') return 'T'
    return ''
  },

  onRstFocus(e) {
    const inputId = e.currentTarget.id
    const dataKey = 'inputFocus.' + inputId
    const data = {}
    data[dataKey] = true
    this.setData(data)
  },

  onRstBlur(e) {
    const inputId = e.currentTarget.id
    const dataKey = 'inputFocus.' + inputId
    const data = {}
    data[dataKey] = false
    this.setData(data)
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
    const formData = this.data.formData

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

    // 验证己方RST
    if (!formData.rst.myRst.r || !formData.rst.myRst.s) {
      wx.showToast({
        title: '请填写己方信号报告RS',
        icon: 'none'
      })
      return
    }

    // 验证对方RST
    if (!formData.rst.theirRst.r || !formData.rst.theirRst.s) {
      wx.showToast({
        title: '请填写对方信号报告RS',
        icon: 'none'
      })
      return
    }

    if (!formData.utcTime) {
      const now = new Date()
      const utcTime = this.formatUTCTime(now)
      this.setData({
        'formData.utcTime': utcTime
      })
      formData.utcTime = utcTime
    }

    if (!formData.bjcTime) {
      const now = new Date()
      const bjcTime = this.formatTime(now)
      this.setData({
        'formData.bjcTime': bjcTime
      })
      formData.bjcTime = bjcTime
    }

    var log = {}
    for (var key in formData) {
      log[key] = formData[key]
    }
    log.btcTime = formData.bjcTime
    log.id = Date.now()
    log.createdAt = new Date().toISOString()

    this.saveLog(log)
    app.saveCallHistory(formData.callSign)

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
      inputFocus: {
        myRstR: false,
        myRstS: false,
        myRstT: false,
        theirRstR: false,
        theirRstS: false,
        theirRstT: false
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
