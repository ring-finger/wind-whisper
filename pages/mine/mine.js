const app = getApp()
const AUTHOR_CALL_SIGN = 'BA4IWA'
const VIBRATE_TYPE = 'medium'

const SHARE_TITLE = '风语纪<电波有痕，风语为纪> - 我的设置'
const STORAGE_AVATAR = 'wxMineAvatarUrl'
const STORAGE_NICK = 'wxMineNickName'
const STORAGE_THEME = 'appTheme'

// 当前版本号 - 每次发布新版本时更新
const CURRENT_VERSION = '1.2.2'

// 更新日志内容
const UPDATE_LOGS = [
  {
    version: CURRENT_VERSION,
    date: '2026-05-12',
    title: '功能优化',
    content: [
      '优化日志添加流程，更便捷的使用方式',
      '优化分享流程',
      '我的分享更友好的展示方式'
    ]
  }
]

const THEMES = {
  radio: {
    name: '无线电'
  },
  morandi: {
    name: '奶油莫兰迪'
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
  toggleCloudSync(e) {
    wx.vibrateShort({ type: VIBRATE_TYPE })
    const newEnabled = e.detail.value
    
    if (newEnabled) {
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
    
    // 检查是否有呼号
    if (!myCallSign) {
      wx.showModal({
        title: '请先设置呼号',
        content: '云同步需要设置您的呼号，请在"我的"页面先设置呼号后再进行同步。',
        confirmText: '去设置',
        success: (res) => {
          if (res.confirm) {
            // 跳转到设置呼号
            this.editCallSign()
          }
        }
      })
      return
    }
    
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
    
    const db = wx.cloud.database()
    const collection = db.collection(app.CLOUD_LOGS_CONFIG.collectionName)
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
            _syncTime: db.serverDate()
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
    
    const db = wx.cloud.database()
    const collection = db.collection(app.CLOUD_LOGS_CONFIG.collectionName)
    
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
      const userAvatarUrl = wx.getStorageSync(STORAGE_AVATAR) || ''
      const userNickName = wx.getStorageSync(STORAGE_NICK) || ''
      this.setData({ userAvatarUrl, userNickName })
    } catch (e) {
      console.error('加载用户资料失败', e)
    }
  },

  onChooseAvatar(e) {
    wx.vibrateShort({ type: VIBRATE_TYPE })
    const avatarUrl = e.detail.avatarUrl
    if (!avatarUrl) return
    const persist = (path) => {
      try {
        wx.setStorageSync(STORAGE_AVATAR, path)
        this.setData({ userAvatarUrl: path })
        const userInfo = wx.getStorageSync('userInfo') || {}
        userInfo.avatarUrl = path
        wx.setStorageSync('userInfo', userInfo)
      } catch (err) {
        console.error('保存头像路径失败', err)
      }
    }
    const fs = wx.getFileSystemManager()
    const dest = `${wx.env.USER_DATA_PATH}/wx_mine_avatar.jpg`
    try {
      fs.unlinkSync(dest)
    } catch (e) {
      /* 不存在则忽略 */
    }
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
            if (callSign) {
            this.setData({
              myCallSign: callSign
            })
            try {
              wx.setStorageSync('myCallSign', callSign)
              const userInfo = wx.getStorageSync('userInfo') || {}
              userInfo.callSign = callSign
              wx.setStorageSync('userInfo', userInfo)
              wx.showToast({
                title: '设置成功',
                icon: 'success'
              })
            } catch (e) {
              console.error('保存呼号失败', e)
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

  exportLogs() {
    wx.vibrateShort({ type: VIBRATE_TYPE })
    try {
      const myCallSign = wx.getStorageSync('myCallSign') || ''
      if (!myCallSign) {
        wx.showModal({
          title: '提示',
          content: '请先在"我的"页面设置个人呼号',
          confirmText: '去设置',
          success: (res) => {
            if (res.confirm) {
              this.editCallSign()
            }
          }
        })
        return
      }

      const logs = wx.getStorageSync('contactLogs') || []
      if (logs.length === 0) {
        wx.showToast({
          title: '暂无日志可导出',
          icon: 'none'
        })
        return
      }

      let csvContent = '日期,BJT时间,UTC时间,己方呼号,对方呼号,天气,频率(MHz),模式,设备,天线,己方RST,对方RST,功率(W),位置,备注\n'
      
      logs.forEach(log => {
        let myRst = ''
        if (log.rst.myRst) {
          myRst = `${log.rst.myRst.r || '-'}${log.rst.myRst.s || '-'}${log.rst.myRst.t || '-'}`
        } else if (log.rst.r || log.rst.s || log.rst.t) {
          myRst = `${log.rst.r || '-'}${log.rst.s || '-'}${log.rst.t || '-'}`
        }
        const theirRst = log.rst.theirRst ? `${log.rst.theirRst.r || '-'}${log.rst.theirRst.s || '-'}${log.rst.theirRst.t || '-'}` : ''
        const weatherText = this.getWeatherText(log.weather)
        csvContent += `${log.date},${log.btcTime},${log.utcTime},${myCallSign},${log.callSign},${weatherText},${log.frequency},${log.mode},${log.equipment || ''},${log.antenna || ''},${myRst},${theirRst},${log.power || ''},${log.qth || ''},${log.notes || ''}\n`
      })

      const fileName = '通联日志_' + this.formatDate(new Date()) + '.csv'
      const filePath = wx.env.USER_DATA_PATH + '/' + fileName

      wx.showLoading({
        title: '正在导出...'
      })

      try {
        // 获取设备信息，用于平台兼容处理
        const appInstance = getApp()
        const platform = appInstance.globalData.platform || ''
        
        // 平台兼容：不同平台可能有不同的文件系统限制
        if (wx.getFileSystemManager) {
          wx.getFileSystemManager().writeFile({
            filePath: filePath,
            data: csvContent,
            encoding: 'utf-8',
            success: () => {
              wx.hideLoading()
              wx.showModal({
                title: '导出成功',
                content: `共导出 ${logs.length} 条日志\n\n建议转发给【文件传输助手】以便保存到电脑`,
                confirmText: '转发',
                cancelText: '取消',
                success: (res) => {
                  if (res.confirm) {
                    // 平台兼容：检查分享API是否可用
                    if (wx.shareFileMessage) {
                      wx.shareFileMessage({
                        filePath: filePath,
                        fileName: fileName,
                        success: () => {
                          console.log('分享成功')
                        },
                        fail: (err) => {
                          console.error('分享失败', err)
                          // 平台兼容：不同平台分享失败原因可能不同
                          if (err.errMsg && err.errMsg.includes('not supported')) {
                            wx.showToast({
                              title: '当前平台不支持文件分享',
                              icon: 'none'
                            })
                          } else {
                            wx.showToast({
                              title: '分享失败',
                              icon: 'none'
                            })
                          }
                        }
                      })
                    } else {
                      // 兼容旧版本，提示用户手动保存
                      wx.showModal({
                        title: '提示',
                        content: '当前版本不支持直接分享文件，文件已保存到本地',
                        showCancel: false
                      })
                    }
                  }
                }
              })
            },
            fail: (err) => {
              wx.hideLoading()
              console.error('写入文件失败', err)
              // 平台兼容：不同平台文件写入失败原因可能不同
              if (err.errMsg && err.errMsg.includes('permission')) {
                wx.showToast({
                  title: '文件系统权限不足',
                  icon: 'none'
                })
              } else {
                wx.showToast({
                  title: '导出失败',
                  icon: 'none'
                })
              }
            }
          })
        } else {
          // 兼容旧版本，使用传统API
          wx.hideLoading()
          wx.showModal({
            title: '提示',
            content: '当前版本不支持文件导出功能',
            showCancel: false
          })
        }
      } catch (e) {
        wx.hideLoading()
        console.error('导出过程出错', e)
        wx.showToast({
          title: '导出失败',
          icon: 'none'
        })
      }
    } catch (e) {
      console.error('导出日志失败', e)
      wx.hideLoading()
      wx.showToast({
        title: '导出失败',
        icon: 'none'
      })
    }
  },

  clearLogs() {
    wx.vibrateShort({ type: VIBRATE_TYPE })
    wx.showModal({
      title: '确认清空',
      content: '确定要清空所有通联日志吗？此操作不可恢复。',
      confirmText: '确定',
      confirmColor: '#ff4d4f',
      success: (res) => {
        if (res.confirm) {
          try {
            wx.setStorageSync('contactLogs', [])
            this.setData({
              contactCount: 0
            })
            wx.showToast({
              title: '清空成功',
              icon: 'success'
            })
          } catch (e) {
            console.error('清空日志失败', e)
            wx.showToast({
              title: '清空失败',
              icon: 'none'
            })
          }
        }
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

  getWeatherText(value) {
    const texts = {
      'sunny': '晴天',
      'cloudy': '多云',
      'rainy': '雨天',
      'stormy': '雷雨',
      'snowy': '雪天',
      'foggy': '雾天',
      'windy': '大风',
      'night': '夜晚'
    }
    return texts[value] || ''
  },

  formatDate(dateString) {
    if (!dateString) return ''
    const date = new Date(dateString)
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  },

  contactAuthor() {
    wx.vibrateShort({ type: VIBRATE_TYPE })
    const url = 'https://mp.weixin.qq.com/s/-ADGZLEDFymzWFU3euFraw'
    wx.navigateTo({
      url: '/pages/web-view/web-view?url=' + encodeURIComponent(url),
      fail: (err) => {
        console.error('导航失败', err)
        wx.showToast({
          title: '打开失败，请重试',
          icon: 'none'
        })
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
