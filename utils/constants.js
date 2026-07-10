/**
 * 全局统一常量配置
 * --------------------------------------------------------------------------
 * 图片违规审核（contentCheck）相关的配置与状态集中在此管理，便于：
 *   1. 统一开关：通过 CONTENT_CHECK.ENABLED 一键开启/关闭审核；
 *   2. 后期整体迁移：审核逻辑若从云函数迁移进小程序内，本文件即唯一来源，
 *      云函数侧仅需同步 cloudfunctions/contentCheck/constants.js 中的同名常量。
 * --------------------------------------------------------------------------
 */

// 图片内容审核配置
const CONTENT_CHECK = {
  // 总开关：true=开启审核；false=直接放行（不调用云函数、不拦截）
  ENABLED: true,
  // 云存储临时目录（客户端上传后等待审核）
  TMP_CHECK_DIR: 'tmp_check',
  // 违规归档目录（违规图片留存，供账号监控）
  TMP_ERR_DIR: 'tmp_err',
  // 违规兜底标识（imgSecCheck 仅返回 errCode:87014，无结构化 label）
  RISKY_LABEL: 'risky',
  // 客户端提示文案
  MESSAGES: {
    VIOLATION: '内容含违规信息',
    PASS: '审核通过'
  }
}

// 审核结果状态枚举（与云函数 contentCheck 返回对齐）
const CONTENT_CHECK_STATUS = {
  SAFE: 'safe', // 合规
  VIOLATION: 'violation', // 违规
  UNKNOWN: 'unknown' // 无法判定（非阻塞放行）
}

// 超级管理员 open_id（拥有系统配置入口）
const SUPER_ADMIN_OPEN_ID = 'osirk5I5Sc02naqQMBz-So1iuZzo'

/**
 * 全局系统配置（云数据库配置中心）
 * 所有用户共享同一份配置（appConfig 集合的 global 文档）。
 * 注意：集合名 appConfig 与云函数名 systemConfig 刻意区分，避免歧义。
 * 超管修改后通过实时 watch + 定时兜底刷新，对所有普通用户立即生效。
 * 注意：appConfig 集合需在云控制台「手动创建」（云开发 SDK 无法自动建集合），
 *       并将「记录权限」设为「所有用户可读，仅创建者可读写」（或仅开放读权限），
 *       否则客户端实时订阅(watch)无法生效；即便如此，定时刷新仍可保证最终一致。
 */
const SYSTEM_CONFIG = {
  COLLECTION: 'appConfig',        // 云数据库集合名（配置中心，与云函数 systemConfig 区分）
  DOC_ID: 'global',               // 全局唯一配置文档 _id
  STORAGE_KEY: 'systemConfigCache', // 本地缓存键（高效读取，避免每次读库）
  DEFAULTS: {
    contentCheckEnabled: true     // 图片内容审核总开关，默认开启
  },
  // 允许超管修改的字段白名单（防止越权写入未知字段）
  WRITABLE_KEYS: ['contentCheckEnabled'],
  // 客户端定时兜底刷新间隔（毫秒），watch 断线时保证最终一致
  REFRESH_INTERVAL: 5 * 60 * 1000,
  // watch 断线后重连延迟（毫秒）
  WATCH_RECONNECT_DELAY: 3000,
  // watch 最大重连次数，超过则放弃重连、依赖定时刷新
  WATCH_MAX_RECONNECT: 5
}

module.exports = {
  CONTENT_CHECK,
  CONTENT_CHECK_STATUS,
  SUPER_ADMIN_OPEN_ID,
  SYSTEM_CONFIG
}
