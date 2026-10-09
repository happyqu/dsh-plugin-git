# dsh-plugin-git

DeepSeek Harness（DSH）的 Git 插件，把常见的 Git 操作搬进一个独立的工作台面板。

![Git 插件截图](https://raw.githubusercontent.com/happyqu/dsh-plugin-git/main/docs/screenshot.png)

## 功能

面板左侧是活动栏，六个模块切换：

- **改动** — 查看改动、暂存/取消暂存、提交，管理分支、远程、标签与储藏
- **储藏** — 查看、应用、删除 stash
- **历史** — 浏览提交记录，按关键字和路径过滤，查看完整 diff
- **提交图** — 泳道图展示分支与合并结构
- **输出** — git 命令及其输出日志
- **设置** — 指定 git 路径、相似度阈值、AI 辅助等

在分支、标签或提交上右键还可以打开「比较」，查看任意两个 ref 之间的差异。

支持中文/英文界面与深浅主题。可选开启 AI 辅助，让模型生成提交信息、解释某次提交。

## 安装

1. 先安装 [Git](https://git-scm.com/downloads)，确保 `git` 在 PATH 中可用。
2. 在 DSH 侧栏打开 **插件 → 添加插件**，输入 `@happyqu/dsh-plugin-git` 安装。

3. 启用后打开 Git 面板即可使用。

## 许可证

MIT
