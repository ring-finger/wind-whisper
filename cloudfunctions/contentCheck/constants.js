/**
 * 云函数侧审核常量（镜像 utils/constants.js）
 * --------------------------------------------------------------------------
 * 云函数运行环境无法引用小程序目录，故在此维护同名常量。
 * 后期整体迁移进小程序内后，以 utils/constants.js 为唯一来源，本文件可删除。
 * 修改路径/标识时请同步两处，保持一致。
 */
const CONTENT_CHECK = {
  ENABLED: true,
  TMP_CHECK_DIR: 'tmp_check',
  TMP_ERR_DIR: 'tmp_err',
  RISKY_LABEL: 'risky'
}

const CONTENT_CHECK_STATUS = {
  SAFE: 'safe',
  VIOLATION: 'violation',
  UNKNOWN: 'unknown'
}

module.exports = {
  CONTENT_CHECK,
  CONTENT_CHECK_STATUS
}
