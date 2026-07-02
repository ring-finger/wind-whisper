Page({
  data: {
    url: ''
  },

  onLoad(options) {
    if (options.url) {
      const decodedUrl = decodeURIComponent(options.url)
      console.log('web-view 加载 URL:', decodedUrl)
      this.setData({ url: decodedUrl })
    }
  },

  onLoadSuccess(e) {
    console.log('web-view 加载成功:', this.data.url)
  },

  onError(e) {
    console.error('=== web-view 加载失败 ===')
    console.error('当前 URL:', this.data.url)
    console.error('错误对象:', JSON.stringify(e))
    if (e && e.detail) {
      console.error('错误详情:', JSON.stringify(e.detail))
      console.error('错误 errMsg:', e.detail.errMsg || '无')
      console.error('错误 errno:', e.detail.errno || '无')
      console.error('错误 url:', e.detail.url || this.data.url)
    }
    wx.showToast({
      title: '加载失败，请重试',
      icon: 'none',
      duration: 3000
    })
  }
})
