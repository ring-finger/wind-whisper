const app = getApp()
const VIBRATE_TYPE = 'medium'

// ==================== 梅登黑德编码核心算法 ====================
const Maidenhead = {
  encode(lat, lng, precision = 6) {
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null

    let lon = lng + 180
    let lat2 = lat + 90
    let grid = ''

    // 第1对：字段 (Field) A-R, 20°×10°
    grid += String.fromCharCode(65 + Math.floor(lon / 20))
    grid += String.fromCharCode(65 + Math.floor(lat2 / 10))
    lon = (lon % 20)
    lat2 = (lat2 % 10)

    if (precision <= 2) return grid

    // 第2对：方 (Square) 0-9, 2°×1°
    grid += Math.floor(lon / 2)
    grid += Math.floor(lat2 / 1)
    lon = (lon % 2)
    lat2 = (lat2 % 1)

    if (precision <= 4) return grid

    // 第3对：子方 (Subsquare) a-x, 5'×2.5'
    lon = lon / 2
    lat2 = lat2 / 1
    const subLon = Math.floor(lon * 24)
    const subLat = Math.floor(lat2 * 24)
    grid += String.fromCharCode(97 + Math.min(subLon, 23))
    grid += String.fromCharCode(97 + Math.min(subLat, 23))

    if (precision <= 6) return grid

    // 第4对：扩展精度 0-9, 约 30"×15"
    lon = (lon * 24 - subLon) * 10
    lat2 = (lat2 * 24 - subLat) * 10
    grid += Math.min(Math.floor(lon), 9).toString()
    grid += Math.min(Math.floor(lat2), 9).toString()

    return grid
  },

  /** 根据坐标和精度反算当前网格单元的 bounding box */
  gridBoundingBox(lat, lng, precision) {
    let lon = lng + 180
    let lat2 = lat + 90

    // Pair 1: Field — 20°×10°
    const fieldLon = Math.floor(lon / 20)
    const fieldLat = Math.floor(lat2 / 10)
    let originLon = fieldLon * 20
    let originLat = fieldLat * 10

    if (precision <= 2) {
      return { west: originLon - 180, south: originLat - 90, east: originLon - 180 + 20, north: originLat - 90 + 10 }
    }

    lon = lon % 20
    lat2 = lat2 % 10

    // Pair 2: Square — 2°×1°
    const sqLon = Math.floor(lon / 2)
    const sqLat = Math.floor(lat2 / 1)
    originLon += sqLon * 2
    originLat += sqLat * 1

    if (precision <= 4) {
      return { west: originLon - 180, south: originLat - 90, east: originLon - 180 + 2, north: originLat - 90 + 1 }
    }

    lon = lon % 2
    lat2 = lat2 % 1

    // Pair 3: Subsquare — 5'×2.5'
    lon = lon / 2
    lat2 = lat2 / 1
    const subLon = Math.floor(lon * 24)
    const subLat = Math.floor(lat2 * 24)
    originLon += subLon * (5 / 60)
    originLat += subLat * (2.5 / 60)

    if (precision <= 6) {
      return { west: originLon - 180, south: originLat - 90, east: originLon - 180 + 5 / 60, north: originLat - 90 + 2.5 / 60 }
    }

    // Pair 4: Extended — 30"×15"
    lon = (lon * 24 - subLon) * 10
    lat2 = (lat2 * 24 - subLat) * 10
    const extLon = Math.floor(lon)
    const extLat = Math.floor(lat2)
    originLon += extLon * (30 / 3600)
    originLat += extLat * (15 / 3600)

    return { west: originLon - 180, south: originLat - 90, east: originLon - 180 + 30 / 3600, north: originLat - 90 + 15 / 3600 }
  }
}

/** bounding box → polygons 数组（填充 + dashArray 虚线边框） */
function buildGridOverlays(box, precision, accentColor, fillColor) {
  const { west, south, east, north } = box
  if (precision <= 2) return []
  const points = [
    { latitude: south, longitude: west },
    { latitude: south, longitude: east },
    { latitude: north, longitude: east },
    { latitude: north, longitude: west }
  ]
  return [{
    points,
    strokeColor: accentColor,
    strokeWidth: 2,
    dashArray: [6, 4],
    fillColor,
    zIndex: 1
  }]
}

/** 主题 → { accentColor, fillColor } */
function themeColors(theme) {
  if (theme === 'morandi') {
    return { accentColor: '#C4643E', fillColor: '#1AC4643E' }
  }
  return { accentColor: '#2C5C97', fillColor: '#1A2C5C97' }
}

// ==================== 缩放级别 ↔ 网格精度映射 ====================
function scaleToPrecision(scale) {
  if (scale <= 5) return 2
  if (scale <= 9) return 4
  if (scale <= 13) return 6
  return 8
}

function precisionToScale(precision) {
  if (precision <= 2) return 5
  if (precision <= 4) return 9
  if (precision <= 6) return 12
  return 16
}

function precisionName(p) {
  return p === 2 ? 'Field 字段级' : p === 4 ? 'Square 方级' : p === 6 ? 'Subsquare 子方级' : '扩展精度'
}

// ==================== 页面 ====================
Page({
  data: {
    currentTheme: 'radio',
    accentColor: '#2C5C97',
    fillColor: 'rgba(44, 92, 151, 0.10)',

    mapLat: 35,
    mapLng: 105,
    mapScale: 12,
    currGrid: '',
    currLat: '',
    currLng: '',
    currPrecision: 6,
    currPrecisionName: 'Subsquare 子方级',
    locationReady: false,
    locationFailed: false,
    mapGridCopied: false,
    gridPolygons: [],
    shareImagePath: ''  // 分享卡片图片路径
  },

  onLoad() {
    this.loadTheme()
    this.requestLocation()
    this.mapCtx = wx.createMapContext('maidenheadMap', this)
    this._timers = []
  },

  onShow() {
    this.loadTheme()
  },

  onUnload() {
    // 清理定时任务，避免页面销毁后回调
    if (this._timers && this._timers.length) {
      this._timers.forEach((t) => clearTimeout(t))
      this._timers = []
    }
    // 关闭地图 show-location 启动的实时定位监听（wx.onLocationChange）
    try { wx.stopLocationUpdate() } catch (e) { /* 忽略 */ }
    this.mapCtx = null
  },

  /** 注册可在页面销毁时统一清理的定时器 */
  _setTimer(fn, delay) {
    const t = setTimeout(() => {
      this._timers = (this._timers || []).filter((x) => x !== t)
      fn()
    }, delay)
    this._timers = this._timers || []
    this._timers.push(t)
    return t
  },

  // ==================== 主题 ====================

  loadTheme() {
    try {
      const savedTheme = app._readStorage('appTheme', 'radio')
      const { accentColor, fillColor } = themeColors(savedTheme)
      wx.setNavigationBarColor({
        frontColor: '#000000',
        backgroundColor: '#F9F7F4',
        animation: { duration: 0, timingFunc: 'linear' }
      })
      this.setData({ currentTheme: savedTheme, accentColor, fillColor }, () => {
        this._refreshGridOverlay()
      })
    } catch (e) {
      console.error('加载主题失败', e)
    }
  },

  // ==================== 权限流程 ====================

  _refreshGridOverlay() {
    const { currPrecision, locationReady, currLat, currLng, accentColor, fillColor } = this.data
    if (!locationReady) return
    const lat = parseFloat(currLat)
    const lng = parseFloat(currLng)
    if (isNaN(lat) || isNaN(lng)) return
    const box = Maidenhead.gridBoundingBox(lat, lng, currPrecision)
    const polygons = buildGridOverlays(box, currPrecision, accentColor, fillColor)
    this.setData({ gridPolygons: polygons })
  },

  requestLocation() {
    // 优先复用全局定位缓存，避免重复调用 getLocation 阻塞渲染
    const cached = app.getCachedLocation()
    if (cached) {
      this._applyLocation(cached.latitude, cached.longitude)
      return
    }

    wx.getSetting({
      success: (res) => {
        if (res.authSetting['scope.userLocation'] !== false && res.authSetting['scope.userLocation'] !== true) {
          wx.authorize({
            scope: 'scope.userLocation',
            success: () => this.getLocation(),
            fail: () => this.setData({ locationFailed: true })
          })
        } else if (res.authSetting['scope.userLocation']) {
          this.getLocation()
        } else {
          this.showPermissionTip()
        }
      },
      fail: () => this.setData({ locationFailed: true })
    })
  },

  showPermissionTip() {
    wx.showModal({
      title: '需要位置权限',
      content: '用于获取您当前位置并自动换算梅登黑德网格编号，位置信息不会上传服务器。',
      confirmText: '去设置',
      cancelText: '取消',
      success: (res) => {
        if (res.confirm) {
          wx.openSetting({
            success: (settingRes) => {
              if (settingRes.authSetting['scope.userLocation']) {
                this.getLocation()
              } else {
                this.setData({ locationFailed: true })
              }
            }
          })
        } else {
          this.setData({ locationFailed: true })
        }
      }
    })
  },

  retryLocation() {
    // 重新定位时以精度6（子方级）展示，并强制重新获取位置（绕过缓存）
    this.setData({
      currPrecision: 6,
      currPrecisionName: precisionName(6),
      mapScale: precisionToScale(6)
    })
    this.getLocation()
  },

  // ==================== 获取位置 + 地图标记 ====================

  getLocation() {
    wx.vibrateShort({ type: VIBRATE_TYPE })
    wx.showLoading({ title: '定位中...', mask: true })

    wx.getLocation({
      type: 'gcj02',
      success: (res) => {
        wx.hideLoading()
        const { latitude, longitude } = res
        // 写入全局定位缓存，供后续进入本页复用
        app.setCachedLocation(latitude, longitude)
        this._applyLocation(latitude, longitude)
      },
      fail: (err) => {
        wx.hideLoading()
        console.error('定位失败', err)
        wx.showToast({ title: '定位失败，请重试', icon: 'none' })
        this.setData({ locationFailed: true })
      }
    })
  },

  /** 应用定位结果：编码网格 + 更新地图标记 + 标记就绪 + 生成分享卡片 */
  _applyLocation(latitude, longitude) {
    const grid = Maidenhead.encode(latitude, longitude, this.data.currPrecision)
    const latStr = latitude.toFixed(6)
    const lngStr = longitude.toFixed(6)

    this.updateMapMarker(latitude, longitude, grid, latStr, lngStr)
    this.setData({
      locationReady: true,
      locationFailed: false
    })

    // 定位成功后生成分享卡片
    this._setTimer(() => this._generateShareCard(), 1000)
  },

  updateMapMarker(lat, lng, grid, latStr, lngStr) {
    const polygons = buildGridOverlays(
      Maidenhead.gridBoundingBox(lat, lng, this.data.currPrecision),
      this.data.currPrecision, this.data.accentColor, this.data.fillColor
    )
    this.setData({
      mapLat: lat,
      mapLng: lng,
      currGrid: grid,
      currLat: latStr,
      currLng: lngStr,
      gridPolygons: polygons
    })
  },

  onReady() {
    // 页面渲染完成后，如果已经定位成功，生成分享卡片
    if (this.data.locationReady && this.data.currGrid) {
      this._setTimer(() => this._generateShareCard(), 500)
    }
  },

  /** 生成梅登黑德分享卡片（canvas 2d 接口） */
  _generateShareCard(callback) {
    const { locationReady, currGrid, currLat, currLng, currPrecisionName } = this.data
    if (!locationReady || !currGrid) {
      callback && callback(false)
      return
    }

    const query = wx.createSelectorQuery()
    query.select('#shareCanvas')
      .fields({ node: true, size: true })
      .exec((res) => {
        const canvasRes = res && res[0]
        if (!canvasRes || !canvasRes.node) {
          console.error('[Maidenhead] 未获取到 shareCanvas 节点')
          callback && callback(false)
          return
        }
        const canvas = canvasRes.node
        const scale = 2
        canvas.width = 500 * scale
        canvas.height = 400 * scale
        const ctx = canvas.getContext('2d')
        ctx.scale(scale, scale)

        const width = 500
        const height = 400
        
        // 清空画布 - 使用浅灰色背景
        ctx.fillStyle = '#F5F7FA'
        ctx.fillRect(0, 0, width, height)
        
        // 绘制卡片背景（白色圆角卡片）
        const cardX = 25
        const cardY = 25
        const cardW = width - 50
        const cardH = height - 50
        
        ctx.fillStyle = '#FFFFFF'
        ctx.shadowOffsetX = 0
        ctx.shadowOffsetY = 4
        ctx.shadowBlur = 20
        ctx.shadowColor = 'rgba(0, 0, 0, 0.08)'
        ctx.fillRect(cardX, cardY, cardW, cardH)
        // 清除阴影
        ctx.shadowColor = 'transparent'
        ctx.shadowBlur = 0
        ctx.shadowOffsetX = 0
        ctx.shadowOffsetY = 0
        
        // 绘制顶部蓝色条
        ctx.fillStyle = '#1E88E5'
        ctx.fillRect(cardX, cardY, cardW, 8)
        
        // 绘制圆形图标背景（纯色）
        const iconCenterX = width / 2
        const iconCenterY = 100
        const iconRadius = 35
        
        ctx.beginPath()
        ctx.arc(iconCenterX, iconCenterY, iconRadius, 0, 2 * Math.PI)
        ctx.fillStyle = '#1E88E5'
        ctx.fill()
        
        // 绘制地图图标
        ctx.font = '35px sans-serif'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillStyle = '#FFFFFF'
        ctx.fillText('🗺️', iconCenterX, iconCenterY)
        
        // 绘制标题 "梅登黑德定位"
        ctx.fillStyle = '#333333'
        ctx.font = '22px sans-serif'
        ctx.textAlign = 'center'
        ctx.fillText('梅登黑德定位', iconCenterX, 160)
        
        // 绘制描述
        ctx.fillStyle = '#666666'
        ctx.font = '13px sans-serif'
        ctx.fillText('梅登黑德定位网格位置', iconCenterX, 185)
        
        // 分隔线
        ctx.beginPath()
        ctx.moveTo(width / 2 - 80, 210)
        ctx.lineTo(width / 2 + 80, 210)
        ctx.strokeStyle = '#E0E0E0'
        ctx.lineWidth = 0.5
        ctx.stroke()
        
        // 网格代码（大字体，使用主题色）
        ctx.fillStyle = '#1E88E5'
        ctx.font = '48px sans-serif'
        ctx.textAlign = 'center'
        ctx.fillText(currGrid, iconCenterX, 260)
        
        // 精度信息
        ctx.fillStyle = '#999999'
        ctx.font = '12px sans-serif'
        ctx.fillText(currPrecisionName, iconCenterX, 285)
        
        // 坐标信息
        ctx.fillStyle = '#666666'
        ctx.font = '15px sans-serif'
        ctx.fillText(`${currLat}°, ${currLng}°`, iconCenterX, 315)
        
        // 底部应用名称
        ctx.fillStyle = '#999999'
        ctx.font = '11px sans-serif'
        ctx.fillText('风语纪 · 业余无线电工具', iconCenterX, height - 40)
        
        // 导出图片（2d 即时绘制，少量延迟确保 emoji 字形就绪）
        this._setTimer(() => {
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
              this.setData({ shareImagePath: res.tempFilePath })
              console.log('分享卡片生成成功:', res.tempFilePath)
              callback && callback(true, res.tempFilePath)
            },
            fail: (err) => {
              console.error('生成分享卡片失败', err)
              callback && callback(false)
            }
          })
        }, 50)
      })
  },

  // ==================== 缩放自动切换精度 ====================

  onMapScaleChange(e) {
    this._handleScaleChange(e.detail.scale)
  },

  onMapRegionChange(e) {
    // bindscale 不可用时（低版本基础库 / 开发工具），regionchange 作降级
    if (e.type !== 'end') return
    this.mapCtx.getScale({
      success: (res) => this._handleScaleChange(res.scale),
      fail: () => {} // 静默
    })
  },

  _handleScaleChange(scale) {
    const newPrecision = scaleToPrecision(scale)
    const { currPrecision, locationReady, currLat, currLng, accentColor, fillColor } = this.data
    if (!locationReady) return
    const lat = parseFloat(currLat)
    const lng = parseFloat(currLng)
    if (isNaN(lat) || isNaN(lng)) return

    const precision = newPrecision !== currPrecision ? newPrecision : currPrecision
    const polygons = buildGridOverlays(
      Maidenhead.gridBoundingBox(lat, lng, precision),
      precision, accentColor, fillColor
    )

    const updates = { gridPolygons: polygons }

    if (newPrecision !== currPrecision) {
      updates.currGrid = Maidenhead.encode(lat, lng, newPrecision)
      updates.currPrecision = newPrecision
      updates.currPrecisionName = precisionName(newPrecision)
    }

    this.setData(updates)
  },

  // ==================== 一键复制 ====================

  copyMapGrid() {
    if (!this.data.currGrid) return
    wx.vibrateShort({ type: VIBRATE_TYPE })
    wx.setClipboardData({
      data: this.data.currGrid,
      success: () => {
        this.setData({ mapGridCopied: true })
        wx.showToast({ title: `${this.data.currGrid} 已复制`, icon: 'success' })
        this._setTimer(() => this.setData({ mapGridCopied: false }), 2000)
      }
    })
  },

  // ==================== 分享 ====================

  onShareAppMessage() {
    const { locationReady, currGrid, shareImagePath } = this.data
    
    // 如果还没有生成分享图，尝试生成
    if (!shareImagePath && locationReady && currGrid) {
      console.log('分享时检测到无分享图，开始生成...')
      this._generateShareCard()
    }
    
    const title = locationReady && currGrid
      ? `我的梅登黑德网格: ${currGrid}`
      : '梅登黑德定位 - 地图定位与网格编码'
    
    console.log('onShareAppMessage, 使用图片:', shareImagePath || '默认图片')
    
    return {
      title,
      path: '/pages/maidenhead/maidenhead',
      imageUrl: shareImagePath || '/images/local.jpg'
    }
  },

  onShareTimeline() {
    const { locationReady, currGrid, currLat, currLng, shareImagePath } = this.data
    
    // 如果还没有生成分享图，尝试生成
    if (!shareImagePath && locationReady && currGrid) {
      console.log('分享时检测到无分享图，开始生成...')
      this._generateShareCard()
    }
    
    const title = locationReady && currGrid
      ? `梅登黑德网格 ${currGrid} (${currLat}, ${currLng})`
      : '梅登黑德定位 - 地图定位与网格编码'
    
    console.log('onShareTimeline, 使用图片:', shareImagePath || '默认图片')
    
    return {
      title,
      query: 'page=maidenhead',
      imageUrl: shareImagePath || '/images/cover.jpg'
    }
  }
})
