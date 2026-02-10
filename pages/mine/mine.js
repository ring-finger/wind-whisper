const app = getApp()
const AUTHOR_CALL_SIGN = 'BA4IWA'

// 分享标题常量
const SHARE_TITLE = '风语纪<电波有痕，风语为纪> - 我的设置'

Page({
  data: {
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
    showThanksInfo: false
  },

  onLoad() {
    this.loadMyCallSign()
    this.loadContactCount()
  },

  onShow() {
    this.loadContactCount()
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
