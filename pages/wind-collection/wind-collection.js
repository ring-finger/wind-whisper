const app = getApp()
const VIBRATE_TYPE = 'medium'

const THEMES = {
  radio: { name: '无线电', navBg: '#F9F7F4', navText: '#000000' },
  morandi: { name: '奶油莫兰迪', navBg: '#F8F2E9', navText: '#000000' }
}

// 本地缓存有效期（毫秒）
const CACHE_TTL = 5 * 60 * 1000
// 每次懒加载渲染的卡片数量
const PAGE_SIZE = 10
// 标签统计缓存键与有效期（与列表分开缓存，可异步补齐）
const TAGS_CACHE_KEY = 'windCollection_tags_v2'
const TAGS_CACHE_TTL = 60 * 1000
// 数据版本号缓存键（云端数据变更时递增，用于失效列表缓存）
const TAGS_VERSION_KEY = 'windCollection_tags_version'

Page({
  data: {
    currentTheme: 'radio',
    year: new Date().getFullYear(),
    tags: [{ name: '全部', count: 0 }],
    activeTag: '全部',
    fullList: [],       // 当前筛选条件下的全量数据（来自云数据库 / 本地缓存）
    displayList: [],    // 已渲染（懒加载）的卡片
    page: 0,
    hasMore: false,
    loading: false,
    // 管理弹窗状态
    manageOpen: false,
    manageMode: 'add', // 'add' | 'edit'
    form: { _id: '', title: '', description: '', appId: '', path: '', shortLink: '', tagsText: '', priority: '50' },
    // 管理员可见的控制按钮（新增 / 刷新统计）
    isAdmin: false,
    refreshing: false
  },

  onLoad() {
    this.loadTheme()
    this.checkAdmin()
    this.loadData('全部', false)
  },

  // 查询当前用户是否为管理员（决定新增 / 刷新按钮是否可见）
  checkAdmin() {
    wx.cloud.callFunction({
      name: 'windCollection',
      data: { action: 'isAdmin' }
    }).then(res => {
      if (res.result && res.result.success) {
        this.setData({ isAdmin: !!res.result.isAdmin })
      }
    }).catch(() => { /* 失败则保持不可见 */ })
  },

  loadTheme() {
    const saved = wx.getStorageSync('appTheme') || 'radio'
    const theme = THEMES[saved] ? saved : 'radio'
    this.setData({ currentTheme: theme })
  },

  onPullDownRefresh() {
    this.loadData(this.data.activeTag, true).then(() => wx.stopPullDownRefresh())
  },

  onReachBottom() {
    if (!this.data.hasMore || this.data.loading) return
    this.loadMore()
  },

  // 加载数据：先用本地缓存即时渲染首屏，再始终从云端拉取最新列表
  // （列表为单次查询、开销小；标签聚合已独立优化并持久化，避免卡顿）
  loadData(tag, force) {
    this.setData({ loading: true })
    const cacheKey = 'windCollection_' + tag
    const cached = this._readCache(cacheKey)
    // 先用缓存即时渲染首屏（若有），保证首屏速度
    if (cached) {
      this._applyData(tag, cached.data, this.data.tags)
    }

    return wx.cloud.callFunction({
      name: 'windCollection',
      data: { action: 'list', tag }
    }).then(res => {
      if (res.result && res.result.success) {
        const list = res.result.list || []
        const version = res.result.version || 0
        this._writeCache(cacheKey, list)
        wx.setStorageSync(TAGS_VERSION_KEY, version) // 记录数据版本，用于失效判断
        // 用云端最新数据覆盖（即便刚用缓存渲染过，也无缝更新）
        this._applyData(tag, list, this.data.tags)
      } else if (!cached) {
        // 无缓存且拉取失败才提示
        this._applyData(tag, [], this.data.tags)
        wx.showToast({ title: '加载失败', icon: 'none' })
      }
    }).catch(err => {
      console.error('[windCollection] 加载失败', err)
      if (!cached) {
        this._applyData(tag, [], this.data.tags)
        wx.showToast({ title: '加载失败', icon: 'none' })
      }
    }).then(() => {
      this.setData({ loading: false })
      this._ensureTags() // 首屏渲染后异步补齐标签数量，避免阻塞
    })
  },

  // 异步加载标签统计（独立 action，不阻塞首屏）
  // 统计走单文档读取 + count 轻量自检，开销极小；始终拉取以保证数量最新
  _ensureTags() {
    wx.cloud.callFunction({
      name: 'windCollection',
      data: { action: 'tags' }
    }).then(res => {
      console.log('[windCollection] tags 原始返回:', JSON.stringify(res.result))
      if (res.result && res.result.success) {
        const allTags = res.result.allTags || []
        const version = res.result.version || 0
        this._writeCache(TAGS_CACHE_KEY, allTags)
        this.setData({ tags: this._normalizeTags(allTags) })
        // 数据版本变化（有人增删改过数据）→ 列表缓存已失效，清掉并强制刷新
        const prevVersion = wx.getStorageSync(TAGS_VERSION_KEY) || 0
        if (prevVersion && prevVersion !== version) {
          this._clearListCaches()
          this.loadData(this.data.activeTag, true)
        }
        wx.setStorageSync(TAGS_VERSION_KEY, version)
      }
    }).catch(err => {
      console.error('[windCollection] 标签统计失败', err)
    })
  },

  // 清除所有按标签缓存的列表数据（保留标签统计相关缓存）
  _clearListCaches() {
    try {
      const info = wx.getStorageInfoSync()
      info.keys.forEach(k => {
        if (k.indexOf('windCollection_') === 0 && k !== TAGS_CACHE_KEY && k !== TAGS_VERSION_KEY) {
          wx.removeStorageSync(k)
        }
      })
    } catch (e) { /* 忽略 */ }
  },

  // 应用数据并重置分页（按优先级已排序，直接切片懒加载）
  _applyData(tag, list, allTags) {
    const display = list.slice(0, PAGE_SIZE)
    this.setData({
      tags: this._normalizeTags(allTags),
      activeTag: tag,
      fullList: list,
      displayList: display,
      page: 1,
      hasMore: list.length > PAGE_SIZE
    })
  },

  // 兼容云函数返回格式：既支持 [{name,count}] 也兼容旧版纯字符串数组
  _normalizeTags(allTags) {
    if (!Array.isArray(allTags) || allTags.length === 0) {
      return [{ name: '全部', count: 0 }]
    }
    return allTags.map(t => {
      if (typeof t === 'string') return { name: t, count: 0 }
      return { name: t.name, count: typeof t.count === 'number' ? t.count : 0 }
    })
  },

  // 懒加载：从全量数据中追加下一页
  loadMore() {
    const { fullList, page } = this.data
    const next = page + 1
    const more = fullList.slice(0, next * PAGE_SIZE)
    this.setData({
      displayList: more,
      page: next,
      hasMore: more.length < fullList.length
    })
  },

  onTagTap(e) {
    const tag = e.currentTarget.dataset.tag
    if (tag === this.data.activeTag) return
    wx.vibrateShort({ type: VIBRATE_TYPE })
    this.loadData(tag, false)
  },

  onCardTap(e) {
    const index = e.currentTarget.dataset.index
    const item = this.data.fullList[index]
    if (!item) return
    wx.vibrateShort({ type: VIBRATE_TYPE })
    if (item.appId) {
      // 小程序卡片（appId 方式）：跳转对应小程序
      wx.navigateToMiniProgram({
        appId: item.appId,
        path: item.path || '',
        extraData: item.extraData || {},
        envVersion: item.envVersion || 'release',
        success: () => {},
        fail: (err) => {
          // 用户主动「取消」跳转属于正常操作，静默关闭，不提示错误
          if (err && /cancel/i.test(err.errMsg || '')) return
          console.error('[windCollection] 跳转小程序失败', err)
          wx.showToast({ title: '跳转失败，请确认已在 app.json 配置该 appId', icon: 'none' })
        }
      })
    } else if (item.shortLink) {
      // 小程序卡片（shortLink 方式）：无需 appId / path
      wx.navigateToMiniProgram({
        shortLink: item.shortLink,
        success: () => {},
        fail: (err) => {
          // 用户主动「取消」跳转属于正常操作，静默关闭，不提示错误
          if (err && /cancel/i.test(err.errMsg || '')) return
          console.error('[windCollection] 跳转小程序失败', err)
          wx.showToast({ title: '跳转失败', icon: 'none' })
        }
      })
    } else {
      wx.showToast({ title: '暂无可跳转方式', icon: 'none' })
    }
  },

  // ===== 数据管理（新增 / 编辑 / 删除，走云函数 manage action）=====
  noop() {},

  openAdd() {
    this.setData({
      manageOpen: true,
      manageMode: 'add',
      form: { _id: '', title: '', description: '', appId: '', path: '', shortLink: '', tagsText: '', priority: '50' }
    })
  },

  // 强制刷新标签统计（重新聚合并入库，走云函数 refreshTags action，仅管理员）
  onRefreshTags() {
    if (this.data.refreshing) return
    this.setData({ refreshing: true })
    wx.showLoading({ title: '统计中' })
    wx.cloud.callFunction({
      name: 'windCollection',
      data: { action: 'refreshTags' }
    }).then(res => {
      if (res.result && res.result.success) {
        const allTags = res.result.allTags || []
        this.setData({ tags: allTags })
        wx.setStorageSync(TAGS_CACHE_KEY, { ts: Date.now(), data: allTags })
        wx.showToast({ title: '统计已更新', icon: 'success' })
        this.loadData(this.data.activeTag, true) // 同步刷新列表
      } else {
        wx.showToast({ title: (res.result && res.result.message) || '刷新失败', icon: 'none' })
      }
    }).catch(() => {
      wx.showToast({ title: '刷新失败', icon: 'none' })
    }).then(() => {
      wx.hideLoading()
      this.setData({ refreshing: false })
    })
  },

  onCardLongPress(e) {
    const index = e.currentTarget.dataset.index
    const item = this.data.fullList[index]
    if (!item) return
    this.setData({
      manageOpen: true,
      manageMode: 'edit',
      form: {
        _id: item._id,
        title: item.title,
        description: item.description,
        appId: item.appId || '',
        path: item.path || '',
        shortLink: item.shortLink || '',
        tagsText: (item.tags || []).join('，'),
        priority: String(item.priority || 0)
      }
    })
  },

  closeManage() {
    this.setData({ manageOpen: false })
  },

  onFormInput(e) {
    const field = e.currentTarget.dataset.field
    this.setData({ ['form.' + field]: e.detail.value })
  },

  saveManage() {
    const f = this.data.form
    if (!f.title.trim()) {
      wx.showToast({ title: '请填写名称', icon: 'none' })
      return
    }
    const tags = f.tagsText.split(/[，,\s]+/).map(s => s.trim()).filter(Boolean)
    const payload = {
      title: f.title.trim(),
      description: f.description.trim(),
      appId: f.appId.trim(),
      path: f.path.trim(),
      shortLink: f.shortLink.trim(),
      tags,
      priority: Number(f.priority) || 0
    }
    if (this.data.manageMode === 'edit') payload._id = f._id
    const action = this.data.manageMode === 'edit' ? 'update' : 'add'
    wx.showLoading({ title: '保存中' })
    wx.cloud.callFunction({
      name: 'windCollection',
      data: { action, data: payload }
    }).then(res => {
      if (res.result && res.result.success) {
        wx.showToast({ title: '已保存' })
        this.setData({ manageOpen: false })
        this.loadData(this.data.activeTag, true)
      } else {
        const msg = (res.result && res.result.message) || '保存失败'
        wx.showToast({ title: msg, icon: 'none' })
      }
    }).catch(() => {
      wx.showToast({ title: '保存失败', icon: 'none' })
    }).then(() => wx.hideLoading())
  },

  deleteItem() {
    const f = this.data.form
    if (!f._id) return
    wx.showModal({
      title: '确认删除',
      content: f.title,
      success: (r) => {
        if (!r.confirm) return
        wx.showLoading({ title: '删除中' })
        wx.cloud.callFunction({
          name: 'windCollection',
          data: { action: 'remove', data: { _id: f._id } }
        }).then(res => {
          if (res.result && res.result.success) {
            wx.showToast({ title: '已删除' })
            this.setData({ manageOpen: false })
            this.loadData(this.data.activeTag, true)
          } else {
            wx.showToast({ title: (res.result && res.result.message) || '删除失败', icon: 'none' })
          }
        }).catch(() => {
          wx.showToast({ title: '删除失败', icon: 'none' })
        }).then(() => wx.hideLoading())
      }
    })
  },

  _readCache(key) {
    try {
      const raw = wx.getStorageSync(key)
      return raw ? JSON.parse(raw) : null
    } catch (e) {
      return null
    }
  },

  _writeCache(key, data) {
    try {
      wx.setStorageSync(key, JSON.stringify({ ts: Date.now(), data }))
    } catch (e) { /* 忽略 */ }
  }
})
