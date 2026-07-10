const cloud = require('wx-server-sdk')
const { SYSTEM_CONFIG, SUPER_ADMIN_OPEN_ID } = require('./constants')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command
const collection = db.collection(SYSTEM_CONFIG.COLLECTION)

// 拼装默认配置文档
// 注意：_id 已通过 collection.doc(DOC_ID) 指定，data 中不能再包含 _id，
// 否则云数据库报 -501007「不能更新_id的值」。
function buildDefault() {
  return Object.assign(
    {},
    SYSTEM_CONFIG.DEFAULTS,
    {
      version: 1,
      updatedAt: db.serverDate(),
      updatedBy: ''
    }
  )
}

// 确保集合存在：集合不存在时用服务端 SDK 自动创建（无需手动去控制台建）
// createCollection 在集合已存在时会抛错（错误码 -501001/ResourceUnavailable 等），忽略即可。
async function ensureCollection() {
  if (typeof db.createCollection !== 'function') return
  try {
    await db.createCollection(SYSTEM_CONFIG.COLLECTION)
    console.log('[systemConfig] 已自动创建集合 %s', SYSTEM_CONFIG.COLLECTION)
  } catch (err) {
    // 集合已存在等情况：忽略
    console.log('[systemConfig] 集合已存在或无需创建：', (err && err.errMsg) || err)
  }
}

// 创建默认配置文档；集合不存在时先自动建集合，再写入默认文档
async function ensureDefault() {
  const def = buildDefault()
  try {
    await ensureCollection()
    await collection.doc(SYSTEM_CONFIG.DOC_ID).set({ data: def })
    console.log('[systemConfig] 已写入默认配置文档 _id=%s', SYSTEM_CONFIG.DOC_ID)
    return def
  } catch (err) {
    console.error('[systemConfig] 写入默认配置失败', err)
    // 可能是并发已创建，再尝试读取一次
    const r = await collection.doc(SYSTEM_CONFIG.DOC_ID).get().catch(() => null)
    if (r && r.data) return r.data
    // 真实失败，向上抛出，避免返回内存默认值却未落库
    throw err
  }
}

// 读取全局配置；文档不存在时自动创建默认配置（保证可写、可订阅）
// 兼容两种 SDK 行为：文档不存在时 (1) get 抛错，或 (2) 返回空 data。
async function getConfig() {
  try {
    const res = await collection.doc(SYSTEM_CONFIG.DOC_ID).get()
    if (res && res.data && Object.keys(res.data).length > 0) {
      return res.data
    }
    // 返回空：视为不存在，创建默认
    return await ensureDefault()
  } catch (e) {
    // 抛错：文档不存在，创建默认
    return await ensureDefault()
  }
}

exports.main = async (event) => {
  const { action, patch } = event
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID || ''

  // 读取配置（所有登录用户可读）
  if (action === 'get') {
    try {
      const cfg = await getConfig()
      return { success: true, config: cfg }
    } catch (e) {
      console.error('[systemConfig] get 失败', e)
      return { success: false, code: 'GET_FAILED', message: '读取配置失败' }
    }
  }

  // 修改配置（仅超管可写；原子自增 version 保证一致性）
  if (action === 'set') {
    if (openid !== SUPER_ADMIN_OPEN_ID) {
      return { success: false, code: 'FORBIDDEN', message: '无权限修改系统配置' }
    }
    if (!patch || typeof patch !== 'object') {
      return { success: false, code: 'INVALID', message: '参数错误' }
    }

    // 仅允许白名单字段写入
    const updateData = {
      version: _.inc(1),
      updatedAt: db.serverDate(),
      updatedBy: openid
    }
    let hasWritable = false
    for (const key of SYSTEM_CONFIG.WRITABLE_KEYS) {
      if (key in patch) {
        updateData[key] = patch[key]
        hasWritable = true
      }
    }
    if (!hasWritable) {
      return { success: false, code: 'EMPTY', message: '无可更新字段' }
    }

    try {
      // 确保文档存在（不存在则先建默认），再原子更新
      await getConfig()
      await collection.doc(SYSTEM_CONFIG.DOC_ID).update({ data: updateData })
      const cfg = await getConfig()
      return { success: true, config: cfg }
    } catch (e) {
      console.error('[systemConfig] set 失败', e)
      return { success: false, code: 'SET_FAILED', message: '更新配置失败' }
    }
  }

  return { success: false, code: 'UNKNOWN_ACTION', message: '未知操作' }
}
