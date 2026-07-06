const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const MAX_LIMIT = 100 // 单次查询上限

/**
 * 清理过期的分享记录
 * 定时触发器：每天凌晨 0:00 执行
 */
exports.main = async (event, context) => {
  const now = Date.now()

  try {
    // 查询所有到期的分享
    const expiredRes = await db.collection('shareLogs')
      .where({
        expireTime: _.lt(new Date(now))
      })
      .limit(MAX_LIMIT)
      .get()

    const expiredList = expiredRes.data
    const totalCount = expiredList.length

    console.log(`[cleanExpiredShares] 发现 ${totalCount} 条到期分享`)

    if (totalCount === 0) {
      return {
        success: true,
        deletedCount: 0,
        message: '没有需要清理的到期分享'
      }
    }

    // 逐条删除（避免批量删除的事务限制）
    let deletedCount = 0
    const errors = []

    for (const doc of expiredList) {
      try {
        await db.collection('shareLogs').doc(doc._id).remove()
        deletedCount++
      } catch (err) {
        errors.push({ id: doc._id, error: err.message || '未知错误' })
        console.error(`[cleanExpiredShares] 删除失败 ${doc._id}:`, err)
      }
    }

    console.log(`[cleanExpiredShares] 清理完成，成功删除 ${deletedCount}/${totalCount} 条`)

    return {
      success: errors.length === 0,
      deletedCount,
      totalCount,
      errors: errors.length > 0 ? errors : undefined,
      message: `成功清理 ${deletedCount} 条到期分享` +
        (errors.length > 0 ? `，${errors.length} 条删除失败` : '')
    }
  } catch (e) {
    console.error('[cleanExpiredShares] 执行失败:', e)
    return {
      success: false,
      error: e.message || '未知错误'
    }
  }
}
