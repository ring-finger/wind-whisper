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
    myCallSign: null,
    wxMineAvatarUrl: null,
    wxMineNickName: null,
    lastLocation: null
  },

  // 定位缓存有效期（毫秒）：5 分钟内复用，避免重复调用 getLocation 阻塞渲染
  LOCATION_CACHE_TTL: 5 * 60 * 1000,

  // 系统配置实时订阅(watch)实例与定时刷新句柄
  _watchInstance: null,
  _configRefreshTimer: null,

  onLaunch() {
    wx.cloud.init({
      env: "wind-d9gv5b4ca9c4129ba"
    });
    // 标记云初始化已发起（实际 ws 登录为异步，watch 会在就绪前暂挂、就绪后再启动）
    this._isCloudReady = false

    // 微信隐私合规：真机上若用户未同意隐私协议，showModal/showToast 等 UI 接口会被
    // 静默拦截（开发者工具不强制，故只在真机暴露）。启动即检查并在需要时拉起系统隐私
    // 授权弹窗；同时注册 onNeedPrivacyAuthorize，覆盖后续隐私敏感接口（如相册/摄像头）的授权。
    if (wx.getPrivacySetting) {
      wx.getPrivacySetting({
        success: (res) => {
          if (res && res.needAuthorization) {
            wx.requirePrivacyAuthorize({
              success: () => console.log('[privacy] 用户已同意隐私协议'),
              fail: () => console.warn('[privacy] 隐私授权失败/被拒绝')
            })
          }
        }
      })
    }
    if (wx.onNeedPrivacyAuthorize) {
      wx.onNeedPrivacyAuthorize((resolve) => {
        wx.requirePrivacyAuthorize({
          success: () => resolve(),
          fail: () => resolve()
        })
      })
    }


    // 延迟同步操作到启动完成后，避免阻塞首屏渲染
    setTimeout(() => {
      if (this._cache.maxCloudLogCount === null) {
        this._cache.maxCloudLogCount = this._readStorage('maxCloudLogCount')
      }
      if (!this._cache.maxCloudLogCount) {
        this.setMaxCloudCount(100)
      }
      this.loadCallHistory()
      this.initTheme()
      this._syncUserProfileFromCloud()
    }, 0)

    // 全局系统配置同步（云函数拉取 + 实时订阅 + 定时刷新）属于后台网络任务，
    // 延后到首屏渲染完成后再启动，避免占用启动关键路径
    setTimeout(() => {
      this.startSystemConfigSync()
    }, 1500)

    this.getDeviceInfo()
  },
  globalData: {
    callHistory: [],
    deviceInfo: null,
    platform: ''
  },

  /**
   * 统一读取本地存储（带全局缓存，避免启动期重复同步读取同一 key）
   * @param {string} key 存储键名
   * @param {*} [fallback=''] 未取到时的默认值
   * @returns {*}
   */
  _readStorage(key, fallback = '') {
    try {
      if (this._cache[key] === null || this._cache[key] === undefined) {
        const v = wx.getStorageSync(key)
        this._cache[key] = (v === '' || v === undefined || v === null) ? fallback : v
      }
      return this._cache[key]
    } catch (e) {
      return fallback
    }
  },

  isCloudSyncEnabled() {
    try {
      if (this._cache.cloudSyncEnabled === null) {
        this._cache.cloudSyncEnabled = this._readStorage(this.CLOUD_LOGS_CONFIG.syncEnabledKey)
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
        }
        // 云函数调用成功即代表云连接已就绪，可安全启动实时订阅
        if (this._isCloudReady !== true) {
          this._isCloudReady = true
          if (this._watchScheduled) {
            this._watchScheduled = false
            this.watchSystemConfig()
          }
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
   * 冷启动时云 WebSocket 可能尚未登录，watch 会立即失败（errCode -402002），
   * 此时不应立即递归重连（会瞬间打满重连次数并产生大量报错），
   * 而是等到云连接就绪后或较长延时后再尝试。
   */
  watchSystemConfig(reconnectCount = 0) {
    // 云连接尚未就绪（典型冷启动）：暂挂起，待登录状态就绪后再启动，避免无效重试
    if (wx.cloud && typeof wx.cloud.init === 'function' && this._isCloudReady !== true) {
      this._scheduleWatchWhenReady(reconnectCount)
      return
    }
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
            const msg = (err && (err.errMsg || err.message)) || ''
            console.warn('[systemConfig] watch 断开:', msg)
            this._watchInstance = null
            // 登录/ws 未就绪导致的失败：等云连接就绪后再试，不计重连次数
            if (/login fail|ws connection not exists|init watch fail|realtime/.test(msg)) {
              this._scheduleWatchWhenReady(reconnectCount)
              return
            }
            if (reconnectCount < SYSTEM_CONFIG.WATCH_MAX_RECONNECT) {
              setTimeout(() => this.watchSystemConfig(reconnectCount + 1), SYSTEM_CONFIG.WATCH_RECONNECT_DELAY)
            } else {
              console.warn('[systemConfig] watch 重连超限，依赖定时刷新兜底')
            }
          }
        })
      this._watchInstance = watcher
    } catch (e) {
      console.warn('[systemConfig] 启动 watch 失败，等待云连接就绪后重试', e)
      this._scheduleWatchWhenReady(reconnectCount)
    }
  },

  /**
   * 在云连接就绪后启动 watch（仅注册一次监听，避免重复绑定）
   */
  _scheduleWatchWhenReady(reconnectCount = 0) {
    if (this._watchScheduled) return
    this._watchScheduled = true
    const start = () => {
      this._watchScheduled = false
      this.watchSystemConfig(reconnectCount)
    }
    // 优先使用云登录状态变化事件（基础库 2.11.0+）
    if (wx.cloud && typeof wx.cloud.onLoginStateExpire === 'function') {
      try {
        wx.cloud.onLoginStateExpire(() => start())
      } catch (e) { /* 忽略 */ }
    }
    // 兜底：固定延时后尝试（此时云连接通常已建立）
    setTimeout(start, SYSTEM_CONFIG.WATCH_RECONNECT_DELAY * 2)
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
        this._cache.maxCloudLogCount = this._readStorage('maxCloudLogCount')
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
        this._cache.appTheme = this._readStorage(this.STORAGE_THEME, 'radio')
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
      // 已有本地呼号 → 不是首次使用，跳过（走全局缓存，避免重复同步读取）
      const localCallSign = this._readStorage('myCallSign', '')
      this._cache.myCallSign = localCallSign
      if (localCallSign) return

      const localNick = this._readStorage('wxMineNickName', '')
      this._cache.wxMineNickName = localNick
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
        // 已写入本地存储，清空全局缓存以便首页/校验处重新读取最新值
        this._cache.myCallSign = null
        this._cache.wxMineNickName = null
        this._cache.wxMineAvatarUrl = null

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
        this._cache.callHistory = this._readStorage('callHistory', [])
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
   * @param {boolean} [options.allowRewardedAd=false] 是否允许"看激励广告临时使用一次"。开启后（如 SSTV 场景），
   *        未设置呼号时弹窗额外提供"看广告使用"选项，观看完成后回调 onReward 放行本次功能。
   * @param {Function} [options.onReward] 观看完整激励广告后的回调，用于放行本次功能（仅在 allowRewardedAd 时生效）
   * @returns {boolean} true=已设置呼号(放行)，false=未设置(已拦截弹窗)
   */
  requireCallSign(options = {}) {
    try {
      if (this._cache.myCallSign === null || this._cache.myCallSign === undefined) {
        this._cache.myCallSign = this._readStorage('myCallSign', '')
      }
    } catch (e) {
      this._cache.myCallSign = ''
    }
    if (this._cache.myCallSign) return true

    const title = options.title || '请先设置呼号'
    const content = options.content || '该功能需要设置您的呼号，请在"我的"页面先设置个人呼号后再试。'
    const navigate = options.navigate !== false
    const onConfirm = typeof options.onConfirm === 'function' ? options.onConfirm : null
    const onReward = typeof options.onReward === 'function' ? options.onReward : null

    // 允许看广告临时使用一次（如 SSTV）：弹窗提供"看广告使用" + "去设置"双路径
    if (options.allowRewardedAd) {
      wx.showModal({
        title,
        content: options.content || '您还未设置呼号，可前往设置，或观看一段激励视频后临时使用一次该功能。',
        confirmText: '看广告',
        cancelText: '去设置',
        success: (res) => {
          if (res.confirm) {
            // 看广告，完整观看后放行本次功能
            this.showRewardedAd({ onReward })
          } else if (res.cancel) {
            // 去设置呼号
            if (onConfirm) {
              onConfirm()
            } else if (navigate) {
              wx.navigateTo({ url: '/pages/mine/mine' })
            }
          }
        }
      })
      return false
    }

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
   * 展示激励视频广告（全局复用，广告实例懒创建并缓存，避免重复创建）
   * 仅当用户完整观看（res.isEnded === true）时才触发 onReward 放行。
   * @param {Object} [options]
   * @param {Function} [options.onReward] 完整观看后的回调，用于发放"使用一次"的权益
   * @param {Function} [options.onFail] 广告加载/展示失败或未看完时的回调
   */
  showRewardedAd(options = {}) {
    const onReward = typeof options.onReward === 'function' ? options.onReward : null
    const onFail = typeof options.onFail === 'function' ? options.onFail : null

    if (!wx.createRewardedVideoAd) {
      wx.showToast({ title: '当前版本暂不支持广告，请升级微信', icon: 'none' })
      if (onFail) onFail()
      return
    }

    // 懒创建并缓存广告实例（onError 只需绑定一次）
    if (!this._rewardedVideoAd) {
      this._rewardedVideoAd = wx.createRewardedVideoAd({ adUnitId: 'adunit-eb0e06b75c9659dc' })
      this._rewardedVideoAd.onError((err) => {
        console.error('激励视频广告加载失败', err)
      })
    }
    const ad = this._rewardedVideoAd

    // 每次展示单独绑定 onClose，回调触发后立即解绑，避免闭包串场 / 多次触发
    const closeHandler = (res) => {
      ad.offClose(closeHandler)
      if (res && res.isEnded) {
        if (onReward) onReward()
      } else {
        wx.showToast({ title: '需完整观看广告才能使用本次功能', icon: 'none' })
        if (onFail) onFail()
      }
    }
    ad.onClose(closeHandler)

    ad.show().catch(() => {
      // 首次展示失败时，重新拉取后再展示
      ad.load()
        .then(() => ad.show())
        .catch((err) => {
          console.error('激励视频广告显示失败', err)
          ad.offClose(closeHandler)
          wx.showToast({ title: '广告加载失败，请稍后再试', icon: 'none' })
          if (onFail) onFail()
        })
    })
  },

  /**
   * 获取缓存的定位结果（有效期内复用，避免重复调用 getLocation 阻塞首屏渲染）
   * @returns {Object|null} { latitude, longitude, time } 或 null（无/已过期）
   */
  getCachedLocation() {
    const loc = this._cache.lastLocation
    if (loc && loc.latitude != null && loc.longitude != null &&
        Date.now() - (loc.time || 0) < this.LOCATION_CACHE_TTL) {
      return loc
    }
    return null
  },

  /**
   * 写入定位缓存
   * @param {number} latitude 纬度
   * @param {number} longitude 经度
   */
  setCachedLocation(latitude, longitude) {
    this._cache.lastLocation = { latitude, longitude, time: Date.now() }
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
          // 读取呼号，供违规留痕命名（走全局缓存，避免重复同步读取）
          let callsign = ''
          try { callsign = this._readStorage('myCallSign', '') } catch (e) { /* 忽略 */ }

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
