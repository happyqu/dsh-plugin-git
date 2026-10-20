# 发版指南

推送 `v版本号` 标签后，[Release 工作流](../.github/workflows/release.yml) 会安装依赖、运行测试、构建并打包，随后发布到 npm，再创建 GitHub Release。Release 附带含 `dist/client.js` 的 `.tgz` 编译包和 `SHA256SUMS.txt` 校验文件，npm 与 GitHub 使用同一份包。

## 首次配置 npm 授权

在 npm 的 `@happyqu/dsh-plugin-git` 包设置中添加 **Trusted Publisher → GitHub Actions**：

| 字段 | 值 |
| --- | --- |
| Organization or user | `happyqu` |
| Repository | `dsh-plugin-git` |
| Workflow filename | `release.yml` |
| Environment name | 留空 |

若页面提供 Allowed actions 选项，请允许直接 `npm publish`。工作流使用 OIDC，无需配置 `NPM_TOKEN`。详见 [npm 可信发布文档](https://docs.npmjs.com/trusted-publishers/)。如果包尚不存在，先由维护者本地 `npm login`、`npm publish --access public` 完成首次发布，再配置可信发布；之后使用新的版本号触发自动发版。

## 发布新版本

先提交代码并确保工作区干净，再执行：

```bash
npm run release
```

默认升级补丁版本（例如 `0.1.20` → `0.1.21`），同步更新 `package.json` 和 `package-lock.json`、创建版本提交和 `v` 标签，并将当前分支及该标签一起推送到 `origin`，触发自动发版。需要升级小版本或大版本时，分别执行 `npm run release -- minor` 或 `npm run release -- major`。

命令会检查未提交文件，并在升级版本前试推送，确认远程可访问且分支可以推送。如果版本已生成但最终推送失败，按终端提示重试推送，不要重复执行发版命令。首次使用前需先将工作流、发版脚本和本指南一起提交并推送到 GitHub。本指南应随发布流程的变更同步更新，不包含 token、密码等凭据。

正式版发布到 npm 的 `latest`；如 `v0.1.22-beta.0` 的预发布版本发布到 `next`，GitHub 同时标记为 Pre-release。

npm 发布任务串行执行。正式版使用 npm 默认的 `latest` 发布策略，保留 npm 内置的版本检查：如果 npm 已有更高的正式版本，较低版本的发布会失败，避免默认安装版本回退；预发布版本仍显式发布到 `next`。

在 GitHub 的 Actions 中查看进度，完成后到 [Releases](https://github.com/happyqu/dsh-plugin-git/releases) 下载 `.tgz` 编译包。GitHub 自动附带的 Source code 归档是源码。若 npm 已成功而 GitHub Release 失败，使用 **Re-run failed jobs** 只重试失败任务，避免重复发布 npm；已发布的 npm 版本不能覆盖。

