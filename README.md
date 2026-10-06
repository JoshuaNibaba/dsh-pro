# DSH Remote

在自己的服务器上运行 [DeepSeek Harness](https://github.com/deepseek-ai/DeepSeek-Harness) 的 Web 界面(`dsh web`),然后从 Mac 客户端、浏览器或手机远程使用。

- **Mac 客户端**(`mac/`):原生 macOS 应用(WKWebView,几百 KB)。填网页地址和访问密码即可登录，和浏览器一样;也可以用本机 SSH key 建立隧道。支持应用内自动更新。标题栏颜色随 dsh 的主题(浅色/深色/自定义主题)变化。
- **服务端**(`server/`):一键安装脚本。dsh 只监听服务器的 127.0.0.1;可选地在前面加一个密码登录网关和 HTTPS,让浏览器和手机也能访问,登录后长期保持。
- **命令行**(`cli/dsh-remote`):可选的终端工具。

## 1. 安装服务端

在一台 Debian/Ubuntu 服务器上以 root 运行:

```sh
# 只允许 SSH 访问(Mac 客户端走 SSH 隧道)
curl -fsSL https://raw.githubusercontent.com/JoshuaNibaba/dsh-remote-mac/main/server/install.sh | bash

# 同时开放浏览器 / 手机访问(需要一个指向该服务器的域名)
curl -fsSL https://raw.githubusercontent.com/JoshuaNibaba/dsh-remote-mac/main/server/install.sh | bash -s -- --domain dsh.example.com
```

脚本会安装 Node.js 22 和 `@deepseek-ai/dsh`,创建无特权用户 `dsh`,配置 systemd 服务 `dsh-web`(只监听 `127.0.0.1:18790`)。加上 `--domain` 时还会:

- 安装密码网关 `dsh-gateway`(`127.0.0.1:18800`)和 nginx 站点;
- 用 Let's Encrypt 申请证书(域名需直接解析到服务器且 80 端口可访问);如果域名经 Cloudflare 代理且 SSL 模式为 Full,用 `--tls selfsigned`;
- 生成访问密码并在最后打印出来。

常用选项:`--password 新密码`(修改密码,同时让所有已登录设备退出)、`--workdir 目录`(dsh 的工作目录,默认 `/home/dsh/workspace`)、`--dsh-version 版本`。重复运行是安全的。

脚本会把 root 的 `authorized_keys` 复制给 `dsh` 用户(`--no-copy-root-keys` 关闭),并只授予它重启这两个服务、读取它们日志和运行 `dsh-update` 的 sudo 权限。

升级服务器上的 dsh:`dsh-update [版本]`(root),或以 `dsh` 用户运行 `sudo dsh-update [版本]`;版本只接受 npm 版本号或标签。

运行自己修改过的 dsh:让 `~dsh/.dsh-remote/dsh-bin` 指向自建版本的 `apps/cli/lib/bin.js` 并重启 `dsh-web`,删除该链接即回到 npm 版本。在官方版本之上维护修改的一套做法(分支结构、同步、构建、部署脚本)见 DeepSeek Harness 源码中 `custom` 分支的 `.custom/README.md`。

域名经 Cloudflare 代理时,SSL 模式 Full 和 Flexible 都可以用(nginx 只信任 Cloudflare 官方 IP 段发来的 `X-Forwarded-Proto` 和 `CF-Connecting-IP`)。建议用 Full:Flexible 下 Cloudflare 到服务器这一段是明文 HTTP。

> dsh 能在服务器上执行任意命令。开放网页访问时请使用足够长的密码,并始终使用 HTTPS。网关对密码错误有限流(同一 IP 连续 5 次错误锁定 15 分钟)。

## 2. 安装 Mac 客户端

从 [Releases](https://github.com/JoshuaNibaba/dsh-remote-mac/releases/latest) 下载 `DSH-Remote.zip`,解压后把 `DSH Remote.app` 拖到「应用程序」。应用没有经过 Apple 公证,第一次打开时请右键点击应用并选择「打开」。也可以用命令行安装(不会触发该提示):

```sh
curl -fsSL https://github.com/JoshuaNibaba/dsh-remote-mac/releases/latest/download/DSH-Remote.zip -o /tmp/DSH-Remote.zip
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
| 功能 | 完整(实时消息走 WebSocket,dsh 每 2 秒发心跳，不会被 CDN 的空闲超时断开) | 完整 |
| 上传 | 经 Cloudflare 免费版时单个请求最大 100 MB | 不限 |
| 服务菜单 | 需要另外填 SSH 服务器 | 可用 |

让服务器信任本机的 SSH key(只在使用 SSH 时需要):

```sh
ssh-keygen -t ed25519                      # 本机还没有 key 时
ssh-copy-id -p <SSH 端口> dsh@<服务器>      # 或把 ~/.ssh/id_ed25519.pub 追加到服务器的 /home/dsh/.ssh/authorized_keys
```

应用默认每 6 小时检查一次新版本(菜单 **DSH Remote → 检查更新…** 可手动检查),确认后自动下载、替换并重启。菜单「服务」里可以重新连接、在浏览器中打开、在终端中登录服务器、查看日志、重启服务和退出网页登录。运行日志在 `~/Library/Logs/DSHRemote.log`(token 已隐藏)。

## 3. 浏览器和手机

打开安装时的网页地址,输入访问密码即可。登录状态在该设备上保持一年(使用期间自动续期)。退出登录:访问 `/__dsh/logout`。

## 开发

```sh
./mac/build.sh               # 本地编译并安装到 ~/Applications(只能在 macOS 上)
./mac/build.sh --no-install  # 只打包 mac/build/DSH-Remote.zip
```

每次推送到 `main` 且修改了 `mac/` 时,GitHub Actions 在 macOS 上编译并发布 release `v1.0.<构建号>`,客户端的自动更新读取最新 release。Fork 本仓库后,构建出的客户端会从你自己的仓库检查更新;服务端安装脚本可用环境变量 `DSH_REMOTE_REPO=<owner>/<repo>` 指定下载来源。

命令行工具:`ln -s "$PWD/cli/dsh-remote" ~/.local/bin/dsh-remote`,它读取 Mac 客户端的设置(包括本地端口，默认 18791),`dsh-remote help` 查看用法。只配置了网页地址时,`dsh-remote open` 在浏览器中打开网页地址。
