# dsh-plugin-git

DeepSeek Harness（DSH）的 Git 插件，把常见的 Git 操作搬进一个独立的工作台面板。

![Git 插件截图](https://raw.githubusercontent.com/happyqu/dsh-plugin-git/main/docs/screenshot.png)

## 功能

面板左侧是活动栏，六个模块切换：

- **改动** — 查看改动、暂存/取消暂存、提交，管理分支、远程、标签与储藏
- **储藏** — 查看、应用、删除 stash
- **历史** — 浏览提交记录，按关键字和路径过滤，查看完整 diff；勾选未推送的提交可改写提交信息（勾 1 个）或合并为 1 个提交（勾多个），也可右键单个未推送提交改写信息
- **提交图** — 泳道图展示分支与合并结构
- **输出** — git 命令及其输出日志
- **设置** — 指定 git 路径、相似度阈值、AI 辅助等

支持 Git LFS 跟踪、内容同步及带备份的历史迁入／迁出；冲突文件可在面板中逐块处理、编辑并标记解决。

在分支、标签或提交上右键还可以打开「比较」，查看任意两个 ref 之间的差异。

支持中文/英文界面与深浅主题。可选开启 AI 辅助，让模型生成提交信息、解释某次提交。

## 安装

1. 先安装 [Git](https://git-scm.com/downloads)，确保 `git` 在 PATH 中可用。
2. 在 DSH 侧栏打开 **插件 → 添加插件**，输入 `@happyqu/dsh-plugin-git` 安装。

3. 启用后打开 Git 面板即可使用。

## 许可证

MIT
