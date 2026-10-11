# DSH Remote for Windows

[English](README.md) | 中文

## 概述

使用 WinForms 和 Microsoft Edge WebView2 的原生 Windows 远程客户端。通过网页地址与网关密码，或 OpenSSH 密钥隧道连接 DSH 服务器。DSH 和工作区在服务器上运行。客户端保留登录 cookie、自动恢复 SSH 连接、跟随页面主题，并提供服务器日志、重启操作和更新提醒。

## 目录

- [安装与连接](#install-and-connect)
- [SSH 与服务操作](#ssh-and-service-controls)
- [设置、更新与排障](#settings-updates-and-troubleshooting)
- [开发](#development)
- [开发说明](#dev-note)

<a id="install-and-connect"></a>

## 安装与连接

1. 按[服务端安装说明](../README.zh.md)准备服务器。
2. 从 [Windows 发布页](https://github.com/JoshuaNibaba/dsh-pro/releases/tag/dsh-remote-windows)下载 `DSH-Remote-Windows-x64.zip`。支持 Windows 10/11 x64；不提供 ARM64 或 32 位安装包。ZIP 已包含 .NET，无需另行安装 .NET。此社区版本未签名，Windows 可能显示未知发布者提示。发布页附有 SHA-256 校验文件。
3. 完整解压 ZIP，运行解压目录中的 `DSH Remote.exe`，保留旁边的 DLL 文件。若应用提示缺少运行时，请安装 [Microsoft Edge WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/)，然后重新启动客户端。
4. 在连接设置窗口填写 HTTPS 网页地址。可以在窗口内填写本次登录的访问密码，也可以留空后在页面上登录。客户端不保存密码，通过网关 cookie 保持登录。之后通过 **DSH Remote → 连接设置…** 修改连接。

界面语言为中文。文件选择和下载使用 WebView2 的 Windows 对话框。其他站点的链接在默认浏览器中打开。请填写最终 HTTPS 地址；跳转到其他来源的地址会交给外部浏览器。通过域名访问 Host 设置需要[在服务器上明确授权](../README.zh.md#remote-host-settings)。

<a id="ssh-and-service-controls"></a>

## SSH 与服务操作

SSH 为可选功能。在 Windows 可选功能中启用 **OpenSSH 客户端**，并配置服务器信任的密钥。加密密钥需要运行 SSH agent 并载入密钥；客户端不能提示输入密钥口令或 SSH 密码。请先在终端中验证交互式连接：

```powershell
ssh dsh@your-server
```

在连接设置中填写服务器 IP、主机名或 `%USERPROFILE%\.ssh\config` 中的别名，并按需填写用户。端口 `0` 表示使用 SSH 配置或默认的 22。隧道默认从本地 `127.0.0.1:18791` 转发到服务器的 `127.0.0.1:18790`；本地端口被其他进程占用时请更改端口。首次遇到的主机密钥会被接受并保存，已变更的密钥会被拒绝。遇到主机密钥错误时，核实服务器身份后再在 OpenSSH 中处理。

默认优先使用网页地址；首次连接失败且配置了 SSH 时会尝试隧道。勾选 **优先使用 SSH 隧道** 可反转顺序。SSH 先尝试已保存的 DSH cookie，收到 HTTP 401 时再通过单独的 SSH 命令读取服务器登录地址。命令执行和隧道启动各有 30 秒总时限。隧道每 10 秒发送心跳，连续三次无响应后断开。已建立的隧道断开后，按 1、2、4、8 秒重试，之后每 10 秒重试；页面保持打开以保留草稿。修改设置、手动重新连接或退出应用会取消旧连接，并等待其 SSH 进程退出。

**服务**菜单可读取配置的 systemd 服务日志、确认后重启服务、打开 SSH 终端或查看客户端诊断。即使通过 HTTPS 浏览，这些服务器操作也需要 SSH。默认服务为 `dsh-web`，权限由服务端安装脚本配置。交互式终端是独立窗口，关闭客户端不会关闭它。**退出网页登录**仅在网关连接下可用；SSH 通过密钥认证，不使用该网关退出操作。

<a id="settings-updates-and-troubleshooting"></a>

## 设置、更新与排障

| 项目 | 位置或行为 |
|---|---|
| 连接设置 | `%LOCALAPPDATA%\DSHRemote\settings.json`；不保存密码 |
| Cookie 与浏览器存储 | `%LOCALAPPDATA%\DSHRemote\WebView2`；同一 Windows 用户的各版本共用 |
| 客户端诊断 | `%LOCALAPPDATA%\DSHRemote\client.log`；隐藏登录 token，超过 2 MiB 时重置日志 |
| 更新 | 启用后在启动时及每六小时检查；**检查更新…**可手动检查，并提供 Windows 发布页入口 |
| 升级 | 退出应用，将新版 ZIP 解压到新目录后启动；设置与 cookie 保留在 AppData 中 |
| 移除 | 删除解压后的应用目录；如需同时清除登录状态和设置，退出后删除 AppData 中的 DSHRemote 目录 |

连接失败会显示在状态栏。按提示检查网页地址、WebView2 安装、OpenSSH 密钥或 agent、本地端口及服务器服务。修复后使用 **连接 → 重新连接**。同一 Windows 登录会话只运行一个客户端实例。客户端需要远程服务器和已安装的 WebView2 Runtime；不在本机安装或运行 DSH，不自动替换自身程序，也不提供 Mac 的命令行工具。

<a id="development"></a>

## 开发

在仓库根目录使用 .NET 8 SDK 运行核心测试。打包需要 Windows x64 和 PowerShell 7：

```powershell
dotnet run --project remote/windows/Tests/DshRemote.Tests.csproj -c Release
pwsh -File remote/windows/build.ps1 -BuildNumber 1 -Repository JoshuaNibaba/dsh-pro
```

构建会在 `remote/build/` 下创建独立目录，包含便携 ZIP、SHA-256 校验文件和 `DSH-Remote-Windows.version`。包内附有 .NET 运行时、WebView2 加载器、说明及依赖许可。`DSH Remote.exe --self-check` 可在不打开浏览器的情况下检查发布依赖。[Windows 工作流](../../.github/workflows/dsh-remote-windows.yml)在 Windows 上运行核心测试、打包并检查程序，然后把主线构建上传到独立的滚动发布 `dsh-remote-windows`。Mac 资产和 DSH Pro 的版本发布保持独立。Fork 构建使用自身仓库检查更新。

[核心测试](Tests/Program.cs)通过独立的测试进程覆盖 URL 与设置校验、token 解析、并行输出的有界读取、取消、超时、子进程清理和隧道端口归属。在 Linux 和 Windows 上运行，不需要真实 DSH 服务器或浏览器自动化。登录、文件对话框、主题变化和休眠恢复的原生交互仍需在发布验证中手动检查。

<a id="dev-note"></a>

## 开发说明

无。
