/**
 * 云数据库工具模块
 * 统一管理所有集合的读写操作
 */

const DB_CONFIG = {
  userProfiles: 'userProfiles',     // 用户基本信息
  contactStats: 'contactStats',     // 通联数量统计（按月）
  monthRankings: 'monthRankings',  // 月度排行榜（预计算）
  yearRankings: 'yearRankings'     // 年度排行榜（预计算）
}

// ==================== 用户基本信息 ====================

/**
 * 同步用户基本信息到云端
 * @param {Object} profile - { nickName, callSign, cloudSyncEnabled, currentTheme, avatarUrl, totalLogCount }
 * @returns {Promise<void>}
 */
function syncUserProfile(profile) {
  return new Promise((resolve, reject) => {
    try {
      const db = wx.cloud.database()
      const _ = db.command
      const collection = db.collection(DB_CONFIG.userProfiles)

      const data = {
        nickName: profile.nickName || '',
        callSign: profile.callSign || '',
        cloudSyncEnabled: profile.cloudSyncEnabled || false,
        currentTheme: profile.currentTheme || 'radio',
        avatarUrl: profile.avatarUrl || '',
        totalLogCount: profile.totalLogCount != null ? profile.totalLogCount : 0,
        updatedAt: new Date()
      }

      // 先查是否已有记录
      collection.where({ _openid: '{openid}' }).get().then(res => {
        const existing = res.data.length > 0 ? res.data[0] : null

        // 库中无记录：信息全为默认值则不入库，有变更才入库（覆盖新用户和老用户云端无数据场景）
        if (!existing) {
          const isAllDefault =
            data.nickName === '' &&
            data.callSign === '' &&
            data.cloudSyncEnabled === false &&
            data.currentTheme === 'radio' &&
            data.avatarUrl === '' &&
            data.totalLogCount === 0
          if (isAllDefault) {
            return Promise.resolve()
          }
          return collection.add({ data })
        }

        // 老用户：逐字段对比，无变更则跳过，有变更则更新
        const changed =
          (existing.nickName ?? '') !== data.nickName ||
          (existing.callSign ?? '') !== data.callSign ||
          (existing.cloudSyncEnabled ?? false) !== data.cloudSyncEnabled ||
          (existing.currentTheme ?? 'radio') !== data.currentTheme ||
          (existing.avatarUrl ?? '') !== data.avatarUrl ||
          (existing.totalLogCount ?? 0) !== data.totalLogCount
        if (!changed) {
          return Promise.resolve()
        }
        return collection.doc(existing._id).update({ data })
      }).then(() => {
        resolve()
      }).catch(err => {
        console.error('syncUserProfile 失败', err)
        reject(err)
      })
    } catch (e) {
      console.error('syncUserProfile 异常', e)
      reject(e)
    }
  })
}

/**
 * 仅同步 totalLogCount 到云端（增删日志后调用，不影响其他字段）
 * @param {number} count - 当前日志总数
 * @returns {Promise<void>}
 */
function syncLogCountToCloud(count) {
  return new Promise((resolve, reject) => {
    try {
      const db = wx.cloud.database()
      const collection = db.collection(DB_CONFIG.userProfiles)

      collection.where({ _openid: '{openid}' }).get().then(res => {
        if (res.data.length === 0) return Promise.resolve()
        const existing = res.data[0]
        // totalLogCount 无变化则跳过
        if ((existing.totalLogCount ?? 0) === count) return Promise.resolve()
        return collection.doc(existing._id).update({
          data: { totalLogCount: count, updatedAt: new Date() }
        })
      }).then(() => {
        resolve()
      }).catch(err => {
        console.error('syncLogCountToCloud 失败', err)
        reject(err)
      })
    } catch (e) {
      console.error('syncLogCountToCloud 异常', e)
      reject(e)
    }
  })
}

/**
 * 从云端加载用户基本信息
 * @returns {Promise<Object|null>}
 */
function loadUserProfile() {
  return new Promise((resolve, reject) => {
    try {
      const db = wx.cloud.database()
      db.collection(DB_CONFIG.userProfiles)
        .where({ _openid: '{openid}' })
        .get()
        .then(res => {
          if (res.data.length > 0) {
            resolve(res.data[0])
          } else {
            resolve(null)
          }
        })
        .catch(err => {
          console.error('loadUserProfile 失败', err)
          reject(err)
        })
    } catch (e) {
      console.error('loadUserProfile 异常', e)
      reject(e)
    }
  })
}

// ==================== 通联数量统计 ====================

/**
 * 从单条日志中提取通联时间戳（毫秒）
 * @param {Object} log
 * @returns {number|null} 时间戳毫秒，无法解析返回 null
 */
function _getLogTimeMillis(log) {
  if (log.contactInstantMs) {
    const t = log.contactInstantMs
    if (!isNaN(t)) return t
  }
  if (log.date && (log.btcTime || log.bjcTime)) {
    const timeStr = log.btcTime || log.bjcTime
    const t = new Date(`${log.date}T${timeStr}:00+08:00`).getTime()
    if (!isNaN(t)) return t
  }
  return null
}

/**
 * 删除指定月份的统计记录（当月数量清零时调用）
 * @param {number} year
 * @param {number} month
 * @returns {Promise<void>}
 */
function deleteMonthStats(year, month) {
  return new Promise((resolve) => {
    try {
      const db = wx.cloud.database()
      db.collection(DB_CONFIG.contactStats)
        .where({ _openid: '{openid}', year, month })
        .get()
        .then(res => {
          if (res.data.length > 0) {
            const tasks = res.data.map(record =>
              db.collection(DB_CONFIG.contactStats).doc(record._id).remove()
            )
            return Promise.all(tasks)
          }
        })
        .then(() => resolve())
        .catch(err => {
          console.error('deleteMonthStats 失败', err)
          resolve()
        })
    } catch (e) {
      console.error('deleteMonthStats 异常', e)
      resolve()
    }
  })
}

/**
 * 清空当前用户的所有统计记录
 * @returns {Promise<void>}
 */
function clearAllStats() {
  return new Promise((resolve) => {
    try {
      const db = wx.cloud.database()
      const MAX_LIMIT = 100
      const collection = db.collection(DB_CONFIG.contactStats)

      const deletePage = () => {
        collection
          .where({ _openid: '{openid}' })
          .limit(MAX_LIMIT)
          .get()
          .then(res => {
            if (!res.data || res.data.length === 0) return resolve()
            const tasks = res.data.map(record =>
              collection.doc(record._id).remove()
            )
            return Promise.all(tasks).then(() => {
              if (res.data.length >= MAX_LIMIT) {
                deletePage()
              } else {
                resolve()
              }
            })
          })
          .catch(err => {
            console.error('clearAllStats 失败', err)
            resolve()
          })
      }
      deletePage()
    } catch (e) {
      console.error('clearAllStats 异常', e)
      resolve()
    }
  })
}

/**
 * 根据全部本地日志重新计算某一月份的统计并同步到云端
 * 用于新增/删除/更新日志后精确同步对应月份
 * @param {Object} log    - 发生变更的日志
 * @param {Array}  logs   - 当前全量本地日志
 * @returns {Promise<void>}
 */
function recomputeMonthForLog(log, logs) {
  const logTime = _getLogTimeMillis(log)
  if (logTime === null) return Promise.resolve()

  const d = new Date(logTime)
  const year = d.getFullYear()
  const month = d.getMonth() + 1

  const count = logs.filter(item => {
    const t = _getLogTimeMillis(item)
    if (t === null) return false
    const itemDate = new Date(t)
    return itemDate.getFullYear() === year && (itemDate.getMonth() + 1) === month
  }).length

  if (count > 0) {
    return syncMonthStats(year, month, count).catch(() => {})
  } else {
    return deleteMonthStats(year, month)
  }
}

/**
 * 同步指定月份的通联数量到云端
 * @param {number} year   - 年份，如 2026
 * @param {number} month  - 月份，1-12
 * @param {number} count  - 当月通联数量
 * @returns {Promise<void>}
 */
function syncMonthStats(year, month, count) {
  return new Promise((resolve, reject) => {
    try {
      const db = wx.cloud.database()
      const collection = db.collection(DB_CONFIG.contactStats)

      const data = {
        year,
        month,
        count,
        callSign: wx.getStorageSync('myCallSign') || '',
        nickName: wx.getStorageSync('wxMineNickName') || '',
        avatarUrl: wx.getStorageSync('wxMineAvatarUrl') || '',
        updatedAt: new Date()
      }

      // 查该用户该月份是否已有记录
      collection.where({
        _openid: '{openid}',
        year,
        month
      }).get().then(res => {
        if (res.data.length > 0) {
          return collection.doc(res.data[0]._id).update({ data })
        } else {
          return collection.add({ data })
        }
      }).then(() => {
        resolve()
      }).catch(err => {
        console.error('syncMonthStats 失败', err)
        reject(err)
      })
    } catch (e) {
      console.error('syncMonthStats 异常', e)
      reject(e)
    }
  })
}

/**
 * 从云端加载指定年份的通联统计
 * @param {number} year - 年份
 * @returns {Promise<Array>} [{ year, month, count }]
 */
function loadYearStats(year) {
  return new Promise((resolve, reject) => {
    try {
      const db = wx.cloud.database()
      db.collection(DB_CONFIG.contactStats)
        .where({
          _openid: '{openid}',
          year
        })
        .orderBy('month', 'asc')
        .get()
        .then(res => {
          resolve(res.data.map(item => ({
            year: item.year,
            month: item.month,
            count: item.count
          })))
        })
        .catch(err => {
          console.error('loadYearStats 失败', err)
          reject(err)
        })
    } catch (e) {
      console.error('loadYearStats 异常', e)
      reject(e)
    }
  })
}

/**
 * 根据本地 contactLogs 聚合每月数量并同步到云端
 * 同步本月及有变化的月份
 */
function syncStatsFromLocalLogs(logs) {
  if (!logs || logs.length === 0) return Promise.resolve()

  // 按月聚合: { '2026-6': 5, '2026-5': 12, ... }
  const monthMap = {}

  logs.forEach(log => {
    const logTime = _getLogTimeMillis(log)
    if (logTime === null) return

    const d = new Date(logTime)
    const key = `${d.getFullYear()}-${d.getMonth() + 1}`
    monthMap[key] = (monthMap[key] || 0) + 1
  })

  const tasks = Object.entries(monthMap).map(([key, count]) => {
    const [year, month] = key.split('-').map(Number)
    return syncMonthStats(year, month, count).catch(() => {})
  })

  return Promise.all(tasks)
}

/**
 * 获取用户所有年份的累计统计（用于图表）
 * @returns {Promise<{ total: number, monthlyData: Array }>}
 */
function loadAllStats() {
  return new Promise((resolve, reject) => {
    try {
      const db = wx.cloud.database()
      db.collection(DB_CONFIG.contactStats)
        .where({ _openid: '{openid}' })
        .orderBy('year', 'asc')
        .orderBy('month', 'asc')
        .get()
        .then(res => {
          let total = 0
          const monthlyData = res.data.map(item => {
            total += item.count || 0
            return {
              year: item.year,
              month: item.month,
              count: item.count || 0
            }
          })
          resolve({ total, monthlyData })
        })
        .catch(err => {
          console.error('loadAllStats 失败', err)
          reject(err)
        })
    } catch (e) {
      console.error('loadAllStats 异常', e)
      reject(e)
    }
  })
}

/**
 * 获取平台通联排行榜（直读预计算集合，无实时聚合）
 * @param {number} year  - 年份
 * @param {number} [month] - 月份（可选，不传则当年排行）
 * @returns {Promise<Array>} [{ rank, callSign, nickName, avatarUrl, count }]
 */
function getPlatformStats(year, month) {
  return new Promise((resolve) => {
    try {
      const db = wx.cloud.database()
      const collectionName = month != null ? DB_CONFIG.monthRankings : DB_CONFIG.yearRankings
      const query = month != null ? { year, month } : { year }

      db.collection(collectionName)
        .where(query)
        .orderBy('updatedAt', 'desc')
        .limit(1)
        .get()
        .then(res => {
          resolve(res.data.length > 0 ? (res.data[0].rankings || []) : [])
        })
        .catch(err => {
          console.error('getPlatformStats 查询失败', err)
          resolve([])
        })
    } catch (e) {
      console.error('getPlatformStats 异常', e)
      resolve([])
    }
  })
}

/**
 * 触发云端排行榜重建（fire-and-forget）
 * 在通联数据变更后调用，后台异步更新 monthRankings / yearRankings
 */
function triggerRebuildRankings() {
  wx.cloud.callFunction({
    name: 'rebuildRankings',
    data: {}
  }).then(() => {}).catch(err => {
    console.error('triggerRebuildRankings 失败', err)
  })
}

module.exports = {
  DB_CONFIG,
  syncUserProfile,
  syncLogCountToCloud,
  loadUserProfile,
  syncMonthStats,
  deleteMonthStats,
  clearAllStats,
  recomputeMonthForLog,
  loadYearStats,
  syncStatsFromLocalLogs,
  loadAllStats,
  getPlatformStats,
  triggerRebuildRankings
}
