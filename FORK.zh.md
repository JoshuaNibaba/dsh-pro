# DSH Pro

[English](FORK.md) | 中文

DSH Pro 是基于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的非官方发行版，不由 DeepSeek 开发、认可或提供支持。DSH Pro 的问题请提交到 [JoshuaNibaba/dsh-pro](https://github.com/JoshuaNibaba/dsh-pro/issues),不要提交到官方仓库。

## 发布

`custom` 分支 = 官方发布标签(`dsh-v*`)+ DSH Pro 的提交。官方新版本通过 merge 合入，历史从不改写，因此克隆后总能快进更新。每个发布版本是一个 `custom-v<官方版本>.<n>` 标签，并对应一个 [GitHub Release](https://github.com/JoshuaNibaba/dsh-pro/releases);`git log --no-merges <官方标签>..custom` 列出全部改动。

## 安装

```sh
git clone -b custom https://github.com/JoshuaNibaba/dsh-pro.git
cd dsh-pro
pnpm install
pnpm run build
node apps/cli/lib/bin.js web
```

更新时运行 `git pull --ff-only`,再运行 `pnpm install` 和 `pnpm run build`;官方基线版本变化时先运行 `pnpm run clean`。各包保留官方的 `@deepseek-ai/*` 名称，不发布到 npm。

## 相对官方版本的改动

| 改动 | 行为 |
|---|---|
| 模型原生搜索 | `web_search` 工具默认使用 `model-native` provider,通过当前 Session 的模型路由搜索(Anthropic `web_search_20250305`;OpenAI、Azure、Codex Responses `web_search`)。DeepSeek 路由委托 `deepseek-official`。每次搜索写入 `web/model-search-request` Session 事件。 |
| 流 WebSocket 压缩 | Remote 流 WebSocket 协商 permessage-deflate。gateway 配置 `websocketCompression: false` 可关闭。 |
| Session 历史窗口 | 打开 Session 时加载最多 40 条消息或三个 Turn;滚动到顶部附近时自动加载更早一页。 |
| 服务器状态栏 | `ui-server-status` 插件在输入框下方显示服务器 CPU、内存、连接状态和 RPC 延迟。默认停用，需在 Web profile 中启用。 |
| Web 静态资源长期缓存 | `assets/` 下带内容哈希的文件以 `Cache-Control: public, max-age=31536000, immutable` 提供。 |
| 文件树下载 | 右侧 Sidebar 文件树可下载工作区文件。 |
| 手机布局 | 宽度小于 768px 时侧栏以抽屉方式打开，Web 应用提供可安装的 PNG 启动图标。 |
| Host 更新后自动刷新 | Web 页面重连到已换用其他客户端插件包重启的 Host 时自动重新加载，而不是原地替换插件后白屏。 |

## 兼容性

执行过模型原生搜索的 Session 含有 `web/model-search-request` 事件。不含此改动的官方构建会拒绝打开这些 Session,因此切换回官方版本后无法再访问它们。

## 许可证

DSH Pro 沿用官方 [MIT 许可证](LICENSE)及其版权声明。"DeepSeek Harness" 是 DeepSeek 的商标，见[品牌规范](BRAND_GUIDELINES.zh.md)。
