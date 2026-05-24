# CLAUDE.md - 桌面宠物 (Desktop Pet)

## 语言偏好
**始终使用中文回复。** 所有解释、建议、代码注释都用简体中文。

## 项目概述
基于 Electron 的桌面宠物应用，搭载本地 AI（DeepSeek API）。宠物会主动说话、响应用户交互，并根据上下文切换心情状态。

## 技术栈
- **框架**: Electron 33
- **打包**: electron-builder 25
- **AI 后端**: DeepSeek API（也支持 Ollama，当前未启用）
- **运行环境**: Node.js + Chromium（渲染进程）
- **持久化**: SQLite（better-sqlite3）

## 项目结构

```
electron/          # 主进程 (Node.js)
  main.js          # 入口、IPC 处理、应用生命周期
  window.js        # 宠物窗口创建与管理
  preload.js       # contextBridge 暴露 petAPI / controlAPI
  mood.js          # 心情状态机（happy/excited/bored/sleepy/caring）
  scheduler.js     # 主动消息调度、对话回复
  events.js        # 前台窗口检测、时间上下文、空闲追踪
  deepseek.js      # DeepSeek API 客户端
  ollama.js        # Ollama API 客户端（备用）
  memory.js        # SQLite 持久化（对话、记忆、心情历史）
  prompts.js       # LLM 提示词模板
  tray.js          # 系统托盘图标与菜单
  get-window.ps1   # PowerShell 脚本，获取前台窗口标题

renderer/          # 渲染进程 (浏览器)
  pet.html         # 宠物窗口 DOM（气泡 + CSS 绘制的角色 + 阴影）
  js/pet.js        # 宠物交互：拖拽、点击、双击、气泡、心情 CSS
  css/pet.css      # 宠物样式：5 种心情的颜色/动画/面部表情
  chat.html        # 聊天窗口 DOM
  js/chat.js       # 聊天渲染：消息追加、流式 token
  css/chat.css     # 聊天窗口样式
  control.html     # 控制面板 DOM
  js/control.js    # 控制面板逻辑
  css/control.css  # 控制面板样式（深色主题）
```

## 核心架构

### 心情系统 (mood.js)
5 种心情：`happy` → `excited` → `bored` → `sleepy` → `caring`
- `triggerEvent(event)` 根据事件 + 概率切换状态
- 事件类型：`user_interaction`、`long_idle`、`late_night`、`morning`、`long_work`、`user_praises`、`user_scolds`、`tick`
- 心情影响主动发言的频率（excited 1-2min，sleepy 5-12min）
- 所有变化通过 `memory.saveMood()` 持久化

### 调度器 (scheduler.js)
- 启动后延迟 60 秒开始循环检查
- 每次检查：更新心情 → 构建上下文 → 调用 LLM 判断是否发言
- LLM 返回 `{should_speak, message, reason}` JSON
- 发言冷却时间 1 分钟
- `generateReplyStreaming()` 处理聊天窗口的流式回复

### 宠物窗口 (window.js)
- 无边框、透明、置顶 (`alwaysOnTop: true`)
- 类型 `tool-window`，不在任务栏显示
- 初始位置：屏幕右下角（距右 260px，距底 360px）
- 可通过拖拽移动（renderer/js/pet.js 的 mousedown/move/up）

### 点击交互 (renderer/js/pet.js)
- **单击宠物** → `forceSpeak()` 触发 AI 主动发言
- **双击宠物** → `openChat()` 打开聊天对话框
- **单击气泡** → 打开聊天窗口
- **单击气泡关闭按钮** → 关闭气泡（不打开聊天）
- 拖拽时不触发点击事件（通过 `dragMoved` 标志判断）

### IPC 通道
| 通道 | 方向 | 用途 |
|------|------|------|
| `open-chat-window` | 渲染→主 | 打开聊天窗口 |
| `close-chat-window` | 渲染→主 | 隐藏聊天窗口 |
| `get-pet-position` | 渲染→主(handle) | 获取宠物位置 |
| `move-window-to` | 渲染→主 | 移动宠物窗口（带边界限制） |
| `move-window` | 渲染→主 | 相对偏移移动 |
| `force-speak` | 渲染→主 | 强制触发主动发言 |
| `user-message` | 渲染→主 | 发送聊天消息，流式回复 |
| `open-control-window` | 渲染→主 | 打开控制面板 |
| `set-mood` / `reset-mood` | 渲染→主 | 手动设置/恢复心情 |
| `get-state` | 渲染→主(handle) | 获取心情和对话历史 |
| `check-status` | 渲染→主(handle) | 检查 API 状态 |

## 开发命令
- `npm run dev` — 启动开发模式（`electron .`）
- `npm run build` — 打包
- `npm run build:win` — Windows 打包

## 配置
- 项目根目录 `.env` 文件配置 `DEEPSEEK_API_KEY`
- `.env.example` 作为模板

## 注意事项
- 宠物窗口关闭不退出应用（托盘常驻），`app.on('window-all-closed')` 为空
- 聊天窗口和控制面板窗口关闭时只是隐藏，不是销毁
- 拖拽支持多显示器边界限制（至少保留 40px 可见）
- 气泡默认 8 秒自动消失，可通过托盘菜单开关气泡功能
- 晚间（深夜）模式会跳过主动发言
