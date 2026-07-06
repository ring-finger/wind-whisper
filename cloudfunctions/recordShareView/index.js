const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

/**
 * 记录分享查看统计
 * @param {Object} event
 * @param {string} event.shareId - 分享ID
 * @returns {Object} { success, viewCount }
 */
exports.main = async (event, context) => {
  const { shareId } = event
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID || wxContext.FROM_OPENID || ''

  if (!openid) {
    return { success: false, error: '无法获取用户身份' }
  }

  if (!shareId) {
    return { success: false, error: 'shareId is required' }
  }

  try {
    // 获取分享文档
    const shareRes = await db.collection('shareLogs').doc(shareId).get()
    if (!shareRes.data) {
      return { success: false, error: '分享不存在' }
    }

    let viewers = shareRes.data.viewers || []
    
    // 去重：如果已经记录过，不再添加
    if (viewers.includes(openid)) {
      return { success: true, viewCount: viewers.length, alreadyViewed: true }
    }

    // 添加查看者
    viewers.push(openid)

    // 更新文档
    await db.collection('shareLogs').doc(shareId).update({
      data: {
        viewers: viewers,
        viewCount: viewers.length
      }
    })

    return { success: true, viewCount: viewers.length }
  } catch (e) {
    console.error('记录查看统计失败', e)
    return { success: false, error: e.message || '未知错误' }
  }
}
