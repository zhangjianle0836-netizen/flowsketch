const { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { fileURLToPath } = require('node:url');

const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
const APP_NAME = '流绘 FlowSketch';
const APP_ICON_PATH = path.join(__dirname, 'build', 'icon.png');
let mainWindow = null;
let activeFlowPath = null;

function assertTrustedSender(event) {
  const senderUrl = event.senderFrame?.url;
  const expectedPath = path.resolve(__dirname, 'dist', 'index.html');
  if (!senderUrl || !senderUrl.startsWith('file:') || path.resolve(fileURLToPath(senderUrl)) !== expectedPath) {
    throw new Error('拒绝来自未知页面的请求');
  }
}

function safeFileName(value, fallback) {
  const sanitized = String(value || fallback).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim();
  return (sanitized || fallback).slice(0, 100);
}

function isFlowDocument(value) {
  return Boolean(
    value &&
      typeof value === 'object' &&
      value.version === 1 &&
      typeof value.title === 'string' &&
      value.title.length <= 200 &&
      Array.isArray(value.nodes) &&
      value.nodes.length <= 2000 &&
      Array.isArray(value.edges) &&
      value.edges.length <= 5000
  );
}

function serializeDocument(document) {
  if (!isFlowDocument(document)) throw new Error('流程文件格式无效');
  const content = JSON.stringify(document, null, 2);
  if (Buffer.byteLength(content, 'utf8') > MAX_DOCUMENT_BYTES) throw new Error('流程文件超过 10 MB 限制');
  return `${content}\n`;
}

async function atomicWrite(filePath, content) {
  const directory = path.dirname(filePath);
  const temporaryPath = path.join(directory, `.${path.basename(filePath)}.${process.pid}.tmp`);
  await fs.writeFile(temporaryPath, content, { encoding: 'utf8', mode: 0o600 });
  try {
    await fs.rename(temporaryPath, filePath);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true });
    throw error;
  }
}

function ensureFlowExtension(filePath) {
  if (filePath.toLowerCase().endsWith('.flow.json')) return filePath;
  return filePath.toLowerCase().endsWith('.json') ? filePath : `${filePath}.flow.json`;
}

function recoveryPath() {
  return path.join(app.getPath('userData'), 'recovery.flow.json');
}

function updateWindowTitle(filePath) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const fileName = filePath ? path.basename(filePath) : '未命名流程';
  mainWindow.setTitle(`${fileName} — ${APP_NAME}`);
  if (process.platform === 'darwin') mainWindow.setRepresentedFilename(filePath || '');
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1040,
    minHeight: 680,
    backgroundColor: '#f5f5f7',
    show: false,
    title: APP_NAME,
    icon: APP_ICON_PATH,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'dist', 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  if (process.platform === 'darwin' && app.dock) app.dock.setIcon(APP_ICON_PATH);
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('flow:open', async (event) => {
  assertTrustedSender(event);
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '打开流程工程',
    properties: ['openFile'],
    filters: [{ name: '流绘流程工程', extensions: ['json'] }]
  });
  if (result.canceled || !result.filePaths[0]) return { canceled: true };

  const filePath = result.filePaths[0];
  if (!filePath.toLowerCase().endsWith('.json')) throw new Error('只能打开 JSON 流程工程');
  const stat = await fs.stat(filePath);
  if (stat.size > MAX_DOCUMENT_BYTES) throw new Error('流程文件超过 10 MB 限制');
  const document = JSON.parse(await fs.readFile(filePath, 'utf8'));
  if (!isFlowDocument(document)) throw new Error('不是有效的流绘流程工程');
  activeFlowPath = filePath;
  updateWindowTitle(filePath);
  return { canceled: false, document, filePath };
});

ipcMain.handle('flow:save', async (event, payload) => {
  assertTrustedSender(event);
  const content = serializeDocument(payload?.document);
  let filePath = activeFlowPath;
  if (!filePath || payload?.saveAs) {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: '保存流程工程',
      defaultPath: `${safeFileName(payload.document.title, '未命名流程')}.flow.json`,
      filters: [{ name: '流绘流程工程', extensions: ['json'] }]
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    filePath = ensureFlowExtension(result.filePath);
  }
  await atomicWrite(filePath, content);
  activeFlowPath = filePath;
  updateWindowTitle(filePath);
  await fs.rm(recoveryPath(), { force: true });
  return { canceled: false, filePath };
});

ipcMain.handle('flow:autosave', async (event, document) => {
  assertTrustedSender(event);
  const content = serializeDocument(document);
  const filePath = activeFlowPath || recoveryPath();
  await atomicWrite(filePath, content);
  return { filePath, isRecovery: !activeFlowPath };
});

ipcMain.handle('flow:load-recovery', async (event) => {
  assertTrustedSender(event);
  try {
    const filePath = recoveryPath();
    const document = JSON.parse(await fs.readFile(filePath, 'utf8'));
    return isFlowDocument(document) ? { found: true, document } : { found: false };
  } catch {
    return { found: false };
  }
});

ipcMain.handle('flow:new', async (event) => {
  assertTrustedSender(event);
  activeFlowPath = null;
  updateWindowTitle(null);
  await fs.rm(recoveryPath(), { force: true });
  return { success: true };
});

ipcMain.handle('flow:export-markdown', async (event, payload) => {
  assertTrustedSender(event);
  if (!payload || typeof payload.content !== 'string' || payload.content.length > MAX_DOCUMENT_BYTES) {
    throw new Error('导出内容无效');
  }
  const result = await dialog.showSaveDialog(mainWindow, {
    title: '导出 Markdown 文档',
    defaultPath: `${safeFileName(payload.title, '流程说明')}.md`,
    filters: [{ name: 'Markdown 文档', extensions: ['md'] }]
  });
  if (result.canceled || !result.filePath) return { canceled: true };
  const filePath = result.filePath.toLowerCase().endsWith('.md') ? result.filePath : `${result.filePath}.md`;
  await atomicWrite(filePath, payload.content);
  return { canceled: false, filePath };
});

ipcMain.handle('flow:export-image', async (event, payload) => {
  assertTrustedSender(event);
  if (!payload || !['png', 'svg'].includes(payload.format) || typeof payload.dataUrl !== 'string') {
    throw new Error('图片导出参数无效');
  }
  const expectedPrefix = payload.format === 'png' ? 'data:image/png' : 'data:image/svg+xml';
  if (!payload.dataUrl.startsWith(expectedPrefix)) throw new Error('图片数据类型与导出格式不匹配');
  if (payload.dataUrl.length > 50 * 1024 * 1024) throw new Error('导出图片超过 50 MB 限制');
  const result = await dialog.showSaveDialog(mainWindow, {
    title: `导出 ${payload.format.toUpperCase()}`,
    defaultPath: `${safeFileName(payload.title, '流程图')}.${payload.format}`,
    filters: [{ name: `${payload.format.toUpperCase()} 图片`, extensions: [payload.format] }]
  });
  if (result.canceled || !result.filePath) return { canceled: true };
  const commaIndex = payload.dataUrl.indexOf(',');
  if (commaIndex < 0) throw new Error('图片数据无效');
  const header = payload.dataUrl.slice(0, commaIndex);
  const raw = payload.dataUrl.slice(commaIndex + 1);
  const buffer = header.includes(';base64') ? Buffer.from(raw, 'base64') : Buffer.from(decodeURIComponent(raw), 'utf8');
  await fs.writeFile(result.filePath, buffer, { mode: 0o600 });
  return { canceled: false, filePath: result.filePath };
});

ipcMain.handle('theme:get', (event) => {
  assertTrustedSender(event);
  return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
});
nativeTheme.on('updated', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('theme:changed', nativeTheme.shouldUseDarkColors ? 'dark' : 'light');
  }
});
