# 上游同步后必查清单（DSH Pro 定制）

每次把 `upstream`（deepseek-ai/DeepSeek-Harness）合并或变基到 `main` 后，逐项确认下面的定制仍然存在并生效。冲突时以本清单描述的行为为准重新实现。

## 1. Claude Code / Codex CLI 请求伪装（`@deepseek-ai/dsh-llm-pi-ai`）

用途：经 sub2api 订阅中转调用 Claude 与 GPT 时，请求表现为 Claude Code 与 Codex CLI。按路由协议自动判定：`anthropic-messages` → Claude Code；`openai-completions` / `openai-responses` / `openai-codex-responses` → Codex CLI。

涉及文件：

- `packages/llm/llm-pi-ai/src/client-emulation.ts`：配置 schema、请求头、请求体改写（整文件为定制）。
- `packages/llm/llm-pi-ai/src/config.ts`：`Config` 增加 `clientEmulation` 字段。
- `packages/llm/llm-pi-ai/src/index.ts`：`resolveClientEmulation(...)` 并传给 `PiAiAdapter`。
- `packages/llm/llm-pi-ai/src/adapter.ts`：`requestHeaders` 的第二个参数（伪装头替换 Harness 署名 `User-Agent`）、`streamWithSnapshot` 中的 `onPayload`、`webSearch` 中的 `transformPayload`。
- `packages/llm/llm-pi-ai/src/web-search.ts`：`WebSearchDispatch.transformPayload`。
- 测试：`packages/llm/llm-pi-ai/tests/client-emulation.spec.ts`、`tests/web-search.spec.ts` 中 “sends the search request as Claude Code” 用例。

同步后检查：

1. pi-ai 升级时确认 `onPayload` 仍在 `anthropic-messages`、`openai-responses`、`openai-completions` 中被调用，且请求头仍是“调用方 `headers` 最后合并”（伪装 `User-Agent` 才能生效）。
2. pi-ai 升级时确认 managed-effort 模型仍以“空内容 + `output_config` 的 system 消息”表达推理强度；伪装会把最后一条的 effort 移到顶层 `output_config.effort` 并删除这些消息与 `mid-conversation-output-config-*` beta，格式变了需同步修改 `topLevelEffort`。
3. 上游若改动 `attributionHeaders` 或 `requestHeaders`，确认启用伪装时 `User-Agent` 仍为 `claude-cli/...` / `codex_cli_rs/...`。
4. 运行 `npx vitest run packages/llm/llm-pi-ai`，全部通过。
5. 运行 `pnpm run gen-config-catalog` 更新配置目录。

部署配置（`~/.dsh/profiles/web/cordis.patch.yml` 中 `llm-pi-ai` 行的 `config`）需保留：

```yaml
clientEmulation:
  enabled: true
```

版本号随官方客户端更新：`clientEmulation.claudeCode.version`（`claude --version`）、`clientEmulation.codex.version`。

## 2. 远程页面可读写 Host 设置（`@deepseek-ai/dsh-client-connection`）

用途：通过 `https://dsh.aipcloud.xyz` 等非 loopback 地址登录的页面也能使用设置页（模型提供商目录等），否则报 “加载提供商目录失败: settings are unavailable in this browser”。

涉及文件：

- `packages/client/connection/src/index.ts`：`Config.privilegedHosts`，注入页面全局 `__DSH_PRIVILEGED_HOSTS__`。
- `packages/client/connection/src/client/index.ts`：`isLoopback` 额外匹配 `privilegedHosts`。
- `packages/client/connection/src/api-request-trust.ts`：`matchesAuthority` 使用页面 `host` 与 `protocol`，省略端口按 HTTP 80 / HTTPS 443 匹配；保持服务端 Host/Origin 信任规则。
- `packages/client/connection/tsconfig.client.json`：`files` 包含 `src/api-request-trust.ts`。
- 测试：`tests/client-apply.client.spec.ts`、`tests/node-half.host.spec.ts`、`tests/api-request-trust.host.spec.ts` 中 privileged 相关用例。

同步后检查：上游若新增 `isLoopback` 的使用方，确认远程页面放开该能力是可接受的。

部署配置需保留（整行 `config` 会被替换，`trustedHosts` 必须一起写）：

```yaml
- id: connection
  name: '@deepseek-ai/dsh-client-connection'
  config:
    trustedHosts: !!js ctx.webRuntime.trustedHosts
    privilegedHosts:
      - dsh.aipcloud.xyz:443
```

## 3. 远程安装和升级

`remote/server/install.sh` 使用实际 Node 可执行路径，接受 `^22.19 || >=24`，并在新 Web URL、Web 服务和网关健康均就绪后报告成功。`remote/server/dsh-update` 传播原生构建失败，失败时不得重启服务；npm 已安装的内容不会自动回滚。运行 `node --test remote/server/tests/*.test.mjs` 检查隔离安装、升级与失败路径。

## 4. Pro 发布约束与 CI

`packages/web/web-search-model` 保持私有且不声明 `publishConfig`；`scripts/check-workspace-constraints.ts` 只为该目录提供 Pro 源码分发例外，其他普通包仍执行上游发布要求。`.github/workflows/dsh-pro-ci.yml` 在 GitHub 托管 runner 检查 `main`、拉取请求和 Pro 标签，`Pro checks passed` 汇总所有作业；上游自定义 runner 工作流单独保留。
