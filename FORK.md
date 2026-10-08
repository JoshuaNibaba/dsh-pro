# DSH Pro

English | [中文](FORK.zh.md)

DSH Pro is an unofficial distribution built on [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). It is not developed, endorsed, or supported by DeepSeek. Report problems with DSH Pro at [JoshuaNibaba/dsh-pro](https://github.com/JoshuaNibaba/dsh-pro/issues), not in the official repository.

## Releases

The `custom` branch is an official release tag (`dsh-v*`) with the DSH Pro commits on top. Official releases are merged into it; its history is never rewritten, so a clone can always fast-forward. Each published version is a `custom-v<official version>.<n>` tag with a [GitHub Release](https://github.com/JoshuaNibaba/dsh-pro/releases); `git log --no-merges <official tag>..custom` lists the changes.

## Install

```sh
git clone -b custom https://github.com/JoshuaNibaba/dsh-pro.git
cd dsh-pro
pnpm install
pnpm run build
node apps/cli/lib/bin.js web
```

Update with `git pull --ff-only`, then `pnpm install` and `pnpm run build`; run `pnpm run clean` first when the official base version changed. Packages keep their official `@deepseek-ai/*` names and are not published to npm.

## Changes from the official release

| Change | Behavior |
|---|---|
| Model-native web search | The `web_search` tool defaults to the `model-native` provider, which searches through the current Session model route (Anthropic `web_search_20250305`; OpenAI, Azure, and Codex Responses `web_search`). DeepSeek routes delegate to `deepseek-official`. Each search records a `web/model-search-request` Session event. |
| Stream WebSocket compression | The Remote stream WebSocket negotiates permessage-deflate. The gateway `websocketCompression: false` setting turns it off. |
| Session history window | Opening a Session loads up to 40 messages or three Turns, and the next older page loads automatically when the reader scrolls near the top. |
| Server status footer | The `ui-server-status` plugin shows server CPU, memory, connection state, and RPC latency under the composer. It ships disabled; enable it in the Web profile. |
| Immutable Web asset caching | Content-hashed files under `assets/` are served with `Cache-Control: public, max-age=31536000, immutable`. |
| File tree download | The right Sidebar file tree can download workspace files. |
| Phone layout | Below 768px the sidebar opens as a drawer, and the Web app provides installable PNG launcher icons. |

## Compatibility

Sessions that ran model-native web search contain `web/model-search-request` events. Official builds without this change refuse to open those Sessions, so switching back to the official release does not restore access to them.

## License

DSH Pro keeps the official [MIT License](LICENSE) and copyright notice. "DeepSeek Harness" is a trademark of DeepSeek; see the [brand guidelines](BRAND_GUIDELINES.md).
