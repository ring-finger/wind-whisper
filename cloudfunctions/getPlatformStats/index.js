const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

/**
 * 获取平台通联排行榜（直读预计算集合，无实时聚合）
 * @param {Object} event
 * @param {number} event.year  - 年份
 * @param {number} [event.month] - 月份（可选，不传则当年排行）
 * @returns {Object} { success, data: [{rank, callSign, nickName, avatarUrl, count}] }
 */
exports.main = async (event) => {
  const { year, month } = event

  if (!year || typeof year !== 'number') {
    return { success: false, error: 'year is required' }
  }

  try {
    const collectionName = month != null ? 'monthRankings' : 'yearRankings'
    const query = month != null ? { year, month } : { year }

    const res = await db.collection(collectionName)
      .where(query)
      .orderBy('updatedAt', 'desc')
      .limit(1)
      .get()

    if (res.data.length > 0) {
      return { success: true, data: res.data[0].rankings || [] }
    }
    return { success: true, data: [] }
  } catch (e) {
    console.error('getPlatformStats 失败', e)
    return { success: false, error: e.message || 'unknown error' }
  }
}
