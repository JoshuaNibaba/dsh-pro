# 定制改动与官方版本合并手册

[English](CHANGES.md) | 中文

本文供维护 `main` 分支和现有 Web 服务的人使用：先核对官方基线与部署，再按下表保留定制行为，最后在独立候选工作树中合并、验证和发布。功能细节由各包的 README 维护；本文负责改动定位、冲突处理和升级验收。

## 目录

- [基线与范围](#baseline)
- [必须保留的定制](#customizations)
- [冲突与生成文件](#conflicts)
- [后续合并流程](#merge)
- [验收与部署](#validation)
- [维护本文](#maintenance)

<a id="baseline"></a>
## 基线与范围

2026-10-07 核对时，`main` 的官方基线为 `dsh-v0.2.0-rc.2`，之后有六个定制提交，最新功能提交主题为 `feat(client): add server resource and connection status footer`。相对基线共修改 109 个文件，新增 4194 行、删除 60 行，包含测试、双语文档和生成物；这些数字不包含本手册提交。六个提交对应五组定制，其中维护工具占两个提交。核对之后新增的历史窗口提交及其后的 Web 提交列在下表最后几行，不计入上述统计。

| 提交主题（按原始顺序） | 本文对应项目 |
|---|---|
| `custom: maintenance tooling for local changes on top of official releases` | 维护工具 |
| `custom: web_search 默认使用当前模型路由的原生搜索(模仿 Claude Code)` | 模型路由搜索 |
| `custom: sync regenerates generated files, runs local tests, and resumes after conflicts` | 维护工具的生成、测试与恢复 |
| `custom: compress the Remote stream WebSocket with permessage-deflate` | 流 WebSocket 压缩 |
| `custom: open Sessions with a 20-message, one-Turn history window` | Session 历史窗口 |
| `feat(client): add server resource and connection status footer` | 状态栏、RPC owner 修复与输入栏换行 |
| `custom: cap history windows at three Turns and load older pages near the top` | Session 历史窗口 |
| `custom: serve content-hashed Web assets with an immutable Cache-Control` | Web 静态资源长期缓存 |
| `custom: download workspace files from the right Sidebar file tree` | 文件树下载 |
| `custom: phone layout with a sidebar drawer, and installable PNG launcher icons` | 手机布局与桌面图标 |

官方 `npm latest` 和 `next` 当时均指向 `0.2.0-rc.2`，`alpha` 指向 `0.2.1-alpha.1`；两个版本都是预发布版本。后续每次升级须重新查询发布渠道并选定明确标签，不能把 `latest` 当作稳定版保证，也不能把 `upstream/master` 当作已发布版本。

| 对象 | 当前用途 | 升级时的处理 |
|---|---|---|
| `upstream` | 官方仓库 `https://github.com/deepseek-ai/DeepSeek-Harness.git`，推送地址禁用 | 只 fetch；以明确发布标签作为合并目标 |
| `origin/main` | 公开 fork `https://github.com/JoshuaNibaba/dsh-pro.git` 的默认分支(旧私有仓库 `dsh-custom` 已归档) | 对外发布分支：只 merge、正常推送，禁止改写历史和强推 |
| `/home/dsh/workspace/dsh` | 源码工作树，分支 `main` | 创建候选分支和独立工作树后处理升级 |
| `/home/dsh/.dsh-custom/release-b` | 核对时的运行工作树，最新提交主题为 `custom: open Sessions with a 20-message, one-Turn history window` | 不在活动目录原地构建；从部署链接重新确认当前目录 |
| 用户 Web profile | 状态栏插件、主题、调度等部署配置 | 与源码分别备份和验证 |

运行工作树尚未包含仓库内的服务器状态栏提交；当前 profile 通过 `/home/dsh/.dsh/plugins/ui-server-status/lib/index.js` 独立加载状态栏。因此，仓库源码和正在使用的界面不是同一套完整版本。合并后的包内状态栏启用前，须迁移或停用这条独立插件配置，避免重复注册。

可从仓库根目录重新核对当前事实：

```sh
pwd
git status --short --branch
git remote -v
git worktree list
git describe --tags --abbrev=0 --match 'dsh-v*' main
git log --reverse --format='%s' dsh-v0.2.0-rc.2..main
git diff --stat dsh-v0.2.0-rc.2..main
readlink -f /home/dsh/.dsh-remote/dsh-bin
npm view @deepseek-ai/dsh dist-tags --json
```

<a id="customizations"></a>
## 必须保留的定制

### 1. 跟随当前模型路由的搜索

官方基线的 base bundle 默认使用 `deepseek-official` 搜索；定制后默认使用 `model-native`，从发起工具调用的 Session 最新 `requestContext()` 取得 provider 和 model。搜索使用该路由的认证、请求头和端点，可通过路由级 `models` 指定搜索模型或通过 `delegates` 委托其他搜索 provider。缺少 Session/路由时明确报错，不静默切换到无关模型。

Anthropic 使用 `web_search_20250305`；OpenAI Responses、Azure Responses、Codex Responses 使用 `web_search`。DeepSeek 路由 `deepseek-official`、`deepseek-account`、`deepseek` 默认委托 `deepseek-official`；Google、Bedrock、Chat Completions 当前不支持原生搜索。保留取消、拒绝重定向、响应片段顺序、引用 URL 去重和错误分类。

| 位置 | 合并时保留 |
|---|---|
| [搜索插件](https://github.com/JoshuaNibaba/dsh-pro/blob/main/packages/web/web-search-model/README.zh.md)及其 [provider](https://github.com/JoshuaNibaba/dsh-pro/blob/main/packages/web/web-search-model/src/provider.ts) | `model-native` 注册、Session 路由解析、模型覆盖、委托与错误映射 |
| [LLM 服务](https://github.com/JoshuaNibaba/dsh-pro/blob/main/packages/llm/llm/src/index.ts)及[搜索类型](https://github.com/JoshuaNibaba/dsh-pro/blob/main/packages/llm/llm/src/web-search.ts) | adapter/service 的 `webSearch` 扩展及请求、结果类型 |
| [pi-ai adapter](https://github.com/JoshuaNibaba/dsh-pro/blob/main/packages/llm/llm-pi-ai/src/adapter.ts)及[协议实现](https://github.com/JoshuaNibaba/dsh-pro/blob/main/packages/llm/llm-pi-ai/src/web-search.ts) | 按协议构建原生搜索请求、认证和流式响应处理 |
| [Web 服务](https://github.com/JoshuaNibaba/dsh-pro/blob/main/packages/web/web/src/index.ts) | Web 搜索默认 provider 的接入 |
| [base bundle 补丁](https://github.com/JoshuaNibaba/dsh-pro/blob/main/packages/bundle/base/cordis.patch.yml)及[依赖清单](https://github.com/JoshuaNibaba/dsh-pro/blob/main/packages/bundle/base/package.json) | 默认 provider、插件加载与 DeepSeek 委托映射 |
| [持久化变更记录](https://github.com/JoshuaNibaba/dsh-pro/blob/main/docs/persistence-changes/2026-10-06-model-search-request.zh.md) | `web/model-search-request` 及对应 schema、已知事件目录 |

原生搜索派发前写入 `web/model-search-request`，记录 provider、model、api 和请求 body；它是辅助请求的审计事件，不进入普通对话请求历史。没有升级 Session 格式版本，并不意味着旧官方构建可读取带新事件的日志：未知且未标记 `ignorable` 的事件会被旧读取器拒绝。回滚必须考虑已有 Session 数据。

### 2. Remote 流 WebSocket 压缩

在 [gateway 配置](https://github.com/JoshuaNibaba/dsh-pro/blob/main/packages/api/gateway/src/index.ts)新增 `websocketCompression`，默认 `true`，在 [stream server](https://github.com/JoshuaNibaba/dsh-pro/blob/main/packages/api/gateway/src/stream-server.ts)传给 `WebSocketServer` 的 `perMessageDeflate`。保留可关闭开关、扩展协商和原有流协议。此处只覆盖 Remote 流 WebSocket，不能据此认定 HTTP 或全部连接也被压缩。

验收同时覆盖开关启用和关闭，确认压缩协商及流消息仍可正常收发；测试位于 [stream server 回归](https://github.com/JoshuaNibaba/dsh-pro/blob/main/packages/api/gateway/tests/stream-server.host.spec.ts)和 [gateway 流回归](https://github.com/JoshuaNibaba/dsh-pro/blob/main/packages/api/gateway/tests/gateway-stream.host.spec.ts)。

### 3. Session 历史窗口

[Session 客户端](https://github.com/JoshuaNibaba/dsh-pro/blob/main/packages/api/session-controller/src/client/sessions/session.ts)让普通历史窗口在满足 40 条消息（`PAGE_MESSAGES`，基线为 50）或三个轮次（`PAGE_TURNS`）之后的第一个轮次开头结束，以先满足者为准；基线要求同时满足 50 条消息和两个轮次。[Host 分页](https://github.com/JoshuaNibaba/dsh-pro/blob/main/packages/api/session-controller/src/history.ts)为轮次上限新增可选字段 `turnWindow.maxTurns`，声明在 [wire 类型](https://github.com/JoshuaNibaba/dsh-pro/blob/main/packages/api/session-controller/src/types.ts)中。工具调用密集的最后一轮通常单独就超过 40 条消息，因此首屏仍只显示一轮；短轮次现在首屏显示三轮。`maxMessages = 500` 与跳转页（`JUMP_PAGE_MESSAGES = 200`，不设轮次上限）保持基线设置。这是浏览器初始/历史加载行为，不是模型上下文裁剪或服务器删除历史。

[Chat 导航](https://github.com/JoshuaNibaba/dsh-pro/blob/main/packages/client/ui-chat/src/client/chat/use-chat-navigation.ts)在滚动位置距离窗口首行不足一个视口高度时自动请求一页更早历史，接入点在 [Chat 滚动](https://github.com/JoshuaNibaba/dsh-pro/blob/main/packages/client/ui-chat/src/client/chat/use-chat-scroll.ts)。跟随底部时保持底部不动，由新页面填充视口；读者滚动停在顶部附近时，沿用“加载更早”锚点保持阅读位置。每个窗口开头只自动请求一次，失败后保留按钮供重试。

合并时检查初次打开、继续加载更早历史、接近顶部时的自动加载和跳转定位；[Session 测试](https://github.com/JoshuaNibaba/dsh-pro/blob/main/packages/api/session-controller/tests/session.client.spec.ts)、[Manager 测试](https://github.com/JoshuaNibaba/dsh-pro/blob/main/packages/api/session-controller/tests/manager.client.spec.ts)、[分页测试](https://github.com/JoshuaNibaba/dsh-pro/blob/main/packages/api/session-controller/tests/session-history-journal.host.spec.ts)、[请求校验测试](https://github.com/JoshuaNibaba/dsh-pro/blob/main/packages/api/session-controller/tests/transport.host.spec.ts)、[Chat 视图测试](https://github.com/JoshuaNibaba/dsh-pro/blob/main/packages/client/ui-chat/tests/chat-view.client.spec.tsx)和 [seeded history e2e](https://github.com/JoshuaNibaba/dsh-pro/blob/main/apps/web/tests/seeded-history.e2e.ts) 也须随行为保留。

### 4. 服务器资源与连接状态栏

[状态栏包](https://github.com/JoshuaNibaba/dsh-pro/blob/main/packages/client/ui-server-status/README.zh.md)通过 `conversation.composer.dock` 显示服务器聚合 CPU、Linux 内存占用、浏览器连接状态和 RPC 往返时延。内存为 `MemTotal - MemAvailable`，不是当前进程 RSS；默认采样 3000 ms、请求超时 5000 ms。RPC 使用 `/server-status` 的 `snapshot` 端点，断开、失败、超时清空旧读数，重连拒绝过期响应。数据只用于 GUI，不写 Session、不消耗模型 token。

| 位置 | 合并时保留 |
|---|---|
| [Host 实现](https://github.com/JoshuaNibaba/dsh-pro/blob/main/packages/client/ui-server-status/src/index.ts)、[采样器](https://github.com/JoshuaNibaba/dsh-pro/blob/main/packages/client/ui-server-status/src/sampler.ts)、[Client 实现](https://github.com/JoshuaNibaba/dsh-pro/blob/main/packages/client/ui-server-status/src/client/index.ts) | 认证 RPC、计时器释放、poller 生命周期、slot 注入、双语显示 |
| [RPC owner 修复](https://github.com/JoshuaNibaba/dsh-pro/blob/main/packages/client/connection/src/rpc-host.ts) | RPC handler 归属调用方 `ctx.fiber.ctx`，获得调用方 `webServer` 注入；保留[回归测试](https://github.com/JoshuaNibaba/dsh-pro/blob/main/packages/client/connection/tests/rpc-owner.host.spec.ts) |
| [输入栏样式](https://github.com/JoshuaNibaba/dsh-pro/blob/main/packages/client/ui-conversation/src/client/skeleton/InputBar.module.css) | 底部容器 `flex-wrap: wrap`，窄窗口可换行 |
| [web-app bundle 补丁](https://github.com/JoshuaNibaba/dsh-pro/blob/main/packages/bundle/web-app/cordis.patch.yml)及[依赖](https://github.com/JoshuaNibaba/dsh-pro/blob/main/packages/bundle/web-app/package.json) | 包已接入但条目 `disabled: true`，需要部署配置明确启用 |
| [base TS 配置](https://github.com/JoshuaNibaba/dsh-pro/blob/main/tsconfig.base.json)、[Host 配置](https://github.com/JoshuaNibaba/dsh-pro/blob/main/tsconfig.host.json)、[Client 配置](https://github.com/JoshuaNibaba/dsh-pro/blob/main/tsconfig.client.json) | 包路径、独立 Host/Client 编译入口与 project references |

用户 profile 当前还有 Everforest 本地主题和实验性 Schedule bundle；它们是用户目录配置，不在本次 109 文件源码差异中。新环境迁移时须单独保留依赖、bundle 列表和插件目录；不要将凭据复制到仓库。

### 5. 定制维护工具

[维护脚本](dsh-custom)提供 `status`、`build`、`try`、`sync`、`resume`、`release`、`deploy` 和 `undeploy`，并处理客户端/CLI 版本一致性、锁文件、目录生成、聚焦测试与双工作树部署。使用方式见[目录说明](README.md)。

`sync` 是人工维护的 merge 流程：创建备份分支，按 npm 渠道或标签选择目标，执行 `git merge --no-ff <标签>`，生成文件冲突采用官方版本，再生成、测试、构建，最后正常 `git push`。它不改写历史，但会直接在主工作树的 `main` 上合并；小时维护 agent 应继续使用下节在独立候选工作树中进行的 merge 流程。

脚本有三处升级验收缺口：`CUSTOM_TESTS` 尚未包含状态栏及 RPC owner 回归；`GENERATED` 未涵盖所有文档图和 Client slot catalog；`deploy` 只有切换前的 smoke，缺少切换后独立健康检查和自动回滚。后续升级须补跑相关检查，不能以脚本成功代替完整验收。`regen` 会 `git add -u` 并提交全部已跟踪改动，故不要在混有未完成源码修复的候选目录直接调用。

### 6. Web 静态资源长期缓存

[frontend-static](https://github.com/JoshuaNibaba/dsh-pro/blob/main/packages/host/frontend-static/README.zh.md) 新增配置 `immutablePrefixes`：这些相对 dist 的目录下的文件以 `Cache-Control: public, max-age=31536000, immutable` 提供，index 与其他文件仍不带 `Cache-Control`。[dsh-web-app](https://github.com/JoshuaNibaba/dsh-pro/blob/main/packages/bundle/web-app/src/index.ts) 传入 `assets/`，因为 [Vite 构建](https://github.com/JoshuaNibaba/dsh-pro/blob/main/apps/web/vite.config.ts)把其中每个文件命名为 `[name]-[hash]`。官方版本提供 447 KB 的 `index`/`vendor` 包时不带缓存头，每次加载页面都重新下载；经高延迟 SSH 隧道时要多花数秒。合并时保留配置字段、前缀校验、bundle 接线和 Vite 命名；官方若改变资源目录布局，前缀须随之调整。测试为[真实组合测试](https://github.com/JoshuaNibaba/dsh-pro/blob/main/packages/host/frontend-static/tests/frontend-static.spec.ts)和 [web-app 接线测试](https://github.com/JoshuaNibaba/dsh-pro/blob/main/packages/bundle/web-app/tests/web-app.spec.ts)。

### 7. 文件树下载

[右侧 Sidebar 文件树](https://github.com/JoshuaNibaba/dsh-pro/blob/main/packages/client/ui-sidebar-files/README.zh.md#downloads)的每个文件行都有下载按钮。它通过现有 `workspaceFiles.readBytes` Remote 按 Host 上限逐个窗口读取文件，拒绝来自不同文件版本的窗口，再把一个 Blob 交给 `download` 锚点；DSH Remote Mac 应用通过 WKWebView 下载代理保存。没有修改 Host 端点或 wire 类型。合并时保留 store 的 `downloads` 状态、face 的 `download` 动作与 `createReadFile`、`save.ts`、行内控件及其样式，以及 `download.*` 文案键；本包自己的测试覆盖它们。

### 8. 手机布局与桌面图标

宽度低于 768px 时，[布局框架](https://github.com/JoshuaNibaba/dsh-pro/blob/main/packages/client/ui-layout/README.zh.md)去掉 56px 控制栏，在左上角挂载 `shell.leading` 的打开侧栏/新会话控件（原先仅限 macOS），并把侧边栏以带遮罩的抽屉形式覆盖在对话之上；主视图的会话或面板改变时，`DrawerNavigation` 通过新增的 store 动作 `closeNarrowSidebar` 关闭抽屉。[base.css](https://github.com/JoshuaNibaba/dsh-pro/blob/main/packages/client/web/src/base.css) 把 `#root` 设为 `100dvh` 并按安全区留白。[Web 外壳](https://github.com/JoshuaNibaba/dsh-pro/blob/main/apps/web/index.html)新增 `viewport-fit=cover`、`apple-touch-icon` 和带凭据的 manifest 链接，因为 DSH Remote 密码网关会用登录页回应匿名的 manifest 请求。[manifest](https://github.com/JoshuaNibaba/dsh-pro/blob/main/apps/web/public/manifest.webmanifest) 改为 `standalone`，并列出 `apps/web/public/icons/` 下的 PNG 图标，它们由桌面图标 `apps/desktop/resources/icon.svg` 渲染（maskable 版本让鲸鱼位于 80% 安全区内）。合并时保留断点常量、让抽屉脱离文档流时中栏仍留在原列的显式 grid 列、手机控件位置对 darwin 的排除，以及图标文件。测试为 [AppFrame](https://github.com/JoshuaNibaba/dsh-pro/blob/main/packages/client/ui-layout/tests/app-frame.client.spec.tsx)、[布局 store](https://github.com/JoshuaNibaba/dsh-pro/blob/main/packages/client/ui-layout/tests/layout-store.client.spec.ts) 和 [PWA 元数据](https://github.com/JoshuaNibaba/dsh-pro/blob/main/apps/web/tests/pwa-manifest.e2e.ts)。

### 9. Host 更新后自动刷新

[HMR 浏览器半侧](https://github.com/JoshuaNibaba/dsh-pro/blob/main/packages/client/hmr/src/client/index.ts)把每次（重新）连接 `/plugins/events` 后收到的第一张图与 `ctx.modules.manifest.rev` 比较，不同时调用 `location.reload()`。官方版本在这帧上原地替换所有变化的插件；重新部署后多个插件同时变化，`SlotAssemblyError` 逃出渲染器，React 根节点卸载，页面白屏。连接期间收到的图变化和重建仍实时应用。合并时保留 `open` 时重置的 `opening` 标志、revision 比较和 `internals.reloadPage` 替换点；[transport 测试](https://github.com/JoshuaNibaba/dsh-pro/blob/main/packages/client/hmr/tests/transport.client.spec.ts)覆盖它们。

### 10. 任务看板与仅 Chat 显示输入框

实验性的[看板服务](https://github.com/JoshuaNibaba/dsh-pro/blob/main/packages/experimental/kanban/README.zh.md)、[视图](https://github.com/JoshuaNibaba/dsh-pro/blob/main/packages/experimental/client-ui-kanban/README.zh.md)和[bundle](https://github.com/JoshuaNibaba/dsh-pro/blob/main/packages/experimental/kanban-bundle/README.zh.md)只存在于本 fork：按工作区保存任务的看板，Host 调度器让每条会话泳道每个 Turn 执行一个任务，界面是与“对话”“轨迹”并列的 `kanban` 会话视图标签。它们对共享文件的改动只有注册：`packages/boot/app-boot/src/profile.ts` 的 `OPTIONAL_BUNDLES`、`apps/cli` 依赖、根 tsconfig 的路径与引用、`scripts/gen-cordis-catalog.ts` 的 `SERVICE_PAGE` 与类型页面、`scripts/gen-doc-graphs.ts` 的角色、模型体验条目、发布家族列表、`kanban` 子系统页，以及[仅用于归属的 `kanban` 消息来源记录](https://github.com/JoshuaNibaba/dsh-pro/blob/main/docs/persistence-changes/2026-10-08-kanban-message-source.zh.md)。带有该来源的 Session 日志会被没有这条记录的构建拒绝，回滚到官方版本时必须考虑。

输入框只属于 Chat：[DefaultConversationViews](https://github.com/JoshuaNibaba/dsh-pro/blob/main/packages/client/ui-conversation/src/client/skeleton/DefaultConversationViews.tsx) 用 `data-conversation-view` 标明当前视图，[ConversationRoot.module.css](https://github.com/JoshuaNibaba/dsh-pro/blob/main/packages/client/ui-conversation/src/client/skeleton/ConversationRoot.module.css) 在选中其他视图时隐藏 `.composerSeat`。官方版本在所有视图下都显示输入框。合并时保留该属性和样式规则；[skeleton 测试](https://github.com/JoshuaNibaba/dsh-pro/blob/main/packages/client/ui-conversation/tests/skeleton.client.spec.tsx)、[看板 Web 场景](https://github.com/JoshuaNibaba/dsh-pro/blob/main/apps/web/tests/kanban.e2e.ts)和 [auto-review-denial](https://github.com/JoshuaNibaba/dsh-pro/blob/main/snapshots/web/auto-review-denial/ui.expected.md) 中的轨迹 golden 覆盖它们。

<a id="conflicts"></a>
## 冲突与生成文件

已启用 `git rerere`，但复用的解决结果仍须审查。普通 merge 中 `ours` 是定制分支、`theirs` 是官方目标；rebase 冲突中 `ours` 是正在重建的官方目标加已重放提交，不能混用两种语义。先解决源码、依赖清单、配置和 TS references，再从合并后源码重新生成产物。

2026-10-07 使用 `git merge-tree --write-tree HEAD dsh-v0.2.1-alpha.1` 预演得到七个冲突文件，未改变分支或工作树；该目标是 alpha，预演不代表已决定升级到它。当前实际冲突集中在生成物和翻译 sidecar：

| 冲突文件 | 处理方法 |
|---|---|
| [事件图英文](https://github.com/JoshuaNibaba/dsh-pro/blob/main/docs/event-producer-consumer.md)、[中文](https://github.com/JoshuaNibaba/dsh-pro/blob/main/docs/event-producer-consumer.zh.md) | `pnpm run gen-doc-graphs` |
| [模块图英文](https://github.com/JoshuaNibaba/dsh-pro/blob/main/docs/module-graph.md)、[中文](https://github.com/JoshuaNibaba/dsh-pro/blob/main/docs/module-graph.zh.md) | `pnpm run gen-module-graph` |
| [Session README sidecar](https://github.com/JoshuaNibaba/dsh-pro/blob/main/packages/api/session-controller/README.i18n.yaml) | 先核对合并后的双语 README，再 `pnpm run verify-translation-pairing --write packages/api/session-controller/README.md` |
| [Client slot catalog](https://github.com/JoshuaNibaba/dsh-pro/blob/main/packages/extensions/cordis-client-runner/src/client/slot-catalog.ts) | `pnpm run gen-client-catalog` |
| [锁文件](https://github.com/JoshuaNibaba/dsh-pro/blob/main/pnpm-lock.yaml) | 先合并 manifests，再 `pnpm install --lockfile-only` |

源码改动即使自动合并也要按上节验收，特别是 LLM adapter、provider 路由、RPC fiber 所属、Session 窗口，以及新增插件的三个接入面：编译 references、bundle 配置、bundle dependency。

其他生成物包括 [配置目录](https://github.com/JoshuaNibaba/dsh-pro/blob/main/docs/config-catalog.md)、[持久化目录](https://github.com/JoshuaNibaba/dsh-pro/blob/main/docs/persistence-catalog.md)、[持久化 schema](https://github.com/JoshuaNibaba/dsh-pro/blob/main/docs/persistence-schema.json)、[已知事件](https://github.com/JoshuaNibaba/dsh-pro/blob/main/packages/core/session/src/known-event-types.ts)、[Cordis API catalog](https://github.com/JoshuaNibaba/dsh-pro/blob/main/packages/extensions/tool-cordis/src/api-catalog.ts)、[技能包列表](https://github.com/JoshuaNibaba/dsh-pro/blob/main/packages/preset/agent-preset/skills/cordis-composition-reference/references/packages.md)及[组合说明](https://github.com/JoshuaNibaba/dsh-pro/blob/main/apps/cli/composition.md)中的生成区域。分别运行 `gen-config-catalog`、`gen-persistence-catalog`、`gen-cordis-catalog` 及其他所属生成器，不手工拼接生成行。[Cordis 生成器](https://github.com/JoshuaNibaba/dsh-pro/blob/main/scripts/gen-cordis-catalog.ts)与 [README 验证器](https://github.com/JoshuaNibaba/dsh-pro/blob/main/scripts/verify-package-readme-model-experience.ts)本身的修改是源码，应审查保留；[Python runtime manifest](https://github.com/JoshuaNibaba/dsh-pro/blob/main/python/sdk-runtime/package.json)的依赖改动也应与上游依赖策略一起核对。

<a id="merge"></a>
## 后续合并流程

以下是后续升级操作模板，本次只执行了检查和合并预演。推荐保留历史的 merge 路径，适用于定时维护和已共享的 `main` 分支。

1. 确认源码干净、`origin/main` 没有未纳入的提交，记录当前部署链接、版本和健康状态；备份 profile、外部插件和持久化数据。查询官方发布，明确是否允许 RC/alpha，再选择目标标签。
2. fetch 官方与定制远程，创建指向当前 `main` 的备份分支，并在独立工作树创建候选分支。候选分支从当前 `main` 起步；正常 merge 选定官方标签，遇到冲突按上一节处理。
3. 保留每项定制或明确记录被官方等效实现替代的项目；源文件解决后重建所有受影响生成物，核对双语 sidecar。候选环境安装依赖、跑测试、构建与 smoke。
4. 验收通过后重新 fetch `origin`。若远程已前进，纳入新增提交并重新验证受影响范围；不能用强推覆盖。仅在本地 `main` 可快进到候选结果时推进并正常推送。
5. 在空闲部署目录构建并 smoke，通过后切换；从另一个进程验证实际服务健康与版本，异常时恢复旧部署链接。最后更新本文、维护状态和运行报告。

候选准备示例（替换目标版本、分支名及工作树路径，命令遇错即停）：

```sh
git fetch upstream --tags
git fetch origin main
git status --short --branch
git branch backup/main-before-upgrade main
git worktree add -b candidate/official-upgrade /home/dsh/workspace/dsh-upgrade main
git -C /home/dsh/workspace/dsh-upgrade merge --no-ff --no-commit dsh-v0.2.1-alpha.1
```

固定示例名称若已存在，应另选名称，不覆盖现有备份。merge 尚未结束时，在候选目录解决冲突、生成所需产物、检查 diff，再 `git add` 所需文件并提交 merge；使用 `git merge --abort` 放弃该候选合并。不要在主工作树或活动发布目录实验。

重新生成时，先从已解决的 manifests 创建锁文件并安装，再执行受影响生成器：

```sh
pnpm install --lockfile-only
pnpm install --frozen-lockfile
pnpm run gen-persistence-catalog
pnpm run gen-config-catalog
pnpm run gen-cordis-catalog
pnpm run gen-client-catalog
pnpm run gen-doc-graphs
pnpm run gen-module-graph
pnpm run gen-third-party-notices
pnpm run verify-persistence-changes
```

双语内容核对完成后，只对修改过的文档执行 `verify-translation-pairing --write <英文文档路径>`；不要用批量刷新掩盖译文缺失。若人工选择现有 rebase 脚本，先阅读脚本与远程历史，再按其备份/冲突恢复流程执行；它会改写历史，不能用于禁止强推的小时维护任务。

候选已提交且全部验收通过后，在主工作树推进并发布；任何快进失败都停下，保留候选并检查远程或本地新增提交：

```sh
git fetch origin main
git switch main
git merge --ff-only origin/main
git merge --ff-only candidate/official-upgrade
git push origin main
```

<a id="validation"></a>
## 验收与部署

以下测试命令，加上构建后运行的 `pnpm exec vitest run --config vitest.web.config.ts apps/web/tests/pwa-manifest.e2e.ts`，覆盖目前九组定制的行为接入点，包含脚本漏掉的状态栏和 RPC owner 测试：

```sh
pnpm exec vitest run \
  packages/llm/llm-pi-ai/tests/web-search.spec.ts \
  packages/web/web-search-model packages/web/tool-web \
  packages/api/gateway/tests/stream-server.host.spec.ts \
  packages/api/gateway/tests/gateway-stream.host.spec.ts \
  packages/api/session-controller/tests/session.client.spec.ts \
  packages/api/session-controller/tests/manager.client.spec.ts \
  packages/client/connection/tests/rpc-owner.host.spec.ts \
  packages/client/ui-server-status \
  packages/host/frontend-static packages/bundle/web-app/tests/web-app.spec.ts \
  packages/client/ui-sidebar-files packages/client/ui-layout packages/client/hmr
pnpm run verify-persistence-changes
pnpm run doc-sync
pnpm run lint
pnpm run typecheck
pnpm run build
```

若合并改变 GUI、连接/RPC 或浏览器组装，追加 `pnpm run test:gui` 和 `DSH_SNAPSHOT=replay pnpm run test:web`；原生搜索协议改变时还须按 [测试规范](https://github.com/JoshuaNibaba/dsh-pro/blob/main/docs/testing.zh.md)补充真实 provider 验证，并清楚区分无凭据的单元测试与真实 API 证据。升级中跑哪些检查由 [pre-push skill](https://github.com/JoshuaNibaba/dsh-pro/blob/main/.agents/skills/dsh-pre-push-checks/SKILL.md)按实际差异选择，不以固定清单取代上游新增要求。

部署 smoke 使用独立 `DSH_HOME` 和端口，不能向生产 Session 写测试记录。切换后在现有 `http://127.0.0.1:18790` 刷新，验证登录、打开旧 Session、继续加载历史、流连接、一次搜索、状态栏及 Schedule 可用；核对 CLI 与浏览器 artifact 版本一致。界面变更须构建相应 Web artifacts，启动另一台 Vite server 不能更新当前 GUI。

回滚代码前先检查新版本是否写入新事件或迁移数据；活动 profile 的外部状态栏、主题和 Schedule 配置也必须能在回滚版本解析。保存上一发布目录和数据备份，部署后的独立检查失败时恢复旧链接并重启，再确认恢复服务健康。

<a id="maintenance"></a>
## 维护本文

每次成功纳入官方版本后更新官方基线、保留/替代的定制、实际冲突与生成器、测试入口和部署配置；新增定制同时维护脚本的 `CUSTOM_TESTS` / `GENERATED`。以版本标签、提交主题和 Git 查询定位提交，不把会因 rebase 改变的提交 ID 写入长期文档。

小时维护任务的当前指令在 `/home/dsh/.dsh/maintenance/dsh.md`，状态和报告位于同目录；这些用户文件不随仓库 clone 恢复。每轮升级先读取本手册与实际运行配置，完成后写回最新基线和验收结论。
