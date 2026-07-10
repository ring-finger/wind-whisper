/**
 * QSL 卡片设计器
 * - 竖版/横版切换
 * - 正面/反面设计
 * - 拖拽文字和图标
 * - 辅助对齐线
 * - 出血边距
 *
 * 尺寸体系（2px/mm）：
 *   标准尺寸: 140×90mm
 *   出血尺寸: 144×94mm（每边 +2mm）
 *   横版裁切: 280x180px  出血: 4px  舞台: 288x188px
 *   竖版裁切: 180x280px  出血: 4px  舞台: 188x288px
 */

const iconList = require('./icons-list')
const modeList = require('./modes-list')
const app = getApp()

const VIBRATE_TYPE = 'light'

// 比例: 2px = 1mm
const SCALE = 2
const BLEED_MM = 2             // (144-140)/2 = 2mm 每边
const BLEED = BLEED_MM * SCALE // 4px

// 裁切尺寸 (px) — 标准 140×90mm
const SIZE = {
  horizontal: { w: 140 * SCALE, h: 90 * SCALE },  // 280 x 180
  vertical:   { w: 90 * SCALE, h: 140 * SCALE }    // 180 x 280
}

// 预设文字（由用户选择添加到正面或反面）
const PRESET_TEXTS = [
  {
    key: 'chinese',
    label: '中国电台(中文)',
    text: '中华人民共和国个人业余电台',
    fontSize: 16,
    color: '#333',
    fontWeight: 'bold'
  },
  {
    key: 'english',
    label: '中国电台(英文)',
    text: 'Personal Amateur Radio Station of P.R.China',
    fontSize: 12,
    color: '#666',
    fontWeight: 'normal'
  }
]

Page({
  data: {
    layout: 'horizontal',   // horizontal | vertical
    currentSide: 'front',   // front | back
    currentTheme: 'radio',
    stageWidth: 0,
    stageHeight: 0,
    trimW: 0,                 // 裁切区域宽（导出用）
    trimH: 0,                 // 裁切区域高（导出用）
    stageScale: 1,           // 舞台缩放比例（根据屏幕动态计算）
    bleed: BLEED,

    // 元素数据 { front: [], back: [] }
    elements: { front: [], back: [] },
    currentElements: [],
    selectedId: '',

    // 背景图 { front: '', back: '' }
    bgImages: { front: '', back: '' },
    currentBg: '',
    bgIsTemplate: { front: false, back: false },
    currentBgIsTemplate: false,

    // 当前面背景位移
    currentBgOffsetX: 0,
    currentBgOffsetY: 0,

    // 背景位移（用于手动调整背景位置）{ front: {x:0,y:0}, back: {x:0,y:0} }
    bgOffsets: { front: { x: 0, y: 0 }, back: { x: 0, y: 0 } },
    // 背景缩放 { front: 1, back: 1 }
    bgScales: { front: 1, back: 1 },
    currentBgScale: 1,
    // 背景旋转角度 { front: 0, back: 0 }
    bgRotations: { front: 0, back: 0 },
    currentBgRotation: 0,
    bgAdjustMode: false,        // 背景调整模式
    bgDragging: false,
    bgDragStartX: 0,
    bgDragStartY: 0,
    bgDragOrigX: 0,
    bgDragOrigY: 0,
    // 双指缩放
    bgPinching: false,
    bgPinchStartDist: 0,
    bgPinchOrigScale: 1,

    // 辅助线（仅在拖拽时显示）
    guideLines: { h: [], v: [] },
    showGuidelines: false,

    // 编辑弹窗
    showEditModal: false,
    editingId: '',
    editForm: { text: '', fontSize: 14, color: '#333', fontWeight: 'normal', fontFamily: 'serif' },

    fontOptions: [
      { label: '宋体', value: 'serif' },
      { label: '黑体', value: 'sans-serif' },
      { label: '楷体', value: 'KaiTi, serif' },
      { label: '仿宋', value: 'FangSong, serif' },
      { label: '微软雅黑', value: 'Microsoft YaHei, sans-serif' },
      { label: '等宽', value: 'monospace' },
      { label: '手写体', value: 'cursive' }
    ],

    // 图标选择器
    showIconPicker: false,
    iconPickerMode: 'element', // 'element' | 'background'
    iconList: iconList,

    // 模板选择器（仅反面可用）
    showTemplatePicker: false,
    templateList: modeList,

    // 预设文字选择器（合并到添加文字弹窗中）
    showTextPicker: false,
    textPickerForm: { text: '' },
    presetTexts: PRESET_TEXTS,

    colorPresets: [
      '#333333', '#666666', '#999999',
      '#e74c3c', '#e67e22', '#f1c40f',
      '#27ae60', '#2980b9', '#8e44ad',
      '#2c3e50', '#1abc9c', '#c0392b'
    ],

    // 拖拽状态
    dragging: false,
    dragStartX: 0,
    dragStartY: 0,
    dragOrigX: 0,
    dragOrigY: 0,

    // 缩放状态
    resizing: false,
    resizeStartX: 0,
    resizeStartY: 0,
    resizeOrigW: 0,
    resizeOrigH: 0,
    resizeOrigRatio: 1,
    resizeOrigFontSize: 14,
    resizeMinSize: 30,

    // 导出
    showExportModal: false,
    exportFormat: 'image',    // 'image' | 'pdf'
    exportRange: 'all',       // 'current' | 'all'
    exportScale: 2,           // 分辨率倍率
    exporting: false
  },

  // ==================== 生命周期 ====================

  onLoad() {
    this._elemId = 0
    this._dpr = wx.getDeviceInfo().pixelRatio || 2
    this.loadTheme()
    this._loadDesign()
    this._initStage()

    // 初始化分享缓存
    this._cache = this._cache || {}
    this._cache.shareImagePath = ''

    // 预生成分享图片
    setTimeout(() => this._generateShareCard(), 1000)
  },

  onShow() {
    this.loadTheme()
  },

  onReady() {
    this._recalcGuideLines()
  },

  onResize() {
    this._calcStageScale()
  },

  // ==================== 主题 ====================

  loadTheme() {
    try {
      const savedTheme = wx.getStorageSync('appTheme') || 'radio'
      this.setData({ currentTheme: savedTheme })
    } catch (e) {
      console.error('加载主题失败', e)
    }
  },

  // ==================== 初始化 ====================

  _initStage() {
    const size = SIZE[this.data.layout]
    this.setData({
      stageWidth: size.w + BLEED * 2,
      stageHeight: size.h + BLEED * 2,
      trimW: size.w,
      trimH: size.h
    })
    this._calcStageScale()
  },

  /** 根据屏幕可用空间计算舞台缩放比例 */
  _calcStageScale() {
    const windowInfo = wx.getWindowInfo()
    const screenW = windowInfo.windowWidth
    const screenH = windowInfo.windowHeight

    const topBarH = 44  // 顶部栏 + 导航栏 ≈ 44px
    const bottomH = 150  // 提示 + 缩略图 + 工具栏
    const availW = screenW - 16
    const availH = screenH - topBarH - bottomH - 10

    const stageW = this.data.stageWidth
    const stageH = this.data.stageHeight
    const scale = Math.min(availW / stageW, availH / stageH, 1.5)

    this.setData({ stageScale: Math.max(0.4, scale) })
  },

  /** 生成唯一元素 ID */
  _nextId() {
    return 'el_' + (++this._elemId)
  },


  /** 估算文字在 serif 字体下的渲染宽度（px） */
  _estimateTextWidth(text, fontSize) {
    let width = 0
    for (const ch of text || '') {
      if (/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/.test(ch)) {
        // CJK 字符 ≈ fontSize
        width += fontSize * 0.95
      } else if (ch === ' ') {
        width += fontSize * 0.28
      } else {
        // 英文字母/数字/标点 ≈ fontSize * 0.52
        width += fontSize * 0.52
      }
    }
    return Math.max(40, Math.ceil(width))
  },


  // ==================== 布局切换 ====================

  switchLayout(e) {
    wx.vibrateShort({ type: VIBRATE_TYPE })
    const layout = e.currentTarget.dataset.layout
    if (layout === this.data.layout) return

    // 转换所有元素坐标到新比例
    const oldSize = SIZE[this.data.layout]
    const newSize = SIZE[layout]

    const convert = (elems) => elems.map(el => ({
      ...el,
      x: Math.round((el.x - BLEED) * (newSize.w / oldSize.w)) + BLEED,
      y: Math.round((el.y - BLEED) * (newSize.h / oldSize.h)) + BLEED
    }))

    const elements = {
      front: convert(this.data.elements.front),
      back: convert(this.data.elements.back)
    }

    this.setData({
      layout,
      elements,
      selectedId: '',
      bgAdjustMode: false,
      bgOffsets: { front: { x: 0, y: 0 }, back: { x: 0, y: 0 } },
      bgScales: { front: 1, back: 1 },
      bgRotations: { front: 0, back: 0 },
      currentBgOffsetX: 0,
      currentBgOffsetY: 0,
      currentBgScale: 1,
      currentBgRotation: 0,
      stageWidth: newSize.w + BLEED * 2,
      stageHeight: newSize.h + BLEED * 2,
      trimW: newSize.w,
      trimH: newSize.h
    })
    this._calcStageScale()
    this._refreshCurrentSide()
    this._recalcGuideLines()
    this._autoSave()
  },

  // ==================== 正反面切换 ====================

  switchSide(e) {
    wx.vibrateShort({ type: VIBRATE_TYPE })
    const side = e.currentTarget.dataset.side
    if (side === this.data.currentSide) return
    this.setData({ currentSide: side, selectedId: '', bgAdjustMode: false })
    this._refreshCurrentSide()
    this._recalcGuideLines()
  },

  _refreshCurrentSide() {
    const side = this.data.currentSide
    const elems = this.data.elements[side] || []
    const offset = (this.data.bgOffsets && this.data.bgOffsets[side]) || { x: 0, y: 0 }
    const bgScale = (this.data.bgScales && this.data.bgScales[side]) || 1
    const bgRotation = (this.data.bgRotations && this.data.bgRotations[side]) || 0
    const bgIsTemplate = (this.data.bgIsTemplate && this.data.bgIsTemplate[side]) || false
    this.setData({
      currentElements: elems,
      currentBg: this.data.bgImages[side] || '',
      currentBgIsTemplate: bgIsTemplate,
      currentBgOffsetX: offset.x,
      currentBgOffsetY: offset.y,
      currentBgScale: bgScale,
      currentBgRotation: bgRotation
    })
  },

  // ==================== 元素拖拽 ====================

  selectElement(e) {
    const id = e.currentTarget.dataset.id
    if (id === this.data.selectedId) return
    this.setData({ selectedId: id })
    this._recalcGuideLines()
  },

  onTouchStart(e) {
    // 缩放进行中或点击删除/缩放按钮时不触发拖拽（允许子控件响应事件）
    if (this.data.resizing || e.target.dataset.delete || e.target.dataset.resize) return
    const id = e.currentTarget.dataset.id
    const touch = e.touches[0]
    const elem = this.data.currentElements.find(el => el.id === id)
    if (!elem) return

    this.setData({
      selectedId: id,
      dragging: true,
      showGuidelines: true,  // 开始拖拽才显示辅助线
      dragStartX: touch.pageX,
      dragStartY: touch.pageY,
      dragOrigX: elem.x,
      dragOrigY: elem.y
    })
    this._recalcGuideLines(elem)
  },

  onTouchMove(e) {
    if (!this.data.dragging) return
    const touch = e.touches[0]
    const scale = this.data.stageScale
    const dx = (touch.pageX - this.data.dragStartX) / scale
    const dy = (touch.pageY - this.data.dragStartY) / scale
    const id = this.data.selectedId

    let newX = this.data.dragOrigX + dx
    let newY = this.data.dragOrigY + dy

    // 对齐吸附（传入元素宽高以支持左/右/上/下/居中对齐）
    const elem = this.data.currentElements.find(el => el.id === this.data.selectedId)
    const elemW = elem ? (elem.width || 40) : 0
    const elemH = elem ? (elem.height || 30) : 0
    const snapped = this._snapToGuides(newX, newY, id, elemW, elemH)
    newX = snapped.x
    newY = snapped.y

    // 限制在舞台内（允许进入出血区）
    const maxX = this.data.stageWidth - 40
    const maxY = this.data.stageHeight - 24
    newX = Math.max(0, Math.min(maxX, newX))
    newY = Math.max(0, Math.min(maxY, newY))

    this._updateElementPosition(id, newX, newY)
  },

  onTouchEnd() {
    if (!this.data.dragging) return
    this.setData({ dragging: false, showGuidelines: false })  // 结束拖拽隐藏辅助线
    wx.vibrateShort({ type: VIBRATE_TYPE })
    this._autoSave()
  },

  // ==================== 元素缩放 ====================

  onResizeStart(e) {
    const touch = e.touches[0]
    const elem = this.data.currentElements.find(el => el.id === this.data.selectedId)
    if (!elem) return

    this.setData({
      resizing: true,
      resizeStartX: touch.pageX,
      resizeStartY: touch.pageY,
      resizeOrigW: elem.width || 80,
      resizeOrigH: elem.height || 30,
      resizeOrigFontSize: elem.fontSize || 14,
      resizeOrigRatio: elem.naturalRatio || ((elem.width || 80) / (elem.height || 30))
    })
    wx.vibrateShort({ type: VIBRATE_TYPE })
  },

  onResizeMove(e) {
    if (!this.data.resizing) return
    const touch = e.touches[0]
    const scale = this.data.stageScale
    const dx = (touch.pageX - this.data.resizeStartX) / scale
    const dy = (touch.pageY - this.data.resizeStartY) / scale

    const elem = this.data.currentElements.find(el => el.id === this.data.selectedId)
    if (!elem) return

    let newW = this.data.resizeOrigW + dx
    let newH = this.data.resizeOrigH + dy
    let newFontSize = this.data.resizeOrigFontSize

    // 图片类型保持宽高比
    if (elem.type === 'image') {
      const ratio = this.data.resizeOrigRatio || (this.data.resizeOrigW / this.data.resizeOrigH)
      if (Math.abs(dx) >= Math.abs(dy)) {
        newW = Math.max(this.data.resizeMinSize, newW)
        newH = Math.round(newW / ratio)
      } else {
        newH = Math.max(this.data.resizeMinSize, newH)
        newW = Math.round(newH * ratio)
      }
    } else {
      newW = Math.max(this.data.resizeMinSize, newW)
      newH = Math.max(this.data.resizeMinSize, newH)
      // 文字缩放：取宽高变化比例的最大值，确保文字与边框同步缩放
      const wRatio = newW / this.data.resizeOrigW
      const hRatio = newH / this.data.resizeOrigH
      const scaleRatio = Math.max(wRatio, hRatio)
      newFontSize = Math.round(Math.max(6, this.data.resizeOrigFontSize * scaleRatio))
    }

    // 限制在舞台内
    newW = Math.min(newW, this.data.stageWidth - elem.x)
    newH = Math.min(newH, this.data.stageHeight - elem.y)

    this._updateElementSize(elem.id, Math.round(newW), Math.round(newH), newFontSize)
  },

  onResizeEnd() {
    if (!this.data.resizing) return
    this.setData({ resizing: false })
    wx.vibrateShort({ type: VIBRATE_TYPE })
    this._autoSave()
  },

  // ==================== 背景调整 ====================

  /** 进入背景调整模式 */
  enterBgAdjustMode() {
    if (!this.data.currentBg) {
      wx.showToast({ title: '请先添加背景图', icon: 'none' })
      return
    }
    wx.vibrateShort({ type: VIBRATE_TYPE })
    this.setData({ bgAdjustMode: true, selectedId: '' })
  },

  /** 退出背景调整模式 */
  exitBgAdjustMode() {
    this.setData({ bgAdjustMode: false, bgDragging: false, bgPinching: false })
    this._autoSave()
  },

  /** 重置背景位置和缩放到默认 */
  resetBgOffset() {
    const side = this.data.currentSide
    this.setData({
      [`bgOffsets.${side}.x`]: 0,
      [`bgOffsets.${side}.y`]: 0,
      [`bgScales.${side}`]: 1,
      [`bgRotations.${side}`]: 0,
      currentBgOffsetX: 0,
      currentBgOffsetY: 0,
      currentBgScale: 1,
      currentBgRotation: 0
    })
    wx.vibrateShort({ type: VIBRATE_TYPE })
    wx.showToast({ title: '背景已重置', icon: 'success', duration: 1200 })
    this._autoSave()
  },

  /** 背景拖拽/缩放开始 */
  onBgTouchStart(e) {
    // 正在拖拽或缩放元素时不响应背景层事件
    if (this.data.dragging || this.data.resizing) return
    if (!this.data.bgAdjustMode) {
      // 非调整模式：点击空白区域取消选中
      this.setData({ selectedId: '' })
      return
    }
    if (!this.data.currentBg) return

    const touches = e.touches
    if (touches.length >= 2) {
      // 双指缩放
      const dx = touches[0].pageX - touches[1].pageX
      const dy = touches[0].pageY - touches[1].pageY
      const dist = Math.sqrt(dx * dx + dy * dy)
      this.setData({
        bgPinching: true,
        bgDragging: false,
        bgPinchStartDist: dist,
        bgPinchOrigScale: this.data.currentBgScale
      })
      return
    }

    const touch = touches[0]
    this.setData({
      bgDragging: true,
      bgPinching: false,
      bgDragStartX: touch.pageX,
      bgDragStartY: touch.pageY,
      bgDragOrigX: this.data.currentBgOffsetX,
      bgDragOrigY: this.data.currentBgOffsetY
    })
  },

  /** 背景拖拽移动 / 双指缩放 */
  onBgTouchMove(e) {
    if (!this.data.bgAdjustMode) return

    if (this.data.bgPinching && e.touches.length >= 2) {
      // 双指缩放
      const touches = e.touches
      const dx = touches[0].pageX - touches[1].pageX
      const dy = touches[0].pageY - touches[1].pageY
      const dist = Math.sqrt(dx * dx + dy * dy)
      if (this.data.bgPinchStartDist > 0) {
        const ratio = dist / this.data.bgPinchStartDist
        const newScale = Math.max(0.5, Math.min(3, this.data.bgPinchOrigScale * ratio))
        this.setData({ currentBgScale: +newScale.toFixed(2) })
      }
      return
    }

    if (!this.data.bgDragging) return
    const touch = e.touches[0]
    const stageScale = this.data.stageScale
    const dx = (touch.pageX - this.data.bgDragStartX) / stageScale
    const dy = (touch.pageY - this.data.bgDragStartY) / stageScale

    this.setData({
      currentBgOffsetX: Math.round(this.data.bgDragOrigX + dx),
      currentBgOffsetY: Math.round(this.data.bgDragOrigY + dy)
    })
  },

  /** 背景拖拽/缩放结束 */
  onBgTouchEnd(e) {
    const side = this.data.currentSide
    if (this.data.bgPinching) {
      this.setData({
        bgPinching: false,
        [`bgScales.${side}`]: this.data.currentBgScale
      })
      wx.vibrateShort({ type: VIBRATE_TYPE })
      this._autoSave()
      return
    }
    if (!this.data.bgDragging) return
    this.setData({
      bgDragging: false,
      [`bgOffsets.${side}.x`]: this.data.currentBgOffsetX,
      [`bgOffsets.${side}.y`]: this.data.currentBgOffsetY
    })
    wx.vibrateShort({ type: VIBRATE_TYPE })
    this._autoSave()
  },

  _updateElementSize(id, w, h, fontSize) {
    const side = this.data.currentSide
    const elems = this.data.elements[side].map(el => {
      if (el.id !== id) return el
      const updated = { ...el, width: w, height: h }
      if (el.type === 'text' && fontSize !== undefined) {
        updated.fontSize = fontSize
        // 文字元素的宽高从内容+字号重新计算，确保边框贴合文字
        updated.width = this._estimateTextWidth(el.text, fontSize)
        updated.height = Math.ceil(fontSize * 1.4)
      }
      return updated
    })
    this.setData({
      [`elements.${side}`]: elems,
      currentElements: elems
    })
  },

  /** 对齐吸附：支持左/右/上/下边缘及居中对齐 */
  _snapToGuides(x, y, selfId, elemW, elemH) {
    const SNAP = 8  // 吸附阈值 px
    let snappedX = x
    let snappedY = y

    // 垂直辅助线（x 方向吸附）：左边缘、右边缘、水平居中
    for (const g of this.data.guideLines.v) {
      if (!g.snappable) continue
      if (Math.abs(x - g.pos) < SNAP) { snappedX = g.pos; break }
      if (elemW && Math.abs(x + elemW - g.pos) < SNAP) { snappedX = g.pos - elemW; break }
      if (elemW && Math.abs(x + elemW / 2 - g.pos) < SNAP) { snappedX = g.pos - elemW / 2; break }
    }
    // 水平辅助线（y 方向吸附）：上边缘、下边缘、垂直居中
    for (const g of this.data.guideLines.h) {
      if (!g.snappable) continue
      if (Math.abs(y - g.pos) < SNAP) { snappedY = g.pos; break }
      if (elemH && Math.abs(y + elemH - g.pos) < SNAP) { snappedY = g.pos - elemH; break }
      if (elemH && Math.abs(y + elemH / 2 - g.pos) < SNAP) { snappedY = g.pos - elemH / 2; break }
    }

    return { x: snappedX, y: snappedY }
  },

  _updateElementPosition(id, x, y) {
    const side = this.data.currentSide
    const elems = this.data.elements[side].map(el =>
      el.id === id ? { ...el, x, y } : el
    )
    this.setData({
      [`elements.${side}`]: elems,
      currentElements: elems
    })
  },

  // ==================== 辅助线 ====================

  _recalcGuideLines(selectedElem) {
    const size = SIZE[this.data.layout]
    const trimL = BLEED
    const trimR = BLEED + size.w
    const trimT = BLEED
    const trimB = BLEED + size.h

    // 裁切线：仅视觉参考（红色虚线），不吸附
    const hLines = [
      { key: 'h-trim-t',   pos: trimT, isCenter: false, snappable: false, type: 'trim' },
      { key: 'h-trim-b',   pos: trimB, isCenter: false, snappable: false, type: 'trim' },
      { key: 'h-center',   pos: trimT + size.h / 2, isCenter: true, snappable: true },
      { key: 'h-third-1',  pos: trimT + size.h / 3, isCenter: false, snappable: true },
      { key: 'h-third-2',  pos: trimT + size.h * 2 / 3, isCenter: false, snappable: true }
    ]

    const vLines = [
      { key: 'v-trim-l',   pos: trimL, isCenter: false, snappable: false, type: 'trim' },
      { key: 'v-trim-r',   pos: trimR, isCenter: false, snappable: false, type: 'trim' },
      { key: 'v-center',   pos: trimL + size.w / 2, isCenter: true, snappable: true },
      { key: 'v-third-1',  pos: trimL + size.w / 3, isCenter: false, snappable: true },
      { key: 'v-third-2',  pos: trimL + size.w * 2 / 3, isCenter: false, snappable: true }
    ]

    // 拖拽时：基于其他元素生成对齐辅助线（左/右/上/下/居中）
    if (selectedElem) {
      const side = this.data.currentSide
      const otherElems = (this.data.elements[side] || []).filter(el => el.id !== selectedElem.id)
      for (const other of otherElems) {
        const oW = other.width || 40
        const oH = other.height || 30
        const oLeft = other.x
        const oRight = other.x + oW
        const oTop = other.y
        const oBottom = other.y + oH
        const oCX = other.x + oW / 2
        const oCY = other.y + oH / 2

        vLines.push({ key: `v-el-left-${other.id}`,  pos: oLeft,  isCenter: false, snappable: true, type: 'element' })
        vLines.push({ key: `v-el-right-${other.id}`, pos: oRight, isCenter: false, snappable: true, type: 'element' })
        vLines.push({ key: `v-el-cx-${other.id}`,    pos: oCX,    isCenter: true,  snappable: true, type: 'element' })

        hLines.push({ key: `h-el-top-${other.id}`,   pos: oTop,   isCenter: false, snappable: true, type: 'element' })
        hLines.push({ key: `h-el-bottom-${other.id}`, pos: oBottom, isCenter: false, snappable: true, type: 'element' })
        hLines.push({ key: `h-el-cy-${other.id}`,    pos: oCY,    isCenter: true,  snappable: true, type: 'element' })
      }
    }

    this.setData({ guideLines: { h: hLines, v: vLines } })
  },

  // ==================== 添加文字（统一入口：合并自定义+预设） ====================

  /** 打开添加文字弹窗 */
  openTextPicker() {
    wx.vibrateShort({ type: VIBRATE_TYPE })
    this.setData({
      showTextPicker: true,
      textPickerForm: { text: '' }
    })
  },

  closeTextPicker() {
    this.setData({ showTextPicker: false })
  },

  /** 文字弹窗表单字段变更 */
  onTextPickerFieldChange(e) {
    const { field } = e.currentTarget.dataset
    const val = e.detail ? (e.detail.value || '') : ''
    const form = { ...this.data.textPickerForm }
    form[field] = val
    this.setData({ textPickerForm: form })
  },

  /** 从自定义输入添加文字（字号/颜色统一在编辑中调整） */
  addCustomText() {
    const text = (this.data.textPickerForm.text || '').trim()
    if (!text) {
      wx.showToast({ title: '请输入文字', icon: 'none' })
      return
    }
    wx.vibrateShort({ type: VIBRATE_TYPE })

    const fontSize = 14
    const size = SIZE[this.data.layout]
    const tw = this._estimateTextWidth(text, fontSize)
    const th = Math.ceil(fontSize * 1.4)
    const elem = {
      id: this._nextId(),
      type: 'text',
      text,
      x: BLEED + (size.w - tw) / 2,
      y: BLEED + (size.h - th) / 2,
      width: tw,
      height: th,
      fontSize,
      color: '#333',
      fontFamily: 'serif',
      fontWeight: 'normal',
      rotation: 0
    }
    this._pushElement(elem)
    this.setData({ showTextPicker: false })
    this._autoSave()
  },

  /** 选择预设文字 */
  selectPresetText(e) {
    const { index } = e.currentTarget.dataset
    const preset = PRESET_TEXTS[index]
    if (!preset) return
    wx.vibrateShort({ type: VIBRATE_TYPE })

    const size = SIZE[this.data.layout]
    const tw = this._estimateTextWidth(preset.text, preset.fontSize)
    const th = Math.ceil(preset.fontSize * 1.4)
    const elem = {
      id: this._nextId(),
      type: 'text',
      text: preset.text,
      x: BLEED + (size.w - tw) / 2,
      y: BLEED + (size.h - th) / 2,
      width: tw,
      height: th,
      fontSize: preset.fontSize,
      color: preset.color,
      fontFamily: 'serif',
      fontWeight: preset.fontWeight,
      rotation: 0
    }
    this._pushElement(elem)
    this.setData({ showTextPicker: false })
    this._autoSave()
  },

  // ==================== 模板选择器（仅反面） ====================

  /** 打开模板选择器，按当前横竖版过滤 */
  openTemplatePicker() {
    wx.vibrateShort({ type: VIBRATE_TYPE })
    this.setData({
      templateList: modeList,
      showTemplatePicker: true
    })
  },

  closeTemplatePicker() {
    this.setData({ showTemplatePicker: false })
  },

  /** 清除模板：移除当前面的背景 */
  clearTemplate() {
    wx.vibrateShort({ type: VIBRATE_TYPE })
    const side = this.data.currentSide
    this.setData({
      [`bgImages.${side}`]: '',
      currentBg: '',
      [`bgIsTemplate.${side}`]: false,
      currentBgIsTemplate: false,
      [`bgOffsets.${side}.x`]: 0,
      [`bgOffsets.${side}.y`]: 0,
      [`bgScales.${side}`]: 1,
      [`bgRotations.${side}`]: 0,
      currentBgOffsetX: 0,
      currentBgOffsetY: 0,
      currentBgScale: 1,
      currentBgRotation: 0,
      showTemplatePicker: false,
      bgAdjustMode: false
    })
    this._autoSave()
  },

  /** 选择模板：完全填充卡片（设为背景，mode=aspectFill） */
  selectTemplate(e) {
    const { path, name, layout } = e.currentTarget.dataset
    // 仅允许匹配当前横竖版的模板
    if (layout !== this.data.layout) return
    const side = this.data.currentSide  // 总是 'back'
    wx.vibrateShort({ type: VIBRATE_TYPE })
    wx.showToast({ title: '已应用' + name, icon: 'success', duration: 1200 })

    this.setData({
      [`bgImages.${side}`]: path,
      currentBg: path,
      [`bgIsTemplate.${side}`]: true,
      currentBgIsTemplate: true,
      [`bgOffsets.${side}.x`]: 0,
      [`bgOffsets.${side}.y`]: 0,
      [`bgScales.${side}`]: 1,
      [`bgRotations.${side}`]: 0,
      currentBgOffsetX: 0,
      currentBgOffsetY: 0,
      currentBgScale: 1,
      currentBgRotation: 0,
      showTemplatePicker: false,
      bgAdjustMode: false
    })
    this._autoSave()
  },

  // ==================== 图标选择器 ====================
  openIconPicker() {
    wx.vibrateShort({ type: VIBRATE_TYPE })
    this.setData({ iconList: iconList, iconPickerMode: 'element', showIconPicker: true })
  },

  closeIconPicker() {
    this.setData({ showIconPicker: false })
  },

  /** 从相册选择自定义图片（图标选择器中 + 按钮） */
  selectCustomImage() {
    wx.vibrateShort({ type: VIBRATE_TYPE })
    wx.chooseImage({
      count: 1,
      sizeType: ['compressed'],
      sourceType: ['album'],
      success: (res) => {
        const path = res.tempFilePaths[0]
        // 内容安全审核
        app.checkImageSafety(path).then(safe => {
          if (!safe) return
          this._doSelectCustomImage(path)
        })
      }
    })
  },

  _doSelectCustomImage(path) {
    if (this.data.iconPickerMode === 'background') {
      const side = this.data.currentSide
      this.setData({
        [`bgImages.${side}`]: path,
        currentBg: path,
        [`bgIsTemplate.${side}`]: false,
        currentBgIsTemplate: false,
        [`bgOffsets.${side}.x`]: 0,
        [`bgOffsets.${side}.y`]: 0,
        [`bgScales.${side}`]: 1,
        [`bgRotations.${side}`]: 0,
        currentBgOffsetX: 0,
        currentBgOffsetY: 0,
        currentBgScale: 1,
        currentBgRotation: 0,
        showIconPicker: false
      })
      this._autoSave()
      return
    }
    // 作为图片元素添加
    wx.getImageInfo({
      src: path,
      success: (info) => {
            const ratio = info.width / info.height
            const MAX_INITIAL = 140
            let w, h
            if (ratio >= 1) {
              w = MAX_INITIAL
              h = Math.round(MAX_INITIAL / ratio)
            } else {
              h = MAX_INITIAL
              w = Math.round(MAX_INITIAL * ratio)
            }
            const size = SIZE[this.data.layout]
            const elem = {
              id: this._nextId(),
              type: 'image',
              src: path,
              x: BLEED + Math.round((size.w - w) / 2),
              y: BLEED + Math.round((size.h - h) / 2),
              width: w,
              height: h,
              naturalRatio: ratio,
              rotation: 0
            }
            this._pushElement(elem)
            this.setData({ showIconPicker: false })
            this._autoSave()
          },
          fail: () => {
            // 默认尺寸
            const size = SIZE[this.data.layout]
            const elem = {
              id: this._nextId(),
              type: 'image',
              src: path,
              x: BLEED + Math.round((size.w - 100) / 2),
              y: BLEED + Math.round((size.h - 100) / 2),
              width: 100,
              height: 100,
              naturalRatio: 1,
              rotation: 0
            }
            this._pushElement(elem)
            this.setData({ showIconPicker: false })
            this._autoSave()
          }
        })
  },

  selectIcon(e) {
    const { path, naturalw: preW, naturalh: preH } = e.currentTarget.dataset

    if (this.data.iconPickerMode === 'background') {
      // 设为背景，重置偏移量和缩放（非模板背景）
      const side = this.data.currentSide
      this.setData({
        [`bgImages.${side}`]: path,
        currentBg: path,
        [`bgIsTemplate.${side}`]: false,
        currentBgIsTemplate: false,
        [`bgOffsets.${side}.x`]: 0,
        [`bgOffsets.${side}.y`]: 0,
        [`bgScales.${side}`]: 1,
        [`bgRotations.${side}`]: 0,
        currentBgOffsetX: 0,
        currentBgOffsetY: 0,
        currentBgScale: 1,
        currentBgRotation: 0,
        showIconPicker: false
      })
      this._autoSave()
      return
    }

    // 添加为元素 — 优先使用预定义尺寸，否则异步获取
    const addImageElement = (naturalW, naturalH) => {
      const ratio = naturalW / naturalH
      const MAX_INITIAL = 140
      let w, h
      if (ratio >= 1) {
        w = MAX_INITIAL
        h = Math.round(MAX_INITIAL / ratio)
      } else {
        h = MAX_INITIAL
        w = Math.round(MAX_INITIAL * ratio)
      }
      const size = SIZE[this.data.layout]
      const elem = {
        id: this._nextId(),
        type: 'image',
        src: path,
        x: BLEED + Math.round((size.w - w) / 2),
        y: BLEED + Math.round((size.h - h) / 2),
        width: w,
        height: h,
        naturalRatio: ratio,
        rotation: 0
      }
      this._pushElement(elem)
      this.setData({ showIconPicker: false })
      this._autoSave()
    }

    if (preW && preH) {
      addImageElement(Number(preW), Number(preH))
    } else {
      wx.getImageInfo({
        src: path,
        success: (info) => addImageElement(info.width, info.height),
        fail: () => addImageElement(100, 100)
      })
    }
  },

  // ==================== 背景图 ====================

  openBgPicker() {
    wx.vibrateShort({ type: VIBRATE_TYPE })
    const hasBg = !!(this.data.bgImages[this.data.currentSide] || '')
    const itemList = hasBg
      ? ['从图标库选择', '从相册选择', '清除背景']
      : ['从图标库选择', '从相册选择']
    wx.showActionSheet({
      itemList,
      success: (res) => {
        if (res.tapIndex === 0) {
          // 从图标库选择 → 打开图标选择器（背景模式）
          this.setData({ iconList: iconList, iconPickerMode: 'background', showIconPicker: true })
        } else if (res.tapIndex === 1) {
          // 从相册选择
          wx.chooseImage({
            count: 1,
            sizeType: ['compressed'],
            sourceType: ['album'],
            success: (res2) => {
              const path = res2.tempFilePaths[0]
              // 内容安全审核
              app.checkImageSafety(path).then(safe => {
                if (!safe) return
                const side = this.data.currentSide
                this.setData({
                  [`bgImages.${side}`]: path,
                  currentBg: path,
                  [`bgIsTemplate.${side}`]: false,
                  currentBgIsTemplate: false,
                  [`bgOffsets.${side}.x`]: 0,
                  [`bgOffsets.${side}.y`]: 0,
                  [`bgScales.${side}`]: 1,
                  [`bgRotations.${side}`]: 0,
                  currentBgOffsetX: 0,
                  currentBgOffsetY: 0,
                  currentBgScale: 1,
                  currentBgRotation: 0
                })
                this._autoSave()
              })
            }
          })
        } else if (res.tapIndex === 2) {
          // 清除背景
          const side = this.data.currentSide
          this.setData({
            [`bgImages.${side}`]: '',
            currentBg: '',
            [`bgIsTemplate.${side}`]: false,
            currentBgIsTemplate: false,
            [`bgOffsets.${side}.x`]: 0,
            [`bgOffsets.${side}.y`]: 0,
            [`bgScales.${side}`]: 1,
            [`bgRotations.${side}`]: 0,
            currentBgOffsetX: 0,
            currentBgOffsetY: 0,
            currentBgScale: 1,
            currentBgRotation: 0
          })
          this._autoSave()
        }
      }
    })
  },

  _pushElement(elem) {
    const side = this.data.currentSide
    const elems = [...this.data.elements[side], elem]
    this.setData({
      [`elements.${side}`]: elems,
      currentElements: elems,
      selectedId: elem.id
    })
    this._recalcGuideLines()
  },

  // ==================== 编辑元素 ====================

  editElement() {
    if (!this.data.selectedId) return
    const elem = this.data.currentElements.find(el => el.id === this.data.selectedId)
    if (!elem) return

    if (elem.type === 'text') {
      this.setData({
        showEditModal: true,
        editingId: elem.id,
        editForm: {
          text: elem.text,
          fontSize: elem.fontSize || 14,
          color: elem.color || '#333',
          fontWeight: elem.fontWeight || 'normal',
          fontFamily: elem.fontFamily || 'serif'
        }
      })
    }
  },

  onEditFieldChange(e) {
    const { field, value } = e.currentTarget.dataset
    const form = { ...this.data.editForm }
    // input 组件通过 e.detail.value 传值；tap 按钮通过 dataset.value
    form[field] = e.detail ? (e.detail.value || value) : value
    this.setData({ editForm: form })
  },

  closeEditModal() {
    this.setData({ showEditModal: false, editingId: '' })
  },

  confirmEdit() {
    const id = this.data.editingId
    const form = this.data.editForm
    const side = this.data.currentSide

    const newText = form.text
    const newFontSize = Number(form.fontSize) || 14
    const newWidth = this._estimateTextWidth(newText, newFontSize)
    const newHeight = Math.ceil(newFontSize * 1.4)

    const elems = this.data.elements[side].map(el =>
      el.id === id ? {
        ...el,
        text: newText || el.text,
        fontSize: newFontSize,
        color: form.color || el.color,
        fontWeight: form.fontWeight || el.fontWeight,
        fontFamily: form.fontFamily || el.fontFamily || 'serif',
        width: newWidth,
        height: newHeight
      } : el
    )

    this.setData({
      [`elements.${side}`]: elems,
      currentElements: elems,
      showEditModal: false,
      editingId: ''
    })
    wx.vibrateShort({ type: VIBRATE_TYPE })
    this._autoSave()
  },

  // ==================== 删除元素 ====================

  deleteElement(e) {
    const id = e.currentTarget.dataset.id
    this._removeElement(id)
  },

  deleteCurrentElement() {
    if (!this.data.selectedId) return
    wx.showModal({
      title: '确认删除',
      content: '确定要删除该元素吗？',
      success: (res) => {
        if (res.confirm) this._removeElement(this.data.selectedId)
      }
    })
  },

  /** 旋转选中元素 90° */
  rotateElement() {
    if (!this.data.selectedId) return
    const side = this.data.currentSide
    const elem = this.data.elements[side].find(el => el.id === this.data.selectedId)
    if (!elem) return

    const newRotation = ((elem.rotation || 0) + 90) % 360
    const elems = this.data.elements[side].map(el =>
      el.id === this.data.selectedId ? { ...el, rotation: newRotation } : el
    )
    this.setData({
      [`elements.${side}`]: elems,
      currentElements: elems
    })
    wx.vibrateShort({ type: VIBRATE_TYPE })
    this._autoSave()
  },

  /** 旋转背景（调整模式下）90° */
  rotateBackground() {
    if (!this.data.bgAdjustMode || !this.data.currentBg) return
    const side = this.data.currentSide
    const newRotation = ((this.data.currentBgRotation || 0) + 90) % 360
    this.setData({
      [`bgRotations.${side}`]: newRotation,
      currentBgRotation: newRotation
    })
    wx.vibrateShort({ type: VIBRATE_TYPE })
    this._autoSave()
  },

  /** 复制友台设计链接 */
  copyFriendLink() {
    wx.vibrateShort({ type: VIBRATE_TYPE })
    wx.setClipboardData({
      data: 'https://qsl.fan/',
      success: () => {
        wx.showToast({
          title: '链接已复制，友台 BA7MLV 维护，请浏览器打开',
          icon: 'none',
          duration: 2500
        })
      }
    })
  },

  _removeElement(id) {
    const side = this.data.currentSide
    const elems = this.data.elements[side].filter(el => el.id !== id)
    this.setData({
      [`elements.${side}`]: elems,
      currentElements: elems,
      selectedId: ''
    })
    this._recalcGuideLines()
    wx.vibrateShort({ type: VIBRATE_TYPE })
    this._autoSave()
  },

  // ==================== 保存 / 加载 ====================

  _loadDesign() {
    try {
      const saved = wx.getStorageSync('qsl_design')
      if (saved && saved.elements && saved.elements.front && saved.elements.back) {
        this._elemId = saved.elemId || 0
        const loadedOffsets = saved.bgOffsets || { front: { x: 0, y: 0 }, back: { x: 0, y: 0 } }
        const loadedScales = saved.bgScales || { front: 1, back: 1 }
        const loadedRotations = saved.bgRotations || { front: 0, back: 0 }
        this.setData({
          layout: saved.layout || 'horizontal',
          elements: saved.elements,
          bgImages: saved.bgImages || { front: '', back: '' },
          bgIsTemplate: saved.bgIsTemplate || { front: false, back: false },
          bgOffsets: loadedOffsets,
          bgScales: loadedScales,
          bgRotations: loadedRotations,
          currentSide: 'front'
        })
        this._refreshCurrentSide()
      }
    } catch (e) {
      console.error('加载设计失败:', e)
    }
  },

  /** 静默自动保存（不弹 toast） */
  _autoSave() {
    try {
      const data = {
        layout: this.data.layout,
        elements: this.data.elements,
        bgImages: this.data.bgImages,
        bgIsTemplate: this.data.bgIsTemplate,
        bgOffsets: this.data.bgOffsets,
        bgScales: this.data.bgScales,
        bgRotations: this.data.bgRotations,
        elemId: this._elemId
      }
      wx.setStorageSync('qsl_design', data)
    } catch (e) {
      // 静默失败
    }
  },

  /** 预览最终效果（背景无透明度） */
  previewDesign() {
    wx.vibrateShort({ type: VIBRATE_TYPE })
    this.setData({ exporting: true })
    wx.showLoading({ title: '渲染中...', mask: true })
    // 预览时优先展示当前选择的一面
    const curSide = this.data.currentSide
    this._renderSideToPreview(curSide, (tempFile) => {
      wx.hideLoading()
      this.setData({ exporting: false })
      if (!tempFile) {
        wx.showToast({ title: '渲染失败', icon: 'error' })
        return
      }
      wx.previewImage({
        urls: [tempFile],
        current: tempFile
      })
    })
  },

  /** 预览指定面 */
  _renderSideToPreview(side, callback) {
    const scale = this.data.exportScale
    const stageW = this.data.stageWidth
    const stageH = this.data.stageHeight
    const canvasW = stageW * scale
    const canvasH = stageH * scale
    this._renderSingleSide(side, canvasW, canvasH, scale, callback)
  },

  // ==================== 导出 ====================

  openExportModal() {
    wx.vibrateShort({ type: VIBRATE_TYPE })
    this.setData({ showExportModal: true })
  },

  closeExportModal() {
    this.setData({ showExportModal: false })
  },

  setExportFormat(e) {
    const format = e.currentTarget.dataset.format
    this.setData({ exportFormat: format })
  },

  setExportRange(e) {
    const range = e.currentTarget.dataset.range
    this.setData({ exportRange: range })
  },

  setExportScale(e) {
    const scale = Number(e.currentTarget.dataset.scale)
    this.setData({ exportScale: scale })
  },

  doExport() {
    if (this.data.exporting) return
    const format = this.data.exportFormat
    if (format === 'image') {
      this._exportAsImage()
    } else {
      this._exportAsPdf()
    }
  },

  /** 图片导出 */
  _exportAsImage() {
    wx.showLoading({ title: '渲染中...' })
    this.setData({ exporting: true, showExportModal: false })

    this._renderCardToCanvas((tempFiles) => {
      wx.hideLoading()
      this.setData({ exporting: false })
      if (!tempFiles || !tempFiles.length) {
        wx.showToast({ title: '导出失败', icon: 'error' })
        return
      }
      // 预览图片
      wx.previewImage({
        urls: tempFiles,
        current: tempFiles[0],
        success: () => {
          // 预览后询问是否保存到相册
          wx.showModal({
            title: '保存到相册？',
            content: '是否将导出的图片保存到手机相册？',
            confirmText: '保存',
            cancelText: '不用',
            success: (res) => {
              if (res.confirm) {
                tempFiles.forEach(path => {
                  wx.saveImageToPhotosAlbum({ filePath: path, success() {}, fail() {} })
                })
                wx.showToast({ title: '已保存', icon: 'success' })
              }
            }
          })
        }
      })
    })
  },

  /** PDF 导出 — 渲染为高分辨率图片后导出 */
  _exportAsPdf() {
    wx.showLoading({ title: '渲染 PDF 中...' })
    this.setData({ exporting: true, showExportModal: false })

    this._renderCardToCanvas((tempFiles) => {
      wx.hideLoading()
      this.setData({ exporting: false })
      if (!tempFiles || !tempFiles.length) {
        wx.showToast({ title: '导出失败', icon: 'error' })
        return
      }
      wx.previewImage({
        urls: tempFiles,
        current: tempFiles[0],
        success: () => {
          wx.showModal({
            title: '保存到相册？',
            content: 'PDF 将以高清图片形式保存到手机相册',
            confirmText: '保存',
            cancelText: '不用',
            success: (res) => {
              if (res.confirm) {
                tempFiles.forEach(path => {
                  wx.saveImageToPhotosAlbum({ filePath: path, success() {}, fail() {} })
                })
                wx.showToast({ title: '已保存', icon: 'success' })
              }
            }
          })
        }
      })
    })
  },

  /** 核心：将卡片渲染到 canvas 并导出为临时文件 */
  _renderCardToCanvas(callback) {
    const range = this.data.exportRange
    const sides = range === 'all' ? ['front', 'back'] : [this.data.currentSide]
    const scale = this.data.exportScale
    const stageW = this.data.stageWidth
    const stageH = this.data.stageHeight
    const canvasW = stageW * scale
    const canvasH = stageH * scale

    // 使用离屏 canvas 逐面渲染
    const results = []
    const that = this

    function renderSide(index) {
      if (index >= sides.length) {
        callback(results.length ? results : null)
        return
      }
      const side = sides[index]
      that._renderSingleSide(side, canvasW, canvasH, scale, (tempFile) => {
        if (tempFile) results.push(tempFile)
        renderSide(index + 1)
      })
    }
    renderSide(0)
  },

  /** 渲染单面卡片 */
  _renderSingleSide(side, canvasW, canvasH, scale, callback) {
    const that = this
    const dpr = this._dpr
    const query = wx.createSelectorQuery()
    query.select('#exportCanvas').fields({ node: true, size: true }).exec((res) => {
      if (!res || !res[0] || !res[0].node) {
        // 无 canvas 节点，尝试使用离屏 canvas
        that._renderWithOffscreen(side, canvasW, canvasH, scale, callback)
        return
      }
      const canvas = res[0].node
      const ctx = canvas.getContext('2d')

      // 设置 canvas 物理像素尺寸（乘以 DPR 确保真机清晰）
      canvas.width = canvasW * dpr
      canvas.height = canvasH * dpr
      // 缩放上下文，使绘制坐标保持 canvasW/canvasH 逻辑空间
      ctx.scale(dpr, dpr)

      // 清空并绘制白色背景
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvasW, canvasH)

      const bgImagePath = that.data.bgImages[side]
      const bgIsTemplate = (that.data.bgIsTemplate && that.data.bgIsTemplate[side]) || false
      const bgOffset = (that.data.bgOffsets && that.data.bgOffsets[side]) || { x: 0, y: 0 }
      const bgScaleVal = (that.data.bgScales && that.data.bgScales[side]) || 1
      const bgRot = (that.data.bgRotations && that.data.bgRotations[side]) || 0
      const elements = that.data.elements[side] || []

      function drawElements() {
        // 绘制背景图：模板用 aspectFill（完全填充），普通背景用 aspectFit
        if (bgImagePath) {
          const bgImg = canvas.createImage()
          bgImg.src = bgImagePath
          bgImg.onload = () => {
            const imgW = bgImg.width
            const imgH = bgImg.height
            const imgRatio = imgW / imgH
            const canvasRatio = canvasW / canvasH

            // 根据模板/普通背景选择缩放模式
            let baseW, baseH
            if (bgIsTemplate) {
              // aspectFill: 完全填充，短边匹配，长边溢出（与 WXML mode="aspectFill" 一致）
              if (imgRatio > canvasRatio) {
                baseW = canvasH * imgRatio   // 以高度为准，宽度溢出
                baseH = canvasH
              } else {
                baseW = canvasW
                baseH = canvasW / imgRatio   // 以宽度为准，高度溢出
              }
            } else {
              // aspectFit: 保持比例完整显示
              if (imgRatio > canvasRatio) {
                baseW = canvasW
                baseH = canvasW / imgRatio
              } else {
                baseH = canvasH
                baseW = canvasH * imgRatio
              }
            }

            // Step 2: 缩放 + 位移 + 旋转，全部围绕舞台中心
            const drawW = baseW * bgScaleVal
            const drawH = baseH * bgScaleVal
            const cx = canvasW / 2 + bgOffset.x * scale
            const cy = canvasH / 2 + bgOffset.y * scale

            // 模板背景（SVG 原生尺寸仅 144×94）在高分辨率导出时会被拉伸变糊。
            // 先将其渲染到物理分辨率的离屏 canvas，再合成到主 canvas。
            let bgSource = bgImg
            if (bgIsTemplate) {
              const offW = Math.ceil(drawW * dpr)
              const offH = Math.ceil(drawH * dpr)
              try {
                const offscreen = wx.createOffscreenCanvas({ type: '2d', width: offW, height: offH })
                const offCtx = offscreen.getContext('2d')
                offCtx.scale(dpr, dpr)
                offCtx.drawImage(bgImg, 0, 0, drawW, drawH)
                bgSource = offscreen
              } catch (e) {
                // 降级：直接使用原图（低分辨率）
              }
            }

            ctx.save()
            ctx.translate(cx, cy)
            if (bgRot) {
              ctx.rotate(bgRot * Math.PI / 180)
            }
            ctx.drawImage(bgSource, -drawW / 2, -drawH / 2, drawW, drawH)
            ctx.restore()
            drawAllElements()
          }
          bgImg.onerror = () => drawAllElements()
        } else {
          drawAllElements()
        }
      }

      function drawAllElements() {
        // 绘制元素
        const imgElements = elements.filter(el => el.type === 'image')
        const textElements = elements.filter(el => el.type === 'text')

        // 先绘制文字
        textElements.forEach(el => {
          const fontSize = (el.fontSize || 14) * scale
          const x = el.x * scale
          const y = el.y * scale
          const w = (el.width || 40) * scale
          const h = (el.height || 24) * scale
          const rotation = el.rotation || 0

          ctx.save()
          const cx = x + w / 2
          const cy = y + h / 2
          ctx.translate(cx, cy)
          if (rotation) {
            ctx.rotate(rotation * Math.PI / 180)
          }
          ctx.font = `${el.fontWeight || 'normal'} ${fontSize}px ${el.fontFamily || 'serif'}`
          ctx.fillStyle = el.color || '#333'
          ctx.fillText(el.text || '', -w / 2, fontSize * 0.2) // y offset adjusted for centering
          ctx.restore()
        })

        // 再绘制图片
        if (imgElements.length === 0) {
          that._canvasToFile(canvas, callback)
          return
        }

        let loaded = 0
        const total = imgElements.length

        imgElements.forEach(el => {
          const img = canvas.createImage()
          img.src = el.src
          img.onload = () => {
            const elW = el.width || 80
            const elH = el.height || 80
            const elRatio = el.naturalRatio || (elW / elH)
            const x = el.x * scale
            const y = el.y * scale
            const rotation = el.rotation || 0
            let drawW = elW * scale
            let drawH = elH * scale
            if (drawW / drawH > elRatio) {
              drawW = Math.round(drawH * elRatio)
            } else {
              drawH = Math.round(drawW / elRatio)
            }
            const cx = x + (elW * scale) / 2
            const cy = y + (elH * scale) / 2
            ctx.save()
            ctx.translate(cx, cy)
            if (rotation) {
              ctx.rotate(rotation * Math.PI / 180)
            }
            ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH)
            ctx.restore()
            loaded++
            if (loaded >= total) {
              that._canvasToFile(canvas, callback)
            }
          }
          img.onerror = () => {
            loaded++
            if (loaded >= total) {
              that._canvasToFile(canvas, callback)
            }
          }
        })
      }

      drawElements()
    })
  },

  /** 离屏 canvas 备用方案 */
  _renderWithOffscreen(side, canvasW, canvasH, scale, callback) {
    const dpr = this._dpr
    const canvas = wx.createOffscreenCanvas({ type: '2d', width: canvasW * dpr, height: canvasH * dpr })
    const ctx = canvas.getContext('2d')
    const that = this

    ctx.scale(dpr, dpr)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvasW, canvasH)

    const bgImagePath = this.data.bgImages[side]
    const bgIsTemplate = (this.data.bgIsTemplate && this.data.bgIsTemplate[side]) || false
    const bgOffset = (this.data.bgOffsets && this.data.bgOffsets[side]) || { x: 0, y: 0 }
    const bgScaleVal = (this.data.bgScales && this.data.bgScales[side]) || 1
    const bgRot = (this.data.bgRotations && this.data.bgRotations[side]) || 0
    const elements = this.data.elements[side] || []

    function finishDraw() {
      wx.canvasToTempFilePath({
        canvas,
        x: 0, y: 0, width: canvasW, height: canvasH,
        destWidth: canvasW * dpr, destHeight: canvasH * dpr,
        fileType: 'png',
        success(res2) { callback(res2.tempFilePath) },
        fail() { callback(null) }
      })
    }

    function drawAllElements() {
      // 绘制文字
      elements.filter(el => el.type === 'text').forEach(el => {
        const fontSize = (el.fontSize || 14) * scale
        const x = el.x * scale
        const y = el.y * scale
        const w = (el.width || 40) * scale
        const h = (el.height || 24) * scale
        const rotation = el.rotation || 0

        ctx.save()
        const cx = x + w / 2
        const cy = y + h / 2
        ctx.translate(cx, cy)
        if (rotation) {
          ctx.rotate(rotation * Math.PI / 180)
        }
        ctx.font = `${el.fontWeight || 'normal'} ${fontSize}px ${el.fontFamily || 'serif'}`
        ctx.fillStyle = el.color || '#333'
        ctx.fillText(el.text || '', -w / 2, fontSize * 0.2)
        ctx.restore()
      })

      const imgElements = elements.filter(el => el.type === 'image')
      if (imgElements.length === 0) {
        finishDraw()
        return
      }

      let loaded = 0
      imgElements.forEach(el => {
        const img = canvas.createImage()
        img.src = el.src
        img.onload = () => {
          const elW = el.width || 80
          const elH = el.height || 80
          const elRatio = el.naturalRatio || (elW / elH)
          const x = el.x * scale
          const y = el.y * scale
          const rotation = el.rotation || 0
          let drawW = elW * scale
          let drawH = elH * scale
          if (drawW / drawH > elRatio) {
            drawW = Math.round(drawH * elRatio)
          } else {
            drawH = Math.round(drawW / elRatio)
          }
          const cx = x + (elW * scale) / 2
          const cy = y + (elH * scale) / 2
          ctx.save()
          ctx.translate(cx, cy)
          if (rotation) {
            ctx.rotate(rotation * Math.PI / 180)
          }
          ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH)
          ctx.restore()
          loaded++
          if (loaded >= imgElements.length) finishDraw()
        }
        img.onerror = () => {
          loaded++
          if (loaded >= imgElements.length) finishDraw()
        }
      })
    }

    // 绘制背景图：模板用 aspectFill（完全填充），普通背景用 aspectFit
    if (bgImagePath) {
      const bgImg = canvas.createImage()
      bgImg.src = bgImagePath
      bgImg.onload = () => {
        const imgW = bgImg.width
        const imgH = bgImg.height
        const imgRatio = imgW / imgH
        const canvasRatio = canvasW / canvasH

        // 根据模板/普通背景选择缩放模式
        let baseW, baseH
        if (bgIsTemplate) {
          // aspectFill: 完全填充，短边匹配，长边溢出（与 WXML mode="aspectFill" 一致）
          if (imgRatio > canvasRatio) {
            baseW = canvasH * imgRatio   // 以高度为准，宽度溢出
            baseH = canvasH
          } else {
            baseW = canvasW
            baseH = canvasW / imgRatio   // 以宽度为准，高度溢出
          }
        } else {
          // aspectFit: 保持比例完整显示
          if (imgRatio > canvasRatio) {
            baseW = canvasW
            baseH = canvasW / imgRatio
          } else {
            baseH = canvasH
            baseW = canvasH * imgRatio
          }
        }

        // Step 2: 缩放 + 位移 + 旋转，全部围绕舞台中心
        const drawW = baseW * bgScaleVal
        const drawH = baseH * bgScaleVal
        const cx = canvasW / 2 + bgOffset.x * scale
        const cy = canvasH / 2 + bgOffset.y * scale

        // 模板背景先渲染到物理分辨率离屏 canvas，避免 SVG 小尺寸被拉伸变糊
        let bgSource = bgImg
        if (bgIsTemplate) {
          const offW = Math.ceil(drawW * dpr)
          const offH = Math.ceil(drawH * dpr)
          try {
            const offscreen = wx.createOffscreenCanvas({ type: '2d', width: offW, height: offH })
            const offCtx = offscreen.getContext('2d')
            offCtx.scale(dpr, dpr)
            offCtx.drawImage(bgImg, 0, 0, drawW, drawH)
            bgSource = offscreen
          } catch (e) {
            // 降级
          }
        }

        ctx.save()
        ctx.translate(cx, cy)
        if (bgRot) {
          ctx.rotate(bgRot * Math.PI / 180)
        }
        ctx.drawImage(bgSource, -drawW / 2, -drawH / 2, drawW, drawH)
        ctx.restore()
        drawAllElements()
      }
      bgImg.onerror = () => drawAllElements()
    } else {
      drawAllElements()
    }
  },

  /** Canvas 转临时文件 */
  _canvasToFile(canvas, callback) {
    const dpr = this._dpr
    wx.canvasToTempFilePath({
      canvas,
      x: 0,
      y: 0,
      width: canvas.width / dpr,
      height: canvas.height / dpr,
      destWidth: canvas.width,
      destHeight: canvas.height,
      fileType: 'png',
      quality: 1,
      success(res) { callback(res.tempFilePath) },
      fail() { callback(null) }
    })
  },

  stopPropagation() {},

  // ==================== 分享功能 ====================

  /** 生成QSL卡分享卡片 */
  _generateShareCard() {
    const query = wx.createSelectorQuery()
    query.select('#shareCanvas')
      .fields({ node: true, size: true })
      .exec((res) => {
        const canvasRes = res && res[0]
        if (!canvasRes || !canvasRes.node) {
          console.error('[QSL] 未获取到 shareCanvas 节点')
          return
        }
        const canvas = canvasRes.node
        const scale = 2
        canvas.width = 500 * scale
        canvas.height = 400 * scale
        const ctx = canvas.getContext('2d')
        ctx.scale(scale, scale)

        // Canvas 尺寸
        const W = 500
        const H = 400
        const pad = 30
        const cardW = W - pad * 2
        const cardH = 240
        const cardX = pad
        const cardY = 80

        // 1. 页面背景色
        ctx.fillStyle = '#F4F7FA'
        ctx.fillRect(0, 0, W, H)

        // 2. 标题区域
        ctx.fillStyle = '#1A2B42'
        ctx.font = 'normal bold 24px sans-serif'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText('QSL 卡片设计器', W / 2, 40)

        // 3. 绘制QSL卡片预览
        // 卡片阴影
        ctx.shadowOffsetX = 0
        ctx.shadowOffsetY = 4
        ctx.shadowBlur = 20
        ctx.shadowColor = 'rgba(58, 85, 130, 0.15)'

        // 卡片背景（渐变）
        const cardGrad = ctx.createLinearGradient(cardX, cardY, cardX + cardW, cardY + cardH)
        cardGrad.addColorStop(0, '#FFFFFF')
        cardGrad.addColorStop(1, '#F8F9FA')
        ctx.fillStyle = cardGrad

        // 圆角矩形
        const r = 12
        ctx.beginPath()
        ctx.moveTo(cardX + r, cardY)
        ctx.lineTo(cardX + cardW - r, cardY)
        ctx.arcTo(cardX + cardW, cardY, cardX + cardW, cardY + r, r)
        ctx.lineTo(cardX + cardW, cardY + cardH - r)
        ctx.arcTo(cardX + cardW, cardY + cardH, cardX + cardW - r, cardY + cardH, r)
        ctx.lineTo(cardX + r, cardY + cardH)
        ctx.arcTo(cardX, cardY + cardH, cardX, cardY + cardH - r, r)
        ctx.lineTo(cardX, cardY + r)
        ctx.arcTo(cardX, cardY, cardX + r, cardY, r)
        ctx.closePath()
        ctx.fill()
        // 清除阴影
        ctx.shadowColor = 'transparent'
        ctx.shadowBlur = 0
        ctx.shadowOffsetX = 0
        ctx.shadowOffsetY = 0

        // 4. 绘制卡片内容（模拟QSL卡片）
        // 顶部彩色条
        const barGrad = ctx.createLinearGradient(cardX + 20, 0, cardX + cardW - 20, 0)
        barGrad.addColorStop(0, '#2C5C97')
        barGrad.addColorStop(1, '#D84315')
        ctx.fillStyle = barGrad
        ctx.fillRect(cardX + 20, cardY + 20, cardW - 40, 6)

        // 标题
        ctx.fillStyle = '#1A2B42'
        ctx.font = 'normal bold 18px sans-serif'
        ctx.textAlign = 'left'
        ctx.fillText('QSL CARD', cardX + 25, cardY + 55)

        // 分割线
        ctx.strokeStyle = '#E8ECF0'
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(cardX + 25, cardY + 70)
        ctx.lineTo(cardX + cardW - 25, cardY + 70)
        ctx.stroke()

        // 模拟文字行
        ctx.fillStyle = '#5B697F'
        ctx.font = 'normal normal 12px sans-serif'
        const lines = ['呼号: B____', '日期: ____-__-__', '时间: __:__', '频率: _____MHz', '模式: _____']
        lines.forEach((line, i) => {
          ctx.fillText(line, cardX + 30, cardY + 95 + i * 22)
        })

        // 右侧模拟图标区域
        ctx.fillStyle = '#E3F2FD'
        ctx.fillRect(cardX + cardW - 100, cardY + 90, 70, 70)
        ctx.fillStyle = '#1E88E5'
        ctx.font = '32px sans-serif'
        ctx.textAlign = 'center'
        ctx.fillText('📻', cardX + cardW - 65, cardY + 125)

        // 底部提示
        ctx.fillStyle = '#8E99A8'
        ctx.font = 'normal normal 13px sans-serif'
        ctx.textAlign = 'center'
        ctx.fillText('设计专属QSL卡片 · 记录每一次通联', W / 2, H - 40)

        // 导出图片（2d 即时绘制，少量延迟确保 emoji 字形就绪）
        setTimeout(() => {
          wx.canvasToTempFilePath({
            canvas: canvas,
            x: 0,
            y: 0,
            width: 500 * scale,
            height: 400 * scale,
            destWidth: 500 * scale,
            destHeight: 400 * scale,
            fileType: 'png',
            quality: 1,
            success: (res) => {
              this._cache.shareImagePath = res.tempFilePath
              console.log('QSL分享卡片生成成功:', res.tempFilePath)
            },
            fail: (err) => {
              console.error('生成QSL分享卡片失败', err)
            }
          })
        }, 50)
      })
  },

  onShareAppMessage() {
    const shareImagePath = this._cache.shareImagePath || ''
    return {
      title: 'QSL 卡片设计器 - 风语纪',
      path: '/pages/qsl/qsl',
      imageUrl: shareImagePath || '/images/cover.jpg'
    }
  },

  onShareTimeline() {
    const shareImagePath = this._cache.shareImagePath || ''
    return {
      title: 'QSL 卡片设计器 - 风语纪',
      query: '',
      imageUrl: shareImagePath || '/images/cover.jpg'
    }
  }
})
