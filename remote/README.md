# DSH Remote

English | [中文](README.zh.md)

Run the [DeepSeek Harness](https://github.com/deepseek-ai/DeepSeek-Harness) Web UI (`dsh web`) on your own server and use it remotely from a Mac client, a browser, or a phone. DSH Remote is a subproject of [DeepSeek Harness Pro](../README.md) and lives in the `remote/` directory of the DSH Pro repository.

- **Mac client** (`mac/`): a native macOS app (WKWebView, a few hundred KB). Enter the web address and access password to log in, as in a browser, or open a tunnel with this Mac's SSH key. It updates itself, and its title bar follows the dsh theme (light, dark, or a custom theme).
- **Server** (`server/`): a one-step installer. dsh listens only on the server's 127.0.0.1; optionally a password login gateway and HTTPS in front of it let browsers and phones connect, and a login lasts a long time.
- **CLI** (`cli/dsh-remote`): an optional terminal tool.

## 1. Install the server

Run as root on a Debian/Ubuntu server:

```sh
# SSH access only (the Mac client uses an SSH tunnel)
curl -fsSL https://raw.githubusercontent.com/JoshuaNibaba/dsh-pro/main/remote/server/install.sh | bash

# Also allow browsers and phones (needs a domain that points to this server)
curl -fsSL https://raw.githubusercontent.com/JoshuaNibaba/dsh-pro/main/remote/server/install.sh | bash -s -- --domain dsh.example.com
```

In a DSH Pro clone you can run `bash remote/server/install.sh [options]` directly. When run through curl, the script downloads only the files it needs from `remote/server/` on GitHub; the `DSH_REMOTE_REPO=<owner>/<repo>` and `DSH_REMOTE_REF=<branch>` environment variables change the source.

The script installs Node.js 22 and `@deepseek-ai/dsh`, creates the unprivileged user `dsh`, and configures the systemd service `dsh-web` (listening on `127.0.0.1:18790` only). With `--domain` it also:

- installs the password gateway `dsh-gateway` (`127.0.0.1:18800`) and an nginx site;
- requests a Let's Encrypt certificate (the domain must resolve directly to the server and port 80 must be reachable); for a domain proxied by Cloudflare with SSL mode Full, use `--tls selfsigned`;
- generates an access password and prints it at the end.

Common options: `--password NEW` (changes the password and logs out every device), `--workdir DIR` (dsh's working directory, default `/home/dsh/workspace`), `--dsh-version VERSION`. Re-running is safe.

The script copies root's `authorized_keys` to the `dsh` user (`--no-copy-root-keys` turns this off) and grants it sudo only to restart the two services, read their logs, and run `dsh-update`.

To upgrade dsh on the server, run `dsh-update [VERSION]` as root, or `sudo dsh-update [VERSION]` as the `dsh` user; it accepts only an npm version or dist-tag.

To run DSH Pro or another self-built dsh, point `~dsh/.dsh-remote/dsh-bin` at its `apps/cli/lib/bin.js` and restart `dsh-web`; deleting the link returns to the npm release. [README](../README.md#deploy-to-a-server) lists the full commands for building DSH Pro on the server and switching to it.

For a domain proxied by Cloudflare, SSL modes Full and Flexible both work (nginx trusts `X-Forwarded-Proto` and `CF-Connecting-IP` only from Cloudflare's published IP ranges). Prefer Full: with Flexible, the hop from Cloudflare to the server is plain HTTP.

> dsh can run any command on the server. When you open web access, use a long password and always use HTTPS. The gateway rate-limits wrong passwords (5 consecutive failures from one IP lock it out for 15 minutes).

When a phone browser adds the page to the home screen, its requests for the icons and manifest carry no login cookie, so the gateway serves these public dsh static files without a login: `/manifest.webmanifest`, `/favicon.svg`, `/favicon-dark.svg`, and `/icons/*.png` (GET/HEAD only). Every other request still needs a login.

## 2. Install the Mac client

Download `DSH-Remote.zip` from the DSH Pro [release `dsh-remote`](https://github.com/JoshuaNibaba/dsh-pro/releases/tag/dsh-remote), unzip it, and drag `DSH Remote.app` into Applications. The app is not notarized by Apple, so the first time, right-click it and choose Open. Installing from the command line avoids that prompt:

```sh
curl -fsSL https://github.com/JoshuaNibaba/dsh-pro/releases/download/dsh-remote/DSH-Remote.zip -o /tmp/DSH-Remote.zip
ditto -x -k /tmp/DSH-Remote.zip ~/Applications
```

The first launch opens the settings window (later: menu **DSH Remote → 设置…**, ⌘,):

| Setting | Meaning |
|---|---|
| 网页地址 (web address) | The address for `--domain` at install time, for example `https://dsh.example.com` |
| 访问密码 (access password) | Enter it on first login or after a password change. It is used for that login only and not stored; the login lasts one year |
| SSH 服务器 (SSH server) | Optional: the server IP (or an alias from `~/.ssh/config`). Use the IP when the domain is proxied by Cloudflare |
| SSH 端口 / 用户 (SSH port / user) | Empty means 22; the recommended user is `dsh` |
| 优先使用 SSH 隧道 (prefer SSH tunnel) | Off by default |

**Entering only the web address and access password is recommended**: it needs no SSH key and logs in the same way as browsers and phones. With an SSH server filled in, 查看日志 (view logs), 重启服务 (restart service), and 在终端中登录服务器 (log in from Terminal) use SSH, and the client falls back to an SSH tunnel when the web address does not open. Prefer SSH tunnel reverses that, keeping the web address as the fallback. Fill in at least one of the web address and the SSH server.

Both connection modes follow the DSH appearance setting. With 跟随系统 (follow system), the page and window follow the macOS appearance; with light or dark, the window uses that fixed appearance.

How the two modes differ:

| | Web address + password | SSH tunnel |
|---|---|---|
| Setup | Password only | This Mac's SSH key must be trusted by the server |
| Latency | One more hop through the CDN, nginx, and gateway; the gateway itself adds under 1 ms, and the CDN's effect depends on the route to the nearest edge | Direct to the server |
| Features | Complete (live messages use a WebSocket; `server/web.patch.yml` makes dsh send a heartbeat every 15 seconds, so CDN idle timeouts do not cut it) | Complete |
| Uploads | At most 100 MB per request through Cloudflare's free plan | Unlimited |
| Service menu | Needs the SSH server as well | Available |

Make the server trust this Mac's SSH key (needed only for SSH):

```sh
ssh-keygen -t ed25519                      # when this Mac has no key yet
ssh-copy-id -p <ssh-port> dsh@<server>     # or append ~/.ssh/id_ed25519.pub to /home/dsh/.ssh/authorized_keys on the server
```

The app checks for a new version every 6 hours (menu **DSH Remote → 检查更新…** checks now); after you confirm, it downloads, replaces, and relaunches itself. The 服务 (Service) menu reconnects, opens the page in a browser, logs in to the server from Terminal, shows logs, restarts the service, and logs out of the web login. The app log is `~/Library/Logs/DSHRemote.log` (tokens hidden).

The Mac client's SSH tunnel recovers by itself without `autossh`: it sends an SSH keepalive every 10 seconds and disconnects after 3 unanswered ones, then retries after 1, 2, 4, and 8 seconds and every 10 seconds after that. An open dsh page stays on screen while disconnected, showing the page's own reconnecting notice; once the tunnel is back on the same local port, the client tells the page to reconnect at once, without reloading the page or reading the access address. Only after 60 seconds without recovery does a status page with the SSH error and a countdown replace it. Loading the page first uses the dsh login cookie stored by WebKit (valid for 30 days and across dsh restarts); only when the service answers 401 does the client read the access address over SSH for a new cookie. Reading the access address opens one SSH connection and reuses its authentication through the tunnel's own control socket, with no second handshake. Every new tunnel uses a new private socket that is deleted when it stops, so a stale connection is never reused. When macOS reports that the network came back or the Mac woke from sleep, the client cancels pending requests and rebuilds the tunnel even if the old SSH process is still running; reconnecting manually and saving settings also cancel old requests and reload the page. A single address-reading command waits at most 10 seconds and waiting for the service to publish its address at most 15 seconds in total; other service-menu SSH commands wait at most 30 seconds. Switching to the web connection or quitting the app cancels retries. If the first SSH connection fails and a fallback web address is configured, the client still switches to it. This recovery belongs to the Mac app and does not apply to tunnels the CLI creates on its own.

Troubleshooting a slow connection: menu **服务 → 打开客户端日志** (open client log) shows the local connection records. The log records the time for resolving the server IP, the TCP connection, the SSH server version reply, authentication, tunnel readiness, reading the access address, the page response, and the page load; `tunnel exited:` lines record the reason SSH reported for each disconnect, for example `Timeout, server <server> not responding.` for a keepalive timeout and `Connection reset by peer` for a connection reset by the network. The UI also distinguishes setting up the SSH tunnel, reading the server's access address, and loading the dsh page; the last step mostly depends on downloading the dsh frontend, about 6 MB on the first load after a dsh frontend update. Disconnect records also give ssh's exit code or the signal that ended it. Ping reflects only the ICMP round trip; when it looks fine, the SSH handshake, key authentication, or remote shell startup may still be waiting. Standalone shell prompt lines in the access address output are ignored, and tokens in the log are hidden.

## 3. Browsers and phones

Open the web address from the installation and enter the access password. The login lasts one year on that device (renewed while in use). To log out, visit `/__dsh/logout`.

## Development

Run these commands from the root of the DSH Pro repository:

```sh
./remote/mac/build.sh               # build and install into ~/Applications (macOS only)
./remote/mac/build.sh --no-install  # only package remote/mac/build/DSH-Remote.zip
```

On every push to `main` that changes `remote/mac/`, GitHub Actions ([`.github/workflows/dsh-remote-mac.yml`](../.github/workflows/dsh-remote-mac.yml)) builds on macOS and updates the fixed release `dsh-remote`: it replaces `DSH-Remote.zip` and `DSH-Remote.version`, which records the build number, and moves the tag to the built commit. Each build replaces the assets in that one release, so DSH Pro's own `dsh-pro-v*` releases stay separate. The client's updater reads `DSH-Remote.version` and offers an update when the build number exceeds its own. In a fork, the built client checks for updates in your own repository.

Besides retry and process-lifecycle tests, macOS CI starts a temporary loopback-only `sshd` with temporary keys to verify that the first connection and a reconnection each authenticate once, and covers the overall command timeout, cancellation while running, both output streams exceeding the pipe capacity, and parsing the login address next to a shell prompt.

CLI: `ln -s "$PWD/remote/cli/dsh-remote" ~/.local/bin/dsh-remote`. It reads the Mac client's settings (including the local port, default 18791); `dsh-remote help` shows usage. With only a web address configured, `dsh-remote open` opens it in the browser.
