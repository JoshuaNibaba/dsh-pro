# Custom changes and official-release merge guide

English | [中文](CHANGES.zh.md)

This guide is for maintainers of the `custom` branch and its Web deployment: check the official baseline and running deployment, preserve the behaviors below, then merge, validate, and publish from an isolated candidate worktree. Package READMEs own feature details; this guide owns change locations, conflict handling, and upgrade acceptance.

## Contents

- [Baseline and scope](#baseline)
- [Customizations to preserve](#customizations)
- [Conflicts and generated files](#conflicts)
- [Future merge procedure](#merge)
- [Validation and deployment](#validation)
- [Maintaining this guide](#maintenance)

<a id="baseline"></a>
## Baseline and scope

As checked on 2026-10-07, the official baseline of `custom` is `dsh-v0.2.0-rc.2`, followed by six custom commits; the latest feature commit subject is `feat(client): add server resource and connection status footer`. The baseline diff touches 109 files with 4194 additions and 60 deletions, including tests, bilingual documentation, and generated artifacts; these figures exclude this guide's commit. The six commits cover five groups of customizations, with two commits for maintenance tooling. The history-window commit added after that check, and the Web commits after it, are the last table rows and are not included in those counts.

| Commit subject (original order) | Corresponding customization |
|---|---|
| `custom: maintenance tooling for local changes on top of official releases` | Maintenance tooling |
| `custom: web_search 默认使用当前模型路由的原生搜索(模仿 Claude Code)` | Model-route search |
| `custom: sync regenerates generated files, runs local tests, and resumes after conflicts` | Tooling regeneration, tests, and recovery |
| `custom: compress the Remote stream WebSocket with permessage-deflate` | Stream WebSocket compression |
| `custom: open Sessions with a 20-message, one-Turn history window` | Session history window |
| `feat(client): add server resource and connection status footer` | Status footer, RPC owner fix, and input-bar wrapping |
| `custom: cap history windows at three Turns and load older pages near the top` | Session history window |
| `custom: serve content-hashed Web assets with an immutable Cache-Control` | Long-lived Web asset cache |
| `custom: download workspace files from the right Sidebar file tree` | File-tree downloads |
| `custom: phone layout with a sidebar drawer, and installable PNG launcher icons` | Phone layout and launcher icons |

At that check, official npm `latest` and `next` both point to `0.2.0-rc.2`, while `alpha` points to `0.2.1-alpha.1`; both versions are prereleases. Query the release channels again for each upgrade and select an explicit tag. `latest` does not guarantee stability, and `upstream/master` does not identify a published release.

| Object | Current purpose | Upgrade handling |
|---|---|---|
| `upstream` | Official repository `https://github.com/deepseek-ai/DeepSeek-Harness.git`, with pushes disabled | Fetch only; merge an explicit release tag |
| `origin/custom` | Default branch of the public fork `https://github.com/JoshuaNibaba/deepseek-harness.git` (the old private `dsh-custom` repository is archived) | Public release branch: merge only with normal pushes; never rewrite history or force-push |
| `/home/dsh/workspace/dsh` | Source worktree on branch `custom` | Create a candidate branch and isolated worktree for upgrades |
| `/home/dsh/.dsh-custom/release-b` | Running worktree at the check, with latest commit subject `custom: open Sessions with a 20-message, one-Turn history window` | Do not build in place; resolve the deployment link to identify the active directory again |
| User Web profile | Deployment configuration for the status plugin, theme, and scheduling | Back up and validate separately from source |

The running worktree does not yet include the repository's server-status commit; the current profile loads the status plugin independently from `/home/dsh/.dsh/plugins/ui-server-status/lib/index.js`. Repository source and the running UI therefore have different complete versions. Before enabling the merged package's status plugin, migrate or disable the independent plugin entry to avoid duplicate registration.

Recheck the current facts from the repository root:

```sh
pwd
git status --short --branch
git remote -v
git worktree list
git describe --tags --abbrev=0 --match 'dsh-v*' custom
git log --reverse --format='%s' dsh-v0.2.0-rc.2..custom
git diff --stat dsh-v0.2.0-rc.2..custom
readlink -f /home/dsh/.dsh-remote/dsh-bin
npm view @deepseek-ai/dsh dist-tags --json
```

<a id="customizations"></a>
## Customizations to preserve

### 1. Search through the current model route

The official baseline's base bundle defaults to `deepseek-official` search; the custom version defaults to `model-native`, taking provider and model from the initiating Session's latest `requestContext()`. Search uses that route's credentials, headers, and endpoint. Route-keyed `models` can override the search model, and `delegates` can select another search provider. Missing Session or route fails explicitly instead of silently selecting an unrelated model.

Anthropic uses `web_search_20250305`; OpenAI Responses, Azure Responses, and Codex Responses use `web_search`. DeepSeek routes `deepseek-official`, `deepseek-account`, and `deepseek` delegate to `deepseek-official` by default; Google, Bedrock, and Chat Completions currently have no native-search support. Preserve cancellation, redirect rejection, response-segment order, citation URL deduplication, and error classification.

| Location | Preserve during merge |
|---|---|
| [Search plugin](https://github.com/JoshuaNibaba/deepseek-harness/blob/custom/packages/web/web-search-model/README.md) and its [provider](https://github.com/JoshuaNibaba/deepseek-harness/blob/custom/packages/web/web-search-model/src/provider.ts) | `model-native` registration, Session route resolution, model overrides, delegation, and error mapping |
| [LLM service](https://github.com/JoshuaNibaba/deepseek-harness/blob/custom/packages/llm/llm/src/index.ts) and [search types](https://github.com/JoshuaNibaba/deepseek-harness/blob/custom/packages/llm/llm/src/web-search.ts) | Adapter/service `webSearch` extension and request/result types |
| [pi-ai adapter](https://github.com/JoshuaNibaba/deepseek-harness/blob/custom/packages/llm/llm-pi-ai/src/adapter.ts) and [protocol implementation](https://github.com/JoshuaNibaba/deepseek-harness/blob/custom/packages/llm/llm-pi-ai/src/web-search.ts) | Protocol-specific native requests, authentication, and streaming response handling |
| [Web service](https://github.com/JoshuaNibaba/deepseek-harness/blob/custom/packages/web/web/src/index.ts) | Integration of the default Web search provider |
| [Base bundle patch](https://github.com/JoshuaNibaba/deepseek-harness/blob/custom/packages/bundle/base/cordis.patch.yml) and [dependencies](https://github.com/JoshuaNibaba/deepseek-harness/blob/custom/packages/bundle/base/package.json) | Default provider, plugin loading, and DeepSeek delegation mappings |
| [Persistence change record](https://github.com/JoshuaNibaba/deepseek-harness/blob/custom/docs/persistence-changes/2026-10-06-model-search-request.md) | `web/model-search-request`, its schema, and the known-event catalog |

Before native search dispatch, `web/model-search-request` records provider, model, api, and request body; this audits an auxiliary request and does not enter ordinary conversation request history. Keeping the Session format version does not guarantee that older official builds can read logs containing the new event: an unknown event without `ignorable` is rejected by older readers. Rollback must account for existing Session data.

### 2. Remote stream WebSocket compression

The [gateway configuration](https://github.com/JoshuaNibaba/deepseek-harness/blob/custom/packages/api/gateway/src/index.ts) adds `websocketCompression`, defaulting to `true`; the [stream server](https://github.com/JoshuaNibaba/deepseek-harness/blob/custom/packages/api/gateway/src/stream-server.ts) passes it to `WebSocketServer` as `perMessageDeflate`. Preserve the disabling option, extension negotiation, and existing stream protocol. This applies to the Remote stream WebSocket and does not establish HTTP compression or compression of every connection.

Validate both enabled and disabled settings, compression negotiation, and stream delivery. Tests are in the [stream server suite](https://github.com/JoshuaNibaba/deepseek-harness/blob/custom/packages/api/gateway/tests/stream-server.host.spec.ts) and [gateway stream suite](https://github.com/JoshuaNibaba/deepseek-harness/blob/custom/packages/api/gateway/tests/gateway-stream.host.spec.ts).

### 3. Session history window

The [Session client](https://github.com/JoshuaNibaba/deepseek-harness/blob/custom/packages/api/session-controller/src/client/sessions/session.ts) ends an ordinary history window at the first Turn start after 40 messages (`PAGE_MESSAGES`, baseline 50) or three Turns (`PAGE_TURNS`), whichever comes first; the baseline required both 50 messages and two Turns. The [Host pager](https://github.com/JoshuaNibaba/deepseek-harness/blob/custom/packages/api/session-controller/src/history.ts) adds the optional `turnWindow.maxTurns` field for the Turn limit, declared in [wire types](https://github.com/JoshuaNibaba/deepseek-harness/blob/custom/packages/api/session-controller/src/types.ts). A tool-heavy last Turn usually exceeds 40 messages alone, so the opening still shows one Turn; short Turns now open with three. `maxMessages = 500` and jump pages (`JUMP_PAGE_MESSAGES = 200`, no Turn limit) keep their baseline settings. This controls browser initial/history loading, not model-context pruning or server-side history deletion.

[Chat navigation](https://github.com/JoshuaNibaba/deepseek-harness/blob/custom/packages/client/ui-chat/src/client/chat/use-chat-navigation.ts) requests one older page automatically when the scrollport's top is less than one viewport height from the window's first row, wired in [Chat scroll](https://github.com/JoshuaNibaba/deepseek-harness/blob/custom/packages/client/ui-chat/src/client/chat/use-chat-scroll.ts). While following the tail, the tail stays in place as pages fill the viewport; after reader scrolling settles near the top, the Load earlier anchor keeps the reading position. Each window head is requested automatically once, so a failed page leaves the button for retry.

Check initial opening, loading earlier history, automatic loading near the top, and jump navigation after merging; preserve the [Session tests](https://github.com/JoshuaNibaba/deepseek-harness/blob/custom/packages/api/session-controller/tests/session.client.spec.ts), [Manager tests](https://github.com/JoshuaNibaba/deepseek-harness/blob/custom/packages/api/session-controller/tests/manager.client.spec.ts), [pager tests](https://github.com/JoshuaNibaba/deepseek-harness/blob/custom/packages/api/session-controller/tests/session-history-journal.host.spec.ts), [request validation tests](https://github.com/JoshuaNibaba/deepseek-harness/blob/custom/packages/api/session-controller/tests/transport.host.spec.ts), [Chat view tests](https://github.com/JoshuaNibaba/deepseek-harness/blob/custom/packages/client/ui-chat/tests/chat-view.client.spec.tsx), and [seeded history e2e](https://github.com/JoshuaNibaba/deepseek-harness/blob/custom/apps/web/tests/seeded-history.e2e.ts) with the behavior.

### 4. Server resource and connection footer

The [status package](https://github.com/JoshuaNibaba/deepseek-harness/blob/custom/packages/client/ui-server-status/README.md) contributes to `conversation.composer.dock`, showing aggregate server CPU, Linux memory use, browser connection status, and RPC round-trip latency. Memory is `MemTotal - MemAvailable`, not process RSS; sampling defaults to 3000 ms and request timeout to 5000 ms. RPC uses the `/server-status` `snapshot` endpoint. Disconnects, failures, and timeouts clear old readings, while reconnects reject stale responses. Readings are GUI-only, with no Session writes or model token use.

| Location | Preserve during merge |
|---|---|
| [Host implementation](https://github.com/JoshuaNibaba/deepseek-harness/blob/custom/packages/client/ui-server-status/src/index.ts), [sampler](https://github.com/JoshuaNibaba/deepseek-harness/blob/custom/packages/client/ui-server-status/src/sampler.ts), and [Client implementation](https://github.com/JoshuaNibaba/deepseek-harness/blob/custom/packages/client/ui-server-status/src/client/index.ts) | Authenticated RPC, timer disposal, poller lifecycle, slot injection, and bilingual display |
| [RPC owner fix](https://github.com/JoshuaNibaba/deepseek-harness/blob/custom/packages/client/connection/src/rpc-host.ts) | Handlers belong to the caller's `ctx.fiber.ctx`, obtaining its `webServer` injection; preserve the [regression test](https://github.com/JoshuaNibaba/deepseek-harness/blob/custom/packages/client/connection/tests/rpc-owner.host.spec.ts) |
| [Input bar styling](https://github.com/JoshuaNibaba/deepseek-harness/blob/custom/packages/client/ui-conversation/src/client/skeleton/InputBar.module.css) | Footer `flex-wrap: wrap` for narrow windows |
| [Web-app bundle patch](https://github.com/JoshuaNibaba/deepseek-harness/blob/custom/packages/bundle/web-app/cordis.patch.yml) and [dependencies](https://github.com/JoshuaNibaba/deepseek-harness/blob/custom/packages/bundle/web-app/package.json) | Package integration with its entry `disabled: true`; deployment configuration must explicitly enable it |
| [Base TS configuration](https://github.com/JoshuaNibaba/deepseek-harness/blob/custom/tsconfig.base.json), [Host configuration](https://github.com/JoshuaNibaba/deepseek-harness/blob/custom/tsconfig.host.json), and [Client configuration](https://github.com/JoshuaNibaba/deepseek-harness/blob/custom/tsconfig.client.json) | Package paths, separate Host/Client compiler entries, and project references |

The user profile also has a local Everforest theme and the experimental Schedule bundle. These are user-directory configuration, outside the 109-file source diff. Preserve their dependencies, bundle list, and plugin directories separately when moving environments; do not copy credentials into the repository.

### 5. Custom maintenance tooling

The [maintenance script](dsh-custom) provides `status`, `build`, `try`, `sync`, `resume`, `release`, `deploy`, and `undeploy`, handling Client/CLI version consistency, lockfiles, catalog generation, focused tests, and deployment between two worktrees. Usage is in the [directory guide](README.md).

`sync` is a manual merge procedure: create a backup branch, select a target from an npm channel or tag, run `git merge --no-ff <tag>`, take the official version of conflicting generated files, regenerate, test, build, then push normally. It never rewrites history, but merges directly on `custom` in the main worktree; the hourly maintenance agent keeps using the isolated candidate-worktree merge procedure below.

The script has three acceptance gaps: `CUSTOM_TESTS` omits server-status and RPC owner regressions; `GENERATED` does not cover all documentation graphs and the Client slot catalog; `deploy` has a pre-switch smoke but no independent post-switch health check or automatic rollback. Run the additional checks during upgrades rather than treating script success as complete acceptance. `regen` uses `git add -u` and commits all tracked changes, so do not invoke it in a candidate directory containing unfinished source fixes.

### 6. Long-lived Web asset cache

[frontend-static](https://github.com/JoshuaNibaba/deepseek-harness/blob/custom/packages/host/frontend-static/README.md) gains the `immutablePrefixes` config: files under those dist-relative directories are served with `Cache-Control: public, max-age=31536000, immutable`, while the index and other files stay without `Cache-Control`. [dsh-web-app](https://github.com/JoshuaNibaba/deepseek-harness/blob/custom/packages/bundle/web-app/src/index.ts) passes `assets/`, because the [Vite build](https://github.com/JoshuaNibaba/deepseek-harness/blob/custom/apps/web/vite.config.ts) names every file there `[name]-[hash]`. Upstream served the 447 KB `index`/`vendor` bundles without cache headers, so each page load fetched them again; over a high-latency SSH tunnel that cost seconds. Preserve the config field, its prefix validation, the bundle wiring, and the Vite naming; if upstream changes the asset layout, the prefix must follow it. Tests are the [real-composition spec](https://github.com/JoshuaNibaba/deepseek-harness/blob/custom/packages/host/frontend-static/tests/frontend-static.spec.ts) and the [web-app glue spec](https://github.com/JoshuaNibaba/deepseek-harness/blob/custom/packages/bundle/web-app/tests/web-app.spec.ts).

### 7. File-tree downloads

Every file row in the [right Sidebar file tree](https://github.com/JoshuaNibaba/deepseek-harness/blob/custom/packages/client/ui-sidebar-files/README.md#downloads) has a download button. It reads the file through the existing `workspaceFiles.readBytes` Remote one Host-capped window at a time, rejects windows from different file versions, and hands one Blob to a `download` anchor; the DSH Remote Mac app saves it through its WKWebView download delegate. No Host endpoint or wire type changed. Preserve the store's `downloads` state, the face's `download` action and `createReadFile`, `save.ts`, the row control and its styles, and the `download.*` locale keys; the package's own tests cover them.

### 8. Phone layout and launcher icons

Below 768px the [layout frame](https://github.com/JoshuaNibaba/deepseek-harness/blob/custom/packages/client/ui-layout/README.md) drops the 56px rail, mounts the `shell.leading` reopen/New Session controls at the top-left (formerly macOS only), and opens the sidebar as a drawer over the conversation with a backdrop; `DrawerNavigation` closes it when the main view's Session or panel changes, through the new `closeNarrowSidebar` store action. [base.css](https://github.com/JoshuaNibaba/deepseek-harness/blob/custom/packages/client/web/src/base.css) sizes `#root` to `100dvh` and pads it by the safe-area insets. The [Web shell](https://github.com/JoshuaNibaba/deepseek-harness/blob/custom/apps/web/index.html) adds `viewport-fit=cover`, an `apple-touch-icon`, and a credentialed manifest link, because the DSH Remote password gateway answers an anonymous manifest fetch with its login. The [manifest](https://github.com/JoshuaNibaba/deepseek-harness/blob/custom/apps/web/public/manifest.webmanifest) switches to `standalone` and lists PNG icons under `apps/web/public/icons/`, rendered from the desktop tile `apps/desktop/resources/icon.svg` (the maskable one keeps the whale in the 80% safe zone). Preserve the breakpoint constants, the explicit grid columns that keep the centre in place while the drawer is out of flow, the darwin exclusion of the phone seat placement, and the icon files. Tests: [AppFrame](https://github.com/JoshuaNibaba/deepseek-harness/blob/custom/packages/client/ui-layout/tests/app-frame.client.spec.tsx), [layout store](https://github.com/JoshuaNibaba/deepseek-harness/blob/custom/packages/client/ui-layout/tests/layout-store.client.spec.ts) and [PWA metadata](https://github.com/JoshuaNibaba/deepseek-harness/blob/custom/apps/web/tests/pwa-manifest.e2e.ts).

<a id="conflicts"></a>
## Conflicts and generated files

`git rerere` is enabled, but reused resolutions still require review. In an ordinary merge, `ours` means the custom branch and `theirs` means the official target; during rebase conflicts, `ours` means the official target being rebuilt plus already replayed commits. Do not interchange these meanings. Resolve source, manifests, configuration, and TS references first, then regenerate artifacts from the merged source.

On 2026-10-07, `git merge-tree --write-tree HEAD dsh-v0.2.1-alpha.1` reported seven conflicting files without changing branches or the worktree. The target is an alpha, and this rehearsal does not select it for deployment. The observed conflicts are generated artifacts and a translation sidecar:

| Conflicting files | Resolution |
|---|---|
| [English event graph](https://github.com/JoshuaNibaba/deepseek-harness/blob/custom/docs/event-producer-consumer.md) and [Chinese](https://github.com/JoshuaNibaba/deepseek-harness/blob/custom/docs/event-producer-consumer.zh.md) | `pnpm run gen-doc-graphs` |
| [English module graph](https://github.com/JoshuaNibaba/deepseek-harness/blob/custom/docs/module-graph.md) and [Chinese](https://github.com/JoshuaNibaba/deepseek-harness/blob/custom/docs/module-graph.zh.md) | `pnpm run gen-module-graph` |
| [Session README sidecar](https://github.com/JoshuaNibaba/deepseek-harness/blob/custom/packages/api/session-controller/README.i18n.yaml) | Review the merged bilingual READMEs, then `pnpm run verify-translation-pairing --write packages/api/session-controller/README.md` |
| [Client slot catalog](https://github.com/JoshuaNibaba/deepseek-harness/blob/custom/packages/extensions/cordis-client-runner/src/client/slot-catalog.ts) | `pnpm run gen-client-catalog` |
| [Lockfile](https://github.com/JoshuaNibaba/deepseek-harness/blob/custom/pnpm-lock.yaml) | Merge manifests first, then `pnpm install --lockfile-only` |

Validate source customizations against the preceding section even when Git merges them automatically, especially LLM adapters, provider routing, RPC fiber ownership, Session windows, and the three plugin integration surfaces: compiler references, bundle configuration, and bundle dependency.

Other generated artifacts include the [configuration catalog](https://github.com/JoshuaNibaba/deepseek-harness/blob/custom/docs/config-catalog.md), [persistence catalog](https://github.com/JoshuaNibaba/deepseek-harness/blob/custom/docs/persistence-catalog.md), [persistence schema](https://github.com/JoshuaNibaba/deepseek-harness/blob/custom/docs/persistence-schema.json), [known events](https://github.com/JoshuaNibaba/deepseek-harness/blob/custom/packages/core/session/src/known-event-types.ts), [Cordis API catalog](https://github.com/JoshuaNibaba/deepseek-harness/blob/custom/packages/extensions/tool-cordis/src/api-catalog.ts), [skill package list](https://github.com/JoshuaNibaba/deepseek-harness/blob/custom/packages/preset/agent-preset/skills/cordis-composition-reference/references/packages.md), and generated regions in the [composition guide](https://github.com/JoshuaNibaba/deepseek-harness/blob/custom/apps/cli/composition.md). Run `gen-config-catalog`, `gen-persistence-catalog`, `gen-cordis-catalog`, and other owning generators instead of combining generated lines manually. Changes to the [Cordis generator](https://github.com/JoshuaNibaba/deepseek-harness/blob/custom/scripts/gen-cordis-catalog.ts) and [README verifier](https://github.com/JoshuaNibaba/deepseek-harness/blob/custom/scripts/verify-package-readme-model-experience.ts) are source changes to review and preserve; review the [Python runtime manifest](https://github.com/JoshuaNibaba/deepseek-harness/blob/custom/python/sdk-runtime/package.json) dependency change against upstream dependency policy as well.

<a id="merge"></a>
## Future merge procedure

The following is a template for future upgrades; this task executed inspections and a merge rehearsal only. Prefer a history-preserving merge for scheduled maintenance and a shared `custom` branch.

1. Confirm clean source and no unincorporated `origin/custom` commits, recording the current deployment link, version, and health. Back up the profile, external plugins, and persistent data. Query official releases, decide whether RC/alpha versions are allowed, and choose a target tag.
2. Fetch both remotes, create a backup branch pointing to current `custom`, and create a candidate branch in an isolated worktree. Start from current `custom`, merge the selected official tag normally, and resolve conflicts as described above.
3. Preserve each customization or explicitly record its replacement by equivalent official behavior. Regenerate affected artifacts after resolving source, and review bilingual sidecars. Install dependencies, test, build, and smoke the candidate environment.
4. Fetch `origin` again after acceptance. If it advanced, incorporate the new commits and revalidate affected surfaces; do not overwrite them with a force push. Advance local `custom` only when it can fast-forward to the candidate, then push normally.
5. Build and smoke in the idle deployment directory before switching. Validate the actual service's health and version from another process, restoring the old deployment link on failure. Update this guide, maintenance state, and the run report.

Candidate preparation example (replace the target version, branch names, and worktree path; stop on any error):

```sh
git fetch upstream --tags
git fetch origin custom
git status --short --branch
git branch backup/custom-before-upgrade custom
git worktree add -b candidate/official-upgrade /home/dsh/workspace/dsh-upgrade custom
git -C /home/dsh/workspace/dsh-upgrade merge --no-ff --no-commit dsh-v0.2.1-alpha.1
```

Choose different names if the example names exist; do not overwrite backups. While the merge remains open, resolve conflicts in the candidate directory, generate required artifacts, inspect the diff, then `git add` the intended files and commit the merge. Use `git merge --abort` to discard that candidate merge. Do not experiment in the primary worktree or active release directory.

For regeneration, create the lockfile from resolved manifests and install first, then run the affected generators:

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

After reviewing bilingual content, run `verify-translation-pairing --write <English-document-path>` only for changed documents; do not hide missing translations with a blanket refresh. If manually choosing the existing rebase script, read it and the remote history before following its backup and conflict recovery procedure. It rewrites history and cannot be used by the hourly task that prohibits force pushes.

Once the candidate is committed and all acceptance checks pass, advance and publish from the primary worktree. Stop on any fast-forward failure, preserve the candidate, and inspect new remote or local commits:

```sh
git fetch origin custom
git switch custom
git merge --ff-only origin/custom
git merge --ff-only candidate/official-upgrade
git push origin custom
```

<a id="validation"></a>
## Validation and deployment

These focused tests, with `pnpm exec vitest run --config vitest.web.config.ts apps/web/tests/pwa-manifest.e2e.ts` after a build, cover the current eight groups of customizations, including server-status and RPC owner suites omitted by the script:

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
  packages/client/ui-sidebar-files packages/client/ui-layout
pnpm run verify-persistence-changes
pnpm run doc-sync
pnpm run lint
pnpm run typecheck
pnpm run build
```

When merging changes to GUI, connection/RPC, or browser assembly, also run `pnpm run test:gui` and `DSH_SNAPSHOT=replay pnpm run test:web`. Native-search protocol changes additionally need real-provider validation under the [testing policy](https://github.com/JoshuaNibaba/deepseek-harness/blob/custom/docs/testing.md), distinguishing keyless unit evidence from real API evidence. The [pre-push skill](https://github.com/JoshuaNibaba/deepseek-harness/blob/custom/.agents/skills/dsh-pre-push-checks/SKILL.md) selects checks from the actual diff; a fixed list does not replace new upstream requirements.

Use a separate `DSH_HOME` and port for deployment smoke, without writing test records to production Sessions. After switching, refresh the existing `http://127.0.0.1:18790` and verify login, opening old Sessions, loading earlier history, stream connections, one search, the status footer, and Schedule. Check CLI/browser artifact version consistency. UI changes require rebuilding the relevant Web artifacts; another Vite server does not update the current GUI.

Before rolling back code, check whether the new version wrote new events or migrated data; the active profile's external status plugin, theme, and Schedule configuration must also resolve on the rollback version. Keep the preceding release directory and data backup. If the independent post-deployment check fails, restore the old link, restart, and verify restored service health.

<a id="maintenance"></a>
## Maintaining this guide

After incorporating an official release, update the baseline, preserved/replaced customizations, actual conflicts and generators, test entrypoints, and deployment configuration. Update the script's `CUSTOM_TESTS` / `GENERATED` when adding a customization. Locate commits using release tags, subjects, and Git queries rather than embedding commit IDs that rebase can change in maintained documentation.

The hourly maintenance instructions currently live at `/home/dsh/.dsh/maintenance/dsh.md`, with state and reports beside them; cloning the repository does not restore these user files. Read this guide and the actual running configuration before each upgrade, then record the latest baseline and acceptance result.
