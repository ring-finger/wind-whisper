App({
  globalData: {
    callHistory: [],
    deviceInfo: null,
    platform: ''
  },
  onLaunch() {
    this.loadCallHistory()
    this.getDeviceInfo()
  },
  getDeviceInfo() {
    try {
      // 使用推荐的API获取设备信息，兼容不同平台
      if (wx.getDeviceInfo) {
        // 推荐使用wx.getDeviceInfo
        wx.getDeviceInfo({
          success: (res) => {
            this.globalData.deviceInfo = res
            this.globalData.platform = res.platform || ''
            console.log('设备信息:', res)
            console.log('平台信息:', res.platform)
          },
          fail: (err) => {
            console.error('获取设备信息失败:', err)
            // 兼容处理，设置默认值
            this.globalData.platform = ''
          }
        })
      } else if (wx.getSystemInfoSync) {
        // 兼容旧版本，使用同步API
        const deviceInfo = wx.getSystemInfoSync()
        this.globalData.deviceInfo = deviceInfo
        this.globalData.platform = deviceInfo.platform || ''
        console.log('设备信息:', deviceInfo)
        console.log('平台信息:', deviceInfo.platform)
      } else if (wx.getSystemInfo) {
        // 兼容更旧版本
        wx.getSystemInfo({
          success: (res) => {
            this.globalData.deviceInfo = res
            this.globalData.platform = res.platform || ''
            console.log('设备信息:', res)
            console.log('平台信息:', res.platform)
          },
          fail: (err) => {
            console.error('获取设备信息失败:', err)
            this.globalData.platform = ''
          }
        })
      } else {
        // 最低兼容处理
        throw new Error('不支持设备信息API')
      }
    } catch (e) {
      console.error('获取设备信息失败:', e)
      // 兼容处理，设置默认值
      this.globalData.platform = ''
    }
  },
  loadCallHistory() {
    try {
      const history = wx.getStorageSync('callHistory')
      if (history) {
        this.globalData.callHistory = history
      }
    } catch (e) {
      console.error('加载呼号历史失败', e)
    }
  },
  saveCallHistory(callSign) {
    if (!callSign) return
    const history = this.globalData.callHistory
    const index = history.indexOf(callSign)
    if (index > -1) {
      history.splice(index, 1)
    }
    history.unshift(callSign)
    if (history.length > 50) {
      history.pop()
    }
    this.globalData.callHistory = history
    try {
      wx.setStorageSync('callHistory', history)
    } catch (e) {
      console.error('保存呼号历史失败', e)
    }
  }
})
