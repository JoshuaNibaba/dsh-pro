# DSH Remote for Windows

English | [中文](README.zh.md)

## Summary

A native Windows client for a DSH server, using WinForms and Microsoft Edge WebView2. Connect with a web address and gateway password, or with an OpenSSH key tunnel. DSH and its workspaces run on the server. The client preserves login cookies, reconnects SSH, follows the page theme, and offers server logs, restart controls and update notifications.

## Table of Contents

- [Install and connect](#install-and-connect)
- [SSH and service controls](#ssh-and-service-controls)
- [Settings, updates and troubleshooting](#settings-updates-and-troubleshooting)
- [Development](#development)
- [Dev Note](#dev-note)

<a id="install-and-connect"></a>

## Install and connect

1. Prepare a server using the [server installation guide](../README.md).
2. Download `DSH-Remote-Windows-x64.zip` from [the Windows release](https://github.com/JoshuaNibaba/dsh-pro/releases/tag/dsh-remote-windows). Windows 10/11 x64 is supported; ARM64 and 32-bit packages are not provided. The ZIP includes .NET, so no .NET installation is needed. This community build is unsigned; Windows may show an unknown-publisher warning. The release includes a SHA-256 checksum.
3. Extract the whole ZIP and run `DSH Remote.exe` inside the extracted folder. Keep the adjacent DLLs. Install [Microsoft Edge WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/) if the app reports it missing, then restart the app.
4. Enter your HTTPS web address in the connection dialog. Enter the access password there for this login, or leave it empty and log in on the page. The client does not save passwords; the gateway cookie preserves the login. Use **DSH Remote → 连接设置…** to change the connection later.

The interface is in Chinese. File selection and downloads use WebView2's normal Windows dialogs. Links to other sites open in the default browser. Configure the final HTTPS address: redirects to another origin are opened externally. Domain access to Host settings requires [explicit authorization on the server](../README.md#remote-host-settings).

<a id="ssh-and-service-controls"></a>

## SSH and service controls

SSH is optional. Enable **OpenSSH Client** in Windows Optional Features, and configure a key accepted by the server. Encrypted keys require a running SSH agent with the key loaded; the app cannot prompt for key passphrases or SSH passwords. Test an interactive connection first:

```powershell
ssh dsh@your-server
```

In connection settings, fill in the server IP, hostname or an alias from `%USERPROFILE%\.ssh\config`, and optionally the user. Port `0` uses SSH configuration or port 22. Forwarding defaults to local `127.0.0.1:18791` and server `127.0.0.1:18790`; change the local port if another process owns it. New host keys are accepted and remembered; changed keys are rejected. Resolve host-key errors in OpenSSH after verifying the server identity.

Web access is preferred by default; initial connection failure falls back to SSH when configured. **优先使用 SSH 隧道** reverses that order. SSH first tries the saved DSH cookie; an HTTP 401 triggers a separate SSH command to read the server login URL. Command execution and tunnel startup each have a 30-second deadline. The tunnel sends a heartbeat every 10 seconds and disconnects after three unanswered probes. After an established tunnel drops, retries wait 1, 2, 4, 8, then 10 seconds; the page stays open so drafts survive. Changing settings, reconnecting manually or quitting cancels the previous connection and waits for its SSH process to exit.

The **服务** menu reads the configured systemd service logs, restarts it after confirmation, opens an SSH terminal, or opens local diagnostics. These server controls need SSH even when browsing over HTTPS. The default service is `dsh-web`, with permissions supplied by the server installer. Interactive terminals are independent windows; closing the client does not close them. **退出网页登录** is available for gateway connections; SSH authenticates through keys and does not use that gateway logout.

<a id="settings-updates-and-troubleshooting"></a>

## Settings, updates and troubleshooting

| Item | Location or behavior |
|---|---|
| Connection settings | `%LOCALAPPDATA%\DSHRemote\settings.json`; no password is stored |
| Cookies and browser storage | `%LOCALAPPDATA%\DSHRemote\WebView2`; shared across app versions under the current Windows account |
| Client diagnostics | `%LOCALAPPDATA%\DSHRemote\client.log`; login tokens are redacted and the log resets above 2 MiB |
| Updates | Checked on startup and every six hours when enabled; **检查更新…** checks manually and offers the Windows release page |
| Upgrade | Exit the app, extract the new ZIP into a new folder, and launch it; settings and cookies remain in AppData |
| Removal | Delete the extracted app folder; to also remove login state and settings, delete the DSHRemote AppData folder after exiting |

A failed connection appears in the status bar. Check the web address, WebView2 installation, OpenSSH key/agent, local port and server service as appropriate. Use **连接 → 重新连接** after fixing the cause. Only one client instance runs per Windows login session. The app requires a remote server and an installed WebView2 Runtime; it does not install or run DSH locally, automatically replace its executable, or supply Mac's CLI utility.

<a id="development"></a>

## Development

From the repository root, use the .NET 8 SDK for core tests. Packaging requires Windows x64 and PowerShell 7:

```powershell
dotnet run --project remote/windows/Tests/DshRemote.Tests.csproj -c Release
pwsh -File remote/windows/build.ps1 -BuildNumber 1 -Repository JoshuaNibaba/dsh-pro
```

The build writes a unique directory under `remote/build/`, containing the portable ZIP, SHA-256 file and `DSH-Remote-Windows.version`. It includes the .NET runtime, WebView2 loader, documentation and dependency licenses. `DSH Remote.exe --self-check` verifies published dependencies without opening a browser. The [Windows workflow](../../.github/workflows/dsh-remote-windows.yml) runs core tests, publishes and checks the executable on Windows, then uploads main-branch builds to the separate rolling release `dsh-remote-windows`. It leaves Mac assets and DSH Pro versioned releases untouched. Fork builds use their own repository for update checks.

The [core tests](Tests/Program.cs) cover URL/settings validation, token parsing, bounded concurrent process output, cancellation, timeout, child cleanup and tunnel ownership using private fixture processes. They run on Linux and Windows without a live DSH server or browser automation. Native interactive checks of login, file dialogs, theme changes and sleep/resume remain manual release verification.

<a id="dev-note"></a>

## Dev Note

None.
