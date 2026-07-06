const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

/**
 * 获取当前用户的openid
 * @returns {Object} { openid }
 */
exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  return {
    openid: wxContext.OPENID || wxContext.FROM_OPENID || ''
  }
}
