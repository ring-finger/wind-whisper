/**
 * 云函数侧系统配置常量（与小程序 utils/constants.js 的 SYSTEM_CONFIG 对齐）
 * 此处仅保留服务端需要的字段；STORAGE_KEY / REFRESH_INTERVAL 等客户端字段无需镜像。
 * 若小程序侧 SYSTEM_CONFIG 调整，本文件需同步。
 */
const SYSTEM_CONFIG = {
  COLLECTION: 'appConfig',
  DOC_ID: 'global',
  DEFAULTS: {
    contentCheckEnabled: true
  },
  WRITABLE_KEYS: ['contentCheckEnabled']
}

// 超级管理员 open_id（拥有系统配置修改权限）
const SUPER_ADMIN_OPEN_ID = 'osirk5I5Sc02naqQMBz-So1iuZzo'

module.exports = { SYSTEM_CONFIG, SUPER_ADMIN_OPEN_ID }
