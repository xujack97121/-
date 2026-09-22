# 工程架构

## 目录职责

### `frontend/`

React 与 Vite 驱动的渲染层，只负责界面、交互状态和本地展示逻辑。

- `src/app/`：应用装配、主界面和全局样式。
- `src/features/analytics/`：统计模型、AI 分析结果整理和分析页面。
- `src/features/comments/`：评论随机化与评论时间过滤。
- `src/features/operations/`：自动化操作间隔和任务状态模型。
- `public/`：浏览器扩展入口、service worker、注入脚本和静态图片。Vite 构建时这些文件必须保持在 `dist/` 根目录对应位置。

前端不得直接读取文件系统、账号会话或密钥，也不得引入 Electron 主进程模块。

### `backend/`

Electron 桌面后端，负责窗口、账号会话、页面采集、笔记操作、AI 请求和本地持久化。

- `main.cjs`：进程启动、窗口生命周期和 IPC 注册入口。
- `preload.cjs`：渲染层唯一的桌面能力边界，只暴露明确允许的 IPC 方法。
- `accounts/`：账号元数据、独立会话与持久化。
- `ai/`：模型目录、流式请求、重试和结果规范化。
- `capture/`：响应采集、DOM 采集、去重和字段规范化。
- `platform/`：文件路径、应用图标和渲染地址安全校验。

后端保持 CommonJS，避免同时改动 Electron 加载模型和现有 Node 直跑测试。

### `tests/`

- `frontend/`：纯数据模型、过滤器、随机化和扩展 worker 测试。
- `backend/`：账号、AI、采集、预加载 IPC 和平台适配测试。
- `packaging/`：Electron Builder 与安装器配置测试。

## 运行链路

```text
frontend React UI
  -> backend/preload.cjs
  -> Electron IPC
  -> backend/main.cjs
  -> accounts / capture / ai / platform
  -> 小红书嵌入页面或本地持久化
```

生产构建由仓库根目录的 `vite.config.mjs` 将 `frontend/` 作为 Vite root，并输出到根目录 `dist/`。Electron Builder 从 `dist/`、`backend/` 和 `package.json` 组装桌面应用。

## 维护原则

1. 新的界面逻辑按业务域放入 `frontend/src/features/`，不要继续扩大 `app/App.jsx`。
2. 新的桌面能力先放入对应后端域，再通过 preload 暴露最小 IPC 接口。
3. 前后端共享数据时使用可序列化对象，不传递 DOM、Electron 对象或文件句柄。
4. 修改采集与操作流程时同时补后端测试；修改统计和过滤逻辑时补前端测试。
5. `dist/`、`release/`、运行时账号数据和历史 ASAR 均为生成物或私密数据，不进入源码仓库。
