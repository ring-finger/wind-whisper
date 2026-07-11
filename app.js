const db = require('./utils/db')
const { CONTENT_CHECK, CONTENT_CHECK_STATUS, SYSTEM_CONFIG } = require('./utils/constants')

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
    cloudSyncEnabled: null,
    systemConfig: null,
    myCallSign: null
  },

  // 系统配置实时订阅(watch)实例与定时刷新句柄
  _watchInstance: null,
  _configRefreshTimer: null,

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
      // 启动全局系统配置同步：立即拉取 + 实时订阅 + 定时兜底刷新
      this.startSystemConfigSync()
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

  // ==================== 全局系统配置（云数据库配置中心） ====================

  /**
   * 读取全局系统配置（同步，优先内存缓存）
   * @returns {Object} 配置对象，含 contentCheckEnabled 等字段
   */
  getSystemConfig() {
    try {
      if (this._cache.systemConfig === null) {
        const stored = wx.getStorageSync(SYSTEM_CONFIG.STORAGE_KEY)
        this._cache.systemConfig = stored ? stored : Object.assign({}, SYSTEM_CONFIG.DEFAULTS)
      }
      return this._cache.systemConfig
    } catch (e) {
      return Object.assign({}, SYSTEM_CONFIG.DEFAULTS)
    }
  },

  /**
   * 将配置写入缓存，并同步到运行时常量（保证 checkImageSafety 等读取点一致）
   * @param {Object} cfg - 最新配置
   */
  _applySystemConfig(cfg) {
    if (!cfg) return
    this._cache.systemConfig = cfg
    try { wx.setStorageSync(SYSTEM_CONFIG.STORAGE_KEY, cfg) } catch (e) { /* 忽略 */ }
    if (cfg.contentCheckEnabled !== undefined) {
      CONTENT_CHECK.ENABLED = !!cfg.contentCheckEnabled
    }
  },

  /**
   * 从云函数拉取最新配置（高效缓存刷新兜底）
   * @returns {Promise<Object>}
   */
  refreshSystemConfig() {
    return new Promise((resolve) => {
      wx.cloud.callFunction({
        name: 'systemConfig',
        data: { action: 'get' }
      }).then(res => {
        if (res.result && res.result.success && res.result.config) {
          this._applySystemConfig(res.result.config)
        } else {
          // 云函数返回失败（如集合未创建导致初始化失败）：明确告警，便于排查
          console.error('[systemConfig] 拉取配置失败：', (res.result && res.result.message) || '未知错误',
            '（请确认已在云控制台创建 appConfig 集合并部署 systemConfig 云函数）')
        }
        resolve(this.getSystemConfig())
      }).catch(err => {
        console.error('[systemConfig] 调用云函数失败（请确认 systemConfig 云函数已部署）：', err)
        resolve(this.getSystemConfig())
      })
    })
  },

  /**
   * 实时订阅云数据库配置变更（推送式，超管改完立即对所有客户端生效）
   * 依赖 systemConfig 集合的「所有用户可读」权限；断线按上限重连。
   */
  watchSystemConfig(reconnectCount = 0) {
    try {
      const db = wx.cloud.database()
      const watcher = db.collection(SYSTEM_CONFIG.COLLECTION)
        .doc(SYSTEM_CONFIG.DOC_ID)
        .watch({
          onChange: (snapshot) => {
            if (snapshot && snapshot.docs && snapshot.docs.length > 0) {
              this._applySystemConfig(snapshot.docs[0])
            }
          },
          onError: (err) => {
            console.warn('[systemConfig] watch 断开', err)
            this._watchInstance = null
            if (reconnectCount < SYSTEM_CONFIG.WATCH_MAX_RECONNECT) {
              setTimeout(() => this.watchSystemConfig(reconnectCount + 1), SYSTEM_CONFIG.WATCH_RECONNECT_DELAY)
            } else {
              console.warn('[systemConfig] watch 重连超限，依赖定时刷新兜底')
            }
          }
        })
      this._watchInstance = watcher
    } catch (e) {
      console.error('[systemConfig] 启动 watch 失败', e)
    }
  },

  /**
   * 启动配置同步：实时订阅 + 定时兜底刷新
   */
  startSystemConfigSync() {
    this.refreshSystemConfig()
    this.watchSystemConfig()
    if (this._configRefreshTimer) return
    this._configRefreshTimer = setInterval(() => {
      this.refreshSystemConfig()
    }, SYSTEM_CONFIG.REFRESH_INTERVAL)
  },

  // 图片内容审核开关（读取全局系统配置；默认取 CONTENT_CHECK.ENABLED）
  getContentCheckEnabled() {
    try {
      const cfg = this.getSystemConfig()
      if (cfg && cfg.contentCheckEnabled !== undefined) {
        return cfg.contentCheckEnabled === true
      }
      return CONTENT_CHECK.ENABLED
    } catch (e) {
      return CONTENT_CHECK.ENABLED
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
  },

  /**
   * 校验当前用户是否已设置呼号（基于全局缓存，未命中则回退本地存储）
   * 未设置时弹窗提示并阻断后续执行；已设置时静默放行。
   * 全局复用：SSTV 编码上传图片前、通联列表导出数据前、开启云同步前等统一调用。
   * @param {Object} [options]
   * @param {string} [options.title='请先设置呼号'] 弹窗标题
   * @param {string} [options.content] 弹窗内容，默认提示去"我的"页面设置
   * @param {boolean} [options.navigate=true] 确认后是否跳转到"我的"页面
   * @param {Function} [options.onConfirm] 确认后的自定义回调，传入则替代默认跳转行为
   * @returns {boolean} true=已设置呼号(放行)，false=未设置(已拦截弹窗)
   */
  requireCallSign(options = {}) {
    try {
      if (this._cache.myCallSign === null || this._cache.myCallSign === undefined) {
        this._cache.myCallSign = wx.getStorageSync('myCallSign') || ''
      }
    } catch (e) {
      this._cache.myCallSign = ''
    }
    if (this._cache.myCallSign) return true

    const title = options.title || '请先设置呼号'
    const content = options.content || '该功能需要设置您的呼号，请在"我的"页面先设置个人呼号后再试。'
    const navigate = options.navigate !== false
    const onConfirm = typeof options.onConfirm === 'function' ? options.onConfirm : null
    wx.showModal({
      title,
      content,
      confirmText: '去设置',
      cancelText: '取消',
      success: (res) => {
        if (!res.confirm) return
        if (onConfirm) {
          onConfirm()
        } else if (navigate) {
          // 项目无 tabBar，"我的"页为主包普通页，需用 navigateTo 跳转
          wx.navigateTo({ url: '/pages/mine/mine' })
        }
      }
    })
    return false
  },

  /**
   * 图片内容安全审核
   * 配置与状态集中在 utils/constants.js（CONTENT_CHECK / CONTENT_CHECK_STATUS）。
   * 统一开关 CONTENT_CHECK.ENABLED=false 时直接放行，不调用云函数、不拦截。
   * 上传临时文件到云存储 tmp_check/ → 调用云函数 contentCheck 审核（同步归档，免回调）。
   * 云函数内：
   *   - 同步 imgSecCheck 合规 → 删除 tmp_check 原文件，返回 safe:true
   *   - 同步 imgSecCheck 违规 → 同步归档为 tmp_err/{时间戳}_{呼号}_{label}.jpg（label 为兜底标识），
   *       归档后删除 tmp_check 原文件，返回 safe:false
   *   - 无法判定 → 删除 tmp_check 原文件，返回 safe:true（非阻塞放行）
   * 客户端依据 safe 结果：false → Toast "内容含违规信息" 并拦截；true → 放行。
   * @param {string} tempFilePath - 本地临时文件路径
   * @returns {Promise<boolean>} - true=安全/放行, false=违规拦截
   */
  checkImageSafety(tempFilePath) {
    return new Promise((resolve) => {
      // 统一开关：关闭审核时直接放行，不调用云函数、不拦截
      if (!this.getContentCheckEnabled()) {
        console.log('[checkImageSafety] 审核已关闭（统一开关），直接放行')
        resolve(true)
        return
      }

      // 上传到云存储临时目录
      const cloudPath = CONTENT_CHECK.TMP_CHECK_DIR + '/' + Date.now() + '_' + Math.random().toString(36).slice(2, 8) + '.jpg'
      wx.cloud.uploadFile({
        cloudPath,
        filePath: tempFilePath,
        success: (uploadRes) => {
          // 读取呼号，供违规留痕命名
          let callsign = ''
          try { callsign = wx.getStorageSync('myCallSign') || '' } catch (e) { /* 忽略 */ }

          // 调用云函数审核（安全/无法判定时由云函数删除临时文件；违规时同步归档并删原文件）
          wx.cloud.callFunction({
            name: 'contentCheck',
            data: { fileID: uploadRes.fileID, callsign }
          }).then((checkRes) => {
            if (checkRes.result && checkRes.result.safe) {
              console.log('[checkImageSafety] 审核通过/已提交后台监控')
              resolve(true)
            } else {
              console.warn('[checkImageSafety] 审核不通过:', checkRes.result)
              wx.showToast({ title: CONTENT_CHECK.MESSAGES.VIOLATION, icon: 'none', duration: 2000 })
              resolve(false)
            }
          }).catch(() => {
            // 云函数调用失败，清理孤儿临时文件，不阻塞
            console.warn('[checkImageSafety] 云函数调用失败，删除临时文件并跳过审核')
            wx.cloud.deleteFile({ fileList: [uploadRes.fileID] }).catch(() => {})
            resolve(true)
          })
        },
        fail: (err) => {
          console.error('[checkImageSafety] 上传云存储失败，跳过审核:', err)
          resolve(true) // 上传失败不阻塞
        }
      })
    })
  }
})
