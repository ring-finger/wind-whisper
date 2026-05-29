/**
 * Robot 36 Color 解码器
 *
 * 移植自 xdsopl/robot36 的 Robot_36_Color.java
 *
 * Robot36 时序（每行约 150ms，共 240 行，总时长约 36 秒）:
 *   [9ms 同步脉冲 1200Hz]
 *   [3ms 同步门廊 1500Hz]
 *   [88ms Y(亮度) 1500-2300Hz, 320 像素]
 *   [4.5ms 分隔符 1500Hz(偶行)/2300Hz(奇行)]
 *   [1.5ms 门廊 1900Hz]
 *   [44ms C(色度) 1500-2300Hz, 160 像素]
 *
 * 色彩编码（两行合并一扫描线）:
 *   偶行: Y + B-Y (U 分量)
 *   奇行: Y + R-Y (V 分量)
 *   合并后通过 YUV→RGB 转换为最终像素
 *
 * 参考:
 *   - Java 原版: Robot_36_Color.java
 *   - 色彩转换: ColorConverter.java (BT.601)
 */

const SSTVModeDecoder = require('./sstv-mode-decoder')

// ============================================================================
// 工具函数
// ============================================================================

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

/**
 * 指数移动平均滤波器
 * 对应 Java 的 ExponentialMovingAverage.java
 */
class ExponentialMovingAverage {
  constructor() {
    this.alpha = 0
    this.value = 0
    this.initialized = false
  }

  /**
   * 设置截止频率和采样数
   * @param {number} pixels - 像素数（用于计算 alpha）
   * @param {number} samplesPerPixel - 每像素采样数
   * @param {number} multiplier - 乘数（Java 中用 2）
   */
  cutoff(pixels, samplesPerPixel, multiplier) {
    // alpha = 1 - exp(-multiplier / pixels / samplesPerPixel)
    // 简化计算，与 Java 版本保持一致
    const rc = multiplier / pixels / samplesPerPixel
    this.alpha = 1.0 - Math.exp(-rc)
  }

  reset() {
    this.initialized = false
    this.value = 0
  }

  /**
   * 输入一个样本，返回滤波后的值
   * @param {number} input
   * @returns {number}
   */
  avg(input) {
    if (!this.initialized) {
      this.value = input
      this.initialized = true
    } else {
      this.value = this.alpha * input + (1.0 - this.alpha) * this.value
    }
    return this.value
  }
}

// ============================================================================
// YUV → RGB 转换（BT.601 SD）
// 对应 Java 的 ColorConverter.java
// ============================================================================

const BT601 = {
  /**
   * YUV → RGB（整数版本）
   * Y ∈ [16, 235], U/V ∈ [16, 240]
   * R = clamp((298 * Y + 409 * V + 128) >> 8)
   * G = clamp((298 * Y - 100 * U - 208 * V + 128) >> 8)
   * B = clamp((298 * Y + 516 * U + 128) >> 8)
   */
  YUV2RGB(Y, U, V) {
    Y = clamp(Y, 16, 235)
    U = clamp(U, 16, 240)
    V = clamp(V, 16, 240)
    const R = clamp(Math.round((298 * Y + 409 * V + 128) >> 8), 0, 255)
    const G = clamp(Math.round((298 * Y - 100 * U - 208 * V + 128) >> 8), 0, 255)
    const B = clamp(Math.round((298 * Y + 516 * U + 128) >> 8), 0, 255)
    return { R, G, B }
  },

  /**
   * 频率值 → 电平 (0.0 ~ 1.0)
   * 对应 Java 的 freqToLevel(): 0.5 * (frequency - offset + 1.0)
   * 归一化频率范围: [-1, +1] → [0, 1]
   */
  freqToLevel(frequency, offset) {
    return clamp(0.5 * (frequency - offset + 1.0), 0.0, 1.0)
  },

  /**
   * 将电平值(0~1)转为 RGB 整数 (0xFFRRGGBB)
   * 对应 Java 的 RGB(float, float, float)
   */
  RGB2Int(r, g, b) {
    const ri = clamp(Math.round(r * 255), 0, 255)
    const gi = clamp(Math.round(g * 255), 0, 255)
    const bi = clamp(Math.round(b * 255), 0, 255)
    return 0xFF000000 | (ri << 16) | (gi << 8) | bi
  },

  /**
   * YUV 分量合并 → RGB 整数
   * 对应 Java 的 YUV2RGB(int YUV)
   * YUV 打包格式: 0x00RRGGBB (实际上 Y=G, U=B, V=R)
   */
  YUV2RGBInt(YUV) {
    const Y = (YUV & 0x00FF0000) >> 16  // Java 中 Y 存在高位
    const U = (YUV & 0x0000FF00) >> 8
    const V = YUV & 0x000000FF
    const rgb = this.YUV2RGB(Y, U, V)
    return 0xFF000000 | (rgb.R << 16) | (rgb.G << 8) | rgb.B
  }
}

// ============================================================================
// Robot 36 Color 解码器主体
// ============================================================================

class Robot36ColorDecoder extends SSTVModeDecoder {
  constructor(sampleRate = 8000) {
    super()
    this.sampleRate = sampleRate

    // --- 时序参数（基于 Java Robot_36_Color 构造函数） ---
    this.horizontalPixels = 320
    this.verticalPixels = 240

    // 各阶段持续时间 (秒)
    this.syncPulseSeconds = 0.009      // 9ms 同步脉冲
    this.syncPorchSeconds = 0.003     // 3ms 同步门廊
    this.luminanceSeconds = 0.088     // 88ms 亮度(Y)
    this.separatorSeconds = 0.0045    // 4.5ms 分隔符
    this.porchSeconds = 0.0015        // 1.5ms 门廊
    this.chrominanceSeconds = 0.044   // 44ms 色度(C)

    // 计算采样数
    this.syncPulseSamples = Math.round(this.syncPulseSeconds * sampleRate)
    this.syncPorchSamples = Math.round(this.syncPorchSeconds * sampleRate)
    this.luminanceSamples = Math.round(this.luminanceSeconds * sampleRate)
    this.separatorSamples = Math.round(this.separatorSeconds * sampleRate)
    this.porchSamples = Math.round(this.porchSeconds * sampleRate)
    this.chrominanceSamples = Math.round(this.chrominanceSeconds * sampleRate)

    // 扫描线总采样数
    this.scanLineSamples = Math.round(
      (this.syncPulseSeconds + this.syncPorchSeconds +
       this.luminanceSeconds + this.separatorSeconds +
       this.porchSeconds + this.chrominanceSeconds) * sampleRate
    )

    // 各阶段在扫描线中的起始偏移（从同步脉冲结束后开始计算）
    // 对应 Java 的 *BeginSamples
    this.luminanceBeginSamples = Math.round(this.syncPorchSeconds * sampleRate)
    this.separatorBeginSamples = Math.round((this.syncPorchSeconds + this.luminanceSeconds) * sampleRate)
    this.chrominanceBeginSamples = Math.round(
      (this.syncPorchSeconds + this.luminanceSeconds +
       this.separatorSeconds + this.porchSeconds) * sampleRate
    )
    this.endSamples = Math.round(
      (this.syncPorchSeconds + this.luminanceSeconds +
       this.separatorSeconds + this.porchSeconds +
       this.chrominanceSeconds) * sampleRate
    )

    // 第一个像素的偏移（从同步脉冲开始算起）
    this.firstPixelSampleIndex = this.luminanceBeginSamples

    // --- 解码状态 ---
    this.lastEven = false          // 上一行是否为偶行
    this.lowPassFilter = new ExponentialMovingAverage()

    // 像素缓冲区（2行，用于奇偶行合并）
    // 每行存储 320 个像素的 YUV 打包值
    this.pixelBuffer = new Int32Array(this.horizontalPixels * 2)
    this.currentRow = 0  // 0 = 偶行, 1 = 奇行

    // 输出图像缓冲区
    this.outputImage = null  // Uint8ClampedArray, 将在 decode 开始时分配
    this.outputLine = 0     // 当前正在构建的扫描线索引 (0 ~ height/2)
  }

  // ---- SSTVModeDecoder 接口实现 ----

  getName() {
    return 'Robot 36 Color'
  }

  getVISCode() {
    return 8  // Robot36 VIS code = 0x08 (偶校验后为 0x88)
  }

  getWidth() {
    return this.horizontalPixels
  }

  getHeight() {
    return this.verticalPixels
  }

  getScanLineSamples() {
    return this.scanLineSamples
  }

  getFirstPixelSampleIndex() {
    return this.firstPixelSampleIndex
  }

  getFirstSyncPulseIndex() {
    return 0  // 同步脉冲在扫描线最开始
  }

  resetState() {
    this.lastEven = false
    this.lowPassFilter.reset()
    this.currentRow = 0
    this.outputLine = 0
    this.pixelBuffer.fill(0)
  }

  /**
   * 初始化输出图像缓冲区
   * @param {number} width
   * @param {number} height
   */
  initOutputImage(width, height) {
    this.outputImage = new Uint8ClampedArray(width * height * 4)
    this.outputImage.fill(255)  // Alpha = 255
    this.outputLine = 0
  }

  /**
   * 解码一行扫描线
   *
   * 对应 Java Robot_36_Color.decodeScanLine() 方法
   *
   * @param {Float32Array} scanLineBuffer - 包含一行数据的缓冲区（归一化频率值 [-1, +1]）
   * @param {number} syncPulseIndex - 同步脉冲在缓冲区中的起始索引
   * @param {number} scanLineSamples - 本行总采样数
   * @param {number} sampleRate - 采样率
   * @param {number} frequencyOffset - 频率偏移校正量（归一化值）
   * @returns {Object|null} { width, height, pixels, completed } 或 null
   */
  decodeScanLine(scanLineBuffer, syncPulseIndex, scanLineSamples, sampleRate, frequencyOffset) {
    const buf = scanLineBuffer
    const idx = syncPulseIndex
    const offset = frequencyOffset

    // 边界检查
    if (idx + this.firstPixelSampleIndex < 0 ||
        idx + this.endSamples > buf.length) {
      return null
    }

    // --- 1. 判断奇偶行 ---
    // 读取分隔符区域的频率值
    // 偶行分隔符 = 1500Hz (< 1900Hz, 归一化后为负值)
    // 奇行分隔符 = 2300Hz (> 1900Hz, 归一化后为正值)
    let separatorSum = 0
    for (let i = 0; i < this.separatorSamples; i++) {
      separatorSum += buf[idx + this.separatorBeginSamples + i]
    }
    let separatorAvg = separatorSum / this.separatorSamples
    separatorAvg -= offset  // 去除频率偏移

    // 判断奇偶行
    // separator < 0 → 偶行, separator > 0 → 奇行
    // 容错: 如果值在 ±0.9 范围内无法判断，则沿用上一行
    let even = separatorAvg < 0
    if (separatorAvg < -1.1 || (separatorAvg > -0.9 && separatorAvg < 0.9) || separatorAvg > 1.1) {
      even = !this.lastEven
    }
    this.lastEven = even

    // --- 2. 低通滤波（对亮度和色度信号） ---
    // 正向滤波
    this.lowPassFilter.cutoff(this.horizontalPixels, 2 * this.luminanceSamples, 2)
    this.lowPassFilter.reset()
    const filtered = new Float32Array(this.endSamples)
    for (let i = this.firstPixelSampleIndex; i < this.endSamples; i++) {
      filtered[i] = this.lowPassFilter.avg(buf[idx + i])
    }

    // 反向滤波（使相位响应对称）
    this.lowPassFilter.reset()
    for (let i = this.endSamples - 1; i >= this.firstPixelSampleIndex; i--) {
      filtered[i] = BT601.freqToLevel(this.lowPassFilter.avg(filtered[i]), offset)
    }

    // --- 3. 提取像素值 ---
    // 对应 Java 的 for (int i = 0; i < horizontalPixels; i++) 循环
    const width = this.horizontalPixels

    for (let i = 0; i < width; i++) {
      // Y(亮度) 位置
      const yPos = this.luminanceBeginSamples +
                   Math.round(i * this.luminanceSamples / width)

      // C(色度) 位置 (色度只有 160 像素，需要插值到 320)
      const cPos = this.chrominanceBeginSamples +
                   Math.round(i * this.chrominanceSamples / (width / 2))

      // 将频率值转为电平 (0~1)，再转为 0~255
      // 归一化频率 [-1, +1] → 电平 [0, 1] → 像素值 [0, 255]
      const yNorm = clamp(filtered[yPos], 0, 1)
      const cNorm = clamp(filtered[cPos], 0, 1)
      const yLevel = Math.round(yNorm * 255)
      const cLevel = Math.round(cNorm * 255)

      if (even) {
        // 偶行: 存储 Y 和 U (B-Y)
        // Java: pixelBuffer[i] = RGB(scratch[luminancePos], 0, scratch[chrominancePos])
        // Java RGB(Y, U, V) 打包为 0x00RRGGBB (R=Y, G=U, B=V)
        // 偶行: G=0, B=U (U 存在 B 位置)
        // 所以 pixelBuffer[i] = (Y << 16) | U
        this.pixelBuffer[i] = (yLevel << 16) | cLevel
      } else {
        // 奇行: 存储 Y 和 V (R-Y)
        // Java: pixelBuffer[i] = RGB(scratch[luminancePos], scratch[chrominancePos], 0)
        // Java RGB(Y, U, V) 打包为 0x00RRGGBB
        //   奇行: R=Y, G=V (V 存在 G 位置), B=0
        //   所以 oddYUV = (Y << 16) | (V << 8)
        const oddYUV = (yLevel << 16) | (cLevel << 8)

        // 合并: Y 和 U 来自偶行, V 来自奇行
        // Java:
        //   evenYUV = pixelBuffer[i] (Y|U)
        //   oddYUV = RGB(scratch[luminancePos], scratch[chrominancePos], 0) (Y|V)
        //   YUV2RGB((evenYUV & 0x00ff00ff) | (oddYUV & 0x0000ff00))
        //   即: Y=even.Y, U=even.U, V=odd.V
        //
        // 位操作:
        //   evenYUV & 0x00ff00ff = 保留 Y(>>16) 和 U(&0xFF, 在 B 位置)
        //   oddYUV & 0x0000ff00 = 保留 V(>>8, 在 G 位置)

        const evenYUV = this.pixelBuffer[i]
        const evenY = (evenYUV >> 16) & 0xFF  // Y 在 R 位置
        const evenU = evenYUV & 0xFF            // U 在 B 位置
        const oddV = (oddYUV >> 8) & 0xFF     // V 在 G 位置

        // YUV → RGB
        const rgb = BT601.YUV2RGB(evenY, evenU, oddV)

        // 存储到输出图像
        if (this.outputImage && this.outputLine < this.verticalPixels) {
          const outIdx = (this.outputLine * width + i) * 4
          this.outputImage[outIdx] = rgb.R
          this.outputImage[outIdx + 1] = rgb.G
          this.outputImage[outIdx + 2] = rgb.B
          this.outputImage[outIdx + 3] = 255
        }

        // 存储奇行的像素（Y|V），用于下一行合并（如果有）
        this.pixelBuffer[i] = oddYUV
      }
    }

    // --- 4. 更新状态 ---
    // Robot36 是隔行扫描:
    //   - 偶行: 存储 Y 和 U
    //   - 奇行: 存储 Y 和 V，并与偶行合并，完成一个扫描线
    //   所以 outputLine++ 应该在奇行结束时执行

    if (even) {
      // 偶行结束
      this.currentRow = 0
    } else {
      // 奇行结束，完成一个扫描线
      this.currentRow = 1
      this.outputLine++
    }

    // 返回当前解码状态
    // outputLine 范围是 0 ~ verticalPixels/2
    // 但输出图像已经是完整高度 (verticalPixels)
    return {
      width: this.horizontalPixels,
      height: this.verticalPixels,
      pixels: this.outputImage,
      line: this.outputLine * 2,  // 转换为实际行号（隔行扫描）
      completed: this.outputLine >= this.verticalPixels / 2
    }
  }
}

module.exports = Robot36ColorDecoder
