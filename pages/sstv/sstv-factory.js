/**
 * SSTV 模式工厂（对应 Java 的 ModeFactory.java）
 * 根据模式名称创建对应的编码器实例
 */
const Robot36 = require('./sstv-robot36')
const Scottie1 = require('./sstv-scottie1')

/**
 * 创建 SSTV 编码器实例
 * @param {string} modeName - 模式名称 ('Robot36', 'Scottie1', etc.)
 * @param {number} sampleRate - 采样率（默认 48000）
 * @returns {SSTVMode} 编码器实例
 */
function createMode(modeName, sampleRate) {
  switch (modeName) {
    case 'Robot36':
      return new Robot36(sampleRate || 48000)
    case 'Scottie1':
      return new Scottie1(sampleRate || 48000)
    default:
      console.warn('[SSTV] 未知模式:', modeName, '，使用默认模式 Robot36')
      return new Robot36(sampleRate || 48000)
  }
}

/**
 * 获取支持的模式列表
 * @returns {Array<{name: string, visCode: number, description: string}>}
 */
function getSupportedModes() {
  return [
    { name: 'Robot36', visCode: 8, description: 'Robot 36 (320x240, 36s)' },
    { name: 'Scottie1', visCode: 60, description: 'Scottie 1 (320x256, 43s)' }
  ]
}

module.exports = {
  createMode: createMode,
  getSupportedModes: getSupportedModes
}
