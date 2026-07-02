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
    gridPolygons: []
  },

  onLoad() {
    this.loadTheme()
    this.requestLocation()
    this.mapCtx = wx.createMapContext('maidenheadMap', this)
  },

  onShow() {
    this.loadTheme()
  },

  // ==================== 主题 ====================

  loadTheme() {
    try {
      const savedTheme = wx.getStorageSync('appTheme') || 'radio'
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
    // 重新定位时以精度6（子方级）展示
    this.setData({
      currPrecision: 6,
      currPrecisionName: precisionName(6),
      mapScale: precisionToScale(6)
    })
    this.requestLocation()
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
        const grid = Maidenhead.encode(latitude, longitude, this.data.currPrecision)
        const latStr = latitude.toFixed(6)
        const lngStr = longitude.toFixed(6)

        this.updateMapMarker(latitude, longitude, grid, latStr, lngStr)
        this.setData({
          locationReady: true,
          locationFailed: false
        })
      },
      fail: (err) => {
        wx.hideLoading()
        console.error('定位失败', err)
        wx.showToast({ title: '定位失败，请重试', icon: 'none' })
        this.setData({ locationFailed: true })
      }
    })
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
        setTimeout(() => this.setData({ mapGridCopied: false }), 2000)
      }
    })
  },

  // ==================== 分享 ====================

  onShareAppMessage() {
    const { locationReady, currGrid } = this.data
    const title = locationReady && currGrid
      ? `我的梅登黑德网格: ${currGrid}`
      : '梅登黑德定位 - 地图定位与网格编码'
    return {
      title,
      path: '/pages/maidenhead/maidenhead',
      imageUrl: '/images/local.jpg'
    }
  },

  onShareTimeline() {
    const { locationReady, currGrid, currLat, currLng } = this.data
    const title = locationReady && currGrid
      ? `梅登黑德网格 ${currGrid} (${currLat}, ${currLng})`
      : '梅登黑德定位 - 地图定位与网格编码'
    return {
      title,
      query: 'page=maidenhead',
      imageUrl: '/images/cover.jpg'
    }
  }
})
