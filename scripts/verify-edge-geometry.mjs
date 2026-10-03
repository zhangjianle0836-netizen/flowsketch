import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const port = process.argv[2] || '9333';
const recoveryPath = join(homedir(), 'Library', 'Application Support', 'flowcanvas-studio', 'recovery.flow.json');
const recovery = JSON.parse(await readFile(recoveryPath, 'utf8'));

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

await new Promise((resolve, reject) => {
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

function send(method, params = {}) {
  const id = ++nextId;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

const result = await send('Runtime.evaluate', {
  expression: `(() => {
    const edges = ${JSON.stringify(recovery.edges)};
    const center = (element) => {
      const rect = element.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    };
    const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    const pathPoint = (path, atEnd) => {
      const point = path.getPointAtLength(atEnd ? path.getTotalLength() : 0);
      const matrix = path.getScreenCTM();
      const transformed = new DOMPoint(point.x, point.y).matrixTransform(matrix);
      return { x: transformed.x, y: transformed.y };
    };
    return edges
      .filter((edge) => edge.sourceHandle && edge.targetHandle)
      .map((edge) => {
        const group = document.querySelector('[data-testid="rf__edge-' + edge.id + '"]');
        const path = group?.querySelector('.react-flow__edge-path');
        const source = document.querySelector('[data-nodeid="' + edge.source + '"][data-handleid="' + edge.sourceHandle + '"]');
        const target = document.querySelector('[data-nodeid="' + edge.target + '"][data-handleid="' + edge.targetHandle + '"]');
        if (!group || !path || !source || !target) return { id: edge.id, missing: true };
        const blockers = [...document.querySelectorAll('.react-flow__node')]
          .filter((node) => node.dataset.id !== edge.source && node.dataset.id !== edge.target)
          .map((node) => node.getBoundingClientRect());
        let obstacleHits = 0;
        const pathLength = path.getTotalLength();
        const matrix = path.getScreenCTM();
        for (let offset = 0; offset <= pathLength; offset += 2) {
          const point = path.getPointAtLength(offset);
          const screen = new DOMPoint(point.x, point.y).matrixTransform(matrix);
          if (blockers.some((rect) => screen.x > rect.left && screen.x < rect.right && screen.y > rect.top && screen.y < rect.bottom)) {
            obstacleHits += 1;
          }
        }
        const sourcePoint = pathPoint(path, false);
        const targetPoint = pathPoint(path, true);
        const sourceCenter = center(source);
        const targetCenter = center(target);
        return {
          id: edge.id,
          sourceError: distance(sourcePoint, sourceCenter),
          targetError: distance(targetPoint, targetCenter),
          sourceDelta: { x: sourcePoint.x - sourceCenter.x, y: sourcePoint.y - sourceCenter.y },
          targetDelta: { x: targetPoint.x - targetCenter.x, y: targetPoint.y - targetCenter.y },
          obstacleHits,
          zIndex: Number(group.parentElement?.style.zIndex || 0)
        };
      });
  })()`,
  returnByValue: true
});

const clickPointResult = await send('Runtime.evaluate', {
  expression: `(() => {
    const path = document.querySelector('.react-flow__edge .react-flow__edge-path');
    if (!path) return null;
    const point = path.getPointAtLength(path.getTotalLength() * 0.45);
    const screen = new DOMPoint(point.x, point.y).matrixTransform(path.getScreenCTM());
    return { x: screen.x, y: screen.y };
  })()`,
  returnByValue: true
});
const clickPoint = clickPointResult.result.value;
if (!clickPoint) throw new Error('没有可点击的测试连线');
await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...clickPoint, button: 'left', buttons: 1, clickCount: 1 });
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...clickPoint, button: 'left', buttons: 0, clickCount: 1 });
await new Promise((resolve) => setTimeout(resolve, 180));
const selectionResult = await send('Runtime.evaluate', {
  expression: `(() => {
    const selected = document.querySelector('.react-flow__edge.selected');
    const path = selected?.querySelector('.react-flow__edge-path');
    const style = path ? getComputedStyle(path) : null;
    return {
      selected: Boolean(selected),
      animationName: style?.animationName || '',
      dasharray: style?.strokeDasharray || ''
    };
  })()`,
  returnByValue: true
});
await send('Emulation.setEmulatedMedia', {
  features: [{ name: 'prefers-reduced-motion', value: 'reduce' }]
});
await new Promise((resolve) => setTimeout(resolve, 80));
const reducedMotionResult = await send('Runtime.evaluate', {
  expression: `(() => {
    const path = document.querySelector('.react-flow__edge.selected .react-flow__edge-path');
    const style = path ? getComputedStyle(path) : null;
    return { animationName: style?.animationName || '', dasharray: style?.strokeDasharray || '' };
  })()`,
  returnByValue: true
});
socket.close();

if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
const diagnostics = result.result.value;
const invalid = diagnostics.filter((edge) => edge.missing || edge.sourceError > 0.75 || edge.targetError > 0.75 || edge.obstacleHits > 0 || edge.zIndex > 0);
if (invalid.length) throw new Error(`连线几何验证失败：${JSON.stringify(invalid)}`);
const selection = selectionResult.result.value;
if (!selection.selected || selection.animationName !== 'edge-flow-forward' || selection.dasharray === 'none') {
  throw new Error(`连线点击流动效果验证失败：${JSON.stringify(selection)}`);
}
const reducedMotion = reducedMotionResult.result.value;
if (reducedMotion.animationName !== 'none' || reducedMotion.dasharray !== 'none') {
  throw new Error(`减少动态效果验证失败：${JSON.stringify(reducedMotion)}`);
}
console.log(JSON.stringify({ success: true, diagnostics, selection, reducedMotion }));
