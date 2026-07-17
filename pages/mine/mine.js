const app = getApp()
const db = require('../../utils/db')
const AUTHOR_CALL_SIGN = 'BA4IWA'
const VIBRATE_TYPE = 'medium'

// 公众号原始ID（gh_ 开头），用于 wx.openOfficialAccountProfile 跳转
// 请替换为本公众号的真实原始ID（公众号后台「设置与开发 > 公众号设置 > 账号详情」查看）
const OFFICIAL_ACCOUNT_USERNAME = 'gh_4792af3126a8'

const SHARE_TITLE = '风语纪<电波有痕，风语为纪> - 我的设置'
const STORAGE_AVATAR = 'wxMineAvatarUrl'
const STORAGE_NICK = 'wxMineNickName'
const STORAGE_THEME = 'appTheme'

// 当前版本号 - 每次发布新版本时更新
const CURRENT_VERSION = '1.6.0'

// 更新日志内容
const UPDATE_LOGS = [
  {
    version: CURRENT_VERSION,
    date: '2026-06-10',
    title: '功能优化',
    content: [
      '风语集——好用的三方工具',
      '图片内容审核',
      'SSTV解码取消功能优化',
      '日志再次分享、分享查看显示',
      '通联日志ADIF文件导出功能',
      'QSL卡片设计功能'
    ]
  }
]

const THEMES = {
  radio: {
    name: '无线电',
    navText: '#000000',
    navBg: '#F9F7F4'
  },
  morandi: {
    name: '奶油莫兰迪',
    navText: '#000000',
    navBg: '#F9F7F4'
  }
}

Page({
  data: {
    userAvatarUrl: '',
    userNickName: '',
    myCallSign: '',
    contactCount: 0,
    authorCallSign: AUTHOR_CALL_SIGN,
    easterEggMessage: '',
    tapCount: 0,
    repeaters: [
      { name: 'BR4IX', message: '439.650 -5 发射88.5' },
      { name: 'BR4IN', message: '439.110 -5 发射88.5' }
    ],
    hams: [
      { name: 'BA4IWA', message: 'CQ CQ CQ 这里是BA4IWA，呼叫频率上的友台' }
    ],
    showAuthorInfo: false,
    showThanksInfo: false,
    currentTheme: 'radio',
    currentThemeName: '无线电',
    showThemePicker: false,
    // 云同步配置
    cloudSyncEnabled: false,
    cloudSyncTips: '',
    cloudSyncExpanded: false,  // 云端同步面板是否展开（默认折叠）
    // 免责声明
    showCloudDisclaimer: false,
    cloudDisclaimerAgreed: false,
    cloudDisclaimerText: '云端同步免责声明：\n\n1. 云端数据存储存在不确定性，不保证100%数据完整性\n2. 云端同步的数据仅为备份用途，不能作为唯一存储方式\n3. 请定期通过"导出日志"功能备份您的数据到本地\n4. 作者不对因云端数据丢失造成的任何损失负责\n5. 开启云同步即表示您同意以上条款',
    // 更新日志
    showUpdateLog: false,
    updateLogList: UPDATE_LOGS,
    currentVersion: CURRENT_VERSION
  },

  onLoad() {
    // 检查是否需要显示更新日志
    this.checkAndShowUpdateLog()
  },

  // 检查并显示更新日志
  checkAndShowUpdateLog() {
    try {
      const lastSeenVersion = wx.getStorageSync('lastSeenVersion') || ''
      
      // 如果是新版本或首次打开，显示更新日志
      if (lastSeenVersion !== CURRENT_VERSION) {
        // 延迟显示，确保页面已加载
        setTimeout(() => {
          this.setData({ showUpdateLog: true })
        }, 500)
        
        // 更新已查看的版本号
        wx.setStorageSync('lastSeenVersion', CURRENT_VERSION)
      }
    } catch (e) {
      console.error('检查更新日志失败', e)
    }
  },

  // 关闭更新日志弹窗
  hideUpdateLog() {
    this.setData({ showUpdateLog: false })
  },

  // 打开更新日志弹窗
  showUpdateLogModal() {
    wx.vibrateShort({ type: VIBRATE_TYPE })
    this.setData({ showUpdateLog: true })
  },

  onLoad() {
    // 检查是否需要显示更新日志
    this.checkAndShowUpdateLog()
    this.loadUserProfile()
    this.loadMyCallSign()
    this.loadContactCount()
    this.loadTheme()
    this.loadCloudSyncConfig()
  },

  onShow() {
    this.loadUserProfile()
    this.loadContactCount()
    this.loadCloudSyncConfig()
  },

  // 加载云同步配置
  loadCloudSyncConfig() {
    try {
      const cloudSyncEnabled = app.isCloudSyncEnabled()

      let tips = ''
      if (cloudSyncEnabled) {
        tips = '已开启 · 云端最多保存 100 条'
      } else {
        tips = '未开启 · 日志仅保存在本地'
      }

      this.setData({
        cloudSyncEnabled,
        cloudSyncTips: tips
      })
    } catch (e) {
      console.error('加载云同步配置失败', e)
    }
  },

  // 切换云同步开关
  toggleCloudSyncPanel() {
    wx.vibrateShort({ type: VIBRATE_TYPE })
    this.setData({ cloudSyncExpanded: !this.data.cloudSyncExpanded })
  },

  // 阻止 switch 的点击冒泡到「开启云同步」行的折叠切换
  noop() {},

  toggleCloudSync(e) {
    wx.vibrateShort({ type: VIBRATE_TYPE })
    const newEnabled = e.detail.value
    
    if (newEnabled) {
      // 呼号拦截校验：未设置则弹窗提示并阻断开启（当前在"我的"页，确认后就地编辑呼号）
      if (!app.requireCallSign({ onConfirm: () => this.editCallSign() })) {
        this.setData({ cloudSyncEnabled: false })  // 回退开关状态
        return
      }
      // 开启时先显示免责声明
      // 注意：此时开关组件的 checked 已经变为 true，但我们需要等待用户同意
      this.setData({ 
        showCloudDisclaimer: true,
        cloudSyncEnabled: false  // 先保持关闭状态，等同意后再开启
      })
    } else {
      // 关闭时
      wx.showModal({
        title: '关闭云同步',
        content: '关闭后新增的日志将不再同步到云端。云端已保存的日志不会被删除。',
        success: (res) => {
          if (res.confirm) {
            app.setCloudSyncEnabled(false)
            this.setData({
              cloudSyncEnabled: false,
              cloudSyncTips: '未开启 · 日志仅保存在本地'
            })
            this._syncProfileToCloud()
            wx.showToast({
              title: '已关闭云同步',
              icon: 'success'
            })
          }
        }
      })
    }
  },

  // 关闭免责声明弹窗
  hideCloudDisclaimer() {
    this.setData({ showCloudDisclaimer: false })
  },

  // 同意免责声明
  agreeCloudDisclaimer() {
    this.setData({ 
      showCloudDisclaimer: false,
      cloudDisclaimerAgreed: true
    })
    
    // 同意后开启云同步
    wx.showModal({
      title: '开启云同步',
      content: '开启后新增的日志会自动同步到云端。是否立即同步现有的本地日志？',
      confirmText: '同步',
      cancelText: '暂不',
      success: (res) => {
        app.setCloudSyncEnabled(true)
        this.setData({
          cloudSyncEnabled: true,
          cloudSyncTips: '已开启 · 云端最多保存 100 条'
        })
        this._syncProfileToCloud()
        wx.showToast({
          title: '已开启云同步',
          icon: 'success'
        })
        
        if (res.confirm) {
          // 立即同步现有日志
          this.syncAllLogsToCloud()
        }
      }
    })
  },

  // 同步所有日志到云端
  syncAllLogsToCloud() {
    const logs = wx.getStorageSync('contactLogs') || []
    const myCallSign = wx.getStorageSync('myCallSign') || ''
    
    if (logs.length === 0) {
      wx.showToast({
        title: '本地暂无日志',
        icon: 'none'
      })
      return
    }
    
    // 呼号拦截校验（未设置则弹窗提示并阻断云同步；当前已在"我的"页，确认后就地编辑呼号）
    if (!app.requireCallSign({ onConfirm: () => this.editCallSign() })) return

    // 为历史日志补充呼号
    logs.forEach(log => {
      if (!log.myCallSign) {
        log.myCallSign = myCallSign
      }
    })
    wx.setStorageSync('contactLogs', logs)
    
    // 检查每天同步限制
    const today = new Date().toISOString().split('T')[0]  // 格式: '2024-01-15'
    const lastSyncDate = wx.getStorageSync('lastCloudSyncDate')
    
    if (lastSyncDate === today) {
      wx.showModal({
        title: '今日已同步',
        content: '云端同步每天只能执行一次，请明天再试。',
        showCancel: false,
        confirmText: '知道了'
      })
      return
    }
    
    wx.showLoading({ title: '同步中...' })
    
    const cloudDB = wx.cloud.database()
    const collection = cloudDB.collection(app.CLOUD_LOGS_CONFIG.collectionName)
    const maxCount = 100
    
    // 限制同步条数
    const logsToSync = logs.slice(0, maxCount)
    
    // 先清空云端
    collection.get().then(res => {
      const existingLogs = res.data || []
      const deleteTasks = existingLogs.map(log => 
        collection.doc(log._id).remove()
      )
      
      return Promise.all(deleteTasks).then(() => logsToSync)
    }).catch(() => logsToSync).then(logsToSync => {
      // 添加日志到云端（过滤掉系统字段）
      const tasks = logsToSync.map(log => {
        // 移除系统保留字段，避免写入错误
        const { _id, _openid, ...logData } = log
        return collection.add({
          data: {
            ...logData,
            _syncTime: cloudDB.serverDate()
          }
        })
      })
      
      return Promise.all(tasks)
    }).then(results => {
      // 同步成功后记录今天的日期
      wx.setStorageSync('lastCloudSyncDate', today)
      
      wx.hideLoading()
      wx.showToast({
        title: `已同步 ${results.length} 条`,
        icon: 'success'
      })
    }).catch(err => {
      wx.hideLoading()
      console.error('同步日志失败', err)
      wx.showToast({
        title: '同步失败',
        icon: 'none'
      })
    })
  },

  // 从云端恢复日志
  restoreFromCloud() {
    wx.vibrateShort({ type: VIBRATE_TYPE })
    
    wx.showModal({
      title: '从云端恢复',
      content: '此操作会用云端日志覆盖本地日志。确定继续吗？',
      confirmText: '确定',
      confirmColor: '#e74c3c',
      success: (res) => {
        if (res.confirm) {
          this.doRestoreFromCloud()
        }
      }
    })
  },

  // 执行从云端恢复
  doRestoreFromCloud() {
    wx.showLoading({ title: '恢复中...' })
    
    const cloudDB = wx.cloud.database()
    const collection = cloudDB.collection(app.CLOUD_LOGS_CONFIG.collectionName)
    
    collection.orderBy('createdAt', 'desc').get().then(res => {
      const cloudLogs = res.data || []
      
      if (cloudLogs.length === 0) {
        wx.hideLoading()
        wx.showToast({
          title: '云端暂无日志',
          icon: 'none'
        })
        return
      }
      
      // 清理系统字段，保持与本地日志格式一致
      const cleanLogs = cloudLogs.map(log => {
        const { _id, _openid, _syncTime, ...logData } = log
        return logData
      })
      
      // 保存到本地
      wx.setStorageSync('contactLogs', cleanLogs)
      
      // 同步统计到云端
      db.syncStatsFromLocalLogs(cleanLogs)
      
      // 更新显示
      this.setData({
        contactCount: cloudLogs.length
      })
      
      wx.hideLoading()
      wx.showToast({
        title: `已恢复 ${cloudLogs.length} 条`,
        icon: 'success'
      })
    }).catch(err => {
      wx.hideLoading()
      console.error('从云端恢复失败', err)
      wx.showToast({
        title: '恢复失败',
        icon: 'none'
      })
    })
  },


  loadTheme() {
    try {
      const savedTheme = wx.getStorageSync(STORAGE_THEME) || 'radio'
      const theme = THEMES[savedTheme] ? savedTheme : 'radio'
      const themeData = THEMES[theme]
      this.setData({
        currentTheme: theme,
        currentThemeName: themeData.name
      })
      this.applyTheme(theme)
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

  applyTheme(theme) {
    try {
      wx.setStorageSync(STORAGE_THEME, theme)
    } catch (e) {
      console.error('保存主题失败', e)
    }
  },

  toggleTheme() {
    wx.vibrateShort({ type: VIBRATE_TYPE })
    const currentTheme = this.data.currentTheme
    const newTheme = currentTheme === 'radio' ? 'morandi' : 'radio'
    const themeData = THEMES[newTheme]

    this.setData({
      currentTheme: newTheme,
      currentThemeName: themeData.name
    })

    try {
      wx.setStorageSync(STORAGE_THEME, newTheme)
      // 清除 app 缓存，通知其他页面重新加载主题
      app._cache.appTheme = null
      app.initTheme()
      this._syncProfileToCloud()
    } catch (e) {
      console.error('保存主题失败', e)
    }

    wx.showToast({
      title: `已切换至${themeData.name}主题`,
      icon: 'none',
      duration: 1500
    })
  },

  loadUserProfile() {
    try {
      let userAvatarUrl = wx.getStorageSync(STORAGE_AVATAR) || ''
      // 校验头像文件是否存在，避免引用已删除的旧路径
      if (userAvatarUrl) {
        try {
          wx.getFileSystemManager().accessSync(userAvatarUrl)
        } catch (e) {
          wx.removeStorageSync(STORAGE_AVATAR)
          userAvatarUrl = ''
        }
      }
      const userNickName = wx.getStorageSync(STORAGE_NICK) || ''
      this.setData({ userAvatarUrl, userNickName })
    } catch (e) {
      console.error('加载用户资料失败', e)
    }
  },

  /**
   * 将当前用户资料同步到云数据库 userProfiles 集合
   */
  _syncProfileToCloud() {
    try {
      const logs = wx.getStorageSync('contactLogs') || []
      db.syncUserProfile({
        nickName: wx.getStorageSync(STORAGE_NICK) || '',
        callSign: wx.getStorageSync('myCallSign') || '',
        cloudSyncEnabled: app.isCloudSyncEnabled(),
        currentTheme: wx.getStorageSync('appTheme') || 'radio',
        avatarUrl: wx.getStorageSync(STORAGE_AVATAR) || '',
        totalLogCount: logs.length
      })
    } catch (e) {
      console.error('同步用户资料到云端失败', e)
    }
  },

  onChooseAvatar(e) {
    wx.vibrateShort({ type: VIBRATE_TYPE })
    const avatarUrl = e.detail.avatarUrl
    if (!avatarUrl) return

    // 头像设置不走图片内容审核（用户自有头像，直接保存）
    const fs = wx.getFileSystemManager()
    // 每次使用唯一文件名，避免 image 组件因路径不变而使用缓存旧图
    const dest = `${wx.env.USER_DATA_PATH}/wx_mine_avatar_${Date.now()}.jpg`
    const persist = (path) => {
      try {
        // 清理旧头像文件，避免积累
        const oldPath = wx.getStorageSync(STORAGE_AVATAR)
        if (oldPath && oldPath !== path) {
          try { fs.unlinkSync(oldPath) } catch (e) { /* 忽略 */ }
        }
        wx.setStorageSync(STORAGE_AVATAR, path)
        this.setData({ userAvatarUrl: path })
        const userInfo = wx.getStorageSync('userInfo') || {}
        userInfo.avatarUrl = path
        wx.setStorageSync('userInfo', userInfo)
        // 清除首页缓存，确保返回首页时显示最新用户信息
        app._cache.wxMineAvatarUrl = null
        app._cache.wxMineNickName = null
        this._syncProfileToCloud()
      } catch (err) {
        console.error('保存头像路径失败', err)
      }
    }
    // 兼容清理旧版固定路径文件
    try {
      fs.unlinkSync(`${wx.env.USER_DATA_PATH}/wx_mine_avatar.jpg`)
    } catch (e) { /* 不存在则忽略 */ }
    fs.copyFile({
      srcPath: avatarUrl,
      destPath: dest,
      success: () => persist(dest),
      fail: () => persist(avatarUrl)
    })
  },

  onNicknameInput(e) {
    this.setData({ userNickName: e.detail.value || '' })
  },

  onNicknameBlur(e) {
    const v = (e.detail.value || '').trim()
    try {
      wx.setStorageSync(STORAGE_NICK, v)
      this.setData({ userNickName: v })
      // 清除首页缓存，确保返回首页时显示最新用户信息
      app._cache.wxMineNickName = null
      app._cache.wxMineAvatarUrl = null
      this._syncProfileToCloud()
    } catch (err) {
      console.error('保存昵称失败', err)
    }
  },

  loadMyCallSign() {
    try {
      const myCallSign = wx.getStorageSync('myCallSign')
      this.setData({
        myCallSign: myCallSign || ''
      })
    } catch (e) {
      console.error('加载个人呼号失败', e)
    }
  },

  loadContactCount() {
    try {
      const logs = wx.getStorageSync('contactLogs') || []
      this.setData({
        contactCount: logs.length
      })
    } catch (e) {
      console.error('加载通联次数失败', e)
    }
  },

  editCallSign() {
    wx.vibrateShort({ type: VIBRATE_TYPE })
    wx.showModal({
      title: '设置个人呼号',
      editable: true,
      placeholderText: '请输入您的呼号',
      content: this.data.myCallSign,
      success: (res) => {
        if (res.confirm && res.content) {
          const callSign = res.content.toUpperCase().replace(/[^A-Z0-9]/g, '')
        // 通用国际呼号正则，[1-2字母] + [1-3数字] + [1-4字母]，兼容国内所有B字头呼号，i忽略大小写
        const callSignRegExp = /^[A-Z]{1,2}\d{1,3}[A-Z]{1,4}$/i;
          if (callSign && callSignRegExp.test(callSign)) {
            this.setData({
              myCallSign: callSign
            })
            try {
              wx.setStorageSync('myCallSign', callSign)
              const userInfo = wx.getStorageSync('userInfo') || {}
              userInfo.callSign = callSign
              wx.setStorageSync('userInfo', userInfo)
              // 清除首页缓存，确保返回首页时显示最新用户信息
              app._cache.myCallSign = null
              app._cache.wxMineAvatarUrl = null
              app._cache.wxMineNickName = null
              this._syncProfileToCloud()
              wx.showToast({
                title: '设置成功',
                icon: 'none'
              })
            } catch (e) {
              console.error('呼号格式不正确', e)
            }
          } else {
            wx.showToast({
              title: '呼号格式不正确',
              icon: 'none'
            })
          }
        }
      }
    })
  },

  goToWindCollection() {
    wx.vibrateShort({ type: VIBRATE_TYPE })
    wx.navigateTo({
      url: '/pages/wind-collection/wind-collection',
      fail: (err) => {
        console.error('导航到风语集页面失败', err)
        wx.showToast({
          title: '打开失败，请重试',
          icon: 'none'
        })
      }
    })
  },

  goToSstv() {
    wx.vibrateShort({ type: VIBRATE_TYPE })
    wx.navigateTo({
      url: '/pages/sstv/sstv',
      fail: (err) => {
        console.error('导航到SSTV页面失败', err)
        wx.showToast({
          title: '打开失败，请重试',
          icon: 'none'
        })
      }
    })
  },

  contactAuthor() {
    wx.vibrateShort({ type: VIBRATE_TYPE })
    // 跳转公众号主页（使用原始ID；基础库 2.18.0+ 支持）
    wx.openOfficialAccountProfile({
      username: OFFICIAL_ACCOUNT_USERNAME,
      fail: (err) => {
        console.error('打开公众号失败', err)
        wx.showToast({ title: '打开失败，请重试', icon: 'none' })
      }
    })
  },

  onAuthorTap() {
    wx.vibrateShort({ type: VIBRATE_TYPE })
    const tapCount = this.data.tapCount + 1
    this.setData({
      tapCount: tapCount
    })

    if (tapCount >= 5) {
      const myCallSign = this.data.myCallSign
      const messages = [
        '哎哟，别点了，来公众号交流噻',
        '电磁波以299792458m/s的速度替你拥抱世界',
        'CQ CQ CQ 这里是' + AUTHOR_CALL_SIGN + '，呼叫频率上的友台',
        '问题和建议请在公众号留言~',
        'CQ CQ，你好啊，' + myCallSign
      ]
      const randomIndex = Math.floor(Math.random() * messages.length)
      this.setData({
        easterEggMessage: messages[randomIndex],
        tapCount: 0
      })

      setTimeout(() => {
        this.setData({
          easterEggMessage: ''
        })
      }, 3000)
    }
  },

  showHamMessage(e) {
    const index = e.currentTarget.dataset.index
    const ham = this.data.hams[index]
    if (ham && ham.message) {
      this.setData({
        easterEggMessage: ham.message
      })

      setTimeout(() => {
        this.setData({
          easterEggMessage: ''
        })
      }, 5000)
    }
  },

  showRepeaterMessage(e) {
    const index = e.currentTarget.dataset.index
    const repeater = this.data.repeaters[index]
    if (repeater && repeater.message) {
      this.setData({
        easterEggMessage: repeater.message
      })

      setTimeout(() => {
        this.setData({
          easterEggMessage: ''
        })
      }, 5000)
    }
  },

  toggleAuthorInfo() {
    wx.vibrateShort({ type: VIBRATE_TYPE })
    this.setData({
      showAuthorInfo: !this.data.showAuthorInfo
    })
  },

  toggleThanksInfo() {
    this.setData({
      showThanksInfo: !this.data.showThanksInfo
    })
  },

  onShareAppMessage() {
    return {
      title: SHARE_TITLE,
      path: '/pages/mine/mine',
      imageUrl: '/images/cover.jpg'
    }
  },

  onShareTimeline() {
    return {
      title: SHARE_TITLE,
      query: 'page=mine',
      imageUrl: '/images/cover.jpg'
    }
  }
})
