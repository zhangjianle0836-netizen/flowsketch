# 打包说明

## 环境要求

- Node.js `^20.19.0` 或 `>=22.12.0`
- npm 10 或更高版本

先在仓库根目录执行 `npm ci`。依赖锁定在 `package-lock.json` 中。

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

## macOS 签名

签名包需要本机已有可用的 Developer ID Application 证书。先运行 `security find-identity -v -p codesigning` 查看身份，再设置环境变量：

```bash
CODESIGN_IDENTITY='Developer ID Application: Your Name (TEAMID)' npm run pack:mac:signed
```

如果证书位于非默认钥匙串，同时设置 `CODESIGN_KEYCHAIN`；需要单独指定 electron-builder 匹配名称时设置 `CSC_NAME`。脚本会验证 App 和 DMG 的签名及 ARM64 架构。此流程**不包含 Apple 公证**，公开分发前还需自行配置公证和发布流程。
