const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const $ = db.command.aggregate

/**
 * 重建排行榜并存入 monthRankings / yearRankings 集合。
 * 由客户端在同步本地统计后按需触发（fire-and-forget）。
 *
 * @param {Object} event
 * @param {number} [event.year]  - 目标年份，默认取当前年份
 * @param {number} [event.month] - 目标月份（不传则同时重建当月+当年；传入则只重建该月）
 */
exports.main = async (event) => {
  const { year, month } = event || {}
  const now = new Date()
  const targetYear = year || now.getFullYear()

  try {
    const results = {}

    // 1. 当月排行
    if (month != null) {
      results.monthRankings = await rebuildAndStore(
        'monthRankings',
        { year: targetYear, month },
        { year: targetYear, month }
      )
    }

    // 2. 当年排行（仅月度排行单独触发时不重建年度排行）
    if (month == null) {
      results.yearRankings = await rebuildAndStore(
        'yearRankings',
        { year: targetYear },
        { year: targetYear }
      )

      // 同时也重建当月排行
      const currentMonth = now.getMonth() + 1
      results.monthRankings = await rebuildAndStore(
        'monthRankings',
        { year: targetYear, month: currentMonth },
        { year: targetYear, month: currentMonth }
      )
    }

    return { success: true, data: results }
  } catch (e) {
    console.error('rebuildRankings 执行失败', e)
    return { success: false, error: e.message || 'unknown error' }
  }
}

/**
 * 以 matchStage 筛选 contactStats，聚合 TOP5 后 upsert 到目标集合
 * @param {string} collectionName - 目标集合名（monthRankings / yearRankings）
 * @param {Object} matchStage     - aggregate match 条件
 * @param {Object} docKey         - upsert 查询键
 */
async function rebuildAndStore(collectionName, matchStage, docKey) {
  // 聚合 TOP5
  const aggResult = await db.collection('contactStats')
    .aggregate()
    .match(matchStage)
    .group({
      _id: '$callSign',
      nickName: $.first('$nickName'),
      avatarUrl: $.first('$avatarUrl'),
      totalCount: $.sum('$count')
    })
    .match({ _id: $.neq('') })
    .sort({ totalCount: -1 })
    .limit(5)
    .end()

  const rankings = aggResult.list.map((item, index) => ({
    rank: index + 1,
    callSign: item._id,
    nickName: item.nickName || '',
    avatarUrl: item.avatarUrl || '',
    count: item.totalCount
  }))

  // 统计参与用户数
  const countResult = await db.collection('contactStats')
    .aggregate()
    .match(matchStage)
    .group({ _id: '$callSign' })
    .match({ _id: $.neq('') })
    .count('total')
    .end()
  const totalUsers = countResult.list.length > 0 ? countResult.list[0].total : 0

  const data = {
    ...docKey,
    rankings,
    totalUsers,
    updatedAt: new Date()
  }

  // upsert
  const existing = await db.collection(collectionName).where(docKey).get()
  if (existing.data.length > 0) {
    await db.collection(collectionName).doc(existing.data[0]._id).update({ data })
  } else {
    await db.collection(collectionName).add({ data })
  }

  return rankings
}
