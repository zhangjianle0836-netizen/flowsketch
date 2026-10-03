# 架构说明

流绘是本地 Electron 应用。React 界面负责编辑流程；Electron 主进程负责文件对话框、工程读写和导出文件落盘。两者通过 `preload.js` 暴露的受限 IPC 接口通信。

## 主要模块

| 位置 | 职责 |
| --- | --- |
| `main.js`、`preload.js` | 窗口、文件对话框、顺序写入、关闭前保存及受限 IPC |
| `src/App.tsx` | 编辑状态、命令、撤销/重做及画布交互 |
| `src/components/` | 阶段、连线、小地图的 React 组件 |
| `src/flow/document.ts` | 创建与解析 `.flow.json` 工程，兼容旧字段 |
| `src/flow/connections.ts`、`routing.ts` | 连接点选择与正交避障回退路由 |
| `src/flow/libavoid.worker.ts` | 在 Worker 中计算复杂连线的避障路径 |
| `src/flow/image-export.ts`、`markdown.ts` | SVG、PNG 和 Markdown 导出 |
| `src/flow/validation.ts` | 流程语义检查 |

## 工程读写

1. 主进程限制文件大小并读取 JSON，界面使用 `parseFlowDocument` 校验和规范化节点、连线。
2. 只有界面确认解析成功，主进程才切换当前工程路径。无效文件不会成为自动保存目标。
3. 手动保存、自动保存与新建操作在主进程按请求顺序执行；每次写入使用独立临时文件，完成后替换目标文件。
4. 工程会话编号阻止旧工程的延迟保存写入新工程。关闭窗口时，若仍有未落盘的修改，界面先提交最新快照。

未命名工程的草稿写入 Electron 用户数据目录的 `recovery.flow.json`。已打开的工程直接自动保存到原文件。工程格式和兼容规则见 [flow-format.md](flow-format.md)。

## 连线与导出

画布先生成可立即显示的正交路径，再由 Worker 计算更精细的避障路线；只有端点、正交性和节点避让校验通过的异步结果才替换当前路径。固定折点由用户控制，可能穿过节点。SVG、PNG 与画布共用流程数据，但导出时会排除编辑控件。Mermaid 保留语义关系，显示布局由 Mermaid 重新计算。
