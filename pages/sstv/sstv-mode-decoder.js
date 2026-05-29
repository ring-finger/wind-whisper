/**
 * SSTV 解码模式接口（对应 Java 的 Mode.java 接口）
 *
 * 所有 SSTV 解码模式都需要实现这个接口。
 * 主控解码器 (SSTVDecoder) 通过此接口调用具体模式的解码逻辑。
 *
 * 设计参考: xdsopl/robot36 的 Mode.java 接口
 */

class SSTVModeDecoder {
  /**
   * 获取模式名称
   * @returns {string} 模式名称，如 "Robot 36 Color"
   */
  getName() {
    throw new Error('getName() must be implemented by subclass')
  }

  /**
   * 获取 VIS 代码
   * @returns {number} VIS 代码，如 Robot36 = 8
   */
  getVISCode() {
    throw new Error('getVISCode() must be implemented by subclass')
  }

  /**
   * 获取图像宽度（像素）
   * @returns {number}
   */
  getWidth() {
    throw new Error('getWidth() must be implemented by subclass')
  }

  /**
   * 获取图像高度（像素）
   * @returns {number}
   */
  getHeight() {
    throw new Error('getHeight() must be implemented by subclass')
  }

  /**
   * 获取每行采样数
   * @returns {number}
   */
  getScanLineSamples() {
    throw new Error('getScanLineSamples() must be implemented by subclass')
  }

  /**
   * 获取第一个像素的采样偏移（从同步脉冲开始）
   * @returns {number}
   */
  getFirstPixelSampleIndex() {
    throw new Error('getFirstPixelSampleIndex() must be implemented by subclass')
  }

  /**
   * 获取第一个同步脉冲的采样偏移
   * @returns {number}
   */
  getFirstSyncPulseIndex() {
    throw new Error('getFirstSyncPulseIndex() must be implemented by subclass')
  }

  /**
   * 重置解码状态（如奇偶行标记、滤波器等）
   * 在每次新图像开始解码前调用
   */
  resetState() {
    throw new Error('resetState() must be implemented by subclass')
  }

  /**
   * 解码一行扫描线
   *
   * @param {Float32Array} scanLineBuffer - 包含一行数据的缓冲区
   * @param {number} syncPulseIndex - 同步脉冲在缓冲区中的索引
   * @param {number} scanLineSamples - 本行总采样数
   * @param {number} sampleRate - 采样率
   * @param {number} frequencyOffset - 频率偏移校正量
   * @returns {Object|null} 解码后的像素数据，或 null 表示需要更多数据
   *   返回格式: { pixels: Uint8Array, width: number, height: number, lineIndex: number }
   */
  decodeScanLine(scanLineBuffer, syncPulseIndex, scanLineSamples, sampleRate, frequencyOffset) {
    throw new Error('decodeScanLine() must be implemented by subclass')
  }
}

module.exports = SSTVModeDecoder
