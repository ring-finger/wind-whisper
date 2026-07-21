const cloud = require('wx-server-sdk')
// 与小程序端 app.js 中 wx.cloud.init 的环境保持一致（避免函数部署到不同环境导致读不到数据）
cloud.init({ env: 'wind-d9gv5b4ca9c4129ba' })

const db = cloud.database()
const _ = db.command
const $ = db.command.aggregate
// 数据库集合名称（与云函数名 windCollection 区分，避免歧义）
const COLLECTION = 'windCollectionItems'
// 标签统计集合（仅存一份全局统计文档，避免每次加载都聚合计算）
const STATS_COLLECTION = 'windCollectionStats'
const STATS_ID = 'global'

// 集合为空时是否自动写入示例数据（仅执行一次，便于首次体验；上线稳定后可改为 false）
const AUTO_SEED = true

// 拥有数据管理权限（add/update/remove）的管理员 openid 列表
// 留空则禁用管理接口；在此填写你的 openid 即可通过云函数管理数据
const ADMIN_OPENIDS = ['osirk5I5Sc02naqQMBz-So1iuZzo']

// 示例数据（仅在集合为空时写入）
const SAMPLES = [
  { title: '气象雷达', description: '实时天气雷达与降水预报。', appId: '', path: '', shortLink: '', tags: ['气象'], priority: 60 },
  { title: '呼号查询', description: '国内外业余电台呼号归属地查询。', appId: '', path: '', shortLink: '', tags: ['工具'], priority: 50 }
]

// 确保集合存在（已存在则忽略报错），name 可指定其他集合
function ensureCollection(name) {
  const coll = name || COLLECTION
  if (typeof db.createCollection !== 'function') return Promise.resolve()
  return db.createCollection(coll).catch(err => {
    console.log('[windCollection] ensureCollection:', (err && err.errMsg) || err)
  })
}

// 集合为空时写入示例数据（仅一次）
function seedIfEmpty() {
  if (!AUTO_SEED) return Promise.resolve()
  return db.collection(COLLECTION).count().then(res => {
    if (res.total > 0) return
    const tasks = SAMPLES.map(s =>
      db.collection(COLLECTION).add({
        data: Object.assign({ updatedAt: db.serverDate() }, s)
      })
    )
    return Promise.all(tasks).then(() =>
      console.log('[windCollection] 已写入示例数据 %d 条', SAMPLES.length)
    )
  }).catch(err => console.error('[windCollection] seed 失败', err))
}

// 统一文档结构（去除服务端内部字段，保留前端需要的字段）
function normalize(doc) {
  return {
    _id: doc._id,
    title: doc.title || '',
    description: doc.description || '',
    appId: doc.appId || '',
    path: doc.path || '',
    // 统一以 shortLink 作为跳转小程序的方式（兼容旧数据的 url 字段）
    shortLink: doc.shortLink || doc.url || '',
    extraData: doc.extraData || {},
    envVersion: doc.envVersion || 'release',
    tags: Array.isArray(doc.tags) ? doc.tags : [],
    priority: typeof doc.priority === 'number' ? doc.priority : 0
  }
}

// 单次初始化（云函数实例冷启动时执行一次，避免每次调用都建集合/写示例）
let _initPromise = null
function initOnce() {
  if (!_initPromise) {
    _initPromise = (async () => {
      await ensureCollection()
      await ensureCollection(STATS_COLLECTION)
      await seedIfEmpty()
      // 注意：标签统计文档不再自动生成/补算，完全由管理员 refreshTags 触发写入
    })()
  }
  return _initPromise
}

// 标签统计的内存缓存（实例复用期内有效；数据变更时会主动失效）
let _tagCache = null

// 重新聚合统计并写入统计集合（仅在数据变更 / 统计缺失 / 自检不一致时调用）
async function recomputeTagStats() {
  const agg = await db.collection(COLLECTION)
    .aggregate()
    .unwind('$tags')
    .group({ _id: '$tags', count: $.sum(1) })
    .end()
  const countMap = new Map()
  ;(agg.list || []).forEach(r => { if (r._id) countMap.set(r._id, r.count) })
  const total = await db.collection(COLLECTION).count()
  const allTags = [{ name: '全部', count: total.total }].concat(
    Array.from(countMap.entries()).map(([name, count]) => ({ name, count }))
  )
  // 读取已有版本号并 +1（避免使用 _.inc，因为对「尚不存在的文档」执行 set + _.inc 可能抛错）
  let version = 1
  try {
    const s = await db.collection(STATS_COLLECTION).doc(STATS_ID).get()
    version = ((s.data && s.data.version) || 0) + 1
  } catch (e) { /* 文档不存在，从 1 开始 */ }
  await db.collection(STATS_COLLECTION).doc(STATS_ID).set({
    data: { tags: allTags, version, updatedAt: db.serverDate() }
  })
  _tagCache = allTags // 更新内存缓存，避免同实例内重复读库
  return allTags
}

// 读取标签统计：直接读取统计集合中的单文档（O(1)，极快）
// 统计的更新完全由管理员的 refreshTags 动作触发，这里不做任何聚合 / 自愈，
// 以保证页面打开时查询足够快
async function loadTagStats() {
  try {
    const res = await db.collection(STATS_COLLECTION).doc(STATS_ID).get()
    if (res.data && Array.isArray(res.data.tags) && res.data.tags.length) {
      return res.data.tags
    }
  } catch (e) { /* 统计文档不存在 */ }
  return [{ name: '全部', count: 0 }]
}

// 列表查询：按标签过滤 + 按优先级降序（仅返回列表，标签统计走独立 action）
async function list(tag) {
  await initOnce()
  const query = {}
  if (tag && tag !== '全部') {
    // 数组字段包含该标签即匹配
    query.tags = tag
  }

  const res = await db.collection(COLLECTION)
    .where(query)
    .orderBy('priority', 'desc')
    .orderBy('updatedAt', 'desc')
    .limit(1000)
    .get()
  // 读取当前数据版本，供客户端判断本地列表缓存是否失效
  let version = 0
  try {
    const s = await db.collection(STATS_COLLECTION).doc(STATS_ID).get()
    version = (s.data && s.data.version) || 0
  } catch (e) { /* 忽略 */ }
  return { list: res.data.map(normalize), version }
}

// 独立的标签统计 action（可延迟/异步调用，不阻塞首屏列表渲染）
async function tags() {
  await initOnce()
  const allTags = await loadTagStats()
  let version = 0
  try {
    const res = await db.collection(STATS_COLLECTION).doc(STATS_ID).get()
    version = (res.data && res.data.version) || 0
  } catch (e) { /* 忽略 */ }
  return { allTags, version }
}

// 判断当前调用者是否为管理员
function isAdmin(wxContext) {
  const openid = wxContext && wxContext.OPENID
  return ADMIN_OPENIDS.includes(openid)
}

// 数据管理（仅管理员）：add / update / remove
async function manage(action, payload, wxContext) {
  const openid = wxContext && wxContext.OPENID
  if (!ADMIN_OPENIDS.includes(openid)) {
    return { error: 'NO_AUTH', message: '无数据管理权限' }
  }
  if (action === 'add') {
    const added = await db.collection(COLLECTION).add({
      data: Object.assign({ updatedAt: db.serverDate() }, payload)
    })
    // 标签统计不再自动刷新，统一由管理员 refreshTags 触发
    return { _id: added._id }
  }
  if (action === 'update') {
    const { _id, ...rest } = payload
    if (!_id) return { error: 'INVALID', message: '缺少 _id' }
    await db.collection(COLLECTION).doc(_id).update({
      data: Object.assign({ updatedAt: db.serverDate() }, rest)
    })
    // 标签统计不再自动刷新，统一由管理员 refreshTags 触发
    return { success: true }
  }
  if (action === 'remove') {
    if (!payload || !payload._id) return { error: 'INVALID', message: '缺少 _id' }
    await db.collection(COLLECTION).doc(payload._id).remove()
    // 标签统计不再自动刷新，统一由管理员 refreshTags 触发
    return { success: true }
  }
  return { error: 'UNKNOWN_ACTION', message: '未知操作' }
}

// 标签统计入库（仅管理员）：强制重新聚合并写入统计集合
async function refreshTags(wxContext) {
  if (!isAdmin(wxContext)) {
    return { error: 'NO_AUTH', message: '无数据管理权限' }
  }
  await initOnce()
  const allTags = await recomputeTagStats()
  let version = 0
  try {
    const s = await db.collection(STATS_COLLECTION).doc(STATS_ID).get()
    version = (s.data && s.data.version) || 0
  } catch (e) { /* 忽略 */ }
  return { allTags, version }
}

exports.main = async (event, context) => {
  const { action = 'list', tag, data } = event
  const wxContext = cloud.getWXContext()
  try {
    if (action === 'list') {
      const result = await list(tag)
      return { success: true, ...result }
    }
    if (action === 'tags') {
      const result = await tags()
      return { success: true, ...result }
    }
    if (action === 'isAdmin') {
      return { success: true, isAdmin: isAdmin(wxContext) }
    }
    if (action === 'refreshTags') {
      const r = await refreshTags(wxContext)
      if (r.error) return { success: false, ...r }
      return { success: true, ...r }
    }
    if (['add', 'update', 'remove'].includes(action)) {
      await initOnce()
      const r = await manage(action, data, wxContext)
      if (r.error) return { success: false, ...r }
      return { success: true, ...r }
    }
    return { success: false, error: 'UNKNOWN_ACTION', message: '未知操作' }
  } catch (err) {
    console.error('[windCollection]', err)
    return { success: false, error: (err && err.errMsg) || 'SERVER_ERROR' }
  }
}
