# DSH Pro

English | [中文](FORK.zh.md)

DSH Pro is an unofficial distribution built on [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`). It is not developed, endorsed, or supported by DeepSeek. On top of the official release it adds a Kanban task board, a server status footer, a phone layout, workspace file downloads, model-native web search, and more, and it ships **DSH Remote**: run dsh on your own server and use it from a Mac client, a browser, or a phone. Report problems with DSH Pro at [JoshuaNibaba/dsh-pro](https://github.com/JoshuaNibaba/dsh-pro/issues), not in the official repository.

![DSH Pro: a conversation, the right-sidebar workspace file tree with downloads, and the server status footer under the composer](.github/dsh-pro/workspace.png)

## Contents

- [Quick start](#quick-start)
- [Deploy to a server and use it remotely](#deploy-to-a-server-and-use-it-remotely)
- [Improvements over the official release](#improvements-over-the-official-release)
- [Added plugins](#added-plugins)
- [Update](#update)
- [Releases and branches](#releases-and-branches)
- [Compatibility](#compatibility)
- [License](#license)

## Quick start

You need Node.js `^22.19` or `>=24`, git, and pnpm (Node's bundled corepack provides the version the repository declares: `corepack enable`).

```sh
git clone -b custom https://github.com/JoshuaNibaba/dsh-pro.git
cd dsh-pro
corepack enable        # first time only; provides pnpm
pnpm install
pnpm run build
node apps/cli/lib/bin.js web
```

The terminal prints an address with a one-time token (`dsh web: http://127.0.0.1:18790/?token=…`) and opens it in the browser. On first use, enter a DeepSeek API key when prompted, or add another model provider (Anthropic, OpenAI, and others) under Settings → Models. An alias such as `alias dsh="node $PWD/apps/cli/lib/bin.js"` lets you run `dsh web`.

Packages keep their official `@deepseek-ai/*` names and are not published to npm; every added plugin below is part of this build and needs no separate installation.

## Deploy to a server and use it remotely

The [`remote/`](remote/README.md) directory is DSH Remote:

| Part | Purpose |
|---|---|
| [Server installer](remote/server/install.sh) | Installs Node.js 22 and the `dsh-web` systemd service (listening on `127.0.0.1` only) on Debian/Ubuntu; with `--domain` it also sets up a password login gateway, nginx, and an HTTPS certificate so browsers and phones can connect |
| Mac client `DSH Remote.app` | Native macOS app: enter the web address and access password, or use an SSH tunnel; updates itself. The built app is in [release `dsh-remote`](https://github.com/JoshuaNibaba/dsh-pro/releases/tag/dsh-remote) |
| [`dsh-remote` CLI](remote/cli/dsh-remote) | Optional terminal tool: open a tunnel, read logs, restart the service, update the Mac client |

On the server, as root:

```sh
git clone -b custom https://github.com/JoshuaNibaba/dsh-pro.git /opt/dsh-pro-src
bash /opt/dsh-pro-src/remote/server/install.sh --domain dsh.example.com
```

Without a clone, `curl -fsSL https://raw.githubusercontent.com/JoshuaNibaba/dsh-pro/custom/remote/server/install.sh | bash -s -- --domain dsh.example.com` does the same. The installer first installs and starts the official dsh from npm, then prints the web address and the generated access password. Then switch the service to DSH Pro:

```sh
corepack enable                                   # root: provides pnpm for every user
sudo -iu dsh                                      # the rest runs as the dsh user
git clone -b custom https://github.com/JoshuaNibaba/dsh-pro.git ~/dsh-pro
cd ~/dsh-pro && pnpm install && pnpm run build
ln -sfn ~/dsh-pro/apps/cli/lib/bin.js ~/.dsh-remote/dsh-bin
sudo systemctl restart dsh-web
```

While `~/.dsh-remote/dsh-bin` exists, the service runs the dsh it points to; remove the link and restart to return to the official npm release.

On the Mac: download `DSH-Remote.zip` from [release `dsh-remote`](https://github.com/JoshuaNibaba/dsh-pro/releases/tag/dsh-remote), unzip it, and drag `DSH Remote.app` into Applications; the first time, right-click it and choose Open (the app is not notarized by Apple). Or install it from the command line:

```sh
curl -fsSL https://github.com/JoshuaNibaba/dsh-pro/releases/download/dsh-remote/DSH-Remote.zip -o /tmp/DSH-Remote.zip
ditto -x -k /tmp/DSH-Remote.zip ~/Applications
```

On first launch, enter the web address and access password. SSH mode, HTTPS options, Cloudflare, the service menu, and troubleshooting are described in [remote/README.md](remote/README.md) (Chinese).

## Improvements over the official release

### Kanban task board

After you switch on **Kanban** on the Plugins page, every started Session gets a **Kanban** tab beside Chat and Trajectory. The board of the Session's Workspace has three columns: a plan pool, one lane per Session, and completed tasks. Drag a planned card into a Session's lane and the Kanban service sends the lane's tasks one at a time while that Session is idle, then marks each task completed or failed from the end reason of its Turn; a failure pauses the lane and offers retry, skip, and withdraw. Unsent tasks stay editable, movable, and withdrawable.

![Kanban board: plan pool, a Session lane with a running task, and completed tasks](.github/dsh-pro/kanban.png)

### Server status footer

The footer under the composer shows the connection state, server CPU, server memory, and RPC round-trip latency (bottom of the first screenshot), so a remote user can tell a busy server from a slow network or a dropped connection. It ships disabled; add these lines to the Web profile's `~/.dsh/profiles/web/cordis.patch.yml` and restart dsh:

```yaml
- id: ui-server-status
  disabled: false
```

### Workspace file downloads

In the right sidebar's Files tree, hovering a file shows a download button that saves the server-side workspace file to your computer (right side of the first screenshot).

### Phone layout

Below 768px wide, the left sidebar becomes a drawer and the conversation and composer fill the screen. The Web app provides PNG launcher icons, so a phone browser can add it to the home screen.

![The conversation and the sidebar drawer on a phone](.github/dsh-pro/phone.png)

### Model-native web search

The `web_search` tool defaults to the search built into the current Session's model (Anthropic `web_search_20250305`; `web_search` for OpenAI, Azure, and Codex Responses), as Claude Code's WebSearch does; DeepSeek models keep DeepSeek's official search. Each search records a `web/model-search-request` Session event.

### Remote connection and load time

| Improvement | Behavior |
|---|---|
| WebSocket compression | The live stream negotiates permessage-deflate, which cuts traffic over CDNs and long-haul links. The gateway `websocketCompression: false` setting turns it off |
| Paged history | Opening a Session loads at most the latest 40 messages or three Turns, and the next older page loads automatically near the top, so long Sessions open faster |
| Immutable asset caching | Content-hashed files under `assets/` are served with `Cache-Control: public, max-age=31536000, immutable`, so reopening the page does not download the frontend again |
| Reload after a server update | A page that reconnects to a server restarted with other client bundles reloads itself instead of going blank |

### Models and tools

| Improvement | Behavior |
|---|---|
| pi-ai 1.1.0 | `@earendil-works/pi-ai` is upgraded to 1.1.0. Anthropic models receive mid-conversation tool changes natively instead of a rewritten cached context; set `compat.supportsMidConvoToolChanges: false` for gateways that strip that beta |
| Batched tool calls | `batchIndependentCalls: true` on the `tools` plugin asks the model in the system prompt to request independent tool calls together in one response |
| Stable source path | `sourceRoot` on the `web-runtime` plugin fixes the source path in the system prompt, so prompt caches stay valid when the service switches between two release directories |
| Sandbox mode compatibility | A tool call that repeats the current sandbox mode with a blank justification (common with GPT models) is accepted; only a wider mode needs a justification |
| Composer only beside Chat | Views such as Trajectory and Kanban render without the composer |

## Added plugins

All of these are built with DSH Pro; none needs installation.

| Plugin | Package | Default | How to switch on |
|---|---|---|---|
| Kanban | `@deepseek-ai/dsh-experimental-kanban-bundle` (with `dsh-experimental-kanban` and `dsh-experimental-client-ui-kanban`) | Off (experimental) | Switch on Kanban on the Plugins page, shown below |
| Server status footer | `@deepseek-ai/dsh-client-ui-server-status` | Off | Set `disabled: false` in `cordis.patch.yml`, as above |
| Model-native search | `@deepseek-ai/dsh-web-search-model` | On | — |
| File downloads, phone layout, paged history, and the rest | Changes to official plugins | On | — |

![Plugins page: switch on Kanban in the Official group](.github/dsh-pro/plugins.png)

## Update

```sh
cd dsh-pro
git pull --ff-only
pnpm install
pnpm run build
```

Run `pnpm run clean` first when the official base version changed. On a server, run the same commands as the dsh user in `~/dsh-pro`, then `sudo systemctl restart dsh-web`. The Mac client checks [release `dsh-remote`](https://github.com/JoshuaNibaba/dsh-pro/releases/tag/dsh-remote) by itself and offers updates.

## Releases and branches

The `custom` branch is an official release tag (`dsh-v*`) with the DSH Pro commits on top. Official releases are merged into it; its history is never rewritten, so a clone can always fast-forward. Each published version is a `custom-v<official version>.<n>` tag with a [GitHub Release](https://github.com/JoshuaNibaba/dsh-pro/releases); `git log --no-merges <official tag>..custom` lists the changes. [GitHub Actions](.github/workflows/dsh-remote-mac.yml) builds the Mac client whenever `remote/mac/` changes and updates release `dsh-remote`.

## Compatibility

Sessions that ran model-native web search contain `web/model-search-request` events. Official builds without this change refuse to open those Sessions, so switching back to the official release does not restore access to them.

## License

DSH Pro keeps the official [MIT License](LICENSE) and copyright notice. "DeepSeek Harness" is a trademark of DeepSeek; see the [brand guidelines](BRAND_GUIDELINES.md).
