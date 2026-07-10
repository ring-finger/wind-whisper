const cloud = require('wx-server-sdk')
const fs = require('fs')
const path = require('path')
const { CONTENT_CHECK, CONTENT_CHECK_STATUS } = require('./constants')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

/**
 * 图片内容安全审核（同步归档，免回调 / 免 HTTP 触发）
 * @param {Object} event
 * @param {string} event.fileID  - 云存储临时文件ID（位于 tmp_check/）
 * @param {string} event.callsign - 当前用户呼号（用于违规监控归档命名）
 * @returns {Object} { success, safe, message }
 *
 * 流程（严格 5 步）：
 *  1) 文件已由客户端上传至 tmp_check/
 *  2) 下载并同步 imgSecCheck 判定合规性
 *  3) 合规 → 直接删除 tmp_check 原文件，返回 safe:true
 *  4) 违规 → 同步归档至 tmp_err/{时间戳}_{呼号}_{label}.jpg（label 为兜底标识，
 *             imgSecCheck 违规时仅返回 errCode:87014，不含结构化 label），
 *             归档成功后删除 tmp_check 原文件，返回 safe:false（客户端同步 Toast 拦截）
 *  5) 归档完成后 tmp_check 原文件即被清理
 *
 * 注：因不走 mediaCheckAsync，违规文件名中的 label 为兜底标识 'risky'，
 *     无法获取微信官方违规编码；如需真实 label 需启用 contentCheckNotify 回调。
 */
function detectContentType(buffer) {
  const head = buffer.slice(0, 4)
  if (head[0] === 0x89 && head[1] === 0x50) return 'image/png'
  if (head[0] === 0x47 && head[1] === 0x49 && head[2] === 0x46) return 'image/gif'
  return 'image/jpeg'
}

function sanitize(s) {
  return String(s || 'unknown').replace(/[^\w-]/g, '_')
}

/**
 * 将内存中的图片缓冲归档为 tmp_err/{时间戳}_{呼号}_{label}.jpg。
 * 仅在上传成功后返回新路径；任何异常都会向上抛出，由调用方决定是否保留原文件。
 * @param {Buffer} buffer - 图片二进制内容
 * @param {string} cs - 已清洗的呼号
 * @param {string} label - 违规标识
 * @returns {string} 归档后的新路径
 */
async function archiveViolation(buffer, cs, label) {
  const newPath = `${CONTENT_CHECK.TMP_ERR_DIR}/${Date.now()}_${cs}_${label}.jpg`
  // 云函数可写临时目录（腾讯云 SCF 为 /tmp）
  const tmp = path.join('/tmp', `v_${Date.now()}.jpg`)
  fs.writeFileSync(tmp, buffer)
  // 该版本 wx-server-sdk 的 uploadFile 要求 fileContent 为 fs.ReadStream
  const stream = fs.createReadStream(tmp)
  try {
    await cloud.uploadFile({ cloudPath: newPath, fileContent: stream })
  } finally {
    stream.destroy()
    try { fs.unlinkSync(tmp) } catch (e) { /* 临时文件清理失败忽略 */ }
  }
  return newPath
}

// 兜底违规标识（imgSecCheck 不返回结构化 label）
const RISKY_LABEL = CONTENT_CHECK.RISKY_LABEL

exports.main = async (event) => {
  const { fileID, callsign } = event

  if (!fileID) {
    return { success: false, safe: false, message: '缺少文件ID' }
  }

  try {
    const fileRes = await cloud.downloadFile({ fileID })
    const buffer = fileRes.fileContent

    // 空文件：直接清理并放行
    if (!buffer || buffer.length === 0) {
      await cloud.deleteFile({ fileList: [fileID] }).catch(() => {})
      return { success: false, safe: true, message: '文件为空，跳过审核' }
    }

    const contentType = detectContentType(buffer)

    // 2) 同步判定合规性
    // syncResult: 'safe' | 'violation' | 'unknown'
    let syncResult = CONTENT_CHECK_STATUS.UNKNOWN
    try {
      await cloud.openapi.security.imgSecCheck({
        media: { contentType, value: buffer }
      })
      syncResult = CONTENT_CHECK_STATUS.SAFE
    } catch (e) {
      if (e.errCode === 87014) {
        syncResult = CONTENT_CHECK_STATUS.VIOLATION
      } else {
        // 未开通/异常：无法判定，按合规放行（清理原文件，避免堆积）
        console.warn('[contentCheck] imgSecCheck 未开通/异常，按放行处理:', e.errCode)
      }
    }

    // 3) 合规：直接清理 tmp_check 原文件
    if (syncResult === CONTENT_CHECK_STATUS.SAFE) {
      await cloud.deleteFile({ fileList: [fileID] }).catch(() => {})
      return { success: true, safe: true, message: '审核通过' }
    }

    // 4) 违规：同步归档 + 删原文件 + 同步提醒
    if (syncResult === CONTENT_CHECK_STATUS.VIOLATION) {
      const cs = sanitize(callsign || 'unknown')
      try {
        const newPath = await archiveViolation(buffer, cs, RISKY_LABEL)
        console.log('[contentCheck] 违规，已归档:', newPath)
        // 归档成功后再删除 tmp_check 原文件
        await cloud.deleteFile({ fileList: [fileID] }).catch((e) => {
          console.error('[contentCheck] 删除原文件失败（归档已完成）:', e)
        })
      } catch (e) {
        // 归档失败：保留原文件于 tmp_check，便于排查，不删除
        console.error('[contentCheck] 违规归档失败，保留原文件:', e)
      }
      return { success: true, safe: false, message: '内容含违规信息' }
    }

    // 5) 无法判定（unknown）：放行并清理原文件
    await cloud.deleteFile({ fileList: [fileID] }).catch(() => {})
    return { success: true, safe: true, message: '已放行' }
  } catch (e) {
    console.error('[contentCheck] 异常:', e)
    // 异常时清理孤儿文件，避免 tmp_check 堆积
    await cloud.deleteFile({ fileList: [fileID] }).catch(() => {})
    return { success: false, safe: true, message: '审核异常，跳过审核' }
  }
}
