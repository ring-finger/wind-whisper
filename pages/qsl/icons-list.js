/**
 * QSL 卡片图标清单
 *
 * 添加新图标步骤：
 *   1. 将 png 图片放入 ../../images/icons/ 目录
 *   2. 在本文件的 ICONS 数组中新增一条 { name, file, naturalW, naturalH } 记录
 *   3. naturalW / naturalH 为图片原始像素尺寸，用于保持宽高比
 *
 * 路径以 /images/icons/ 开头，小程序可直接用作 image src
 */
const ICONS = [
  { name: 'CRAC-1', file: 'CRAC-1.svg', naturalW: 513, naturalH: 1024 },
  { name: 'CRAC-2', file: 'CRAC-2.svg', naturalW: 500, naturalH: 500 }
]

// 拼接完整路径
const BASE = '/images/icons/'
module.exports = ICONS.map(icon => ({
  name: icon.name,
  path: BASE + icon.file,
  naturalW: icon.naturalW || 100,
  naturalH: icon.naturalH || 100
}))
