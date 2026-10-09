---
description: "dsh Web 客户端的编辑器配色主题，默认 Everforest，在「通用」设置中切换。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-theme-pack

[English](README.md) | 中文

## 概述

DSH Pro 用知名编辑器配色为 Web UI 重新着色：浏览器没有保存其他选择时使用 Everforest，另有 Gruvbox、Catppuccin、Rosé Pine、Tokyo Night、Nord、Solarized、Kanagawa 和 GitHub。**设置 → 通用 → 配色主题**可切换配色或回到内置配色。每套配色都有浅色和深色两版，因此「外观」一行仍决定浅色、深色或跟随系统。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

web-app bundle 组合了本插件，因此每个 Web profile 一开始就是 Everforest。打开**设置 → 通用 → 配色主题**，点击卡片即可立即切换；**默认**取消重新着色。选择保存在当前浏览器 `localStorage` 的 `dsh-theme-pack` 键下，因此其他浏览器或设备在自行选择之前都从 Everforest 开始。所有使用 `--dsw-alias-*` 变量绘制的界面都会跟随配色，包括首次打开的欢迎弹窗等对话框。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

Host 半边是空的 `apply`，只为让本包拥有一行 Loader 条目，客户端模块系统据此提供浏览器半边。`palettes.ts` 保存每套配色的调色板，并把它们映射为 alias 变量、`--dsw-specific-*` 界面变量和 Shiki 代码高亮变量的 `{ light, dark }` 值对；缺少的状态底色由基础色和强调色混合得出。浏览器半边以包名为来源，把这一层交给 `ctx.theme.overrideTokens`，每次选择时替换，选择**默认**或 fiber 离开时移除。通用设置中的这一行通过注入的快照 store 读取当前选择，注册顺序为 10.5，位于「外观」之后。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [ui-theme](../ui-theme/README.zh.md) — 主题运行时、alias 变量，以及本包叠加的覆盖层。
- [ui-settings-general](../ui-settings-general/README.zh.md) — 「通用」设置区及其 `settings.general.item` 插槽。

-----

<a id="model-experience"></a>
## 模型体验

无，本包是浏览器端的配色层，不注册任何模型可见内容。

#### KV 缓存影响

无；本包既不组装也不发送提供方请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **按浏览器保存选择** — 配色不属于 profile 设置，每个浏览器各自选择。
- **运行时不变量：** 不发布配套检查。本包除主题运行时已按来源跟踪的那一层覆盖之外，不持有其他关系。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作背景 — 点击展开</summary>

无。

</details>
