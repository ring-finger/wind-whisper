App({
  STORAGE_THEME: 'appTheme',
  THEMES: {
    radio: {
      name: '无线电',
      navBg: '#F9F7F4',
      navText: '#000000',
      bgPrimary: '#F4F7FA'
    },
    morandi: {
      name: '奶油莫兰迪',
      navBg: '#F8F2E9',
      navText: '#000000',
      bgPrimary: '#F5F0E6'
    },
    dark: {
      name: '深色',
      navBg: '#1A1A2E',
      navText: '#FFFFFF',
      bgPrimary: '#1A1A2E'
    }
  },

  // 云数据库日志配置
  CLOUD_LOGS_CONFIG: {
    collectionName: 'contactLogs',  // 云数据库集合名称
    maxLocalCount: 100,            // 默认最大本地条数
    maxCloudCount: 100,            // 默认最大云端条数
    syncEnabledKey: 'cloudSyncEnabled'  // 存储键
  },

  // 内存缓存 - 避免启动阶段重复同步读取
  _cache: {
    appTheme: null,
    maxCloudLogCount: null,
    callHistory: null,
    cloudSyncEnabled: null
  },

  onLaunch() {
    wx.cloud.init({
      env: "wind-d9gv5b4ca9c4129ba"
    });

    // 延迟非关键同步调用，避免阻塞启动线程
    // 使用 setTimeout 将同步 API 推迟到启动完成后执行
    setTimeout(() => {
      // 初始化最大云端条数（如果未设置则默认为100）
      if (this._cache.maxCloudLogCount === null) {
        this._cache.maxCloudLogCount = wx.getStorageSync('maxCloudLogCount')
      }
      if (!this._cache.maxCloudLogCount) {
        this.setMaxCloudCount(100)
      }
      this.loadCallHistory()
      this.initTheme()
    }, 0)

    // getDeviceInfo 使用异步 API，不阻塞启动
    this.getDeviceInfo()
  },
  globalData: {
    callHistory: [],
    deviceInfo: null,
    platform: ''
  },

  // 获取云同步开关状态（使用缓存）
  isCloudSyncEnabled() {
    try {
      if (this._cache.cloudSyncEnabled === null) {
        this._cache.cloudSyncEnabled = wx.getStorageSync(this.CLOUD_LOGS_CONFIG.syncEnabledKey)
      }
      return this._cache.cloudSyncEnabled === true
    } catch (e) {
      return false
    }
  },

  // 设置云同步开关（同步更新缓存）
  setCloudSyncEnabled(enabled) {
    try {
      this._cache.cloudSyncEnabled = enabled
      wx.setStorageSync(this.CLOUD_LOGS_CONFIG.syncEnabledKey, enabled)
    } catch (e) {
      console.error('保存云同步设置失败', e)
    }
  },

  // 获取最大云端条数配置（使用缓存）
  getMaxCloudCount() {
    try {
      if (this._cache.maxCloudLogCount === null) {
        this._cache.maxCloudLogCount = wx.getStorageSync('maxCloudLogCount')
      }
      return this._cache.maxCloudLogCount || this.CLOUD_LOGS_CONFIG.maxCloudCount
    } catch (e) {
      return this.CLOUD_LOGS_CONFIG.maxCloudCount
    }
  },

  // 设置最大云端条数（同步更新缓存）
  setMaxCloudCount(count) {
    try {
      this._cache.maxCloudLogCount = count
      wx.setStorageSync('maxCloudLogCount', count)
    } catch (e) {
      console.error('保存最大条数设置失败', e)
    }
  },

  initTheme() {
    try {
      // 使用缓存，避免重复同步读取
      if (this._cache.appTheme === null) {
        this._cache.appTheme = wx.getStorageSync(this.STORAGE_THEME) || 'radio'
      }
      const savedTheme = this._cache.appTheme
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
      // 优先使用异步 API，避免阻塞 JS 线程
      if (wx.getDeviceInfo) {
        wx.getDeviceInfo({
          success: (res) => {
            this.globalData.deviceInfo = res
            this.globalData.platform = res.platform || ''
            console.log('设备信息:', res)
            console.log('平台信息:', res.platform)
          },
          fail: (err) => {
            console.error('获取设备信息失败:', err)
            this.globalData.platform = ''
            // 失败时降级到异步 getSystemInfo
            this._getSystemInfoAsync()
          }
        })
      } else {
        // 降级到异步 getSystemInfo
        this._getSystemInfoAsync()
      }
    } catch (e) {
      console.error('获取设备信息失败:', e)
      this.globalData.platform = ''
    }
  },

  // 异步获取系统信息（降级方案）
  _getSystemInfoAsync() {
    if (wx.getSystemInfo) {
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
      console.error('不支持设备信息API')
      this.globalData.platform = ''
    }
  },
  loadCallHistory() {
    try {
      // 使用缓存，避免重复同步读取
      if (this._cache.callHistory === null) {
        this._cache.callHistory = wx.getStorageSync('callHistory') || []
      }
      this.globalData.callHistory = this._cache.callHistory
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
    // 同步更新缓存和 storage
    try {
      this._cache.callHistory = history
      wx.setStorageSync('callHistory', history)
    } catch (e) {
      console.error('保存呼号历史失败', e)
    }
  }
})
