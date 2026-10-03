# 参与贡献

感谢你帮助改进流绘。开始前请先阅读 [README.md](README.md) 和 [架构说明](docs/architecture.md)。

## 提交问题

请在 GitHub Issues 中描述使用场景、复现步骤、预期与实际结果，并附上应用版本和操作系统。连线或布局问题可以附截图和最小化的 `.flow.json` 工程；提交前请删除工程中的个人、客户或业务敏感信息。

## 开发步骤

1. 使用符合 [BUILD.md](BUILD.md) 要求的 Node.js 和 npm，运行 `npm ci`。
2. 用 `npm run dev` 调试界面，或用 `npm start` 在 Electron 中验证文件操作。
3. 修改行为时补充针对性的 Vitest 测试；涉及打开、保存或导出时，使用 `npm run test:desktop` 做桌面回归。
4. 提交前依次运行 `npm test` 和 `npm run build`。请勿同时运行多个完整构建或测试任务。

## Pull Request

- 保持改动聚焦，并说明问题、解决方式、验证命令及结果。
- 保持 `.flow.json` v1 工程的向后兼容；格式变化需更新 [工程格式文档](docs/flow-format.md)。
- 不要提交 `node_modules/`、`dist/`、`release/`、签名证书或真实用户工程。
- 新增生产依赖前说明现有依赖或内置能力为何无法满足需求。

项目代码采用 [MIT 许可证](LICENSE)，依赖许可见 [第三方声明](THIRD_PARTY_NOTICES.md)。
