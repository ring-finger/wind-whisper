const app = getApp()
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

function formatRstBlock(rst) {
  if (!rst) return { my: '', their: '' }
  let my = ''
  let their = ''
  if (rst.myRst) {
    my = `${rst.myRst.r || ''}${rst.myRst.s || ''}${rst.myRst.t || ''}`
  } else if (rst.r || rst.s || rst.t) {
    my = `${rst.r || ''}${rst.s || ''}${rst.t || ''}`
  }
  if (rst.theirRst) {
    their = `${rst.theirRst.r || ''}${rst.theirRst.s || ''}${rst.theirRst.t || ''}`
  }
  return { my, their }
}

Page({
  data: {
    currentTab: 'list',
    filteredLogs: [],
    _allLogs: [],
    searchQuery: '',
    dateFrom: '',
    dateTo: '',
    searchExpanded: false,
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
    modes: ['SSB', 'CW', 'FM', 'AM', 'PSK31', 'FT8', 'RTTY', 'ATV'],
    callSuggestions: [],
    frequencySuggestions: [],
    isUHF: false,
    isVHF: false,
    rstPlusSelected: {
      myRst: false,
      theirRst: false
    },
    currentTheme: 'radio'
  },

  onLoad(options) {
    this.loadTheme()
    this.initDateTime()
    if (options && options.tab === 'add') {
      this.setData({ currentTab: 'add' })
    }
  },

  onShow() {
    this.loadTheme()
    if (this.data.currentTab === 'list') {
      this.loadLogs()
    }
    this.loadCallSuggestions()
  },

  loadTheme() {
    try {
      const savedTheme = wx.getStorageSync('appTheme') || 'radio'
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

  onPullDownRefresh() {
    if (this.data.currentTab === 'list') {
      this.loadLogs()
    }
    wx.stopPullDownRefresh()
  },

  switchTab(e) {
    const tab = e.currentTarget.dataset.tab
    wx.vibrateShort({ type: VIBRATE_TYPE })
    this.setData({ currentTab: tab })
    if (tab === 'list') {
      this.loadLogs()
    } else {
      this.initDateTime()
    }
  },

  initDateTime() {
    this.syncTimeFromInstant(Date.now())
  },

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
    const timeStr = currentTimeType === 'BJT' ? formData.bjcTime || '00:00' : formData.utcTime || '00:00'
    const ms = currentTimeType === 'BJT' ? instantFromBjt(cal, timeStr) : instantFromUtc(cal, timeStr)
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
    this.setData({ currentTimeType: type })
  },

  loadLogs() {
    try {
      const logs = wx.getStorageSync('contactLogs') || []
      this.setData({ _allLogs: logs })
      this.applyFilter(logs)
    } catch (e) {
      console.error(e)
      this.setData({ filteredLogs: [] })
    }
  },

  applyFilter(sourceLogs) {
    const logs = sourceLogs || this.data._allLogs || []
    let q = (this.data.searchQuery || '').trim().toUpperCase()
    const from = this.data.dateFrom
    const to = this.data.dateTo

    const filtered = logs.filter((log) => {
      if (q) {
        const cs = (log.callSign || '').toUpperCase()
        const freq = String(log.frequency || '')
        const mode = String(log.mode || '')
        if (!cs.includes(q) && !freq.includes(q) && !mode.toUpperCase().includes(q)) {
          return false
        }
      }
      const d = log.date || ''
      if (from && d && d < from) return false
      if (to && d && d > to) return false
      return true
    })

    const list = filtered.map((log) => {
      const { my, their } = formatRstBlock(log.rst)
      return {
        ...log,
        rstMy: my,
        rstTheir: their,
        rstSummary: [my, their].filter(Boolean).join(' / ')
      }
    })

    this.setData({ filteredLogs: list })
  },

  onSearchInput(e) {
    const searchQuery = e.detail.value
    this.setData({ searchQuery }, () => this.applyFilter())
  },

  onSearchConfirm() {
    this.applyFilter()
  },

  toggleSearchExpanded() {
    wx.vibrateShort({ type: VIBRATE_TYPE })
    this.setData({ searchExpanded: !this.data.searchExpanded })
  },

  onDateFromChange(e) {
    this.setData({ dateFrom: e.detail.value })
  },

  onDateToChange(e) {
    this.setData({ dateTo: e.detail.value })
  },

  onDateSearch() {
    wx.vibrateShort({ type: VIBRATE_TYPE })
    this.applyFilter()
  },

  onDateReset() {
    wx.vibrateShort({ type: VIBRATE_TYPE })
    this.setData({ dateFrom: '', dateTo: '' }, () => this.applyFilter())
  },

  openDetail(e) {
    const id = e.currentTarget.dataset.id
    wx.vibrateShort({ type: VIBRATE_TYPE })
    wx.navigateTo({
      url: '/pages/log-detail/log-detail?id=' + id
    })
  },

  onCallSignInput(e) {
    const value = e.detail.value.toUpperCase()
    if (value && /[^A-Z0-9]/.test(value)) {
      wx.showToast({ title: '呼号只能包含字母和数字', icon: 'none', duration: 2000 })
      return
    }
    this.setData({ 'formData.callSign': value })
    wx.vibrateShort({ type: VIBRATE_TYPE })
    if (value.length > 0) {
      this.filterCallSuggestions(value)
    } else {
      this.setData({ callSuggestions: [] })
    }
  },

  filterCallSuggestions(input) {
    const history = app.globalData.callHistory || []
    const filtered = history.filter(item => item.toUpperCase().includes(input.toUpperCase())).slice(0, 5)
    this.setData({ callSuggestions: filtered })
  },

  loadCallSuggestions() {
    const history = app.globalData.callHistory || []
    this.setData({ callSuggestions: history.slice(0, 5) })
  },

  selectCallSign(e) {
    const callSign = e.currentTarget.dataset.callsign
    this.setData({ 'formData.callSign': callSign, callSuggestions: [] })
    wx.vibrateShort({ type: VIBRATE_TYPE })
  },

  selectWeather(e) {
    const value = e.currentTarget.dataset.value
    const currentWeather = this.data.formData.weather
    const newWeather = currentWeather === value ? '' : value
    this.setData({ 'formData.weather': newWeather })
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
    this.setData({ 'formData.frequency': value })
    this.updateFrequencyRangeStatus(value)
    wx.vibrateShort({ type: VIBRATE_TYPE })
    if (value.length > 0) {
      this.filterFrequencySuggestions(value)
    } else {
      this.setData({ frequencySuggestions: [], isUHF: false, isVHF: false })
    }
  },

  filterFrequencySuggestions(input) {
    try {
      const logs = wx.getStorageSync('contactLogs') || []
      const frequencySet = new Set(logs.map(log => log.frequency).filter(f => f))
      const frequencies = Array.from(frequencySet)
      const filtered = frequencies.filter(freq => freq.includes(input)).slice(0, 5)
      this.setData({ frequencySuggestions: filtered })
    } catch (e) {
      console.error('加载频率历史失败', e)
    }
  },

  selectFrequency(e) {
    const frequency = e.currentTarget.dataset.frequency
    this.setData({ 'formData.frequency': frequency, frequencySuggestions: [] })
    this.updateFrequencyRangeStatus(frequency)
    wx.vibrateShort({ type: VIBRATE_TYPE })
  },

  updateFrequencyRangeStatus(frequency) {
    const freq = parseFloat(frequency)
    const isUHF = !isNaN(freq) && freq >= 300 && freq <= 3000
    const isVHF = !isNaN(freq) && freq >= 30 && freq < 300
    this.setData({ isUHF: isUHF, isVHF: isVHF })
  },

  selectMode(e) {
    const mode = e.currentTarget.dataset.mode
    const currentMode = this.data.formData.mode
    const newMode = currentMode === mode ? '' : mode
    this.setData({ 'formData.mode': newMode })
    wx.vibrateShort({ type: VIBRATE_TYPE })
  },

  onRstInput(e) {
    wx.vibrateShort({ type: VIBRATE_TYPE })
    const { formData } = this.data
    const type = e.currentTarget.dataset.type
    const field = e.currentTarget.dataset.field
    let value = e.detail.value

    if (value.length > 1) {
      value = value.slice(-1)
    }

    if (field === 'r') {
      const num = parseInt(value, 10)
      if (isNaN(num) || num < 1 || num > 5) {
        value = ''
      }
    } else if (field === 's') {
      const num = parseInt(value, 10)
      if (isNaN(num) || num < 1 || num > 9) {
        value = ''
      }
    }

    const rst = {
      myRst: { ...formData.rst.myRst },
      theirRst: { ...formData.rst.theirRst }
    }
    const cur = { ...rst[type] }
    cur[field] = value
    rst[type] = cur
    this.setData({ 'formData.rst': rst })
  },

  onQthInput(e) {
    this.setData({ 'formData.qth': e.detail.value })
    wx.vibrateShort({ type: VIBRATE_TYPE })
  },

  onPowerInput(e) {
    this.setData({ 'formData.power': e.detail.value })
    wx.vibrateShort({ type: VIBRATE_TYPE })
  },

  onEquipmentInput(e) {
    this.setData({ 'formData.equipment': e.detail.value })
    wx.vibrateShort({ type: VIBRATE_TYPE })
  },

  onAntennaInput(e) {
    this.setData({ 'formData.antenna': e.detail.value })
    wx.vibrateShort({ type: VIBRATE_TYPE })
  },

  onNotesInput(e) {
    this.setData({ 'formData.notes': e.detail.value })
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
      wx.showToast({ title: '请输入呼号', icon: 'none' })
      return
    }

    if (!formData.frequency) {
      wx.showToast({ title: '请输入频率', icon: 'none' })
      return
    }

    if (!formData.mode) {
      wx.showToast({ title: '请选择工作模式', icon: 'none' })
      return
    }

    if (!formData.rst.myRst.r || !formData.rst.myRst.s) {
      wx.showToast({ title: '请填写己方信号报告RS', icon: 'none' })
      return
    }

    if (!formData.rst.theirRst.r || !formData.rst.theirRst.s) {
      wx.showToast({ title: '请填写对方信号报告RS', icon: 'none' })
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
    wx.showToast({ title: '保存成功', icon: 'success' })

    this.resetForm()
    this.switchTab({ currentTarget: { dataset: { tab: 'list' } } })
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
      wx.showToast({ title: '保存失败', icon: 'none' })
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
  }
})
