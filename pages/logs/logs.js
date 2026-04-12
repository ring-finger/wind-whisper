const VIBRATE_TYPE = 'medium'

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
    filteredLogs: [],
    _allLogs: [],
    searchQuery: '',
    dateFrom: '',
    dateTo: '',
    searchExpanded: false
  },

  onShow() {
    this.loadLogs()
  },

  onPullDownRefresh() {
    this.loadLogs()
    wx.stopPullDownRefresh()
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
    this.setData({
      searchExpanded: !this.data.searchExpanded
    })
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
  }
})
