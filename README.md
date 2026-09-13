# 风语纪 · 业余无线电通联日志小程序

> 电波有痕，风语为纪

一个面向业余无线电爱好者的微信小程序，覆盖通联日志记录、SSTV 图像传输、梅登黑德网格定位、QSL 卡片设计与三方工具聚合。

原生小程序框架 + 微信云开发，无 TypeScript、无构建步骤，克隆后用微信开发者工具直接打开即可运行。

---

## 功能模块

### 首页 `pages/index`

个人仪表盘。顶部展示呼号 / 昵称 / 头像，四张统计卡片（今日、本周、本月、累计通联数）可直接点击跳转到对应筛选的日志列表；下方是近 6 个月的迷你柱状图，点击柱子弹出当月通联次数；再下方为四个功能入口卡片；右下角悬浮按钮直达"记录日志"表单。

支持 `onShareAppMessage` / `onShareTimeline`，分享图由 canvas 实时绘制四张功能卡片生成，无需预置图片资源。

### 通联日志 `pages/logs`

核心模块，包含记录表单、日志列表、日志详情三个页面。

**记录表单**
- 日期 / BJT 时间自动填充，支持手选与一键刷新；UTC 时间提交时自动补算
- 频率：MHz，保留 3 位小数，按历史记录联想输入，并实时提示所属频段
- 呼号：自动转大写，联想输入，历史记录最多保留 50 个
- 天气（`WX`，选填）：晴 / 多云 / 雨 / 雷雨 / 雪 / 雾 / 大风 / 夜间
- 工作模式（`MODE`）：SSB、CW、FM、AM、PSK31、FT8、RTTY、ATV
- 信号报告（`RST`）：己方与对方各三段，输入后自动跳转下一格。**HF 段报完整 RST（R/S/T），VHF/UHF 段按惯例只报 RS，T 整格不展示也不采集**；切换频段时残留的 T 会被自动清除
- 位置（`QTH`）、设备（`EQUIPMENT`）、天馈（`ANTENNA`）、功率（`PWR`，W）、备注（`NOTES`）
- 支持编辑已有日志

**列表与搜索**
- 按呼号、日期区间搜索，支持"今日 / 本周 / 本月"预设筛选
- 下拉刷新，点击进入详情

**导出**
- CSV（UTF-8 带 BOM，Excel 直接打开，含全部字段）
- ADIF（`.adi`，可导入主流日志软件）

**日志共享**
- 勾选多条日志生成分享，生成 `shareLogs` 云端记录，有效期 7 天
- "我的分享"可查看自己发出的分享及其浏览人数
- 进入他人分享页会通过 `recordShareView` 云函数去重记录查看者
- 过期分享由 `cleanExpiredShares` 云函数每日定时清理

### SSTV 图像传输 `pages/sstv`

**编码**：选图 → 生成 SSTV 音频，当前支持 Robot36 模式，生成标准 48kHz 单声道 WAV，可试听、下载、保存到相册；可叠加呼号水印。

**解码**：监听麦克风或选择音频文件，用 Goertzel / FFT 算法实时解码，支持 VIS 自动识别，覆盖 Robot 36/72、Martin 1/2、Scottie 1/2/DX 共 7 种模式，边解边预览，完成后可保存到相册。

相关实现见 `docs/SSTV_改进说明.md`（参考 CKegel/Web-SSTV 项目修正了同步脉冲、颜色频率范围等标准参数）。

### 梅登黑德网格定位 `pages/maidenhead`

读取定位后实时换算梅登黑德网格编号（支持 4/6/8 位精度），地图上标出当前位置与网格边界，可复制网格号或一键分享。

### QSL 卡片设计 `pages/qsl`

卡面画布设计器。标准 140×90mm（横版 / 竖版可切换），支持正反两面独立设计。

- 拖拽文字 / 图标 / 自定义图片元素，可缩放、旋转、删除，拖动时显示吸附辅助线
- 背景图支持平移、双指缩放、旋转与模板替换
- 字体可选宋体 / 黑体 / 楷体 / 仿宋 / 微软雅黑 / 等宽 / 手写体
- 内置中国电台中英文预设文字、呼号图标与模式模板（`icons-list.js` / `modes-list.js`）
- 设计稿自动保存，导出支持图片与 PDF，可指定单面 / 双面与缩放比例

### 风语集 `pages/wind-collection`

业余无线电相关的三方小程序聚合页。按标签筛选、按优先级排序，卡片点击通过 `appId + path` 或 `shortLink` 跳转目标小程序。

管理员（`ADMIN_OPENIDS` 白名单）长按卡片可新增 / 编辑 / 删除条目，并可手动刷新标签统计；标签统计结果落库到单文档 `windCollectionStats`，避免每次打开都做聚合。

首屏的列表、标签统计、管理员身份由**单次** `home` 调用聚合返回（云函数内并行查询）；同时本地保留了列表 / 标签 / 管理员身份缓存，命中缓存时首屏即时渲染，再由云端结果无缝覆盖。

若首屏仍偏慢，剩余瓶颈是**云函数冷启动**（实例空闲回收后首次触发需 0.5–2s，与调用次数无关）。为此「我的」页会在 `onLoad` / `onShow` 静默发一次 `ping`（服务端不读库、纯空转）把实例焐热，同一会话内 5 分钟节流一次，失败静默忽略。

### 我的 `pages/mine`

设置中心。头像与昵称（微信头像昵称填写能力）、个人呼号（正则 `^[A-Z]{1,2}\d{1,3}[A-Z]{1,4}$` 校验）、主题切换（无线电 / 奶油莫兰迪）、通联总数、更新日志弹窗、云同步开关（含免责声明）、导出日志、联系作者（跳转公众号）。

隐藏彩蛋：连点作者呼号 5 次、或点击中继 / 友台条目，会弹出随机无线电趣味提示。

---

## 项目结构

```
wind-whispe/
├── app.js                    # 全局入口：主题、缓存层、呼号校验、广告、审核、配置同步
├── app.json                  # 页面注册、分包、权限、预加载规则
├── app.wxss                  # 全局样式
├── sitemap.json
├── project.config.json       # appid / 云函数根目录 / 基础库版本
├── utils/
│   ├── constants.js          # 审核开关、系统配置中心、超管 openid
│   ├── db.js                 # 云数据库封装（用户资料、按月统计）
│   └── rst.js                # RST 工具：频段判定、归一化、ADIF BAND 映射
├── pages/
│   ├── index/                # 首页仪表盘（主包）
│   ├── mine/                 # 我的 / 设置（主包）
│   ├── logs/                 # 分包：通联日志
│   │   ├── logs.*            #   记录表单 + 列表
│   │   └── detail/           #   日志详情
│   ├── sstv/                 # 分包：SSTV 编解码
│   │   ├── sstv.*
│   │   ├── sstv-mode.js      #   模式基类（WAV 编码、相位连续单音）
│   │   ├── sstv-robot36.js   #   Robot36 编码
│   │   ├── sstv-scottie1.js  #   Scottie1 编码（预留）
│   │   └── sstv-fft-decoder.js #  FFT 解码器（7 种模式 + VIS 识别）
│   ├── qsl/                  # 分包：QSL 卡片设计
│   │   ├── qsl.*
│   │   ├── icons-list.js
│   │   └── modes-list.js
│   ├── maidenhead/           # 分包：网格定位
│   └── wind-collection/      # 分包：风语集
├── cloudfunctions/
│   ├── windCollection/       # 风语集列表 / 标签统计 / 管理员管理
│   ├── contentCheck/         # 图片内容安全审核 + 违规归档
│   ├── systemConfig/         # 全局配置读取与超管修改
│   ├── recordShareView/      # 记录日志分享的查看者（去重）
│   ├── cleanExpiredShares/   # 定时清理过期分享
│   └── getOpenId/            # 获取当前用户 openid
├── images/
│   ├── cover.jpg             # 默认分享封面
│   ├── icons/                # CRAC 徽标
│   └── modes/                # QSL 模式模板（横版 / 竖版）
├── docs/
│   └── SSTV_改进说明.md
└── minitest/
```

`logs` 分包已配置 `preloadRule`，进入首页时预加载。

---

## 云开发

### 云函数

| 云函数 | 说明 | 权限 |
|---|---|---|
| `windCollection` | 风语集：`home`（首屏聚合）/ `ping`（静默预热，不读库）/ `list` / `tags` / `isAdmin` / `refreshTags` / `add` / `update` / `remove` | 读接口全员可用，写接口仅 `ADMIN_OPENIDS` |
| `contentCheck` | 下载 `tmp_check/` 图片并调用 `security.imgSecCheck` 审核 | 全员可用 |
| `systemConfig` | `get` 全员可读；`set` 仅超管，字段受 `WRITABLE_KEYS` 白名单限制 | 分级 |
| `recordShareView` | 按 openid 去重累加分享浏览数 | 全员可用 |
| `cleanExpiredShares` | 清理 `expireTime` 到期的分享记录 | 定时触发（每日 0:00） |
| `getOpenId` | 返回调用方 openid | 全员可用 |

### 云数据库集合

| 集合 | 用途 |
|---|---|
| `userProfiles` | 用户资料（昵称、呼号、头像、主题、云同步开关、日志总数） |
| `contactStats` | 按月通联数量统计，用于图表 |
| `contactLogs` | 云端日志备份（开启云同步后写入） |
| `shareLogs` | 日志分享记录、查看者列表、过期时间 |
| `appConfig` | 全局配置中心，单文档 `_id = global` |
| `windCollectionItems` | 风语集条目 |
| `windCollectionStats` | 风语集标签统计，单文档 `_id = global` |

> `appConfig` 的「记录权限」需设为**所有用户可读**，否则客户端实时订阅（watch）不生效。

### 云存储目录

| 目录 | 用途 |
|---|---|
| `tmp_check/` | 待审核图片的临时中转，审核后即删除 |
| `tmp_err/` | 违规图片归档，命名 `{时间戳}_{呼号}_{label}.jpg` |

---

## 本地存储

| Key | 内容 |
|---|---|
| `contactLogs` | 通联日志（本地最多 200 条） |
| `myCallSign` | 个人呼号 |
| `callHistory` | 呼号联想历史（最多 50 个） |
| `frequencyHistory` | 频率联想历史 |
| `appTheme` | 当前主题（`radio` / `morandi`） |
| `cloudSyncEnabled` | 云同步开关 |
| `wxMineAvatarUrl` / `wxMineNickName` | 头像本地路径 / 昵称 |
| `maxCloudLogCount` | 云端日志条数上限 |
| `systemConfigCache` | 系统配置本地缓存 |
| `lastSeenVersion` | 已查看过的版本号 |
| `lastCloudSyncDate` | 上次云端同步日期（每日限一次） |
| `windCollection_*` / `windCollection_tags_v2` | 风语集列表与标签缓存 |

---

## 全局能力（`app.js`）

- **`_cache` 存储缓存层**：所有跨页读取的存储值统一走内存缓存，未命中才读 Storage，避免启动期重复同步 IO 阻塞渲染
- **`requireCallSign(options)`**：呼号拦截统一入口，未设置呼号时弹窗阻断并引导去"我的"页；传 `allowRewardedAd` 可额外提供"看激励广告临时使用一次"路径（SSTV 场景在用）
- **`checkImageSafety(tempFilePath)`**：图片审核统一入口，受 `CONTENT_CHECK.ENABLED` 与云端配置双开关控制；关闭时直接放行，异常时不阻塞
- **系统配置同步**：`refreshSystemConfig()` 拉取 + `watchSystemConfig()` 实时订阅 + 5 分钟定时兜底；已处理冷启动时云 WebSocket 未登录（`-402002`）导致的无效重连风暴
- **主题**：`initTheme()` 统一设置导航栏颜色并广播 `currentTheme` 到所有页面
- **定位缓存**：`getCachedLocation()` 5 分钟内复用，避免重复 `getLocation` 阻塞首屏
- **隐私合规**：启动即检查 `wx.getPrivacySetting`，并注册 `onNeedPrivacyAuthorize` 覆盖后续授权

---

## 关键配置

部署到自己的账号前，需要同步修改以下位置：

| 位置 | 说明 |
|---|---|
| `project.config.json` → `appid` | 小程序 AppID |
| `app.js` → `wx.cloud.init({ env })` | 云开发环境 ID |
| 各云函数 → `cloud.init(...)` | 需与上面同环境（部分函数用 `DYNAMIC_CURRENT_ENV`） |
| `utils/constants.js` → `SUPER_ADMIN_OPEN_ID` | 系统配置管理员的 openid |
| `cloudfunctions/windCollection/index.js` → `ADMIN_OPENIDS` | 风语集数据管理员白名单，留空则禁用管理接口 |
| `pages/mine/mine.js` → `OFFICIAL_ACCOUNT_USERNAME` | 公众号原始 ID（`gh_` 开头） |
| `app.js` → `createRewardedVideoAd({ adUnitId })` | 激励视频广告位 ID |

> `utils/constants.js` 与 `cloudfunctions/*/constants.js` 存在同名常量副本，修改需手动同步。

---

## 开发与部署

1. 用微信开发者工具打开项目根目录
2. 开通云开发并创建环境，把环境 ID 填入 `app.js`
3. 右键 `cloudfunctions/` 下每个云函数 → 「上传并部署：云端安装依赖」
4. 在云控制台创建数据库集合（见上方表格），并把 `appConfig` 权限设为所有用户可读
5. 为 `cleanExpiredShares` 配置定时触发器（每日 0:00）
6. 点击「编译」在模拟器预览，真机调试需配置真实 AppID

调试时可在 `utils/constants.js` 里把 `CONTENT_CHECK.ENABLED` 置为 `false` 关闭图片审核。

---

## 数据与限制

- 本地日志上限 200 条，云端备份上限 100 条
- 云端全量同步每天只能执行一次（`lastCloudSyncDate` 控制）
- 日志分享有效期 7 天，过期由定时任务清理
- 数据主要存于本地，清除小程序缓存会丢失，建议定期导出备份

---

## 隐私与权限

- `scope.userLocation` / `requiredPrivateInfos: getLocation`：仅用于梅登黑德网格换算
- 图片审核会将图片临时上传至云存储 `tmp_check/`，审核完成后立即删除；违规图片会归档至 `tmp_err/` 供人工复核
- 启动时检查隐私协议授权状态，未同意则拉起系统授权弹窗

---

## 版本

当前版本 **1.6.0**，更新内容见 `pages/mine/mine.js` 中的 `UPDATE_LOGS`。发布新版本时需同步更新该常量，用户首次打开新版会看到更新日志弹窗。

---

## 作者

- 呼号：BA4IWA
- 公众号：饮月听风
- 问题与建议欢迎通过公众号留言

## 许可证

MIT License
