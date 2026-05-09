const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()
const MAX_SHARE_AGE_DAYS = 7  // 分享最大保留天数

/**
 * 定时清理过期的分享数据
 * 
 * 触发方式：云函数定时触发（建议每天执行一次）
 * 触发配置：在 cloudbaserc.json 或云开发控制台设置
 * 
 * Cron表达式示例：
 * - 每天凌晨2点：0 2 * * *
 * - 每周日凌晨3点：0 3 * * 0
 */
exports.main = async (event, context) => {
  console.log('开始清理过期分享数据...')
  console.log('当前环境:', cloud.DYNAMIC_CURRENT_ENV)
  
  try {
    const now = new Date()
    const expireDate = new Date(now.getTime() - MAX_SHARE_AGE_DAYS * 24 * 60 * 60 * 1000)
    
    console.log('清理条件：', {
      当前时间: now.toISOString(),
      过期时间: expireDate.toISOString(),
      保留天数: MAX_SHARE_AGE_DAYS
    })
    
    // 查询过期的分享记录
    const expiredShares = await db.collection('shareLogs')
      .where({
        createTime: db.command.lt(expireDate)
      })
      .field({
        _id: true,
        createTime: true,
        myCallSign: true,
        expireTime: true
      })
      .limit(100)  // 限制每次最多清理100条
      .get()
    
    console.log('找到过期分享:', expiredShares.data.length, '条')
    
    if (expiredShares.data.length === 0) {
      return {
        success: true,
        message: '没有需要清理的过期分享',
        cleanedCount: 0,
        timestamp: now.toISOString()
      }
    }
    
    // 删除过期分享
    const deletedIds = []
    let cleanedCount = 0
    
    for (const share of expiredShares.data) {
      try {
        await db.collection('shareLogs').doc(share._id).remove()
        deletedIds.push(share._id)
        cleanedCount++
        console.log(`已删除分享: ${share._id}`)
      } catch (err) {
        console.error(`删除分享失败: ${share._id}`, err)
      }
    }
    
    console.log('清理完成:', {
      成功删除: cleanedCount,
      失败数量: expiredShares.data.length - cleanedCount
    })
    
    return {
      success: true,
      message: `成功清理 ${cleanedCount} 条过期分享`,
      cleanedCount: cleanedCount,
      deletedIds: deletedIds,
      timestamp: now.toISOString()
    }
    
  } catch (err) {
    console.error('清理过期分享失败:', err)
    return {
      success: false,
      message: '清理失败',
      error: err.message || err,
      timestamp: new Date().toISOString()
    }
  }
}
