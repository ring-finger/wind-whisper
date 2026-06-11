const db = require('./utils/db')

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
    }
  },

  CLOUD_LOGS_CONFIG: {
    collectionName: 'contactLogs',
    maxLocalCount: 200,
    maxCloudCount: 100,
    syncEnabledKey: 'cloudSyncEnabled'
  },

  // 云数据库集合名称
  DB_COLLECTIONS: {
    userProfiles: 'userProfiles',
    contactStats: 'contactStats'
  },

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

    // 延迟同步操作到启动完成后，避免阻塞
    setTimeout(() => {
      if (this._cache.maxCloudLogCount === null) {
        this._cache.maxCloudLogCount = wx.getStorageSync('maxCloudLogCount')
      }
      if (!this._cache.maxCloudLogCount) {
        this.setMaxCloudCount(100)
      }
      this.loadCallHistory()
      this.initTheme()
      this._syncUserProfileFromCloud()
    }, 0)

    this.getDeviceInfo()
  },
  globalData: {
    callHistory: [],
    deviceInfo: null,
    platform: ''
  },

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

  setCloudSyncEnabled(enabled) {
    try {
      this._cache.cloudSyncEnabled = enabled
      wx.setStorageSync(this.CLOUD_LOGS_CONFIG.syncEnabledKey, enabled)
    } catch (e) {
      console.error('保存云同步设置失败', e)
    }
  },

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
      if (this._cache.appTheme === null) {
        this._cache.appTheme = wx.getStorageSync(this.STORAGE_THEME) || 'radio'
      }
      const theme = this._cache.appTheme
      const themeConfig = this.THEMES[theme] || this.THEMES.radio

      wx.setNavigationBarColor({
        frontColor: themeConfig.navText,
        backgroundColor: themeConfig.navBg,
        animation: { duration: 0, timingFunc: 'linear' }
      })

      const pages = getCurrentPages()
      pages.forEach(page => {
        if (!page || !page.setData) return
        try {
          page.setData({ currentTheme: theme })
        } catch (e) {
          // WebView 已销毁或跨独立分包，忽略
        }
      })
    } catch (e) {
      console.error('初始化主题失败', e)
    }
  },
  getDeviceInfo() {
    try {
      if (wx.getDeviceInfo) {
        wx.getDeviceInfo({
          success: (res) => {
            this.globalData.deviceInfo = res
            this.globalData.platform = res.platform || ''
          },
          fail: () => {
            this.globalData.platform = ''
            this._getSystemInfoAsync()
          }
        })
      } else {
        this._getSystemInfoAsync()
      }
    } catch (e) {
      this.globalData.platform = ''
    }
  },

  /**
   * 若无本地缓存，从云端 userProfiles 同步用户数据到本地
   */
  _syncUserProfileFromCloud() {
    try {
      // 已有本地呼号 → 不是首次使用，跳过
      const localCallSign = wx.getStorageSync('myCallSign')
      if (localCallSign) return

      const localNick = wx.getStorageSync('wxMineNickName')
      if (localNick) return

      db.loadUserProfile().then(profile => {
        if (!profile) return

        if (profile.callSign) {
          wx.setStorageSync('myCallSign', profile.callSign)
        }
        if (profile.nickName) {
          wx.setStorageSync('wxMineNickName', profile.nickName)
        }
        if (profile.avatarUrl) {
          wx.setStorageSync('wxMineAvatarUrl', profile.avatarUrl)
        }
        if (profile.currentTheme) {
          wx.setStorageSync('appTheme', profile.currentTheme)
        }
        if (profile.cloudSyncEnabled !== undefined) {
          wx.setStorageSync('cloudSyncEnabled', profile.cloudSyncEnabled)
        }

        // 主题可能变了，重新应用
        this._cache.appTheme = null
        this.initTheme()
      }).catch(err => {
        console.error('从云端同步用户资料失败', err)
      })
    } catch (e) {
      console.error('同步用户资料异常', e)
    }
  },

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
    if (index > -1) history.splice(index, 1)
    history.unshift(callSign)
    if (history.length > 50) history.pop()
    this.globalData.callHistory = history
    try {
      this._cache.callHistory = history
      wx.setStorageSync('callHistory', history)
    } catch (e) {
      console.error('保存呼号历史失败', e)
    }
  }
})
