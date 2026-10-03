# `.flow.json` 工程格式

流绘目前读取和写入 `version: 1` 的 JSON 工程。它是可继续编辑的源文件；Markdown、SVG、PNG 都是导出结果。

## 最小示例

```json
{
  "version": 1,
  "title": "示例流程",
  "nodes": [
    { "id": "start", "type": "stage", "position": { "x": 80, "y": 200 }, "data": { "title": "开始", "notes": "", "kind": "start" } },
    { "id": "end", "type": "stage", "position": { "x": 400, "y": 200 }, "data": { "title": "结束", "notes": "", "kind": "end" } }
  ],
  "edges": [
    { "id": "connection", "source": "start", "target": "end" }
  ],
  "viewport": { "x": 0, "y": 0, "zoom": 1 }
}
```

| 字段 | 说明 |
| --- | --- |
| `version` | 必须为 `1` |
| `title` | 工程名称，最多保留 200 个字符 |
| `direction` | 可选，`LR`（横向）或 `TB`（纵向） |
| `nodes` | 阶段列表；`id` 不重复，`position.x/y` 为有限数字，`data.kind` 为 `start`、`process`、`decision` 或 `end` |
| `edges` | 连线列表；`id` 不重复，`source` 和 `target` 必须引用已有阶段 |
| `viewport` | 可选画布位置和缩放；缩放范围为 0.2–2 |
| `createdAt`、`updatedAt` | 可选时间字符串；缺省时由应用填入 |

每个阶段可在 `data.notes` 中保存备注。连线的 `label` 是画布及 Mermaid 导出中的标注。旧工程若只在 `data.condition` 中保存条件且没有 `label`，打开时会将条件显示为标注。

## 连接点与路径

连线可以带 `sourceHandle` 和 `targetHandle`。两者分别以 `source-`、`target-` 开头，后缀可为 `left`、`right`、`top-left`、`top-right`、`bottom-left`、`bottom-right`。旧工程中不存在的点位会回退到有效点位，避免连线消失。

`data.portMode` 可选 `auto` 或 `fixed`。`auto` 根据节点相对位置选择连接点；`fixed` 保留指定点位。`data.waypoints` 是可选折点数组，每项为 `{ "x": 数字, "y": 数字 }`；固定折点优先于自动避障。`data.labelPosition` 为 0–1 的路径位置，`data.labelOffset` 为标签的 `{ "x", "y" }` 偏移。

打开工程时最多接受 2,000 个阶段、5,000 条连线和 10 MB 文件。解析会规范化已知字段；不应依赖应用原样保留未定义的扩展字段。修改工程前建议保留副本。
