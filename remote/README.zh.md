# DSH Remote

[English](README.md) | 中文

在自己的服务器上运行 [DeepSeek Harness](https://github.com/deepseek-ai/DeepSeek-Harness) 的 Web 界面(`dsh web`),然后从 Mac 客户端、浏览器或手机远程使用。DSH Remote 是 [DeepSeek Harness Pro](../README.zh.md) 的子项目，位于 DSH Pro 仓库的 `remote/` 目录。

- **Mac 客户端**(`mac/`):原生 macOS 应用(WKWebView,几百 KB)。填网页地址和访问密码即可登录，和浏览器一样;也可以用本机 SSH key 建立隧道。支持应用内自动更新。标题栏颜色随 dsh 的主题(浅色/深色/自定义主题)变化。
- **服务端**(`server/`):一键安装脚本。dsh 只监听服务器的 127.0.0.1;可选地在前面加一个密码登录网关和 HTTPS,让浏览器和手机也能访问,登录后长期保持。
- **命令行**(`cli/dsh-remote`):可选的终端工具。

## 1. 安装服务端

在一台 Debian/Ubuntu 服务器上以 root 运行:

```sh
# SSH access only (the Mac client uses an SSH tunnel)
curl -fsSL https://raw.githubusercontent.com/JoshuaNibaba/dsh-pro/main/remote/server/install.sh | bash

# Also allow browsers and phones (needs a domain that points to this server)
curl -fsSL https://raw.githubusercontent.com/JoshuaNibaba/dsh-pro/main/remote/server/install.sh | bash -s -- --domain dsh.example.com
```

已经克隆了 DSH Pro 时，也可以直接运行 `bash remote/server/install.sh [选项]`。通过 curl 运行时，脚本只从 GitHub 下载 `remote/server/` 下需要的几个文件；环境变量 `DSH_REMOTE_REPO=<owner>/<repo>` 和 `DSH_REMOTE_REF=<分支>` 可改变下载来源。

脚本会复用满足 `^22.19 || >=24` 的 Node.js，必要时安装 Node.js 22，然后安装 `@deepseek-ai/dsh`、创建无特权用户 `dsh`，并配置 systemd 服务 `dsh-web`（只监听 `127.0.0.1:18790`）。服务使用选定的 Node 安装；`dsh` 必须能访问其可执行文件及父目录。加上 `--domain` 时还会：

- 安装密码网关 `dsh-gateway`(`127.0.0.1:18800`)和 nginx 站点;
- 用 Let's Encrypt 申请证书(域名需直接解析到服务器且 80 端口可访问);如果域名经 Cloudflare 代理且 SSL 模式为 Full,用 `--tls selfsigned`;
- 生成访问密码并在最后打印出来。

常用选项:`--password 新密码`(修改密码,同时让所有已登录设备退出)、`--workdir 目录`(dsh 的工作目录,默认 `/home/dsh/workspace`)、`--dsh-version 版本`。重复运行是安全的。

脚本会把 root 的 `authorized_keys` 复制给 `dsh` 用户(`--no-copy-root-keys` 关闭),并只授予它重启这两个服务、读取它们日志和运行 `dsh-update` 的 sudo 权限。

升级服务器上的 dsh：以 root 运行 `dsh-update [版本]`，或以 `dsh` 用户运行 `sudo dsh-update [版本]`；版本只接受 npm 版本号或标签。原生构建失败时会打印诊断、以非零状态退出，并阻止服务重启。npm 安装不会回滚；请修复报出的构建错误并重新运行命令，再重启服务。安装器只有在 `dsh-web` 发布新的 URL，且使用 `--domain` 时网关通过回环健康检查后，才报告就绪。失败时查看 `journalctl -u dsh-web` 或 `journalctl -u dsh-gateway`。

运行 DSH Pro 或其他自建的 dsh:让 `~dsh/.dsh-remote/dsh-bin` 指向自建版本的 `apps/cli/lib/bin.js` 并重启 `dsh-web`,删除该链接即回到 npm 版本。在服务器上构建并切换到 DSH Pro 的完整命令见 [README](../README.zh.md#deploy-to-a-server)。

域名经 Cloudflare 代理时,SSL 模式 Full 和 Flexible 都可以用(nginx 只信任 Cloudflare 官方 IP 段发来的 `X-Forwarded-Proto` 和 `CF-Connecting-IP`)。建议用 Full:Flexible 下 Cloudflare 到服务器这一段是明文 HTTP。

> dsh 能在服务器上执行任意命令。开放网页访问时请使用足够长的密码,并始终使用 HTTPS。网关对密码错误有限流(同一 IP 连续 5 次错误锁定 15 分钟)。

手机浏览器“添加到主屏幕”时,系统取图标和 manifest 的请求不带登录 cookie,所以网关不需登录就放行 dsh 的这几个公开静态文件:`/manifest.webmanifest`、`/favicon.svg`、`/favicon-dark.svg` 和 `/icons/*.png`(仅 GET/HEAD)。其他请求仍需登录。

<a id="remote-host-settings"></a>

### 授权远程 Host 设置

`--trusted-host` 允许该域名的 API 请求，但不会授予页面访问 Host 设置（如模型提供商目录）的能力。要在 DSH Pro 中授予此能力，请在首次启动后以 `dsh` 用户编辑 `/home/dsh/.dsh/profiles/web/cordis.patch.yml`。添加或更新下面的 `connection` 行，把 `dsh.example.com:443` 换成你明确授权的 HTTPS 域名和端口。保留其他行以及已有的 `connection.config` 字段；补丁会替换该行的整个 `config`，因此需保留示例中的 `trustedHosts`。

```yaml
- id: connection
  name: '@deepseek-ai/dsh-client-connection'
  config:
    trustedHosts: !!js ctx.webRuntime.trustedHosts
    privilegedHosts:
      - dsh.example.com:443
```

只列出受网页登录保护的域名。不带端口的主机名会授权所有端口；显式写 `:443` 可将授权限定到该端口。不要把全部 `trustedHosts` 复制到 `privilegedHosts`。运行 `sudo systemctl restart dsh-web`，重新加载页面，然后打开设置，验证模型提供商目录能加载。[远程补丁](server/web.patch.yml) 只配置 WebSocket 心跳，不授予 Host 设置访问能力。官方 npm 版本必须支持 `privilegedHosts` 才能使用此配置；本 fork 的实现请使用 [DSH Pro 部署](../README.zh.md#deploy-to-a-server)。

## 2. 安装 Mac 客户端

从 DSH Pro 的 [Release `dsh-remote`](https://github.com/JoshuaNibaba/dsh-pro/releases/tag/dsh-remote) 下载 `DSH-Remote.zip`,解压后把 `DSH Remote.app` 拖到「应用程序」。应用没有经过 Apple 公证,第一次打开时请右键点击应用并选择「打开」。也可以用命令行安装(不会触发该提示):

```sh
curl -fsSL https://github.com/JoshuaNibaba/dsh-pro/releases/download/dsh-remote/DSH-Remote.zip -o /tmp/DSH-Remote.zip
ditto -x -k /tmp/DSH-Remote.zip ~/Applications
```

首次启动会打开设置窗口(之后在菜单 **DSH Remote → 设置…**,⌘,):

| 项目 | 说明 |
|---|---|
| 网页地址 | 安装时 `--domain` 对应的地址,例如 `https://dsh.example.com` |
| 访问密码 | 首次登录或密码修改后填写。只用于这一次登录，不会保存;登录状态保持一年 |
| SSH 服务器 | 可选,服务器 IP(也可以是 `~/.ssh/config` 里的别名)。域名经 Cloudflare 代理时要填 IP |
| SSH 端口 / 用户 | 留空为 22;用户建议 `dsh` |
| 优先使用 SSH 隧道 | 默认关闭 |

**推荐只填网页地址和访问密码**:不需要配置 SSH key,和浏览器、手机的登录方式一样。填了 SSH 服务器时,「查看日志」「重启服务」「在终端中登录服务器」使用 SSH;网页地址打不开时也会自动改用 SSH 隧道。勾选「优先使用 SSH 隧道」则反过来，网页地址作为备用。网页地址和 SSH 服务器至少填一项。

两种连接方式都使用 DSH 的外观设置。选择「跟随系统」时，页面和窗口跟随 macOS 的外观；选择浅色或深色时，窗口使用对应的固定外观。

两种方式的差别:

| | 网页地址 + 密码 | SSH 隧道 |
|---|---|---|
| 配置 | 只要密码 | 需要本机 SSH key 被服务器信任 |
| 延迟 | 多经过一层 CDN / nginx / 网关；网关本身不到 1 ms,CDN 的影响取决于本机到最近节点的线路 | 直连服务器 |
| 功能 | Host 设置需要[明确授权](#remote-host-settings)；实时消息走 WebSocket，`server/web.patch.yml` 配置 15 秒心跳 | 完整 |
| 上传 | 经 Cloudflare 免费版时单个请求最大 100 MB | 不限 |
| 服务菜单 | 需要另外填 SSH 服务器 | 可用 |

让服务器信任本机的 SSH key(只在使用 SSH 时需要):

```sh
ssh-keygen -t ed25519                      # when this Mac has no key yet
ssh-copy-id -p <ssh-port> dsh@<server>     # or append ~/.ssh/id_ed25519.pub to /home/dsh/.ssh/authorized_keys on the server
```

应用默认每 6 小时检查一次新版本(菜单 **DSH Remote → 检查更新…** 可手动检查),确认后自动下载、替换并重启。菜单「服务」里可以重新连接、在浏览器中打开、在终端中登录服务器、查看日志、重启服务和退出网页登录。运行日志在 `~/Library/Logs/DSHRemote.log`(token 已隐藏)。

Mac 客户端的 SSH 隧道会自动恢复,不需要安装 `autossh`:每 10 秒发送一次 SSH 心跳,连续 3 次无响应后断开;断开后按 1、2、4、8 秒的间隔重试,之后每 10 秒重试一次。已打开的 dsh 页面在断线期间保持显示,由页面自带的「正在重连」提示表示状态;隧道在原本地端口恢复后,客户端通知页面立即重连,不重新加载页面、也不读取访问地址。断线持续 60 秒仍未恢复时,才换成显示 SSH 错误和倒计时的状态页。加载页面时先使用 WebKit 保存的 dsh 登录 cookie(有效期 30 天,dsh 重启后仍有效);只有服务返回 401 时,才通过 SSH 读取访问地址换取新 cookie。读取访问地址时只建立一次 SSH 连接,通过该隧道的专属控制套接字复用认证,不会再进行第二次握手。每次新隧道使用新的私有套接字,停止时删除,避免复用失效的旧连接。macOS 报告网络恢复或从睡眠唤醒时,客户端会取消未完成的请求并重建旧隧道,即使旧 SSH 进程仍在运行;手动重新连接和保存设置也会取消旧请求,并重新加载页面。地址读取单条命令最多等待 10 秒,等待服务发布地址的总时限为 15 秒;其他服务菜单的 SSH 命令最多等待 30 秒。切换到网页连接或退出应用会取消重试。首次 SSH 连接失败且配置了备用网页地址时,仍会改用网页连接。此自动恢复由 Mac 应用管理,不适用于命令行工具单独创建的隧道。

排查连接慢:菜单 **服务 → 打开客户端日志** 可查看本机连接记录。日志分别记录连接服务器 IP、TCP 建连、SSH 服务端版本响应、认证完成、隧道就绪、读取访问地址、页面响应和页面加载完成的耗时;`tunnel exited:` 行记录每次断线时 SSH 报告的原因,例如 `Timeout, server <服务器> not responding.` 表示心跳超时,`Connection reset by peer` 表示连接被网络中途重置。界面也会区分「正在建立 SSH 隧道」「正在读取服务器访问地址」和「正在加载 dsh 页面」;最后一步的耗时主要取决于下载 dsh 前端代码,dsh 更新前端后的第一次加载约需下载 6 MB。断线记录同时给出 ssh 的退出码或结束它的信号。Ping 只反映 ICMP 往返时间;它正常时,SSH 握手、密钥认证或远程 shell 启动仍可能等待。访问地址输出中的独立 shell 提示行会被忽略,日志中的 token 会隐藏。

## 3. 浏览器和手机

打开安装时的网页地址,输入访问密码即可。登录状态在该设备上保持一年(使用期间自动续期)。退出登录:访问 `/__dsh/logout`。

## 开发

以下命令在 DSH Pro 仓库根目录运行:

```sh
./remote/mac/build.sh               # build and install into ~/Applications (macOS only)
./remote/mac/build.sh --no-install  # only package remote/mac/build/DSH-Remote.zip
node --test remote/server/tests/*.test.mjs  # isolated installer/updater mocks (Linux)
```

每次推送到 `main` 且修改了 `remote/mac/` 时,GitHub Actions([`.github/workflows/dsh-remote-mac.yml`](../.github/workflows/dsh-remote-mac.yml))在 macOS 上编译，并更新固定的 release `dsh-remote`:替换其中的 `DSH-Remote.zip` 和记录构建号的 `DSH-Remote.version`,标签移到本次提交。每次构建都替换这一个 release 中的文件，与 DSH Pro 自身的 `dsh-pro-v*` 发布互不影响。客户端的自动更新读取 `DSH-Remote.version`,构建号大于本机版本时提示更新。Fork 仓库后，构建出的客户端会从你自己的仓库检查更新。

macOS CI 除了重试与进程生命周期测试,还启动仅监听回环地址的临时 `sshd`,使用临时密钥验证首次连接和重连各只认证一次,并覆盖命令总超时、执行中取消、双输出流大于管道容量及带 shell 提示的登录地址解析。

命令行工具:`ln -s "$PWD/remote/cli/dsh-remote" ~/.local/bin/dsh-remote`,它读取 Mac 客户端的设置(包括本地端口，默认 18791),`dsh-remote help` 查看用法。只配置了网页地址时,`dsh-remote open` 在浏览器中打开网页地址。
