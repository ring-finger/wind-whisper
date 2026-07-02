/**
 * QSL 卡片模板清单
 *
 * 添加新模板步骤：
 *   1. 将 SVG 文件放入 images/modes/horizontal/ 或 images/modes/vertical/
 *   2. 在本文件的 MODES 数组中新增一条 { name, file, layout } 记录
 *   3. layout 可选值: 'horizontal' | 'vertical'
 */

const MODES = [
  { name: '横版模板-1', file: 'BA7MLV-1.svg', layout: 'horizontal', note: 'BA7MLV提供' },
  { name: '竖版模板-1', file: 'BA7MLV-2.svg', layout: 'vertical', note: 'BA7MLV提供' }
]

const BASE = '/images/modes/'

module.exports = MODES.map(mode => ({
  name: mode.name,
  note: mode.note || '',
  path: BASE + mode.layout + '/' + mode.file,
  layout: mode.layout
}))
