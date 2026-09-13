/**
 * RST 信号报告工具
 *
 * RST 由三项组成：R(可辨度 1-5) / S(信号强度 1-9) / T(音调 1-9)。
 * 业余无线电通联中，VHF/UHF 频段（30MHz 以上）几乎只用 FM 话务，
 * 不存在音调一说，故惯例只报 RS 两项；HF 频段才报完整 RST。
 *
 * 因此本项目对 T 的处理是频段相关的：
 *   - HF：T 是独立的 1-9 数字输入格
 *   - VHF/UHF：不展示也不采集 T，界面只保留 R、S 两格
 *
 * 本模块是 RST 归一化的唯一来源。读取老数据时必须在展示 / 导出前调用
 * normalizeRst()，因为历史数据里可能存在「VHF 通联却带着 T 值」的脏数据
 * （早期版本允许在 UV 段填 T，且在切换频段时不清理）。
 */

// 频段类型
const BAND_HF = 'hf'
const BAND_VHF = 'vhf'
const BAND_UHF = 'uhf'

/**
 * 按频率判断频段。
 * 与页面里的 updateFrequencyRangeStatus 保持同一口径：
 *   30 ≤ f < 300   → VHF
 *   300 ≤ f ≤ 3000 → UHF
 *   其余（含解析失败）→ HF
 * @param {number|string} frequency 频率，单位 MHz
 * @returns {'hf'|'vhf'|'uhf'}
 */
function bandFromFrequency(frequency) {
  const freq = parseFloat(frequency)
  if (isNaN(freq)) return BAND_HF
  if (freq >= 300 && freq <= 3000) return BAND_UHF
  if (freq >= 30 && freq < 300) return BAND_VHF
  return BAND_HF
}

/**
 * 是否为 30MHz 以上的 UV 段（VHF / UHF）。
 * UV 段不展示、不采集 T。
 */
function isUVBand(frequency) {
  const band = bandFromFrequency(frequency)
  return band === BAND_VHF || band === BAND_UHF
}

/**
 * 把频率换算成 ADIF 的 BAND 字段值。
 * 注意：2m / 70cm 换段时 T 无效，调用方需自行配合 normalizeRst。
 * @param {number|string} frequency 频率，单位 MHz
 * @returns {string} 形如 '20m'、'70cm'，无法识别时返回 ''
 */
function bandNameFromFrequency(frequency) {
  const freq = parseFloat(frequency)
  if (isNaN(freq)) return ''
  if (freq >= 0.136 && freq < 0.138) return '2190m'
  if (freq >= 0.472 && freq < 0.479) return '630m'
  if (freq >= 1.8 && freq < 2.0) return '160m'
  if (freq >= 3.5 && freq < 4.0) return '80m'
  if (freq >= 5.2 && freq < 5.5) return '60m'
  if (freq >= 7.0 && freq < 7.3) return '40m'
  if (freq >= 10.1 && freq < 10.15) return '30m'
  if (freq >= 14.0 && freq < 14.35) return '20m'
  if (freq >= 18.068 && freq < 18.168) return '17m'
  if (freq >= 21.0 && freq < 21.45) return '15m'
  if (freq >= 24.89 && freq < 24.99) return '12m'
  if (freq >= 28.0 && freq < 29.7) return '10m'
  if (freq >= 50 && freq < 54) return '6m'
  if (freq >= 144 && freq < 148) return '2m'
  if (freq >= 430 && freq < 450) return '70cm'
  return ''
}

/** 把任意值收敛成 0-9 的单个数字字符，无效返回 '' */
function toDigit(value) {
  if (value === 0) return '0'
  if (!value) return ''
  const s = String(value).trim()
  return /^[0-9]$/.test(s) ? s : ''
}

/**
 * 归一化一个 R/S/T 子对象。
 * 所有输出字段都是字符串，便于直接拼接与比较。
 * @param {{r?:any,s?:any,t?:any}} obj
 * @param {boolean} includeT 是否保留 T（HF 为 true，UV 段为 false）
 */
function normalizeRstPart(obj, includeT) {
  const src = obj || {}
  return {
    r: toDigit(src.r),
    s: toDigit(src.s),
    t: includeT ? toDigit(src.t) : ''
  }
}

/**
 * 归一化整条日志的 RST 数据。
 *
 * 同时兼容两种历史结构：
 *   - 当前结构：{ myRst: {r,s,t}, theirRst: {r,s,t} }
 *   - 更早的平铺结构：{ r, s, t }（视作己方 RST）
 *
 * @param {object} rst 原始 RST 数据，可为 null
 * @param {number|string} frequency 该条日志的频率，用于判定是否保留 T
 * @returns {{myRst:{r,s,t}, theirRst:{r,s,t}}}
 */
function normalizeRst(rst, frequency) {
  const includeT = !isUVBand(frequency)
  const src = rst || {}
  const rawMy = src.myRst || (src.r || src.s || src.t ? src : null)
  return {
    myRst: normalizeRstPart(rawMy, includeT),
    theirRst: normalizeRstPart(src.theirRst, includeT)
  }
}

/**
 * 拼成展示用的字符串，如 '59' / '599'。
 * 缺失的位直接省略，由调用方决定是否补占位符。
 * @param {{r,s,t}} part
 * @returns {string}
 */
function formatRstPart(part) {
  if (!part) return ''
  return `${part.r || ''}${part.s || ''}${part.t || ''}`
}

module.exports = {
  BAND_HF,
  BAND_VHF,
  BAND_UHF,
  bandFromFrequency,
  isUVBand,
  bandNameFromFrequency,
  normalizeRst,
  normalizeRstPart,
  formatRstPart
}
