import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import { pathToFileURL } from 'node:url';
import { join, resolve } from 'node:path';

const project = resolve(import.meta.dirname, '..');
const qaDir = await mkdtemp(join(tmpdir(), 'flowsketch-qa-'));
const output = process.argv[2] ? resolve(process.argv[2]) : qaDir;
await mkdir(output, { recursive: true });
const fixturePath = join(qaDir, 'fixture.flow.json');
const now = new Date().toISOString();
const nodes = [
  ['S', '开始', 'start', 80, 200],
  ['D', '是否满足退款申请条件并已核对订单状态？', 'decision', 390, 180],
  ['A', '审核退款申请', 'process', 700, 90],
  ['B', '补充退款资料', 'process', 700, 340],
  ['E', '结束', 'end', 1010, 200]
].map(([id, title, kind, x, y]) => ({ id, type: 'stage', position: { x, y }, data: { title, kind, notes: id === 'A' ? '核对原订单及支付记录。' : '' } }));
const edges = [['S', 'D', ''], ['D', 'A', '条件满足'], ['D', 'B', '资料不完整'], ['A', 'E', ''], ['B', 'D', '补充后重新判断']].map(([source, target, label], index) => ({ id: `e${index}`, source, target, label, data: { portMode: 'auto' } }));
await writeFile(fixturePath, JSON.stringify({ version: 1, title: '退款审核流程', nodes, edges, viewport: { x: 0, y: 0, zoom: 1 }, createdAt: now, updatedAt: now }));
const launcher = join(qaDir, 'launcher.cjs');
await writeFile(launcher, `const { app, dialog } = require(${JSON.stringify(join(project, 'node_modules/electron'))});\napp.setPath('userData', ${JSON.stringify(join(qaDir, 'profile'))});\ndialog.showOpenDialog = async () => ({canceled:false,filePaths:[${JSON.stringify(fixturePath)}]});\ndialog.showSaveDialog = async (_window, options) => ({canceled:false,filePath:require('node:path').join(${JSON.stringify(output)}, options.defaultPath)});\nrequire(${JSON.stringify(join(project, 'main.js'))});\n`);
// Electron's runtime module must be required by name inside its process.
await writeFile(launcher, (await readFile(launcher, 'utf8')).replace(`require(${JSON.stringify(join(project, 'node_modules/electron'))})`, "require('electron')"));
const lease = createServer();
await new Promise((resolveListen) => lease.listen(0, '127.0.0.1', resolveListen));
const port = lease.address().port;
await new Promise((resolveClose) => lease.close(resolveClose));
const expectedUrl = pathToFileURL(join(project, 'dist/index.html')).href;
const child = spawn(join(project, 'node_modules/.bin/electron'), [launcher, `--remote-debugging-port=${port}`], { cwd: project, env: { ...process.env, RAYON_NUM_THREADS: '2', UV_THREADPOOL_SIZE: '2' }, stdio: ['ignore', 'pipe', 'pipe'] });
let logs = '';
child.stderr.on('data', (chunk) => { logs += chunk; });
let socket;
const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
try {
  let page;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try { page = (await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json())).find((item) => item.type === 'page' && item.url === expectedUrl); } catch {}
    if (page) break;
    await sleep(150);
  }
  if (!page) throw new Error(`无法启动测试应用：${logs}`);
  socket = new WebSocket(page.webSocketDebuggerUrl);
  const pending = new Map();
  let nextId = 0;
  const errors = [];
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message)); else request.resolve(message.result);
  });
  await new Promise((resolveOpen, reject) => { socket.addEventListener('open', resolveOpen, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  const send = (method, params = {}) => new Promise((resolveRequest, reject) => { const id = ++nextId; pending.set(id, { resolve: resolveRequest, reject }); socket.send(JSON.stringify({ id, method, params })); });
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  await send('Runtime.enable');
  const waitFor = async (expression) => {
    for (let attempt = 0; attempt < 50; attempt += 1) { if (await evaluate(expression)) return; await sleep(100); }
    throw new Error(`等待失败：${expression}`);
  };
  const clickButton = async (text) => { await evaluate(`(() => {const button=[...document.querySelectorAll('button')].find(item=>item.textContent.trim()===${JSON.stringify(text)}); if(!button || button.disabled) throw new Error('按钮不可用'); button.click();})()`); await sleep(150); };
  const mouseClick = async (point) => { await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', buttons: 1, clickCount: 1 }); await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', buttons: 0, clickCount: 1 }); await sleep(120); };
  const selectNode = async (id) => { const point = await evaluate(`(() => {const node=[...document.querySelectorAll('.react-flow__node')].find(item=>item.dataset.id===${JSON.stringify(id)});const rect=node.getBoundingClientRect();return {x:rect.left+rect.width/2,y:rect.top+12};})()`); await mouseClick(point); await evaluate(`document.activeElement?.blur()`); };
  const selectEdge = async (id) => { const point = await evaluate(`(() => {const path=document.querySelector('[data-id="${id}"] .react-flow__edge-interaction');const point=path.getPointAtLength(path.getTotalLength()*0.45);const screen=new DOMPoint(point.x,point.y).matrixTransform(path.getScreenCTM());return {x:screen.x,y:screen.y};})()`); await mouseClick(point); };
  const change = async (id, value) => { await evaluate(`(() => {const input=document.getElementById(${JSON.stringify(id)});const prototype=input instanceof HTMLSelectElement?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(prototype,'value').set.call(input,${JSON.stringify(String(value))});input.dispatchEvent(new Event(input instanceof HTMLSelectElement?'change':'input',{bubbles:true}));})()`); await sleep(80); };
  const capture = async (name) => { const shot = await send('Page.captureScreenshot', { format: 'png' }); await writeFile(join(output, name), Buffer.from(shot.data, 'base64')); };
  await waitFor("document.querySelectorAll('.react-flow__node').length===3");
  await clickButton('打开');
  await waitFor("document.querySelectorAll('.react-flow__node').length===5");
  await clickButton('自动整理布局');
  await sleep(600);
  assert.equal(await evaluate("document.querySelectorAll('.stage-node--decision polygon').length"), 1);
  const title = await evaluate("(() => {const element=document.querySelector('.stage-node--decision .stage-node__title');return {text:element.textContent,whiteSpace:getComputedStyle(element).whiteSpace,height:element.getBoundingClientRect().height};})()");
  assert.equal(title.whiteSpace, 'normal');
  assert.ok(title.height > 20);
  await evaluate("document.documentElement.dataset.theme='light'");
  const geometry = await evaluate(`[...document.querySelectorAll('.react-flow__edge-path')].map(path => { const values=path.getAttribute('d').match(/-?\\d+(?:\\.\\d+)?(?:e[+-]?\\d+)?/gi).map(Number); const points=[];for(let i=0;i<values.length;i+=2) points.push({x:values[i],y:values[i+1]});return points.slice(1).every((point,index)=>Math.abs(point.x-points[index].x)<0.02||Math.abs(point.y-points[index].y)<0.02);})`);
  assert.ok(geometry.every(Boolean), '画布连线必须保持正交');
  await capture('flowsketch-light.png');
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
  await evaluate("document.documentElement.dataset.theme='dark'");
  await capture('flowsketch-dark.png');
  await evaluate("document.documentElement.dataset.theme='light'");
  // Export to actual files through the isolated Electron dialog shim.
  await clickButton('SVG');
  await waitFor("document.querySelector('[role=status]').textContent.includes('SVG 已完整导出')");
  const svg = await readFile(join(output, '退款审核流程.svg'), 'utf8');
  assert.ok(svg.includes('<polygon') && !svg.includes('foreignObject'));
  assert.ok(svg.includes('是否满足退款申请条件并已核对订单状态？') || svg.includes('<title>是否满足退款申请条件并已核对订单状态？</title>'));
  await clickButton('PNG');
  await waitFor("document.querySelector('[role=status]').textContent.includes('PNG 已完整导出')");
  const png = await readFile(join(output, '退款审核流程.png'));
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  await clickButton('导出 Markdown');
  await waitFor("document.querySelector('[role=status]').textContent.includes('Markdown 文档已导出')");
  assert.ok((await readFile(join(output, '退款审核流程.md'), 'utf8')).includes('flowchart LR'));
  // Fixed handles and label settings persist through save/open.
  await selectEdge('e1');
  await waitFor("Boolean(document.getElementById('edge-port-mode'))");
  await change('edge-port-mode', 'fixed');
  await change('edge-source-port', 'source-top-left');
  await change('edge-label-position', 70);
  await clickButton('添加折点');
  await clickButton('应用修改');
  await clickButton('保存');
  let saved = JSON.parse(await readFile(fixturePath, 'utf8'));
  const edited = saved.edges.find((item) => item.id === 'e1');
  assert.equal(edited.data.portMode, 'fixed');
  assert.equal(edited.sourceHandle, 'source-top-left');
  assert.equal(edited.data.labelPosition, 0.7);
  assert.equal(edited.data.waypoints.length, 1);
  await writeFile(fixturePath, JSON.stringify(saved));
  await clickButton('打开');
  await selectEdge('e1');
  assert.equal(await evaluate("document.getElementById('edge-port-mode').value"), 'fixed');
  assert.equal(await evaluate("document.getElementById('edge-source-port').value"), 'source-top-left');
  await capture('flowsketch-edge-settings.png');
  const dragElement = async (selector, dx, dy) => {
    const point = await evaluate(`(() => {const rect=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:rect.left+rect.width/2,y:rect.top+rect.height/2};})()`);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', buttons: 1, clickCount: 1 });
    for (let step = 1; step <= 5; step += 1) { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x + dx * step / 5, y: point.y + dy * step / 5, button: 'left', buttons: 1 }); await sleep(30); }
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x + dx, y: point.y + dy, button: 'left', buttons: 0, clickCount: 1 });
    await sleep(150);
  };
  await dragElement('.route-waypoint', 40, -30);
  await clickButton('保存');
  const moved = JSON.parse(await readFile(fixturePath, 'utf8')).edges.find(item => item.id === 'e1');
  assert.notDeepEqual(moved.data.waypoints, edited.data.waypoints);
  await capture('flowsketch-after-waypoint.png');
  await dragElement('.routed-edge-label.is-selected', 40, -30);
  await clickButton('保存');
  const movedLabel = JSON.parse(await readFile(fixturePath, 'utf8')).edges.find(item => item.id === 'e1');
  assert.ok(movedLabel.data.labelOffset.x > 0);
  await evaluate("document.querySelector('[aria-label=撤销]').click()");
  await sleep(150);
  await clickButton('保存');
  const undoneLabel = JSON.parse(await readFile(fixturePath, 'utf8')).edges.find(item => item.id === 'e1');
  assert.deepEqual(undoneLabel.data.labelOffset, moved.data.labelOffset);
  await selectEdge('e1');

  await clickButton('在线上插入处理阶段');
  assert.equal(await evaluate("document.querySelectorAll('.react-flow__node').length"), 6);
  await evaluate("document.querySelector('[aria-label=撤销]').click()");
  await waitFor("document.querySelectorAll('.react-flow__node').length===5");
  await waitFor("!document.querySelector('[aria-label=重做]').disabled");
  await evaluate("document.querySelector('[aria-label=重做]').click()");
  await waitFor("document.querySelectorAll('.react-flow__node').length===6");
  await sleep(250);
  await selectNode('A');
  await clickButton('复制阶段（⌘/Ctrl + D）');
  assert.equal(await evaluate("document.querySelectorAll('.react-flow__node').length"), 7);
  // Real keyboard navigation: Shift+Tab must leave a focused node without creating one.
  await evaluate("document.querySelector('.react-flow__node.selected').focus()");
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', modifiers: 8, windowsVirtualKeyCode: 9 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', modifiers: 8, windowsVirtualKeyCode: 9 });
  assert.equal(await evaluate("document.querySelectorAll('.react-flow__node').length"), 7);
  // Downward layout is preserved in Mermaid and the editable project.
  await change('flow-direction', 'TB');
  await sleep(400);
  await clickButton('保存');
  saved = JSON.parse(await readFile(fixturePath, 'utf8'));
  assert.equal(saved.direction, 'TB');
  await clickButton('导出 Markdown');
  assert.ok((await readFile(join(output, '退款审核流程.md'), 'utf8')).includes('flowchart TB'));
  await capture('flowsketch-downward.png');
  // Checks remain nonblocking and selecting an issue restores editor focus.
  await evaluate("[...document.querySelectorAll('.palette button')].find(item=>item.textContent.startsWith('检查流程')).click()");
  await waitFor("document.querySelector('.flow-check').open");
  const issueCount = await evaluate("document.querySelectorAll('.flow-check li').length");
  assert.ok(issueCount > 0);
  await evaluate("document.querySelector('.flow-check li button').click()");
  await sleep(200);
  assert.ok(await evaluate("['stage-title','edge-label'].includes(document.activeElement.id)"));
  await capture('flowsketch-checks.png');
  assert.deepEqual(errors, []);
  // Confirm the toolbar remains inside the supported minimum window width.
  await send('Emulation.setDeviceMetricsOverride', { width: 1040, height: 680, deviceScaleFactor: 1, mobile: false });
  await sleep(100);
  const right = await evaluate("document.querySelector('.topbar__right').getBoundingClientRect().right");
  assert.ok(right <= 1040, `工具栏超出窗口：${right}`);
  await capture('flowsketch-minimum-window.png');
  await writeFile(join(output, '已验证工程.flow.json'), JSON.stringify(saved, null, 2));
  console.log(JSON.stringify({ success: true, output, title, issueCount, pngBytes: png.length, svgBytes: svg.length, runtimeErrors: errors }, null, 2));
} finally {
  socket?.close();
  child.kill('SIGTERM');
}
