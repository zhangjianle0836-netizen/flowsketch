# 打包说明

## 环境要求

- Node.js 20 或更高版本
- npm 10 或更高版本

## macOS ARM64

```bash
npm ci
npm run pack:mac
```

## Windows x64

```bash
npm ci
npm run pack:win
```

生产资源由 Vite 生成到 `dist/`，安装包由 electron-builder 生成到 `release/`。打包前会执行 TypeScript 检查和生产构建。
