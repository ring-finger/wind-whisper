Page({
  data: {
    url: ''
  },

  onLoad(options) {
    if (options.url) {
      this.setData({
        url: decodeURIComponent(options.url)
      })
    }
  },

  onError(e) {
    console.error('Web-view error:', e)
    wx.showToast({
      title: '加载失败，请重试',
      icon: 'none'
    })
  }
})
