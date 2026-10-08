# DSH Pro 维护与部署工具

`deploy` 是一个孤立分支(与产品源码没有共同历史),只放维护这个 fork 和在本机部署所用的工具与手册，不进入对外发布的 `custom` 分支。它作为同一仓库的独立工作树检出在 `/home/dsh/workspace/dsh-deploy`,`~/.local/bin/dsh-custom` 链接到这里的脚本。

升级前先读[定制改动与合并手册](CHANGES.zh.md)：其中列出各项定制的源码位置、必须保留的行为、实际冲突、生成器、验收命令，以及源码与运行部署的区别。

## 仓库与分支

| | |
|---|---|
| `upstream` | 官方仓库 deepseek-ai/deepseek-harness(只拉取，push 已禁用) |
| `origin` | 公开 fork JoshuaNibaba/dsh-pro |
| `master` | 官方 master 的镜像，不在上面提交 |
| `custom` | **对外发布的分支**(fork 默认分支)= 官方发布标签(`dsh-v*`)+ 本 fork 的提交。只用 merge 升级，**不改写历史、不强推** |
| `feat/*` | 从 `upstream/master` 拉出的通用改进，每个分支一项改动，留待上游开放外部 PR 时提交 |
| `deploy` | 本分支：维护脚本与手册 |
| `custom-v<官方版本>.<n>` | 对外发布的标签，对应一个 GitHub Release |

旧的私有仓库 JoshuaNibaba/dsh-custom 已归档；改写前的历史保存在本地分支 `backup/custom-pre-public`。

已开启 `git rerere`:同一处冲突解决过一次，以后再遇到会自动套用。

### 待贡献上游的分支

2026-10-08 基于当时的 `upstream/master`(`5badb15009`)创建，均已推送到 origin。上游开放外部 PR 前，定期 `git rebase upstream/master` 保持可合并(这些分支只用于提交 PR,可以强推)。

| 分支 | 内容 | 对应 custom 中的改动 |
|---|---|---|
| `feat/stream-websocket-compression` | Remote 流 WebSocket permessage-deflate,gateway `websocketCompression` 开关 | 流 WebSocket 压缩 |
| `feat/immutable-web-asset-cache` | frontend-static `immutablePrefixes`,带内容哈希的 `assets/` 长期缓存 | Web 静态资源长期缓存 |
| `feat/sidebar-file-download` | 右侧 Sidebar 文件树下载文件 | 文件树下载 |
| `fix/rpc-handler-owner` | `connection.rpc` 注册归属调用方 fiber(状态栏依赖它) | 状态栏中的 RPC owner 修复 |
| `feat/server-status-footer` | 基于 `fix/rpc-handler-owner`,服务器资源与连接状态栏 | 服务器状态栏 |
| `feat/phone-layout` | 窄屏侧栏抽屉与 PNG 启动图标 | 手机布局与桌面图标 |

模型原生搜索与 Session 历史窗口属于本 fork 的取舍，只留在 `custom`。

## 日常用法

```sh
dsh-custom status        # 基线、官方最新版本、自己的提交、服务正在运行的版本

# 修改代码(源码工作树 /home/dsh/workspace/dsh,分支 custom)
git switch custom
# …编辑…
git commit -am "custom: 简述改动和原因"      # 每个改动单独一个提交
git push                                      # 正常推送，从不强推
dsh-custom build                              # 构建
dsh-custom try                                # 用独立数据目录在 18795 端口试运行
dsh-custom deploy                             # 让 dsh-web 服务改用这个版本

# 官方发布新版本后
dsh-custom sync          # merge npm latest 对应的标签;或 sync alpha / sync dsh-v0.2.1
dsh-custom deploy
dsh-custom release       # 打 custom-v* 标签并发布 GitHub Release
```

`sync` 依次做：备份分支 → `git merge --no-ff <官方标签>` → 重新生成锁文件和生成文件(有变化时单独提交 `custom: regenerate generated files`)→ 跑本地修改的测试(`CUSTOM_TESTS`)→ 构建 → 正常 `git push`。官方版本只前进不回退：目标标签不是当前基线的后续版本时拒绝合并。

冲突处理：脚本里 `GENERATED` 列出的生成文件冲突时自动采用官方版本(merge 中的 theirs),之后重新生成。其他文件冲突时会停下并列出文件：手动合并、`git add`,再运行 `dsh-custom resume` 提交合并并完成剩下的步骤;`git merge --abort` 可以放弃，同步前的分支另存为 `backup/custom-<时间>`。新增本地功能时，把它的测试加进 `CUSTOM_TESTS`,新增的生成文件加进 `GENERATED`。

`deploy` 完成后会打印回滚命令(把链接指回上一个发布目录并重启)。服务回到官方 npm 版本:`dsh-custom undeploy`。

## 改动放在哪里

1. **改配置**:`~/.dsh/profiles/web/cordis.patch.yml`(用户补丁层),或 dsh-remote 的 `/opt/dsh-remote/web.patch.yml`。只影响本机。
2. **写插件**:能用插件实现的功能写成独立 npm 包/仓库，加 GitHub topic `dsh-plugin`。官方更新不会与它冲突，官方用户也能直接使用。
3. **改源码，`custom` 分支**:插件做不到的修改。同时在 `custom` 的 `FORK.md` / `FORK.zh.md` 里登记这项改动。
4. **通用改进**:另外从 `upstream/master` 拉 `feat/<名称>` 分支，只包含这一项改动、按上游 AGENTS.md 的要求补齐测试和文档，推到 origin。上游目前[不接受外部 PR](https://github.com/deepseek-ai/deepseek-harness/blob/master/CONTRIBUTING.md),可先在官方 GitHub Discussions 提出并附上分支链接；上游开放后再从这些分支提 PR。

## 让合并更顺利

- 每个改动一个提交，信息里写清原因；不需要的改动用 `git revert`(公开分支不删提交)。
- 改动尽量小、集中，少做格式化和重命名这类大面积修改。
- 新增代码优先放在新文件里，在官方文件中只留最少的接入点。
- 按明确发布标签更新，不直接跟随 `master` 普通提交。

## 服务如何运行自定义版本

dsh-remote 的 `run-web.sh` 在 `~/.dsh-remote/dsh-bin` 存在时，用它指向的 `apps/cli/lib/bin.js` 代替 npm 安装的 `dsh`。`deploy` 在 `~/.dsh-custom/release-a` / `release-b` 两个工作树之间轮换：在空闲的那个里构建、试启动成功后才切换链接并重启服务，正在运行的版本不会被原地重建。
