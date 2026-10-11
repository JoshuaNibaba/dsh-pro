using System.Diagnostics;
using System.Net;
using System.Text.Json;
using DshRemote.Core;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace DshRemote;

internal sealed class MainForm : Form
{
    private readonly WebView2 browser = new() { Dock = DockStyle.Fill };
    private readonly ToolStripStatusLabel status = new() { Text = "准备连接", Spring = true, TextAlign = ContentAlignment.MiddleLeft };
    private readonly CancellationTokenSource lifetime = new();
    private readonly SemaphoreSlim connectionGate = new(1, 1);
    private readonly System.Windows.Forms.Timer updateTimer = new() { Interval = 6 * 60 * 60 * 1000 };
    private readonly SshClient ssh = new();
    private RemoteSettings settings = new();
    private CancellationTokenSource? connectionCancellation;
    private Task connectionTask = Task.CompletedTask, serviceTask = Task.CompletedTask, updateTask = Task.CompletedTask;
    private Task initialization = Task.CompletedTask;
    private TaskCompletionSource<int>? navigation;
    private ulong? navigationId;
    private readonly ToolStripMenuItem logout;
    private Uri? activeOrigin;
    private bool sshRoute, closing, shutdownComplete, ready, checkingUpdate;
    private string pendingPassword = "";

    internal MainForm()
    {
        Text = "DSH Remote";
        Icon = Icon.ExtractAssociatedIcon(Environment.ProcessPath!);
        Size = new Size(1280, 860);
        MinimumSize = new Size(720, 500);
        StartPosition = FormStartPosition.CenterScreen;
        AutoScaleMode = AutoScaleMode.Dpi;
        var menu = new MenuStrip();
        var app = new ToolStripMenuItem("DSH Remote");
        app.DropDownItems.Add(Item("连接设置…", () => ConfigureAsync(), Keys.Control | Keys.Oemcomma));
        app.DropDownItems.Add(Item("检查更新…", () => CheckUpdatesAsync(true)));
        app.DropDownItems.Add(Item("关于", () =>
        {
            MessageBox.Show(this, $"DSH Remote for Windows {Program.Version.ToString(3)}\nDSH Pro 社区远程客户端 · MIT\n通过网页或 SSH 连接你的 DSH 服务器。", "关于 DSH Remote");
            return Task.CompletedTask;
        }));
        app.DropDownItems.Add(new ToolStripSeparator());
        app.DropDownItems.Add(Item("退出", () => { Close(); return Task.CompletedTask; }));
        var connection = new ToolStripMenuItem("连接");
        connection.DropDownItems.Add(Item("重新连接", ReconnectAsync, Keys.Control | Keys.R));
        connection.DropDownItems.Add(Item("在浏览器中打开", OpenBrowserAsync));
        logout = Item("退出网页登录", LogoutAsync);
        connection.DropDownItems.Add(logout);
        var service = new ToolStripMenuItem("服务");
        service.DropDownItems.Add(Item("查看服务器日志", () => ServiceAsync(false)));
        service.DropDownItems.Add(Item("重启服务器服务…", () => ServiceAsync(true)));
        service.DropDownItems.Add(Item("打开 SSH 终端", OpenTerminalAsync));
        service.DropDownItems.Add(Item("打开客户端日志", () =>
        {
            Log.Write("Opened client log");
            Process.Start(new ProcessStartInfo("notepad.exe") { UseShellExecute = true, ArgumentList = { Log.FilePath } });
            return Task.CompletedTask;
        }));
        menu.Items.AddRange([app, connection, service]);
        var strip = new StatusStrip();
        strip.Items.Add(status);
        Controls.Add(browser);
        Controls.Add(strip);
        Controls.Add(menu);
        MainMenuStrip = menu;
        Shown += (_, _) => initialization = GuardAsync(InitializeAsync);
        FormClosing += OnClosing;
        updateTimer.Tick += (_, _) => updateTask = GuardAsync(() => CheckUpdatesAsync(false));
    }

    private ToolStripMenuItem Item(string text, Func<Task> action, Keys shortcut = Keys.None)
    {
        var item = new ToolStripMenuItem(text) { ShortcutKeys = shortcut };
        item.Click += async (_, _) => await GuardAsync(action);
        return item;
    }

    private async Task GuardAsync(Func<Task> action)
    {
        if (closing) return;
        try { await action(); }
        catch (OperationCanceledException) { /* Connection changes and window closure cancel owned work. */ }
        catch (Exception error)
        {
            Log.Write(error.ToString());
            if (!closing) SetStatus($"操作失败：{Log.Redact(error.Message)}");
        }
    }

    private async Task InitializeAsync()
    {
        try { settings = SettingsStore.Load(Program.SettingsPath); }
        catch (Exception error)
        {
            MessageBox.Show(this, $"无法读取连接设置：{Log.Redact(error.Message)}\n请重新填写；原文件会保留到你保存设置。", "DSH Remote");
        }
        try
        {
            var environment = await CoreWebView2Environment.CreateAsync(null, Path.Combine(Program.DataDirectory, "WebView2"));
            if (closing) return;
            await browser.EnsureCoreWebView2Async(environment);
        }
        catch (WebView2RuntimeNotFoundException)
        {
            if (MessageBox.Show(this, "需要 Microsoft Edge WebView2 Runtime 才能显示页面。是否打开微软官方下载页？安装后重新启动 DSH Remote。",
                "安装 WebView2", MessageBoxButtons.YesNo, MessageBoxIcon.Information) == DialogResult.Yes)
                OpenExternal(new Uri("https://developer.microsoft.com/microsoft-edge/webview2/"));
            SetStatus("请安装 WebView2 Runtime 后重新启动客户端。");
            return;
        }
        if (closing) return;
        var core = browser.CoreWebView2;
        core.Settings.AreHostObjectsAllowed = false;
        core.Settings.IsPasswordAutosaveEnabled = false;
        core.Settings.IsGeneralAutofillEnabled = false;
        core.NavigationStarting += OnNavigationStarting;
        core.NavigationCompleted += OnNavigationCompleted;
        core.NewWindowRequested += (_, args) =>
        {
            args.Handled = true;
            if (!Uri.TryCreate(args.Uri, UriKind.Absolute, out var uri)) return;
            if (activeOrigin != null && NavigationPolicy.SameOrigin(uri, activeOrigin)) core.Navigate(uri.AbsoluteUri);
            else OpenExternal(uri);
        };
        core.WebMessageReceived += OnThemeMessage;
        core.ProcessFailed += (_, args) =>
        {
            navigation?.TrySetException(new IOException($"页面进程退出：{args.ProcessFailedKind}"));
            SetStatus("页面进程退出，请重新连接；若无法恢复，请重新启动客户端。");
        };
        await core.AddScriptToExecuteOnDocumentCreatedAsync(Theme.Script);
        ready = true;
        updateTimer.Start();
        if (settings.WebUri == null && settings.SshHost.Length == 0) await ConfigureAsync();
        else await ReconnectAsync();
        if (!closing && settings.CheckUpdates) updateTask = GuardAsync(() => CheckUpdatesAsync(false));
    }

    private async Task ConfigureAsync()
    {
        if (!ready) return;
        using var dialog = new SettingsForm(settings);
        if (dialog.ShowDialog(this) != DialogResult.OK) return;
        settings = dialog.Result;
        pendingPassword = dialog.Password;
        await ReconnectAsync();
    }

    private async Task ReconnectAsync()
    {
        if (!ready || closing) return;
        await connectionGate.WaitAsync(lifetime.Token);
        try
        {
            connectionCancellation?.Cancel();
            await connectionTask;
            connectionCancellation?.Dispose();
            if (closing) return;
            connectionCancellation = CancellationTokenSource.CreateLinkedTokenSource(lifetime.Token);
            browser.CoreWebView2.Stop();
            navigation = null;
            connectionTask = ConnectionLoopAsync(settings, connectionCancellation.Token);
        }
        finally { connectionGate.Release(); }
    }

    private async Task ConnectionLoopAsync(RemoteSettings config, CancellationToken cancellation)
    {
        try
        {
            config.Validate();
            bool[] routes = config.PreferSsh ? [true, false] : [false, true];
            Exception? failure = null;
            foreach (var useSsh in routes)
            {
                if (useSsh ? config.SshHost.Length == 0 : config.WebUri == null) continue;
                cancellation.ThrowIfCancellationRequested();
                try
                {
                    sshRoute = useSsh;
                    logout.Enabled = !useSsh;
                    activeOrigin = useSsh ? new Uri($"http://127.0.0.1:{config.LocalPort}/") : config.WebUri;
                    if (useSsh) await SshLoopAsync(config, cancellation);
                    else
                    {
                        SetStatus("正在连接网页…");
                        var code = await NavigateAsync(activeOrigin!, cancellation);
                        if (code >= 500) throw new IOException($"网页服务器返回 HTTP {code}");
                        SetStatus("网页已连接");
                    }
                    return;
                }
                catch (OperationCanceledException) when (cancellation.IsCancellationRequested) { throw; }
                catch (Exception error)
                {
                    failure = error;
                    Log.Write($"{(useSsh ? "SSH" : "Web")} connection failed: {error.Message}");
                }
            }
            throw failure ?? new InvalidOperationException("请先填写网页地址或 SSH 服务器。");
        }
        catch (OperationCanceledException) when (cancellation.IsCancellationRequested) { /* The previous connection has relinquished its resources. */ }
        catch (Exception error)
        {
            pendingPassword = "";
            SetStatus($"连接失败：{Log.Redact(error.Message)} · 可打开连接设置或重新连接。");
            Log.Write(error.ToString());
        }
    }

    private async Task SshLoopAsync(RemoteSettings config, CancellationToken cancellation)
    {
        bool pageLoaded = false;
        var attempt = 0;
        while (true)
        {
            cancellation.ThrowIfCancellationRequested();
            try
            {
                SetStatus(pageLoaded ? "SSH 已断开，正在恢复连接…" : "正在建立 SSH 隧道…");
                await using var tunnel = await SshTunnel.StartAsync(config, cancellation);
                if (!pageLoaded)
                {
                    var code = await NavigateAsync(activeOrigin!, cancellation);
                    if (code == (int)HttpStatusCode.Unauthorized)
                    {
                        SetStatus("正在读取服务器访问地址…");
                        var output = await ssh.RunAsync(config, SshCommands.LoginUrl(config.Service), cancellation);
                        var login = SshCommands.ParseLoginUrl(output, config.LocalPort)
                            ?? throw new IOException("服务器未返回有效登录地址，请检查 dsh-web 服务。");
                        code = await NavigateAsync(login, cancellation);
                    }
                    if (code >= 400) throw new IOException($"DSH 返回 HTTP {code}，请检查服务器服务。");
                    pageLoaded = true;
                }
                else
                {
                    // Keep the document and drafts; the DSH connection plugin owns socket reconnection.
                    await browser.CoreWebView2.ExecuteScriptAsync("window.dispatchEvent(new Event('online'))");
                }
                attempt = 0;
                SetStatus("SSH 已连接");
                Log.Write("SSH tunnel ready");
                var exitCode = await tunnel.Completion.WaitAsync(cancellation);
                throw new IOException($"SSH 已退出（{exitCode}）：{tunnel.LastError}");
            }
            catch (OperationCanceledException) when (cancellation.IsCancellationRequested) { throw; }
            catch (Exception error)
            {
                if (!pageLoaded) throw;
                var seconds = Math.Min(10, 1 << Math.Min(attempt++, 4));
                Log.Write($"SSH recovery: {error.Message}");
                SetStatus($"SSH 连接中断，{seconds} 秒后重试 · {Log.Redact(error.Message)}");
                await Task.Delay(TimeSpan.FromSeconds(seconds), cancellation);
            }
        }
    }

    private async Task<int> NavigateAsync(Uri uri, CancellationToken cancellation)
    {
        var completion = new TaskCompletionSource<int>(TaskCreationOptions.RunContinuationsAsynchronously);
        navigation = completion;
        navigationId = null;
        try
        {
            browser.CoreWebView2.Navigate(uri.AbsoluteUri);
            return await completion.Task.WaitAsync(TimeSpan.FromSeconds(45), cancellation);
        }
        finally { if (ReferenceEquals(navigation, completion)) navigation = null; }
    }

    private void OnNavigationStarting(object? sender, CoreWebView2NavigationStartingEventArgs args)
    {
        if (!Uri.TryCreate(args.Uri, UriKind.Absolute, out var uri)) { args.Cancel = true; return; }
        if (activeOrigin != null && NavigationPolicy.SameOrigin(uri, activeOrigin))
        {
            navigationId = args.NavigationId;
            return;
        }
        args.Cancel = true;
        OpenExternal(uri);
        navigation?.TrySetException(new IOException("页面跳转到其他站点，已交给默认浏览器。请检查配置的网页地址。"));
    }

    private async void OnNavigationCompleted(object? sender, CoreWebView2NavigationCompletedEventArgs args)
    {
        if (closing || args.NavigationId != navigationId) return;
        // A completed HTTP 401 is the DSH first-login signal even when WebView2 reports IsSuccess=false.
        if (!args.IsSuccess && args.HttpStatusCode != 401)
        {
            navigation?.TrySetException(new IOException($"页面加载失败：{args.WebErrorStatus}"));
            SetStatus($"页面加载失败：{args.WebErrorStatus} · 可重新连接。");
            return;
        }
        var waiter = navigation;
        waiter?.TrySetResult(args.HttpStatusCode);
        if (waiter == null && sshRoute && args.HttpStatusCode == 401)
        {
            await GuardAsync(ReconnectAsync);
            return;
        }
        await GuardAsync(async () =>
        {
            if (!sshRoute && pendingPassword.Length > 0 && activeOrigin != null)
            {
                var secret = pendingPassword;
                pendingPassword = "";
                // Both document and form must still belong to the configured gateway at execution time.
                var origin = JsonSerializer.Serialize(activeOrigin.GetLeftPart(UriPartial.Authority));
                await browser.CoreWebView2.ExecuteScriptAsync($$"""
                    (() => {
                      if (location.origin !== {{origin}}) return;
                      const form = document.querySelector('form[action="/__dsh/login"]');
                      const input = form && form.querySelector('input[name="password"]');
                      if (!input || new URL(form.action).origin !== location.origin) return;
                      input.value = {{JsonSerializer.Serialize(secret)}};
                      form.requestSubmit();
                    })()
                    """);
            }
        });
    }

    private void OnThemeMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs args)
    {
        if (closing || activeOrigin == null || !Uri.TryCreate(args.Source, UriKind.Absolute, out var uri)
            || !NavigationPolicy.SameOrigin(uri, activeOrigin)) return;
        try
        {
            if (args.WebMessageAsJson.Length > 512) return;
            using var data = JsonDocument.Parse(args.WebMessageAsJson);
            if (!data.RootElement.TryGetProperty("dshTheme", out var value) || value.ValueKind != JsonValueKind.String) return;
            if (Theme.Parse(value.GetString()) is { } color) Theme.Apply(this, MainMenuStrip!, status.Owner!, color);
        }
        catch (JsonException error) { Log.Write($"Invalid theme message: {error.Message}"); }
    }

    private Task LogoutAsync()
    {
        if (!ready || activeOrigin == null || sshRoute) return Task.CompletedTask;
        pendingPassword = "";
        browser.CoreWebView2.Navigate(new Uri(activeOrigin, "/__dsh/logout").AbsoluteUri);
        return Task.CompletedTask;
    }

    private Task OpenBrowserAsync()
    {
        if (activeOrigin == null) return Task.CompletedTask;
        if (!sshRoute) { OpenExternal(activeOrigin); return Task.CompletedTask; }
        if (!serviceTask.IsCompleted) return serviceTask;
        var config = settings;
        var origin = activeOrigin;
        serviceTask = GuardAsync(async () =>
        {
            var output = await ssh.RunAsync(config, SshCommands.LoginUrl(config.Service), lifetime.Token);
            if (closing || !sshRoute || settings != config || activeOrigin != origin) return;
            var url = SshCommands.ParseLoginUrl(output, config.LocalPort)
                ?? throw new InvalidOperationException("未能读取服务器登录地址，请查看服务器日志。");
            OpenExternal(url);
        });
        return serviceTask;
    }

    private Task ServiceAsync(bool restart)
    {
        if (!serviceTask.IsCompleted) return Task.CompletedTask;
        if (settings.SshHost.Length == 0) throw new InvalidOperationException("请先在连接设置中填写 SSH 服务器。");
        if (restart && MessageBox.Show(this, "重启服务器上的 DSH 服务？所有设备的连接会暂时中断。", "重启服务",
            MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes) return Task.CompletedTask;
        serviceTask = GuardAsync(async () =>
        {
            var config = settings;
            SetStatus(restart ? "正在重启服务…" : "正在读取日志…");
            var output = await ssh.RunAsync(config, restart ? SshCommands.Restart(config.Service) : SshCommands.Logs(config.Service), lifetime.Token);
            if (closing) return;
            if (restart) { SetStatus("服务已重启，正在重新连接…"); await ReconnectAsync(); }
            else
            {
                using var dialog = new Form { Text = "服务器日志", Size = new Size(920, 660), StartPosition = FormStartPosition.CenterParent };
                dialog.Controls.Add(new TextBox { Multiline = true, ReadOnly = true, ScrollBars = ScrollBars.Both,
                    WordWrap = false, Dock = DockStyle.Fill, Font = new Font(FontFamily.GenericMonospace, 10), Text = Log.Redact(output).ReplaceLineEndings() });
                dialog.ShowDialog(this);
                SetStatus("服务器日志读取完成");
            }
        });
        return serviceTask;
    }

    private Task OpenTerminalAsync()
    {
        if (settings.SshHost.Length == 0) throw new InvalidOperationException("请先填写 SSH 服务器。");
        settings.Validate();
        var executable = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "OpenSSH", "ssh.exe");
        var start = new ProcessStartInfo(executable) { UseShellExecute = true };
        if (settings.SshPort > 0) { start.ArgumentList.Add("-p"); start.ArgumentList.Add(settings.SshPort.ToString()); }
        start.ArgumentList.Add("--");
        start.ArgumentList.Add(settings.SshDestination);
        Process.Start(start)?.Dispose();
        return Task.CompletedTask;
    }

    private Task CheckUpdatesAsync(bool manual)
    {
        if (checkingUpdate) return updateTask;
        updateTask = GuardAsync(() => CheckUpdatesCoreAsync(manual));
        return updateTask;
    }

    private async Task CheckUpdatesCoreAsync(bool manual)
    {
        if (checkingUpdate || (!manual && !settings.CheckUpdates)) return;
        checkingUpdate = true;
        try
        {
            var latest = await Updater.LatestAsync(lifetime.Token);
            if (closing) return;
            if (latest <= Program.Version.Build)
            {
                if (manual) MessageBox.Show(this, "已是最新版本。", "检查更新");
                return;
            }
            if (MessageBox.Show(this, $"发现 Windows 新版本 1.0.{latest}。是否打开下载页？\n下载后退出客户端，将新版解压到一个新文件夹并运行。连接设置和登录状态会保留。",
                "DSH Remote 更新", MessageBoxButtons.YesNo, MessageBoxIcon.Information) == DialogResult.Yes)
                OpenExternal(Updater.ReleasePage);
        }
        catch (Exception error) when (!manual && error is not OperationCanceledException) { Log.Write($"Update check failed: {error.Message}"); }
        finally { checkingUpdate = false; }
    }

    private void SetStatus(string text)
    {
        if (closing) return;
        status.Text = text.Length > 240 ? text[..240] + "…" : text;
        status.ToolTipText = text;
        Text = activeOrigin == null ? "DSH Remote" : $"DSH Remote · {(sshRoute ? settings.SshHost : activeOrigin.Host)}";
    }

    private void OpenExternal(Uri uri)
    {
        if (closing || !NavigationPolicy.SafeExternal(uri)) return;
        try { Process.Start(new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true })?.Dispose(); }
        catch (Exception error) { SetStatus($"无法打开浏览器：{Log.Redact(error.Message)}"); }
    }

    private async void OnClosing(object? sender, FormClosingEventArgs args)
    {
        if (shutdownComplete) return;
        args.Cancel = true;
        if (closing) return;
        closing = true;
        Enabled = false;
        updateTimer.Stop();
        lifetime.Cancel();
        connectionCancellation?.Cancel();
        await connectionGate.WaitAsync();
        try
        {
            await Task.WhenAll(initialization, connectionTask, serviceTask, updateTask);
        }
        catch (Exception error) { Log.Write($"Shutdown: {error.Message}"); }
        finally
        {
            connectionGate.Release();
            connectionCancellation?.Dispose();
            updateTimer.Dispose();
            browser.Dispose();
            lifetime.Dispose();
            shutdownComplete = true;
            Close();
        }
    }
}
