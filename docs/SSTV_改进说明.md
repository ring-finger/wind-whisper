# SSTV 解码器改进总结

## 参考项目
- **GitHub**: https://github.com/CKegel/Web-SSTV
- **MIT License**: Christian Kegel

## 主要改进

### 1. 修正SSTV标准参数
基于Web-SSTV项目，修正了以下关键参数：

| 参数 | 旧值 | 新值 | 说明 |
|------|------|------|------|
| 同步脉冲频率 | 1200Hz | 1200Hz | 保持一致 |
| 消隐脉冲频率 | 1500Hz | 1500Hz | 保持一致 |
| 垂直同步频率 | 900Hz | 1900Hz | 修正为标准值 |
| 颜色频率范围 | 300-2300Hz | 1500-2300Hz | 修正为标准值 |
| VIS ONE | - | 1100Hz | 新增 |
| VIS ZERO | - | 1300Hz | 新增 |

### 2. 优化Goertzel算法
- 使用优化的Goertzel算法检测频率
- 添加Hamming窗口函数
- 支持多个关键频率的同时检测
- 增加颜色频率精细检测功能

### 3. 改进状态机
- 完善的状态机处理流程
- 支持水平同步(1200Hz)和垂直同步(1900Hz)
- 优化的频率检测逻辑

### 4. 支持多种格式
```javascript
setFormat(format) {
  switch(format) {
    case 'Robot36':
      this.imageWidth = 320
      this.imageHeight = 240
      break
    case 'MartinM1':
    case 'MartinM2':
    case 'ScottieS1':
    case 'ScottieS2':
      this.imageWidth = 320
      this.imageHeight = 256
      break
  }
}
```

## 技术细节

### Goertzel算法参数
- **采样率**: 8000Hz（适合手机麦克风）
- **处理窗口**: 64样本（约8ms）
- **关键检测频率**:
  - 同步脉冲: 1200Hz
  - 消隐脉冲: 1500Hz
  - 垂直同步: 1900Hz
  - 颜色范围: 1500-2300Hz

### 频率到灰度映射
```javascript
frequencyToGray(freq) {
  // 将1500-2300Hz映射到0-255
  const ratio = (freq - 1500) / (2300 - 1500)
  return Math.floor(ratio * 255)
}
```

### 实时预览优化
- 每10行更新一次预览图片
- 减少Canvas重绘频率
- 优化内存使用

## 已删除功能
- ❌ 频谱图显示（显示效果差）
- ❌ 音频波形显示（显示效果差）

## 保留功能
- ✅ 实时解码预览
- ✅ 进度显示（扫描线和百分比）
- ✅ 保存到相册
- ✅ 停止监听提示

## 测试建议
1. 使用标准SSTV音频源进行测试
2. 确保音频信号强度适中
3. 环境噪音尽量低
4. 观察控制台输出的调试信息

## 下一步改进方向
1. 添加VIS码识别（自动检测SSTV格式）
2. 实现彩色解码（目前是灰度）
3. 添加更多SSTV格式支持
4. 优化噪声过滤算法
5. 添加图像增强功能

## 相关文件
- `pages/sstv/sstv.js` - SSTV编解码核心逻辑
- `pages/sstv/sstv.wxml` - UI界面
- `pages/sstv/sstv.wxss` - 样式

## 参考资料
- Web-SSTV项目源码: https://github.com/CKegel/Web-SSTV
- SSTV Handbook
- JL Barber (N7CXI) Proposal for SSTV Mode Specifications
