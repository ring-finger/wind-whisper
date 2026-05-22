const app = getApp()
const VIBRATE_TYPE = 'medium'

const BJT_OFFSET_MS = 8 * 60 * 60 * 1000
const SHARE_EXPIRE_DAYS = 7  // 分享过期天数
const SHARE_EXPIRE_MS = SHARE_EXPIRE_DAYS * 24 * 60 * 60 * 1000  // 30天的毫秒数

function pad2(n) {
  return String(n).padStart(2, '0')
}

function ymdFromParts(y, m, day) {
  return `${y}-${pad2(m)}-${pad2(day)}`
}

function hmFromParts(h, min) {
  return `${pad2(h)}:${pad2(min)}`
}

function bjtWallFromInstant(ms) {
  const wd = new Date(ms + BJT_OFFSET_MS)
  return {
    y: wd.getUTCFullYear(),
    m: wd.getUTCMonth() + 1,
    day: wd.getUTCDate(),
    h: wd.getUTCHours(),
    min: wd.getUTCMinutes()
  }
}

function utcWallFromInstant(ms) {
  const wd = new Date(ms)
  return {
    y: wd.getUTCFullYear(),
    m: wd.getUTCMonth() + 1,
    day: wd.getUTCDate(),
    h: wd.getUTCHours(),
    min: wd.getUTCMinutes()
  }
}

function instantFromBjt(dateStr, timeStr) {
  if (!dateStr || !timeStr) return null
  const t = new Date(`${dateStr}T${timeStr}:00+08:00`).getTime()
  return isNaN(t) ? null : t
}

function instantFromUtc(dateStr, timeStr) {
  if (!dateStr || !timeStr) return null
  const t = new Date(`${dateStr}T${timeStr}:00Z`).getTime()
  return isNaN(t) ? null : t
}

function buildTimeFields(ms) {
  const b = bjtWallFromInstant(ms)
  const u = utcWallFromInstant(ms)
  return {
    contactInstantMs: ms,
    date: ymdFromParts(b.y, b.m, b.day),
    utcDate: ymdFromParts(u.y, u.m, u.day),
    bjcTime: hmFromParts(b.h, b.min),
    utcTime: hmFromParts(u.h, u.min)
  }
}

function formatRstBlock(rst) {
  if (!rst) return { my: '', their: '' }
  let my = ''
  let their = ''
  if (rst.myRst) {
    my = `${rst.myRst.r || ''}${rst.myRst.s || ''}${rst.myRst.t || ''}`
  } else if (rst.r || rst.s || rst.t) {
    my = `${rst.r || ''}${rst.s || ''}${rst.t || ''}`
  }
  if (rst.theirRst) {
    their = `${rst.theirRst.r || ''}${rst.theirRst.s || ''}${rst.theirRst.t || ''}`
  }
  return { my, their }
}

Page({
  data: {
    currentTab: 'list',
    filteredLogs: [],
    _allLogs: [],
    searchQuery: '',
    dateFrom: '',
    dateTo: '',
    searchExpanded: false,
    contactInstantMs: 0,
    formData: {
      date: '',
      utcDate: '',
      bjcTime: '',
      utcTime: '',
      callSign: '',
      weather: '',
      frequency: '',
      mode: 'SSB',  // 默认SSB模式
      equipment: '',
      antenna: '',
      rst: {
        myRst: { r: '', s: '', t: '' },
        theirRst: { r: '', s: '', t: '' }
      },
      qth: '',
      power: '',
      notes: ''
    },
    currentTimeType: 'BJT',
    weatherIcons: [
      { emoji: '☀️', label: '晴', value: 'sunny' },
      { emoji: '⛅', label: '多云', value: 'cloudy' },
      { emoji: '🌧️', label: '雨', value: 'rainy' },
      { emoji: '⛈️', label: '雷雨', value: 'stormy' },
      { emoji: '🌨️', label: '雪', value: 'snowy' },
      { emoji: '🌫️', label: '雾', value: 'foggy' },
      { emoji: '💨', label: '大风', value: 'windy' },
      { emoji: '🌙', label: '夜间', value: 'night' }
    ],
    modes: ['SSB', 'CW', 'FM', 'AM', 'PSK31', 'FT8', 'RTTY', 'ATV'],
    callSuggestions: [],
    frequencySuggestions: [],
    isUHF: false,
    isVHF: false,
    rstPlusSelected: {
      myRst: false,
      theirRst: false
    },
    // RST焦点状态 - 控制哪个输入框可编辑
    rstFocus: {
      theirRst: 'r',  // 默认聚焦对方R
      myRst: 'r'
    },
    currentTheme: 'radio',
    // 分享功能
    shareMode: false,
    selectedLogs: {},  // 对象存储选中的ID {id: true}
    selectedLogsArray: [],  // 数组存储选中的ID列表
    shareDataReady: false,  // 分享数据是否已准备好
    preparingShare: false,  // 是否正在准备分享数据
    // 我的分享
    showMySharesModal: false,
    myShareList: [],
    myShareCount: 0,
    // 分享详情弹窗
    showShareDetailModal: false,
    shareDetailLoading: false,
    shareDetailLogs: [],
    shareDetailData: {},
    // 分享来源
    shareOwnerCallSign: '',
    // 分享引导闪烁效果
    showShareGuide: false,  // 是否显示分享按钮闪烁引导
    _shareGuideShown: false  // 内部标记：本次会话是否已展示过闪烁
  },

  onLoad(options) {
    this.loadTheme()
    this.initDateTime()
    
    if (options && options.tab === 'add') {
      // 保存需要切换到添加页的标志
      this._switchToAddOnShow = true
    }
    
    // 处理筛选参数（从首页统计卡片跳转）
    if (options && options.filter) {
      this._pendingFilter = options.filter
    }
    
    // 处理分享链接
    if (options && options.shareId) {
      this.loadSharedLogs(options.shareId)
    }
    
    // 检查是否需要显示分享引导闪烁效果（首次进入）
    this.initShareGuide()
    
    // 默认滚动到顶部
    wx.pageScrollTo({ scrollTop: 0, duration: 0 })
  },
  
  // 初始化分享引导闪烁效果
  initShareGuide() {
    try {
      // 从本地存储读取是否已展示过闪烁
      const hasShownGuide = wx.getStorageSync('hasShownShareGuide')
      
      // 如果还没有展示过，并且有通联记录，则显示闪烁效果
      if (!hasShownGuide) {
        // 延迟显示，确保列表已加载
        setTimeout(() => {
          this.setData({ showShareGuide: true })
        }, 500)
      }
    } catch (e) {
      console.error('检查分享引导状态失败', e)
    }
  },

  onShow() {
    this.loadTheme()

    // 检查是否需要切换到添加页
    if (this._switchToAddOnShow) {
      this._switchToAddOnShow = false
      this.setData({
        currentTab: 'add',
        rstFocus: { theirRst: 'r', myRst: 'r' }
      }, () => {
        setTimeout(() => { wx.pageScrollTo({ scrollTop: 0, duration: 0 }) }, 100)
      })
    }

    // 应用待处理的筛选（从首页统计卡片跳转）
    let shouldLoadLogs = this.data.currentTab === 'list'
    if (this._pendingFilter) {
      const filter = this._pendingFilter
      this._pendingFilter = null
      this.applyPresetFilter(filter)
      shouldLoadLogs = false
    }

    if (shouldLoadLogs) {
      this.loadLogs()
    }

    // 统一加载推荐数据和分享数据
    this.loadCallSuggestions()
    if (this.data.currentTab === 'add') {
      this.loadFrequencySuggestions()
    }
    this.loadMyShares()

    // 检查是否需要显示分享引导闪烁效果
    this.checkShareGuide()
  },
  
  // 检查并显示分享引导闪烁效果
  checkShareGuide() {
    try {
      const hasShownGuide = wx.getStorageSync('hasShownShareGuide')
      
      // 如果还没有展示过闪烁，且通联记录已加载，则显示闪烁效果
      if (!hasShownGuide && this.data.filteredLogs && this.data.filteredLogs.length > 0) {
        this.setData({ showShareGuide: true })
      }
    } catch (e) {
      console.error('检查分享引导状态失败', e)
    }
  },

  loadTheme() {
    try {
      const savedTheme = wx.getStorageSync('appTheme') || 'radio'
      this.setData({ currentTheme: savedTheme })
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

  loadSharedLogs(shareId) {
    // 显示加载提示
    wx.showLoading({ title: '加载分享...' })
    
    // 保存当前分享ID，供_displaySharedLogs使用
    this._currentShareId = shareId

    const db = wx.cloud.database()
    db.collection('shareLogs').doc(shareId).get().then(res => {
      wx.hideLoading()
      if (res.data) {
        this._displaySharedLogs(res.data)
      } else {
        wx.showToast({ title: '分享记录不存在', icon: 'none' })
      }
    }).catch(err => {
      wx.hideLoading()
      console.error('加载分享记录失败', err)
      wx.showToast({ title: '加载分享失败', icon: 'none' })
    })
  },

  _displaySharedLogs(shareData) {
    // 检查是否过期
    if (shareData.expireTime) {
      const expireTime = new Date(shareData.expireTime).getTime()
      const now = Date.now()
      
      if (now > expireTime) {
        wx.showToast({
          title: '分享链接已过期',
          icon: 'none',
          duration: 3000
        })
        return
      }
      
      // 计算剩余天数
      const remainDays = Math.ceil((expireTime - now) / (24 * 60 * 60 * 1000))
      shareData.remainDays = remainDays
    }
    
    // 格式化分享的记录
    const sharedLogs = shareData.logs.map(log => {
      const { my, their } = formatRstBlock(log.rst)
      return {
        ...log,
        rstMy: my,
        rstTheir: their,
        rstSummary: [my, their].filter(Boolean).join(' / ')
      }
    })
    
    this.setData({
      filteredLogs: sharedLogs,
      currentTab: 'list',
      shareMode: false,
      selectedLogs: {},
      selectedLogsArray: [],
      currentShareId: this._currentShareId,  // 保存当前查看的分享ID
      shareOwnerCallSign: shareData.myCallSign || 'TA'
    })
    
    // 显示过期提示
    if (shareData.remainDays) {
      wx.showModal({
        title: '分享的通联记录',
        content: `来自 ${shareData.myCallSign || 'BA4IWA'} 的 ${sharedLogs.length} 条通联记录\n\n⚠️ 剩余有效期：${shareData.remainDays}天`,
        showCancel: false,
        confirmText: '查看'
      })
    } else {
      wx.showModal({
        title: '分享的通联记录',
        content: `来自 ${shareData.myCallSign || 'BA4IWA'} 的 ${sharedLogs.length} 条通联记录`,
        showCancel: false,
        confirmText: '查看'
      })
    }
  },

  onPullDownRefresh() {
    if (this.data.currentTab === 'list') {
      this.loadLogs()
    }
    wx.stopPullDownRefresh()
  },

  switchTab(e) {
    const tab = e.currentTarget.dataset.tab
    wx.vibrateShort({ type: VIBRATE_TYPE })
    
    this.setData({ 
      currentTab: tab,
      rstFocus: {
        theirRst: 'r',
        myRst: 'r'
      }
    }, () => {
      // 滚动到顶部
      wx.pageScrollTo({ scrollTop: 0, duration: 0 })
      
      if (tab === 'list') {
        this.loadLogs()
      } else {
        this.initDateTime()
        this.loadFrequencySuggestions()
      }
    })
  },

  initDateTime() {
    this.syncTimeFromInstant(Date.now())
  },

  syncTimeFromInstant(ms) {
    const t = buildTimeFields(ms)
    this.setData({
      contactInstantMs: t.contactInstantMs,
      'formData.date': t.date,
      'formData.utcDate': t.utcDate,
      'formData.bjcTime': t.bjcTime,
      'formData.utcTime': t.utcTime
    })
  },

  onDateChange(e) {
    wx.vibrateShort({ type: VIBRATE_TYPE })
    const cal = e.detail.value
    const { currentTimeType, formData } = this.data
    const timeStr = currentTimeType === 'BJT' ? formData.bjcTime || '00:00' : formData.utcTime || '00:00'
    const ms = currentTimeType === 'BJT' ? instantFromBjt(cal, timeStr) : instantFromUtc(cal, timeStr)
    if (ms == null) return
    this.syncTimeFromInstant(ms)
  },

  onBjcTimeChange(e) {
    wx.vibrateShort({ type: VIBRATE_TYPE })
    const { formData } = this.data
    const ms = instantFromBjt(formData.date, e.detail.value)
    if (ms == null) return
    this.syncTimeFromInstant(ms)
  },

  onUtcTimeChange(e) {
    wx.vibrateShort({ type: VIBRATE_TYPE })
    const { formData } = this.data
    const ms = instantFromUtc(formData.utcDate, e.detail.value)
    if (ms == null) return
    this.syncTimeFromInstant(ms)
  },

  refreshTime() {
    wx.vibrateShort({ type: VIBRATE_TYPE })
    this.syncTimeFromInstant(Date.now())
  },

  setTimeType(e) {
    const type = e.currentTarget.dataset.type
    if (!type || this.data.currentTimeType === type) return
    wx.vibrateShort({ type: VIBRATE_TYPE })
    this.setData({ currentTimeType: type })
  },

  loadLogs() {
    try {
      const logs = wx.getStorageSync('contactLogs') || []
      this.setData({ 
        _allLogs: logs,
        currentShareId: null  // 清除分享ID，切回本地日志
      })
      this.applyFilter(logs)
      
      // 日志加载完成后检查是否需要显示分享引导
      this.checkShareGuide()
    } catch (e) {
      console.error(e)
      this.setData({ filteredLogs: [], currentShareId: null })
    }
  },

  // ========== 分享功能 ==========
  enterShareMode() {
    wx.vibrateShort({ type: VIBRATE_TYPE })
    
    // 先刷新分享数量
    this.loadMyShares()
    
    // 检查分享次数限制（最多5条）
    if (this.data.myShareCount >= 5) {
      wx.showModal({
        title: '分享次数已达上限',
        content: `您已有 ${this.data.myShareCount} 条分享记录（含未过期），请先删除部分分享记录后再分享。`,
        showCancel: true,
        cancelText: '我知道了',
        confirmText: '查看我的分享',
        success: (res) => {
          if (res.confirm) {
            // 用户选择查看我的分享
            this.showMyShares()
          }
        }
      })
      return
    }
    
    // 停止闪烁引导效果
    this.stopShareGuide()
    
    this.setData({
      shareMode: true
      // selectedLogs 保持不变，保留之前的勾选状态
    })
  },
  
  // 停止分享引导闪烁效果
  stopShareGuide() {
    // 如果正在显示闪烁效果
    if (this.data.showShareGuide) {
      try {
        // 标记为已展示过
        wx.setStorageSync('hasShownShareGuide', true)
      } catch (e) {
        console.error('保存分享引导状态失败', e)
      }
    }
    
    this.setData({
      showShareGuide: false,
      _shareGuideShown: true
    })
  },

  cancelShare() {
    wx.vibrateShort({ type: VIBRATE_TYPE })
    this.setData({
      shareMode: false,
      shareDataReady: false,
      preparingShare: false
      // selectedLogs 保留，下次进入时恢复
    })
  },

  toggleLogSelect(e) {
    wx.vibrateShort({ type: VIBRATE_TYPE })
    const logId = e.currentTarget.dataset.id
    const selectedLogs = this.data.selectedLogs
    
    if (selectedLogs[logId]) {
      delete selectedLogs[logId]
    } else {
      const count = Object.keys(selectedLogs).length
      if (count >= 10) {
        wx.showToast({
          title: '最多选择10条记录',
          icon: 'none'
        })
        return
      }
      selectedLogs[logId] = true
    }
    
    // 同步更新 Array
    const selectedLogsArray = Object.keys(selectedLogs)
    
    this.setData({ 
      selectedLogs,
      selectedLogsArray
    })
  },

  // 准备分享数据 - 保存分享数据到全局，供 onShareAppMessage 使用
  prepareShareData() {
    if (this.data.selectedLogsArray.length === 0) {
      wx.showToast({
        title: '请选择要分享的记录',
        icon: 'none'
      })
      return
    }

    wx.vibrateShort({ type: VIBRATE_TYPE })
    this.setData({ preparingShare: true })
    
    // 获取选中的记录
    const allLogs = this.data._allLogs || []
    const selectedIds = this.data.selectedLogs
    const selectedLogsData = allLogs.filter(log => 
      selectedIds[log.id]
    )

    // 生成分享卡片图片
    this.generateShareCard(selectedLogsData).then(imagePath => {
      // 使用云开发保存分享数据
      const db = wx.cloud.database()
      const shareCollection = db.collection('shareLogs')
      
      const myCallSign = wx.getStorageSync('myCallSign') || 'BA4IWA'
      const shareData = {
        logs: selectedLogsData,
        myCallSign: myCallSign,
        createTime: db.serverDate(),
        expireTime: db.serverDate({ offset: SHARE_EXPIRE_MS })
      }

      return shareCollection.add({
        data: shareData
      }).then(res => {
        // 保存到全局，供 onShareAppMessage 使用
        const app = getApp()
        app.globalData.currentShareId = res._id
        app.globalData.currentShareData = { myCallSign, logs: selectedLogsData }
        app.globalData.currentShareImage = imagePath
        
        // 保存到我的分享列表
        this.saveToMyShares(res._id, selectedLogsData.length)

        // 设置分享数据准备好
        this.setData({
          shareDataReady: true,
          preparingShare: false
        })

        // 显示分享菜单
        wx.showShareMenu({
          withShareTicket: true,
          menus: ['shareAppMessage', 'shareTimeline']
        })
      })
    }).catch(err => {
      this.setData({ preparingShare: false })
      console.error('分享失败', err)
      wx.showToast({ title: '分享失败，请重试', icon: 'none' })
    })
  },

  // 保存到我的分享列表
  saveToMyShares(shareId, logCount) {
    try {
      let myShares = wx.getStorageSync('myShares') || []
      const now = new Date()
      const pad = n => String(n).padStart(2, '0')
      const shareDateTime = `${now.getMonth() + 1}月${now.getDate()}日 ${pad(now.getHours())}:${pad(now.getMinutes())}`
      const newShare = {
        id: shareId,
        logCount: logCount,
        myCallSign: wx.getStorageSync('myCallSign') || 'BA4IWA',
        createTime: now.toISOString(),
        expireDaysLeft: SHARE_EXPIRE_DAYS,
        shareTitle: `${shareDateTime} · ${logCount}条通联`
      }
      myShares.unshift(newShare)
      // 只保留最近10条
      if (myShares.length > 10) {
        myShares = myShares.slice(0, 10)
      }
      wx.setStorageSync('myShares', myShares)
      this.loadMyShares()
    } catch (e) {
      console.error('保存分享记录失败', e)
    }
  },

  // 加载我的分享列表
  loadMyShares() {
    try {
      let myShares = wx.getStorageSync('myShares') || []
      const now = Date.now()
      
      // 过滤并计算剩余天数
      myShares = myShares.filter(share => {
        const expireTime = new Date(share.createTime).getTime() + SHARE_EXPIRE_MS
        share.expireDaysLeft = Math.max(0, Math.ceil((expireTime - now) / (24 * 60 * 60 * 1000)))
        return share.expireDaysLeft > 0
      })
      
      wx.setStorageSync('myShares', myShares)
      this.setData({
        myShareList: myShares,
        myShareCount: myShares.length
      })
    } catch (e) {
      console.error('加载分享记录失败', e)
    }
  },

  // 显示我的分享弹窗
  showMyShares() {
    console.log('showMyShares called')
    this.loadMyShares()
    this.setData({ showMySharesModal: true })
  },

  // 隐藏我的分享弹窗
  hideMyShares() {
    console.log('hideMyShares called')
    this.setData({ showMySharesModal: false })
  },

  // 查看分享详情
  viewShareDetail(e) {
    const shareId = e.currentTarget.dataset.id
    wx.vibrateShort({ type: VIBRATE_TYPE })
    
    this.hideMyShares()
    this.setData({
      showShareDetailModal: true,
      shareDetailLoading: true,
      shareDetailLogs: [],
      shareDetailData: {}
    })
    
    // 从云端加载分享数据
    const db = wx.cloud.database()
    db.collection('shareLogs').doc(shareId).get().then(res => {
      if (!res.data) {
        this.setData({ shareDetailLoading: false })
        wx.showToast({ title: '该分享已删除或超时', icon: 'none' })
        return
      }
      
      const shareData = res.data
      const logs = (shareData.logs || []).map(log => {
        const { my, their } = formatRstBlock(log.rst)
        return {
          ...log,
          rstMy: my,
          rstTheir: their,
          rstSummary: [my, their].filter(Boolean).join(' / ')
        }
      })
      
      this.setData({
        shareDetailLoading: false,
        shareDetailLogs: logs,
        shareDetailData: {
          myCallSign: shareData.myCallSign,
          logCount: logs.length
        }
      })
    }).catch(err => {
      this.setData({ shareDetailLoading: false })
      console.error('加载分享记录失败', err)
      wx.showToast({ title: '该分享已删除或超时', icon: 'none' })
    })
  },

  // 隐藏分享详情弹窗
  hideShareDetail() {
    this.setData({ showShareDetailModal: false })
  },

  // 删除分享记录
  deleteShareRecord(e) {
    const shareId = e.currentTarget.dataset.id
    wx.vibrateShort({ type: VIBRATE_TYPE })
    
    wx.showModal({
      title: '删除分享',
      content: '确定要删除这条分享记录吗？云端数据也会同步删除。',
      success: (res) => {
        if (res.confirm) {
          wx.showLoading({ title: '删除中...' })
          
          // 删除云端数据
          const db = wx.cloud.database()
          db.collection('shareLogs').doc(shareId).remove().then(() => {
            // 云端删除成功后，删除本地记录
            try {
              let myShares = wx.getStorageSync('myShares') || []
              myShares = myShares.filter(share => share.id !== shareId)
              wx.setStorageSync('myShares', myShares)
              this.loadMyShares()
              wx.hideLoading()
              wx.showToast({ title: '已删除', icon: 'success' })
            } catch (e) {
              console.error('删除本地分享记录失败', e)
              wx.hideLoading()
            }
          }).catch(err => {
            wx.hideLoading()
            console.error('删除云端分享记录失败', err)
            // 即使云端删除失败，也删除本地记录
            try {
              let myShares = wx.getStorageSync('myShares') || []
              myShares = myShares.filter(share => share.id !== shareId)
              wx.setStorageSync('myShares', myShares)
              this.loadMyShares()
              wx.showToast({ title: '已删除', icon: 'success' })
            } catch (e) {
              console.error('删除本地分享记录失败', e)
            }
          })
        }
      }
    })
  },

  // 生成分享卡片图片
  generateShareCard(logs) {
    return new Promise((resolve, reject) => {
      // 超时处理，避免一直卡住
      const timeout = setTimeout(() => {
        reject(new Error('生成卡片超时'))
      }, 10000) // 10秒超时

      try {
        const width = 520
        const height = 416
        const padding = 24
        const lineHeight = 48
        const maxLines = 6

        // 使用 canvas 2D 接口
        const query = wx.createSelectorQuery()
        query.select('#shareCardCanvas')
          .node((res) => {
            const canvas = res.node
            const ctx = canvas.getContext('2d')
            
            // 设置 canvas 尺寸
            canvas.width = width
            canvas.height = height

            // 背景
            ctx.fillStyle = '#1a1a2e'
            ctx.fillRect(0, 0, width, height)

            // 顶部装饰条
            ctx.fillStyle = '#e74c3c'
            ctx.fillRect(0, 0, width, 8)

            // 标题
            ctx.fillStyle = '#ffffff'
            ctx.font = '28px sans-serif'
            ctx.fillText('📻 业余无线电通联日志', padding, 60)

            // 呼号
            const myCallSign = wx.getStorageSync('myCallSign') || 'BA4IWA'
            ctx.font = '36px sans-serif'
            ctx.fillStyle = '#e74c3c'
            ctx.fillText(myCallSign, padding, 110)

            // 记录数量
            ctx.font = '22px sans-serif'
            ctx.fillStyle = '#888888'
            ctx.fillText(`分享 ${logs.length} 条通联记录`, padding, 145)

            // 分割线
            ctx.strokeStyle = '#333333'
            ctx.beginPath()
            ctx.moveTo(padding, 165)
            ctx.lineTo(width - padding, 165)
            ctx.stroke()

            // 通联列表头部
            ctx.font = '20px sans-serif'
            ctx.fillStyle = '#666666'
            ctx.fillText('呼号          频率          模式          RST', padding, 195)

            // 绘制通联记录
            const displayLogs = logs.slice(0, maxLines)
            displayLogs.forEach((log, index) => {
              const y = 230 + index * lineHeight
              
              // 序号
              ctx.fillStyle = '#e74c3c'
              ctx.font = '18px sans-serif'
              ctx.fillText(`${index + 1}.`, padding, y)
              
              // 呼号
              ctx.fillStyle = '#ffffff'
              ctx.font = '22px sans-serif'
              const callSign = (log.callSign || '').padEnd(10, ' ')
              ctx.fillText(callSign, padding + 30, y)
              
              // 频率
              ctx.fillStyle = '#888888'
              ctx.font = '20px sans-serif'
              const freq = (log.frequency || '0') + ' MHz'
              ctx.fillText(freq, padding + 170, y)
              
              // 模式
              ctx.fillStyle = '#f39c12'
              ctx.font = '20px sans-serif'
              ctx.fillText(log.mode || 'SSB', padding + 295, y)
              
              // RST
              ctx.fillStyle = '#2ecc71'
              ctx.font = '20px sans-serif'
              const rst = log.rstSummary || ''
              ctx.fillText(rst, padding + 380, y)
            })

            // 如果还有更多记录
            if (logs.length > maxLines) {
              ctx.fillStyle = '#666666'
              ctx.font = '18px sans-serif'
              ctx.fillText(`... 还有 ${logs.length - maxLines} 条记录`, padding, 230 + maxLines * lineHeight)
            }

            // 底部信息
            ctx.fillStyle = '#444444'
            ctx.font = '16px sans-serif'
            ctx.fillText(`有效期 ${SHARE_EXPIRE_DAYS} 天 · ${new Date().toLocaleDateString()}`, padding, height - 30)

            // 使用 canvas 2D 的导出方式
            wx.canvasToTempFilePath({
              canvas: canvas,  // 使用 canvas 对象而非 canvasId
              x: 0,
              y: 0,
              width: width,
              height: height,
              destWidth: width * 2,
              destHeight: height * 2,
              fileType: 'png',
              quality: 0.9,
              success: (res) => {
                clearTimeout(timeout)
                resolve(res.tempFilePath)
              },
              fail: (err) => {
                clearTimeout(timeout)
                console.error('生成分享卡片失败', err)
                reject(err)
              }
            })
          })
          .exec()
      } catch (err) {
        clearTimeout(timeout)
        console.error('生成卡片异常', err)
        reject(err)
      }
    })
  },

  // ========== 分享功能结束 ==========

  applyFilter(sourceLogs) {
    const logs = sourceLogs || this.data._allLogs || []
    let q = (this.data.searchQuery || '').trim().toUpperCase()
    const from = this.data.dateFrom
    const to = this.data.dateTo

    const filtered = logs.filter((log) => {
      if (q) {
        const cs = (log.callSign || '').toUpperCase()
        const freq = String(log.frequency || '')
        const mode = String(log.mode || '')
        if (!cs.includes(q) && !freq.includes(q) && !mode.toUpperCase().includes(q)) {
          return false
        }
      }
      const d = log.date || ''
      if (from && d && d < from) return false
      if (to && d && d > to) return false
      return true
    })

    const list = filtered.map((log) => {
      const { my, their } = formatRstBlock(log.rst)
      return {
        ...log,
        rstMy: my,
        rstTheir: their,
        rstSummary: [my, their].filter(Boolean).join(' / ')
      }
    })

    this.setData({ filteredLogs: list })
  },

  onSearchInput(e) {
    const searchQuery = e.detail.value
    this.setData({ searchQuery }, () => this.applyFilter())
  },

  onSearchConfirm() {
    this.applyFilter()
  },

  toggleSearchExpanded() {
    wx.vibrateShort({ type: VIBRATE_TYPE })
    this.setData({ searchExpanded: !this.data.searchExpanded })
  },

  onDateFromChange(e) {
    this.setData({ dateFrom: e.detail.value })
  },

  onDateToChange(e) {
    this.setData({ dateTo: e.detail.value })
  },

  onDateSearch() {
    wx.vibrateShort({ type: VIBRATE_TYPE })
    this.applyFilter()
  },

  onDateReset() {
    wx.vibrateShort({ type: VIBRATE_TYPE })
    this.setData({ dateFrom: '', dateTo: '' }, () => this.applyFilter())
  },

  // 应用预设筛选（从首页统计卡片跳转）
  applyPresetFilter(filter) {
    const now = new Date()
    let dateFrom = ''
    let dateTo = ''

    if (filter === 'today') {
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
      const dateStr = ymdFromParts(today.getFullYear(), today.getMonth() + 1, today.getDate())
      dateFrom = dateStr
      dateTo = dateStr
    } else if (filter === 'week') {
      // 计算本周一
      const dayOfWeek = now.getDay() || 7
      const monday = new Date(now.getTime() - (dayOfWeek - 1) * 24 * 60 * 60 * 1000)
      dateFrom = ymdFromParts(monday.getFullYear(), monday.getMonth() + 1, monday.getDate())
      // 计算本周日
      const sunday = new Date(monday.getTime() + 6 * 24 * 60 * 60 * 1000)
      dateTo = ymdFromParts(sunday.getFullYear(), sunday.getMonth() + 1, sunday.getDate())
    } else if (filter === 'month') {
      // 本月1日
      const firstDay = new Date(now.getFullYear(), now.getMonth(), 1)
      dateFrom = ymdFromParts(firstDay.getFullYear(), firstDay.getMonth() + 1, firstDay.getDate())
      // 本月最后一天
      const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0)
      dateTo = ymdFromParts(lastDay.getFullYear(), lastDay.getMonth() + 1, lastDay.getDate())
    }

    this.setData({
      dateFrom,
      dateTo,
      searchExpanded: true,
      currentTab: 'list'
    }, () => {
      this.loadLogs()
    })
  },

  openDetail(e) {
    const id = e.currentTarget.dataset.id
    const shareId = e.currentTarget.dataset.shareid
    wx.vibrateShort({ type: VIBRATE_TYPE })
    
    // 如果是查看他人分享的记录，拦截并提示
    if (this.data.currentShareId) {
      wx.showModal({
        title: '提示',
        content: '分享信息不可查看详情',
        showCancel: false,
        confirmText: '知道了'
      })
      return
    }
    
    if (shareId) {
      // 从分享列表进入，需要传递分享ID和日志ID，以及日志数据
      const log = this.data.filteredLogs.find(item => item.id == id)
      if (log) {
        const logData = encodeURIComponent(JSON.stringify(log))
        wx.navigateTo({
          url: `/pages/log-detail/log-detail?shareId=${shareId}&logId=${id}&logData=${logData}`
        })
      }
    } else {
      wx.navigateTo({
        url: '/pages/log-detail/log-detail?id=' + id
      })
    }
  },

  onCallSignInput(e) {
    const value = e.detail.value.toUpperCase()
    if (value && /[^A-Z0-9]/.test(value)) {
      wx.showToast({ title: '呼号只能包含字母和数字', icon: 'none', duration: 2000 })
      return
    }
    this.setData({ 'formData.callSign': value })
    wx.vibrateShort({ type: VIBRATE_TYPE })
    if (value.length > 0) {
      this.filterCallSuggestions(value)
    } else {
      // 输入清空时，恢复默认最近3条
      this.loadCallSuggestions()
    }
  },

  filterCallSuggestions(input) {
    const history = app.globalData.callHistory || []
    const currentCallSign = this.data.formData.callSign
    const filtered = history.filter(item => 
      item.toUpperCase().includes(input.toUpperCase()) && item !== currentCallSign
    ).slice(0, 5)
    this.setData({ callSuggestions: filtered })
  },

  // 加载最近3条去重呼号（默认展示）
  loadCallSuggestions() {
    const history = app.globalData.callHistory || []
    const seen = new Set()
    const recent = []
    for (const item of history) {
      if (!seen.has(item)) {
        seen.add(item)
        recent.push(item)
        if (recent.length >= 3) break
      }
    }
    this.setData({ callSuggestions: recent })
  },

  selectCallSign(e) {
    const callSign = e.currentTarget.dataset.callsign
    // 选中后清空推荐列表，避免已选中的值重复出现在联想中
    this.setData({ 'formData.callSign': callSign, callSuggestions: [] })
    wx.vibrateShort({ type: VIBRATE_TYPE })
  },

  selectWeather(e) {
    const value = e.currentTarget.dataset.value
    const currentWeather = this.data.formData.weather
    const newWeather = currentWeather === value ? '' : value
    this.setData({ 'formData.weather': newWeather })
    wx.vibrateShort({ type: VIBRATE_TYPE })
  },

  onFrequencyInput(e) {
    let value = e.detail.value
    value = value.replace(/[^\d.]/g, '')
    const parts = value.split('.')
    if (parts.length > 2) {
      value = parts[0] + '.' + parts.slice(1).join('')
    }
    if (parts[1] && parts[1].length > 3) {
      value = parts[0] + '.' + parts[1].substring(0, 3)
    }
    this.setData({ 'formData.frequency': value })
    this.updateFrequencyRangeStatus(value)
    wx.vibrateShort({ type: VIBRATE_TYPE })
    if (value.length > 0) {
      this.filterFrequencySuggestions(value)
    } else {
      // 输入清空时，恢复默认最近3条
      this.loadFrequencySuggestions()
    }
  },

  // 频率输入框聚焦时，加载最近3条频率
  onFrequencyFocus() {
    this.loadFrequencySuggestions()
  },

  // 加载最近3条去重频率（默认展示）
  loadFrequencySuggestions() {
    try {
      const logs = wx.getStorageSync('contactLogs') || []
      const seen = new Set()
      const recent = []
      for (const log of logs) {
        if (log.frequency && !seen.has(log.frequency)) {
          seen.add(log.frequency)
          recent.push(log.frequency)
          if (recent.length >= 3) break
        }
      }
      this.setData({ frequencySuggestions: recent, isUHF: false, isVHF: false })
    } catch (e) {
      console.error('加载频率历史失败', e)
    }
  },

  filterFrequencySuggestions(input) {
    try {
      const logs = wx.getStorageSync('contactLogs') || []
      const seen = new Set()
      const matched = []
      const currentFrequency = this.data.formData.frequency
      // 按日志顺序遍历，保留最近匹配的项在前
      for (let i = logs.length - 1; i >= 0; i--) {
        const f = logs[i].frequency
        if (f && f.includes(input) && !seen.has(f) && f !== currentFrequency) {
          seen.add(f)
          matched.push(f)
        }
      }
      const filtered = matched.reverse().slice(0, 5)
      this.setData({ frequencySuggestions: filtered })
    } catch (e) {
      console.error('过滤频率建议失败', e)
    }
  },

  selectFrequency(e) {
    const frequency = e.currentTarget.dataset.frequency
    this.setData({ 'formData.frequency': frequency })
    this.updateFrequencyRangeStatus(frequency)
    // 选中后清空推荐列表，避免已选中的值重复出现在联想中
    this.setData({ frequencySuggestions: [] })
    wx.vibrateShort({ type: VIBRATE_TYPE })
  },

  updateFrequencyRangeStatus(frequency) {
    const freq = parseFloat(frequency)
    const isUHF = !isNaN(freq) && freq >= 300 && freq <= 3000
    const isVHF = !isNaN(freq) && freq >= 30 && freq < 300
    
    this.setData({ 
      isUHF: isUHF, 
      isVHF: isVHF
    })
  },

  selectMode(e) {
    const mode = e.currentTarget.dataset.mode
    const currentMode = this.data.formData.mode
    const newMode = currentMode === mode ? '' : mode
    this.setData({ 'formData.mode': newMode })
    wx.vibrateShort({ type: VIBRATE_TYPE })
  },

  // ========== RST验证码式输入组件 ==========

  // 封装聚焦方法 - 使用rstFocus数据控制焦点
  focusRstInput(type, field) {
    const { isVHF, isUHF } = this.data
    
    // 重置所有焦点
    const rstFocus = {
      theirRst: { r: false, s: false, t: false },
      myRst: { r: false, s: false, t: false }
    }
    
    // VHF/UHF频段时，跳过T字段
    if (field === 't' && (isVHF || isUHF)) {
      if (type === 'theirRst') {
        rstFocus.myRst.r = true
      }
    } else {
      rstFocus[type][field] = true
    }
    
    this.setData({ rstFocus })
  },

  // RST输入处理 - 核心交互逻辑
  onRstInput(e) {
    const { formData, isVHF, isUHF } = this.data
    const type = e.currentTarget.dataset.type
    const field = e.currentTarget.dataset.field
    let value = e.detail.value

    // 只保留最后一个字符
    if (value.length > 1) {
      value = value.slice(-1)
    }

    // 验证输入值
    if (field === 'r') {
      const num = parseInt(value, 10)
      if (isNaN(num) || num < 1 || num > 5) {
        value = ''
      }
    } else if (field === 's') {
      const num = parseInt(value, 10)
      if (isNaN(num) || num < 1 || num > 9) {
        value = ''
      }
    } else if (field === 't') {
      // T字段只允许数字
      if (value && !/^[0-9]$/.test(value)) {
        value = ''
      }
    }

    // 更新RST数据
    const rst = {
      myRst: { ...formData.rst.myRst },
      theirRst: { ...formData.rst.theirRst }
    }
    const cur = { ...rst[type] }
    const prevValue = cur[field]  // 保存之前的值用于判断是输入还是删除
    cur[field] = value
    rst[type] = cur
    this.setData({ 'formData.rst': rst })

    wx.vibrateShort({ type: VIBRATE_TYPE })

    // 判断是输入还是删除
    if (value && !prevValue) {
      // 正向输入：自动跳转下一个
      this.rstForwardFocus(type, field, isVHF, isUHF)
    } else if (!value && prevValue) {
      // 反向删除：自动跳转上一个
      this.rstBackwardFocus(type, field)
    }
  },

  // RST正向跳转 - 输入完成后自动聚焦下一个
  rstForwardFocus(type, field, isVHF, isUHF) {
    const nextFocus = {}
    let nextType = type
    let nextField = ''

    if (field === 'r') {
      // R → S
      nextField = 's'
      nextFocus.rstFocus = { ...this.data.rstFocus, [type]: 's' }
    } else if (field === 's') {
      if (isVHF || isUHF) {
        // VHF/UHF频段：S → 己方R (跳过T)
        nextType = 'myRst'
        nextField = 'r'
        nextFocus.rstFocus = { ...this.data.rstFocus, myRst: 'r' }
      } else {
        // HF频段：S → T
        nextField = 't'
        nextFocus.rstFocus = { ...this.data.rstFocus, [type]: 't' }
      }
    } else if (field === 't') {
      // T → 己方R
      nextType = 'myRst'
      nextField = 'r'
      nextFocus.rstFocus = { ...this.data.rstFocus, myRst: 'r' }
    }

    if (Object.keys(nextFocus).length > 0) {
      this.setData(nextFocus, () => {
        // 真正聚焦到下一个输入框
        this.focusRstInput(nextType, nextField)
      })
    }
  },

  // RST反向跳转 - 删除时自动聚焦上一个
  rstBackwardFocus(type, field) {
    const nextFocus = {}
    let nextType = type
    let nextField = ''

    if (field === 't') {
      // T → S
      nextField = 's'
      nextFocus.rstFocus = { ...this.data.rstFocus, [type]: 's' }
    } else if (field === 's') {
      // S → R
      nextField = 'r'
      nextFocus.rstFocus = { ...this.data.rstFocus, [type]: 'r' }
    } else if (field === 'r') {
      // R → 对方S (如果当前是己方)
      if (type === 'myRst') {
        nextType = 'theirRst'
        nextField = 's'
        nextFocus.rstFocus = { ...this.data.rstFocus, theirRst: 's' }
      }
    }

    if (Object.keys(nextFocus).length > 0) {
      this.setData(nextFocus, () => {
        // 真正聚焦到上一个输入框
        this.focusRstInput(nextType, nextField)
      })
    }
  },

  // RST获取焦点 - 点击输入框时聚焦
  onRstFocus(e) {
    const type = e.currentTarget.dataset.type
    const field = e.currentTarget.dataset.field
    this.setData({
      rstFocus: { ...this.data.rstFocus, [type]: field }
    }, () => {
      // 真正聚焦到输入框
      this.focusRstInput(type, field)
    })
  },

  // RST点击切换 - 点击占位符切换焦点
  rstTapToFocus(e) {
    const type = e.currentTarget.dataset.type
    const field = e.currentTarget.dataset.field
    wx.vibrateShort({ type: VIBRATE_TYPE })
    this.setData({
      rstFocus: { ...this.data.rstFocus, [type]: field }
    }, () => {
      // 真正聚焦到输入框
      this.focusRstInput(type, field)
    })
  },

  // 设置RST的T为+号（VHF/UHF频段）- 可切换选中/非选中
  setRstPlus(e) {
    const type = e.currentTarget.dataset.type
    const { formData } = this.data
    const rst = {
      myRst: { ...formData.rst.myRst },
      theirRst: { ...formData.rst.theirRst }
    }
    const cur = { ...rst[type] }
    // 切换+号状态：如果已有+则清除，否则设置为+
    cur.t = cur.t === '+' ? '' : '+'
    rst[type] = cur
    this.setData({ 'formData.rst': rst })
    wx.vibrateShort({ type: VIBRATE_TYPE })

    // 设置+后跳到己方R
    if (type === 'theirRst' && cur.t === '+') {
      this.setData({
        rstFocus: { ...this.data.rstFocus, myRst: 'r' }
      }, () => {
        // 真正聚焦到己方R输入框
        this.focusRstInput('myRst', 'r')
      })
    }
  },

  // 获取完整的RST字符串 - 提供给外部调用
  getFullRst(type = 'theirRst') {
    const { formData } = this.data
    const rst = formData.rst[type]
    return `${rst.r || ''}${rst.s || ''}${rst.t || ''}`
  },

  // ========== RST组件结束 ==========

  // 选择功率快捷值
  selectPower(e) {
    const power = e.currentTarget.dataset.power
    this.setData({ 'formData.power': power })
    wx.vibrateShort({ type: VIBRATE_TYPE })
  },

  onQthInput(e) {
    this.setData({ 'formData.qth': e.detail.value })
    wx.vibrateShort({ type: VIBRATE_TYPE })
  },

  onPowerInput(e) {
    this.setData({ 'formData.power': e.detail.value })
    wx.vibrateShort({ type: VIBRATE_TYPE })
  },

  onEquipmentInput(e) {
    this.setData({ 'formData.equipment': e.detail.value })
    wx.vibrateShort({ type: VIBRATE_TYPE })
  },

  onAntennaInput(e) {
    this.setData({ 'formData.antenna': e.detail.value })
    wx.vibrateShort({ type: VIBRATE_TYPE })
  },

  onNotesInput(e) {
    this.setData({ 'formData.notes': e.detail.value })
    wx.vibrateShort({ type: VIBRATE_TYPE })
  },

  submitLog() {
    const ms = this.data.contactInstantMs || Date.now()
    const timeSnap = buildTimeFields(ms)
    const formData = {
      ...this.data.formData,
      date: timeSnap.date,
      utcDate: timeSnap.utcDate,
      bjcTime: timeSnap.bjcTime,
      utcTime: timeSnap.utcTime
    }

    if (!formData.callSign) {
      wx.showToast({ title: '请输入呼号', icon: 'none' })
      return
    }

    if (!formData.frequency) {
      wx.showToast({ title: '请输入频率', icon: 'none' })
      return
    }

    if (!formData.mode) {
      wx.showToast({ title: '请选择工作模式', icon: 'none' })
      return
    }

    if (!formData.rst.myRst.r || !formData.rst.myRst.s) {
      wx.showToast({ title: '请填写己方信号报告RS', icon: 'none' })
      return
    }

    if (!formData.rst.theirRst.r || !formData.rst.theirRst.s) {
      wx.showToast({ title: '请填写对方信号报告RS', icon: 'none' })
      return
    }

    var log = {}
    for (var key in formData) {
      if (key === 'utcDate') continue
      log[key] = formData[key]
    }
    log.btcTime = formData.bjcTime
    log.id = Date.now()
    log.createdAt = new Date().toISOString()

    this.saveLog(log)
    app.saveCallHistory(formData.callSign)

    wx.vibrateShort({ type: VIBRATE_TYPE })
    wx.showToast({ title: '保存成功', icon: 'success' })

    this.resetForm()
    this.switchTab({ currentTarget: { dataset: { tab: 'list' } } })
  },

  saveLog(log) {
    try {
      let logs = wx.getStorageSync('contactLogs') || []
      
      // 补充当前用户的呼号（兼容历史数据）
      const myCallSign = wx.getStorageSync('myCallSign') || ''
      if (!log.myCallSign) {
        log.myCallSign = myCallSign
      }
      
      logs.unshift(log)
      if (logs.length > 1000) {
        logs = logs.slice(0, 1000)
      }
      wx.setStorageSync('contactLogs', logs)
      
      // 同步到云数据库
      this.syncLogToCloud(log)
    } catch (e) {
      console.error('保存日志失败', e)
      wx.showToast({ title: '保存失败', icon: 'none' })
    }
  },

  // 同步单条日志到云数据库
  syncLogToCloud(log) {
    if (!app.isCloudSyncEnabled()) return
    
    try {
      const db = wx.cloud.database()
      const collection = db.collection(app.CLOUD_LOGS_CONFIG.collectionName)
      
      // 添加到云端
      collection.add({
        data: {
          ...log,
          _syncTime: db.serverDate()
        }
      }).then(res => {
        console.log('日志已同步到云端', res)
        // 同步成功后检查云端条数限制
        this.checkCloudLogLimit()
      }).catch(err => {
        console.error('同步日志到云端失败', err)
      })
    } catch (e) {
      console.error('云同步异常', e)
    }
  },

  // 检查并清理云端日志数量
  checkCloudLogLimit() {
    if (!app.isCloudSyncEnabled()) return
    
    try {
      const db = wx.cloud.database()
      const collection = db.collection(app.CLOUD_LOGS_CONFIG.collectionName)
      const maxCount = 100
      
      // 获取云端总数
      collection.count().then(res => {
        if (res.total > maxCount) {
          // 需要删除超出的部分
          const removeCount = res.total - maxCount
          this.removeOldestCloudLogs(removeCount)
        }
      }).catch(err => {
        console.error('检查云端日志数量失败', err)
      })
    } catch (e) {
      console.error('检查云端限制异常', e)
    }
  },

  // 删除最旧的云端日志
  removeOldestCloudLogs(count) {
    try {
      const db = wx.cloud.database()
      const collection = db.collection(app.CLOUD_LOGS_CONFIG.collectionName)
      
      // 按创建时间升序排列，获取最旧的记录
      collection.orderBy('createdAt', 'asc').limit(count).get().then(res => {
        const oldLogs = res.data || []
        if (oldLogs.length === 0) return
        
        // 删除这些记录
        const tasks = oldLogs.map(log => {
          return collection.doc(log._id).remove()
        })
        
        Promise.all(tasks).then(results => {
          console.log(`已删除 ${results.length} 条云端旧日志`)
        }).catch(err => {
          console.error('删除云端旧日志失败', err)
        })
      }).catch(err => {
        console.error('获取云端旧日志失败', err)
      })
    } catch (e) {
      console.error('删除云端日志异常', e)
    }
  },

  // 从云端同步日志
  syncLogsFromCloud() {
    return new Promise((resolve, reject) => {
      if (!app.isCloudSyncEnabled()) {
        resolve([])
        return
      }
      
      wx.showLoading({ title: '同步中...' })
      
      try {
        const db = wx.cloud.database()
        const collection = db.collection(app.CLOUD_LOGS_CONFIG.collectionName)
        
        collection.orderBy('createdAt', 'desc').get().then(res => {
          wx.hideLoading()
          const cloudLogs = res.data || []
          console.log(`从云端同步了 ${cloudLogs.length} 条日志`)
          resolve(cloudLogs)
        }).catch(err => {
          wx.hideLoading()
          console.error('从云端同步日志失败', err)
          reject(err)
        })
      } catch (e) {
        wx.hideLoading()
        console.error('云同步异常', e)
        reject(e)
      }
    })
  },

  // 手动触发云端同步
  triggerCloudSync() {
    wx.vibrateShort({ type: VIBRATE_TYPE })
    
    if (!app.isCloudSyncEnabled()) {
      wx.showToast({
        title: '请先开启云同步',
        icon: 'none'
      })
      return
    }
    
    // 同步本地日志到云端
    this.syncLocalLogsToCloud()
  },

  // 将本地所有日志同步到云端
  syncLocalLogsToCloud() {
    wx.showLoading({ title: '同步中...' })
    
    try {
      const localLogs = wx.getStorageSync('contactLogs') || []
      
      if (localLogs.length === 0) {
        wx.hideLoading()
        wx.showToast({
          title: '本地暂无日志',
          icon: 'none'
        })
        return
      }
      
      const db = wx.cloud.database()
      const collection = db.collection(app.CLOUD_LOGS_CONFIG.collectionName)
      
      // 先清空云端（可选策略，也可以选择追加）
      collection.get().then(res => {
        const existingLogs = res.data || []
        const deleteTasks = existingLogs.map(log => 
          collection.doc(log._id).remove()
        )
        
        return Promise.all(deleteTasks).then(() => {
          // 删除完成后，添加本地日志到云端
          return this.addLogsToCloud(localLogs)
        })
      }).catch(() => {
        // 如果获取失败，直接尝试添加
        return this.addLogsToCloud(localLogs)
      })
    } catch (e) {
      wx.hideLoading()
      console.error('同步本地日志到云端失败', e)
      wx.showToast({
        title: '同步失败',
        icon: 'none'
      })
    }
  },

  // 将日志批量添加到云端
  addLogsToCloud(logs) {
    const db = wx.cloud.database()
    const collection = db.collection(app.CLOUD_LOGS_CONFIG.collectionName)
    const maxCount = 100
    
    // 只同步最新的N条
    const logsToSync = logs.slice(0, maxCount)
    
    const tasks = logsToSync.map(log => {
      return collection.add({
        data: {
          ...log,
          _syncTime: db.serverDate()
        }
      })
    })
    
    Promise.all(tasks).then(results => {
      wx.hideLoading()
      wx.showToast({
        title: `已同步 ${results.length} 条`,
        icon: 'success'
      })
      console.log(`已同步 ${results.length} 条日志到云端`)
    }).catch(err => {
      wx.hideLoading()
      console.error('批量同步日志失败', err)
      wx.showToast({
        title: '同步失败',
        icon: 'none'
      })
    })
  },


  resetForm() {
    this.initDateTime()
    this.setData({
      currentTimeType: 'BJT',
      'formData.callSign': '',
      'formData.weather': '',
      'formData.frequency': '',
      'formData.mode': '',
      'formData.equipment': '',
      'formData.antenna': '',
      'formData.rst': {
        myRst: { r: '', s: '', t: '' },
        theirRst: { r: '', s: '', t: '' }
      },
      'formData.qth': '',
      'formData.power': '',
      'formData.notes': '',
      callSuggestions: [],
      frequencySuggestions: [],
      isUHF: false,
      isVHF: false,
      rstPlusSelected: {
        myRst: false,
        theirRst: false
      },
      rstFocus: {
        theirRst: 'r',
        myRst: 'r'
      }
    }, () => {
      // 重置后聚焦到对方R输入框
      this.focusRstInput('theirRst', 'r')
    })
  },

  onShareAppMessage(res) {
    const app = getApp()
    const currentShareId = app.globalData.currentShareId
    const currentShareData = app.globalData.currentShareData
    const currentShareImage = app.globalData.currentShareImage
    
    if (currentShareId) {
      const myCallSign = currentShareData?.myCallSign || 'BA4IWA'
      const logCount = currentShareData?.logs?.length || 0
      
      // 清理当前分享数据
      app.globalData.currentShareId = null
      app.globalData.currentShareData = null
      app.globalData.currentShareImage = null
      
      // 重置分享状态
      this.setData({
        shareMode: false,
        selectedLogs: {},
        selectedLogsArray: [],
        shareDataReady: false,
        preparingShare: false
      })
      
      return {
        title: `${myCallSign}分享了${logCount}条通联记录（${SHARE_EXPIRE_DAYS}天有效）`,
        path: `/pages/logs/logs?shareId=${currentShareId}`,
        imageUrl: currentShareImage || '/images/cover.jpg'
      }
    }
    
    return {
      title: '业余无线电通联日志',
      path: '/pages/logs/logs',
      imageUrl: '/images/cover.jpg'
    }
  },

  onShareTimeline() {
    const app = getApp()
    const currentShareId = app.globalData.currentShareId
    const currentShareData = app.globalData.currentShareData
    const currentShareImage = app.globalData.currentShareImage
    
    if (currentShareId) {
      const myCallSign = currentShareData?.myCallSign || 'BA4IWA'
      const logCount = currentShareData?.logs?.length || 0
      
      // 重置分享状态
      this.setData({
        shareMode: false,
        selectedLogs: {},
        selectedLogsArray: [],
        shareDataReady: false,
        preparingShare: false
      })
      
      return {
        title: `${myCallSign}分享了${logCount}条通联记录（${SHARE_EXPIRE_DAYS}天有效）`,
        query: `shareId=${currentShareId}`,
        imageUrl: currentShareImage || '/images/cover.jpg'
      }
    }
    
    return {
      title: '业余无线电通联日志',
      query: '',
      imageUrl: '/images/cover.jpg'
    }
  }
})
