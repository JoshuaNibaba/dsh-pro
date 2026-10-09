# DeepSeek Harness Pro

[English](README.md) | 中文

DeepSeek Harness Pro(DSH Pro)是 DeepSeek AI 开源智能体框架 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)(`dsh`)的增强发行版。它保留官方的全部功能，并增加了任务看板、服务器状态栏、手机布局、工作区文件下载、模型原生网页搜索和更快的远程加载，还附带 **DSH Remote**:把 dsh 部署到自己的服务器，再用 Mac 客户端、浏览器或手机远程使用。

DSH Pro 是非官方版本，不由 DeepSeek 开发、认可或提供支持。DSH Pro 的问题请提交到 [JoshuaNibaba/dsh-pro](https://github.com/JoshuaNibaba/dsh-pro/issues),不要提交到官方仓库。

![DSH Pro:对话、右侧工作区文件树(可下载)和输入框下方的服务器状态栏](.github/dsh-pro/workspace.png)

## 目录

- [亮点](#highlights)
- [运行](#run)
- [部署到服务器](#deploy-to-a-server)
- [相对 DeepSeek Harness 的改进](#improvements-over-deepseek-harness)
- [新增插件](#added-plugins)
- [更新](#update)
- [发布与分支](#releases-and-branches)
- [兼容性](#compatibility)
- [关于 DeepSeek Harness](#about-deepseek-harness)
- [许可证](#license)

<a id="highlights"></a>

## 亮点

- **任务看板**:按工作区规划任务，让每个会话按泳道逐个执行。
- **远程使用**:DSH Remote 把 dsh 安装为服务，并配好密码网关和 HTTPS;用原生 Mac 客户端、浏览器或手机连接。
- **服务器状态栏**:输入框下方显示连接状态、服务器 CPU 和内存、RPC 延迟。
- **手机布局**:侧栏抽屉，以及手机浏览器可添加到主屏幕的启动图标。
- **工作区文件下载**:在右侧文件树中直接下载。
- **模型原生网页搜索**:像 Claude Code 一样使用当前模型自带的搜索工具。
- **更快的远程加载**:WebSocket 压缩、历史分页、静态资源长期缓存，以及服务端更新后自动刷新页面。

<a id="run"></a>

## 运行

DeepSeek Harness 处于 _开发者预览_ 阶段，DSH Pro 跟随其发布，因此会出现破坏兼容性的变更。运行前请阅读[安全说明](SAFETY.zh.md)。

<a id="run-from-source"></a>

### 从源码运行

需要 Node.js `^22.19` 或 `>=24` 和 git;Node 自带的 corepack 会提供仓库声明的 pnpm 版本。

```sh
git clone https://github.com/JoshuaNibaba/dsh-pro.git
cd dsh-pro
corepack enable
pnpm install
pnpm run build
pnpm dsh web
```

`pnpm run build` 准备仓库构建产物,`pnpm dsh web` 用这些产物启动 Web UI,打印访问地址并在默认浏览器中打开；加 `--no-open` 则不打开浏览器。首次使用时按提示填写 DeepSeek API 密钥，或在「设置 → 模型」中添加其他模型提供方(Anthropic、OpenAI 等)。另见 [Web UI 指南](docs/user/guide/index.zh.md)。

各包保留官方的 `@deepseek-ai/*` 名称，不发布到 npm。下面所有新增插件都已包含在这次构建里，不需要另外安装。

<a id="deploy-to-a-server"></a>

## 部署到服务器

仓库的 [`remote/`](remote/README.zh.md) 目录是 DSH Remote:

| 组成 | 作用 |
|---|---|
| [服务端安装脚本](remote/server/install.sh) | 在 Debian/Ubuntu 上安装 Node.js 22 和 systemd 服务 `dsh-web`(只监听 `127.0.0.1`);加 `--domain` 时再配置密码登录网关、nginx 和 HTTPS 证书，浏览器和手机即可访问 |
| Mac 客户端 `DSH Remote.app` | 原生 macOS 应用，填网页地址和访问密码即可使用，也可以走 SSH 隧道；支持应用内自动更新。编译好的安装包在 [Release `dsh-remote`](https://github.com/JoshuaNibaba/dsh-pro/releases/tag/dsh-remote) |
| [命令行 `dsh-remote`](remote/cli/dsh-remote) | 可选的终端工具：打开隧道、查看日志、重启服务、更新 Mac 客户端 |

服务器上(以 root 运行):

```sh
git clone https://github.com/JoshuaNibaba/dsh-pro.git /opt/dsh-pro-src
bash /opt/dsh-pro-src/remote/server/install.sh --domain dsh.example.com
```

不想克隆时也可以直接 `curl -fsSL https://raw.githubusercontent.com/JoshuaNibaba/dsh-pro/main/remote/server/install.sh | bash -s -- --domain dsh.example.com`。脚本先装好 npm 上的官方 dsh 并启动服务，最后打印网页地址和生成的访问密码。然后把服务换成 DSH Pro:

```sh
corepack enable
sudo -iu dsh
git clone https://github.com/JoshuaNibaba/dsh-pro.git ~/dsh-pro
cd ~/dsh-pro && pnpm install && pnpm run build
ln -sfn ~/dsh-pro/apps/cli/lib/bin.js ~/.dsh-remote/dsh-bin
sudo systemctl restart dsh-web
```

`corepack enable` 以 root 运行，为所有用户提供 pnpm;其余命令以 `dsh` 用户运行。`~/.dsh-remote/dsh-bin` 存在时服务运行它指向的 dsh;删除该链接并重启即回到 npm 上的官方版本。

Mac 上：从 [Release `dsh-remote`](https://github.com/JoshuaNibaba/dsh-pro/releases/tag/dsh-remote) 下载 `DSH-Remote.zip`,解压后把 `DSH Remote.app` 拖到「应用程序」,第一次右键选择「打开」(应用未经 Apple 公证)。或者用命令行安装:

```sh
curl -fsSL https://github.com/JoshuaNibaba/dsh-pro/releases/download/dsh-remote/DSH-Remote.zip -o /tmp/DSH-Remote.zip
ditto -x -k /tmp/DSH-Remote.zip ~/Applications
```

首次启动填写网页地址和访问密码即可。SSH 模式、HTTPS 选项、Cloudflare、服务菜单和排障说明见 [remote/README.zh.md](remote/README.zh.md)。

<a id="improvements-over-deepseek-harness"></a>

## 相对 DeepSeek Harness 的改进

### 任务看板

在「插件」页打开 **看板** 后，每个已开始的会话在「对话」「轨迹」旁多一个 **任务看板** 标签。看板按工作区分为三列：计划池、每个会话一条泳道、已完成。把计划卡片拖进某个会话的泳道，看板服务会在该会话空闲时逐个发送任务，并按该轮的结束原因把任务标记为完成或失败；失败会暂停该泳道，并提供重试、跳过和撤回。未发送的任务可以随时编辑、移动或撤回。

![任务看板：计划池、会话泳道(执行中)和已完成](.github/dsh-pro/kanban.png)

### 服务器状态栏

输入框下方显示连接状态、服务器 CPU、服务器内存和 RPC 往返延迟(见第一张图底部)。远程使用时一眼能看出是服务器忙、网络慢还是连接断了。默认停用；在 Web profile 的 `~/.dsh/profiles/web/cordis.patch.yml` 中加入下面几行后重启 dsh:

```yaml
- id: ui-server-status
  disabled: false
```

### 工作区文件下载

右侧边栏「文件」树中，鼠标移到文件上会出现下载按钮，可把服务器上的工作区文件直接下载到本机(见第一张图右侧)。

### 手机布局

屏幕宽度小于 768px 时，左侧栏改为抽屉，对话和输入框占满屏幕。Web 应用提供 PNG 启动图标，可在手机浏览器中「添加到主屏幕」。

![手机上的对话页和侧栏抽屉](.github/dsh-pro/phone.png)

### 模型原生网页搜索

`web_search` 工具默认使用当前会话所用模型自己的搜索能力(Anthropic `web_search_20250305`;OpenAI、Azure、Codex Responses 的 `web_search`),做法和 Claude Code 的 WebSearch 相同；DeepSeek 模型仍使用 DeepSeek 官方搜索。每次搜索写入 `web/model-search-request` 会话事件。

### 首次打开的欢迎页

第一次打开 DSH Pro 时，会弹出分页的欢迎对话框，用简短的动画介绍上面这些亮点，包括卡片在任务看板上被拖动的过程。用「下一项」「上一项」翻页，随时可以「跳过」。

### 远程连接与加载速度

| 改进 | 行为 |
|---|---|
| WebSocket 压缩 | 实时消息流协商 permessage-deflate,经 CDN 或长距离线路时流量更小。gateway 配置 `websocketCompression: false` 可关闭 |
| 历史分页加载 | 打开会话时只加载最近最多 40 条消息或三个 Turn,滚动到顶部附近时自动加载更早一页，长会话打开更快 |
| 静态资源长期缓存 | `assets/` 下带内容哈希的文件以 `Cache-Control: public, max-age=31536000, immutable` 提供，再次打开页面不必重新下载前端代码 |
| 更新后自动刷新 | 服务端更新并重启后，已打开的页面重连时发现前端插件已变化，会自动重新加载，而不是白屏 |

### 模型与工具

| 改进 | 行为 |
|---|---|
| pi-ai 1.1.0 | 升级 `@earendil-works/pi-ai` 到 1.1.0。Anthropic 模型在对话中途增减工具时以原生方式发送，不改写已缓存的上下文；网关不支持该 beta 时可设置 `compat.supportsMidConvoToolChanges: false` |
| 并行工具调用提示 | `tools` 插件的 `batchIndependentCalls: true` 在系统提示中要求模型把互不依赖的工具调用放在同一次回复中 |
| 稳定的源码路径 | `web-runtime` 插件的 `sourceRoot` 可固定系统提示里的源码路径，在两个发布目录之间切换时提示缓存仍然有效 |
| 沙箱权限兼容 | 模型重复声明当前沙箱模式并留空理由时(GPT 系列常见)不再被拒绝；只有申请更宽权限时才要求理由 |
| 输入框只在对话视图显示 | 「轨迹」「任务看板」等视图不再显示输入框 |

<a id="added-plugins"></a>

## 新增插件

以下插件都随 DSH Pro 构建，无需安装。

| 插件 | 包 | 默认状态 | 开启方式 |
|---|---|---|---|
| 任务看板 | `@deepseek-ai/dsh-experimental-kanban-bundle`(含 `dsh-experimental-kanban` 和 `dsh-experimental-client-ui-kanban`) | 关闭(实验性) | 「插件」页打开「看板」,见下图 |
| 服务器状态栏 | `@deepseek-ai/dsh-client-ui-server-status` | 关闭 | 在 `cordis.patch.yml` 中设置 `disabled: false`,见上文 |
| 模型原生搜索 | `@deepseek-ai/dsh-web-search-model` | 开启 | — |
| 文件下载、手机布局、历史分页等 | 对官方插件的修改 | 开启 | — |

![「插件」页：在「官方」分组中打开「看板」](.github/dsh-pro/plugins.png)

<a id="update"></a>

## 更新

```sh
cd dsh-pro
git pull --ff-only
pnpm install
pnpm run build
```

官方基线版本变化时先运行 `pnpm run clean`。服务器上以 `dsh` 用户在 `~/dsh-pro` 执行同样的命令，再 `sudo systemctl restart dsh-web`。Mac 客户端会自动检查 [Release `dsh-remote`](https://github.com/JoshuaNibaba/dsh-pro/releases/tag/dsh-remote) 并提示更新。

<a id="releases-and-branches"></a>

## 发布与分支

| 名称 | 内容 |
|---|---|
| `main` 分支 | 默认分支：官方发布标签(`dsh-v*`)加上 DSH Pro 的提交。官方新版本通过 merge 合入，历史从不改写，因此克隆后总能快进更新 |
| `master` 分支 | 官方 `master` 的副本，不含 DSH Pro 的改动 |
| `dsh-pro-v<官方版本>.<n>` 标签 | 已发布的 DSH Pro 版本，各对应一个 [GitHub Release](https://github.com/JoshuaNibaba/dsh-pro/releases);`dsh-pro-v0.2.0-rc.2.1` 是基于官方 `dsh-v0.2.0-rc.2` 的第一个 DSH Pro 版本 |
| Release `dsh-remote` | 最新的 Mac 客户端，`remote/mac/` 变化时由 [GitHub Actions](.github/workflows/dsh-remote-mac.yml) 重新编译 |

`git log --no-merges <官方标签>..main` 列出 DSH Pro 的全部改动。

<a id="compatibility"></a>

## 兼容性

执行过模型原生搜索的会话含有 `web/model-search-request` 事件。不含此改动的官方构建会拒绝打开这些会话，因此切换回官方版本后无法再访问它们。

<a id="about-deepseek-harness"></a>

## 关于 DeepSeek Harness

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 是由 [DeepSeek AI](https://deepseek.com) 开发的开源智能体框架，构建于由 [Cordis](https://github.com/cordiverse/cordis) 驱动的**一切皆插件**架构之上，其设计见论文 [_A Programming Paradigm for Spatiotemporal Composability_](https://arxiv.org/abs/2608.25512)。DSH Pro 继承它的全部功能；官方 [README](https://github.com/deepseek-ai/deepseek-harness#readme) 和[文档](https://deepseek-harness.github.io/deepseek-harness/)介绍了这些功能。

本仓库中的开发文档同样适用于 DSH Pro:从[开发指南](docs/development.zh.md)和[架构文档](docs/architecture.zh.md)开始；智能体遵循 [AGENTS.md](AGENTS.md),[CONTRIBUTING.zh.md](CONTRIBUTING.zh.md) 介绍官方的贡献流程。关于 DeepSeek Harness 本身的反馈请发到其 [GitHub Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions) 和 [Discord 社区](https://discord.gg/4MrtZUhpxg)。

<a id="license"></a>

## 许可证

DSH Pro 沿用官方 [MIT 许可证](LICENSE)及其版权声明。第三方依赖及其许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。"DeepSeek Harness" 是 DeepSeek 的商标，见[品牌规范](BRAND_GUIDELINES.zh.md)。
