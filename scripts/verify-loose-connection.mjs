import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const port = process.argv[2] || '9333';
const sourceIndex = Number(process.argv[3] || 0);
const targetIndex = Number(process.argv[4] || 1);

async function findPage() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
      const page = targets.find((target) => target.type === 'page' && target.url.includes('dist/index.html'));
      if (page) return page;
    } catch {
      // Electron may still be starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('未找到 Electron 调试页面');
}

const page = await findPage();
const socket = new WebSocket(page.webSocketDebuggerUrl);
const pending = new Map();
let nextId = 0;

const opened = new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});

socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  const request = pending.get(message.id);
  if (!request) return;
  pending.delete(message.id);
  if (message.error) request.reject(new Error(message.error.message));
  else request.resolve(message.result);
});

await opened;

function send(method, params = {}) {
  const id = ++nextId;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}

const before = await evaluate(`document.querySelectorAll('.react-flow__edge').length`);
const sourceNodePoint = await evaluate(`(() => {
  const node = [...document.querySelectorAll('.react-flow__node')][${sourceIndex}];
  if (!node) throw new Error('画布节点不足');
  const rect = node.getBoundingClientRect();
  return { x: rect.right - 8, y: rect.top + 8 };
})()`);
await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...sourceNodePoint, button: 'left', buttons: 1, clickCount: 1 });
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...sourceNodePoint, button: 'left', buttons: 0, clickCount: 1 });
await new Promise((resolve) => setTimeout(resolve, 150));

const selectedReady = await evaluate(`(() => {
  const node = [...document.querySelectorAll('.react-flow__node')][${sourceIndex}];
  const handle = node?.querySelector('.stage-handle--source.stage-handle--bottom-left');
  return Boolean(node?.classList.contains('selected') && handle && getComputedStyle(handle).pointerEvents !== 'none');
})()`);
if (!selectedReady) {
  const selectionDebug = await evaluate(`(() => {
    const node = [...document.querySelectorAll('.react-flow__node')][${sourceIndex}];
    const handle = node?.querySelector('.stage-handle--source.stage-handle--bottom-left');
    return {
      selected: node?.classList.contains('selected'),
      visualSelected: Boolean(node?.querySelector('.stage-node.is-selected')),
      handlePointerEvents: handle ? getComputedStyle(handle).pointerEvents : null,
      hitClass: document.elementFromPoint(${sourceNodePoint.x}, ${sourceNodePoint.y})?.getAttribute('class'),
      activeTag: document.activeElement?.tagName
    };
  })()`);
  throw new Error(`测试节点未进入可连接状态：${JSON.stringify(selectionDebug)}`);
}

const points = await evaluate(`(() => {
  const nodes = [...document.querySelectorAll('.react-flow__node')];
  if (nodes.length < 2) throw new Error('画布节点不足');
  const sourceNode = nodes[${sourceIndex}];
  const targetNode = nodes[${targetIndex}];
  const sourceHandle = sourceNode?.querySelector('.stage-handle--source.stage-handle--bottom-left');
  const targetHandle = targetNode?.querySelector('.stage-handle--target.stage-handle--top-left');
  if (!sourceHandle || !targetHandle) throw new Error('未找到测试连接点');
  const center = (element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  };
  return {
    source: center(sourceHandle),
    target: center(targetHandle),
    sourceId: sourceNode.dataset.id,
    targetId: targetNode.dataset.id
  };
})()`);

await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...points.source, button: 'left', buttons: 1, clickCount: 1 });
for (let step = 1; step <= 8; step += 1) {
  const progress = step / 8;
  await send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: points.source.x + (points.target.x - points.source.x) * progress,
    y: points.source.y + (points.target.y - points.source.y) * progress,
    button: 'left',
    buttons: 1
  });
  await new Promise((resolve) => setTimeout(resolve, 25));
}
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...points.target, button: 'left', buttons: 0, clickCount: 1 });
await new Promise((resolve) => setTimeout(resolve, 1500));
const after = await evaluate(`document.querySelectorAll('.react-flow__edge').length`);
socket.close();

if (after !== before + 1) throw new Error(`连线数量未增加：${before} → ${after}`);
const recoveryPath = join(homedir(), 'Library', 'Application Support', 'flowcanvas-studio', 'recovery.flow.json');
let savedInDragDirection = false;
for (let attempt = 0; attempt < 20 && !savedInDragDirection; attempt += 1) {
  const recovery = JSON.parse(await readFile(recoveryPath, 'utf8'));
  savedInDragDirection = recovery.edges.some((edge) => (
    edge.source === points.sourceId && edge.target === points.targetId
  ));
  if (!savedInDragDirection) await new Promise((resolve) => setTimeout(resolve, 200));
}
if (!savedInDragDirection) {
  throw new Error(`箭头方向错误：期望 ${points.sourceId} → ${points.targetId}`);
}
console.log(JSON.stringify({
  mode: 'any-port-drag',
  before,
  after,
  source: points.sourceId,
  target: points.targetId,
  savedInDragDirection,
  success: true
}));
process.exit(0);
