App({
  STORAGE_THEME: 'appTheme',
  THEMES: {
    radio: {
      name: '无线电',
      navBg: '#F9F7F4',
      navText: '#000000'
    },
    morandi: {
      name: '奶油莫兰迪',
      navBg: '#F8F2E9',
      navText: '#000000'
    },
    dark: {
      name: '深色',
      navBg: '#1A1A2E',
      navText: '#FFFFFF'
    }
  },

  // 云数据库日志配置
  CLOUD_LOGS_CONFIG: {
    collectionName: 'contactLogs',  // 云数据库集合名称
    maxLocalCount: 100,            // 默认最大本地条数
    maxCloudCount: 100,            // 默认最大云端条数
    syncEnabledKey: 'cloudSyncEnabled'  // 存储键
  },

  onLaunch() {
    wx.cloud.init({
      env: "wind-d9gv5b4ca9c4129ba"
    });
    // 初始化最大云端条数（如果未设置则默认为100）
    if (!wx.getStorageSync('maxCloudLogCount')) {
      this.setMaxCloudCount(100)
    }
    this.loadCallHistory()
    this.getDeviceInfo()
    this.initTheme()
  },
  globalData: {
    callHistory: [],
    deviceInfo: null,
    platform: ''
  },

  // 获取云同步开关状态
  isCloudSyncEnabled() {
    try {
      const enabled = wx.getStorageSync(this.CLOUD_LOGS_CONFIG.syncEnabledKey)
      return enabled === true
    } catch (e) {
      return false
    }
  },

  // 设置云同步开关
  setCloudSyncEnabled(enabled) {
    try {
      wx.setStorageSync(this.CLOUD_LOGS_CONFIG.syncEnabledKey, enabled)
    } catch (e) {
      console.error('保存云同步设置失败', e)
    }
  },

  // 获取最大云端条数配置
  getMaxCloudCount() {
    try {
      const count = wx.getStorageSync('maxCloudLogCount')
      return count || this.CLOUD_LOGS_CONFIG.maxCloudCount
    } catch (e) {
      return this.CLOUD_LOGS_CONFIG.maxCloudCount
    }
  },

  // 设置最大云端条数
  setMaxCloudCount(count) {
    try {
      wx.setStorageSync('maxCloudLogCount', count)
    } catch (e) {
      console.error('保存最大条数设置失败', e)
    }
  },

  initTheme() {
    try {
      const savedTheme = wx.getStorageSync(this.STORAGE_THEME) || 'radio'
      const themeConfig = this.THEMES[savedTheme] || this.THEMES.radio
      
      wx.setNavigationBarColor({
        frontColor: themeConfig.navText,
        backgroundColor: themeConfig.navBg,
        animation: {
          duration: 0,
          timingFunc: 'linear'
        }
      })
      
      // 触发页面重新渲染以应用主题CSS类
      const pages = getCurrentPages()
      if (pages.length > 0) {
        const currentPage = pages[pages.length - 1]
        if (currentPage && currentPage.setData) {
          currentPage.setData({ currentTheme: savedTheme })
        }
      }
    } catch (e) {
      console.error('初始化主题失败', e)
    }
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
