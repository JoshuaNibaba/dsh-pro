// DSH Remote: a thin macOS client for a dsh web service on a remote server.
//
// Two routes to the UI:
//   web  the configured web address (server/install.sh --domain): the password gateway
//        shows its login page and sets a long-lived cookie, exactly as in a browser.
//        A password typed in Settings fills that page once; it is never stored.
//   ssh  (key or ssh-agent only) open an `ssh -L` tunnel and load the UI from 127.0.0.1
//        with dsh's login cookie; only a 401 reads dsh's current launch-token URL over
//        that authenticated transport. A tunnel that drops under a loaded page is rebuilt
//        behind it, and dsh's own client reconnects without reloading the page.
// The web route is used whenever a web address is set, unless "prefer SSH" is on;
// each route falls back to the other when it cannot connect. SSH, when configured,
// also backs the Service menu (logs, restart, terminal) in either route.
// The WKWebView data store persists, so both logins survive restarts.

import AppKit
import WebKit
import Network

private let logLock = NSLock()

/// Appends one line to ~/Library/Logs/DSHRemote.log, hiding tokens.
func log(_ msg: String) {
    logLock.lock()
    defer { logLock.unlock() }
    let url = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Logs/DSHRemote.log")
    try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    let line = "\(ISO8601DateFormatter().string(from: Date())) \(msg)\n"
        .replacingOccurrences(of: "token=[^ \n&]*", with: "token=<hidden>", options: .regularExpression)
    if let h = try? FileHandle(forWritingTo: url) { h.seekToEndOfFile(); h.write(line.data(using: .utf8)!); try? h.close() }
    else { try? line.data(using: .utf8)!.write(to: url) }
}

enum Route: Equatable {
    case none
    case ssh
    case web(URL)
}

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate,
                         WKDownloadDelegate, WKScriptMessageHandler {
    var window: NSWindow!
    var webView: WKWebView!
    let tunnel = Tunnel()
    var settings = Settings.load()
    var route = Route.none
    var connecting = false
    var connectCommand: SSHCommand?
    var sshPageStarted: TimeInterval?
    /// The dsh page from the tunnel is on screen; tunnel recovery keeps it instead of reloading.
    var sshPageLive = false
    var keptPageOutage = KeptPageOutage()
    /// The tunnel page answered 401: the next connection reads a launch token over SSH.
    var sshNeedsToken = false
    /// The current SSH page load carries a launch token, so another 401 is not retried.
    var sshLoadUsedToken = false
    var quitting = false
    let recovery = SSHRecovery()
    let networkMonitor = NWPathMonitor()
    var networkAvailable: Bool?
    var restartSSHAfterConnect = false
    var reconnectAfterConnect = false
    var settingsWindow: SettingsWindowController?
    var updateTimer: Timer?
    var updating = false
    /// Password typed in Settings, used to fill the gateway's login page once.
    var pendingPassword = ""
    /// The web route failed and SSH was tried instead during this connect().
    var webFellBack = false

    func applicationDidFinishLaunching(_ n: Notification) {
        // The Dock may hold a cached icon from an earlier version at the same path.
        if let icon = NSImage(named: "AppIcon") { NSApp.applicationIconImage = icon }
        buildMenu()
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        config.preferences.setValue(true, forKey: "developerExtrasEnabled")
        Chrome.configure(config, handler: self)
        webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = false

        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1280, height: 860),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable],
                          backing: .buffered, defer: false)
        window.contentView = webView
        Chrome.install(window)
        window.setFrameAutosaveName("DSHRemoteMain")
        if !window.setFrameUsingName("DSHRemoteMain") { window.center() }
        window.makeKeyAndOrderFront(nil)

        tunnel.onExit = { [weak self] msg in self?.tunnelDropped(msg) }
        tunnel.onProgress = { log($0) }
        networkMonitor.pathUpdateHandler = { [weak self] path in
            let available = path.status == .satisfied
            DispatchQueue.main.async { self?.networkChanged(available) }
        }
        networkMonitor.start(queue: DispatchQueue(label: "com.joshua.dsh-remote.network"))
        NSWorkspace.shared.notificationCenter.addObserver(
            self, selector: #selector(didWake), name: NSWorkspace.didWakeNotification, object: nil)
        connect()
        if CommandLine.arguments.contains("--update-now") { updateNow() } else { scheduleUpdateChecks() }
    }

    /// `--update-now`: install the latest release without asking (scripts and testing).
    func updateNow() {
        Updater.latest { [weak self] result in
            guard case .success(let r) = result, r.build > Updater.currentBuild else {
                log("update-now: nothing to install (\(result))")
                self?.scheduleUpdateChecks()
                return
            }
            log("update-now: installing \(r.version)")
            Updater.install(r) { error in
                if let error { log("update-now failed: \(error.localizedDescription)") } else { Updater.relaunch() }
            }
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ s: NSApplication) -> Bool { true }

    func applicationWillTerminate(_ n: Notification) {
        quitting = true
        connectCommand?.cancel()
        recovery.stop()
        networkMonitor.cancel()
        tunnel.shutdown()
    }

    // MARK: status page

    func showStatus(_ title: String, _ detail: String = "", retry: Bool = false, settingsLink: Bool = false) {
        log("status: \(title) \(detail)")
        sshPageLive = false
        keptPageOutage.reset()
        func esc(_ s: String) -> String {
            s.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;")
        }
        var links: [String] = []
        if retry { links.append("<a href='dsh-remote://retry'>重新连接</a>") }
        if settingsLink { links.append("<a href='dsh-remote://settings'>打开设置</a>") }
        let html = """
        <html><head><meta charset='utf-8'><style>
        body{font:14px -apple-system,sans-serif;display:flex;align-items:center;justify-content:center;height:90vh;
        color:#444;background:#fafafa}@media(prefers-color-scheme:dark){body{background:#1e1e1e;color:#ccc}}
        div{text-align:center;max-width:640px}pre{white-space:pre-wrap;text-align:left;font-size:12px;opacity:.8}
        a{color:#4d6bfe;margin:0 10px}</style></head><body><div><h3>\(esc(title))</h3>
        <pre>\(esc(detail))</pre><p>\(links.joined())</p></div></body></html>
        """
        webView.loadHTMLString(html, baseURL: nil)
    }

    /// Rewrites the visible status page in place; a new status page would cancel the navigation that follows.
    func retitleStatus(_ title: String, _ detail: String) {
        guard !sshPageLive, webView.url == nil || webView.url?.absoluteString == "about:blank",
              let data = try? JSONSerialization.data(withJSONObject: [title, detail]),
              let literal = String(data: data, encoding: .utf8) else { return }
        log("status: \(title) \(detail)")
        webView.evaluateJavaScript("""
        (function (t) {
          var h = document.querySelector('h3'), p = document.querySelector('pre');
          if (h) h.textContent = t[0];
          if (p) p.textContent = t[1];
          return 0;
        })(\(literal))
        """)
    }

    // MARK: connection

    @objc func connect() {
        guard !connecting else { return }
        settings = Settings.load()
        let s = settings
        window.title = s.displayName.isEmpty ? "DSH Remote" : "DSH Remote — \(s.displayName)"
        guard s.isConfigured else {
            recovery.stop()
            route = .none
            showStatus("尚未配置服务器", "请在「设置」中填写服务器地址或网页地址。", settingsLink: true)
            openSettings()
            return
        }
        webFellBack = false
        if s.prefersWeb { return useWeb(s, reason: nil) }
        connectSSH(s, fallbackToWeb: s.web != nil)
    }

    func connectSSH(_ s: Settings, fallbackToWeb: Bool) {
        guard !connecting, !quitting else { return }
        recovery.cancelPending()
        settings = s
        recovery.start()
        route = .ssh
        connecting = true
        sshPageStarted = nil
        let needsToken = sshNeedsToken
        sshNeedsToken = false
        let command = SSHCommand()
        connectCommand = command
        let started = ProcessInfo.processInfo.systemUptime
        let trace = "ssh[\(UUID().uuidString.prefix(8))]"
        log("\(trace) connecting to \(s.sshDestination)\(sshPageLive ? " behind the current page" : "")")
        if !sshPageLive { showStatus("正在建立 SSH 隧道到 \(s.server) …") }
        DispatchQueue.global().async {
            let result: Result<URL, Error> = Result {
                if !self.tunnel.isRunning && Tunnel.canConnect(port: s.localPort) && Tunnel.reclaimOrphan(port: s.localPort) {
                    log("stopped an orphaned tunnel on port \(s.localPort)")
                }
                if Tunnel.canConnect(port: s.localPort) && !self.tunnel.isRunning {
                    throw NSError(domain: "dsh", code: 1, userInfo: [NSLocalizedDescriptionKey:
                        "本地端口 \(s.localPort) 已被其他程序占用。\n可执行: defaults write com.joshua.dsh-remote localPort -int <端口>"])
                }
                guard !command.isCancelled else { throw NSError(domain: NSURLErrorDomain, code: NSURLErrorCancelled) }
                if !self.tunnel.isRunning { try self.tunnel.start(s) }
                guard self.tunnel.waitReady(s, timeout: 20, cancelled: { command.isCancelled }) else {
                    let detail = self.tunnel.lastError
                    throw NSError(domain: "dsh", code: 2, userInfo: [NSLocalizedDescriptionKey:
                        "SSH 隧道未能建立" + (detail.isEmpty ? "" : "\n\(detail)")])
                }
                log("\(trace) authenticated tunnel ready after \(String(format: "%.3f", ProcessInfo.processInfo.systemUptime - started))s")
                guard needsToken else { return SSH.localPageURL(port: s.localPort) }
                DispatchQueue.main.async {
                    guard self.connectCommand === command, !command.isCancelled, !self.sshPageLive else { return }
                    self.showStatus("正在读取服务器访问地址 …")
                }
                let reading = ProcessInfo.processInfo.systemUptime
                let url = try self.fetchLoginURL(s, using: command)
                log("\(trace) login URL read over existing SSH connection in \(String(format: "%.3f", ProcessInfo.processInfo.systemUptime - reading))s")
                return url
            }
            DispatchQueue.main.async {
                self.connecting = false
                self.connectCommand = nil
                if needsToken { self.sshNeedsToken = true } // kept until a token page load starts
                guard !self.quitting else { self.tunnel.stop(); return }
                if self.reconnectAfterConnect {
                    self.reconnectAfterConnect = false
                    self.reconnect()
                    return
                }
                if self.restartSSHAfterConnect {
                    self.restartSSHAfterConnect = false
                    self.restoreSSH()
                    return
                }
                switch result {
                case .success(let url):
                    guard self.tunnel.isRunning else {
                        self.scheduleSSHRetry("SSH 隧道在连接就绪后退出")
                        return
                    }
                    self.route = .ssh
                    self.recovery.reset()
                    self.keptPageOutage.reset()
                    if self.sshPageLive && !needsToken {
                        log("\(trace) tunnel restored behind the current page after \(String(format: "%.3f", ProcessInfo.processInfo.systemUptime - started))s")
                        self.nudgePageConnection()
                        return
                    }
                    let elapsed = ProcessInfo.processInfo.systemUptime - started
                    log("\(trace) ready to load page after \(String(format: "%.3f", elapsed))s")
                    log("ssh: load \(url.absoluteString)")
                    self.retitleStatus("正在加载 dsh 页面 …", "SSH 隧道已建立(\(String(format: "%.1f", elapsed)) 秒)")
                    self.sshNeedsToken = false
                    self.sshLoadUsedToken = needsToken
                    self.sshPageStarted = ProcessInfo.processInfo.systemUptime
                    self.webView.load(URLRequest(url: url))
                case .failure(let e):
                    log("\(trace) failed after \(String(format: "%.3f", ProcessInfo.processInfo.systemUptime - started))s: \(e.localizedDescription)")
                    self.tunnel.stop()
                    if fallbackToWeb {
                        self.useWeb(s, reason: e.localizedDescription)
                    } else {
                        self.scheduleSSHRetry(e.localizedDescription)
                    }
                }
            }
        }
    }

    func useWeb(_ s: Settings, reason: String?) {
        recovery.stop()
        restartSSHAfterConnect = false
        tunnel.stop()
        guard let web = s.web else { return }
        if let reason { log("ssh unavailable, using web address: \(reason)") }
        sshPageLive = false
        keptPageOutage.reset()
        route = .web(web)
        webView.load(URLRequest(url: web))
    }

    /// Reads dsh's current URL over SSH and rewrites it to the local tunnel endpoint.
    func fetchLoginURL(_ s: Settings, using command: SSHCommand) throws -> URL {
        let deadline = ProcessInfo.processInfo.systemUptime + 15
        var attempts = 0
        while ProcessInfo.processInfo.systemUptime < deadline {
            guard !command.isCancelled else { throw NSError(domain: NSURLErrorDomain, code: NSURLErrorCancelled) }
            attempts += 1
            let remaining = deadline - ProcessInfo.processInfo.systemUptime
            let output = try tunnel.run(s, SSH.urlCommand(s.service), using: command, timeout: min(10, remaining))
            if let url = SSH.localLoginURL(output, port: s.localPort) { return url }
            log("ssh: service has not published a token URL (read \(attempts))")
            let nextRead = min(deadline, ProcessInfo.processInfo.systemUptime + 1)
            while ProcessInfo.processInfo.systemUptime < nextRead, !command.isCancelled {
                Thread.sleep(forTimeInterval: 0.05)
            }
        }
        throw NSError(domain: "dsh", code: 3, userInfo: [NSLocalizedDescriptionKey:
            "服务 \(s.service) 在 15 秒内未输出访问地址,请检查服务状态(菜单:服务 → 查看日志)"])
    }

    func scheduleSSHRetry(_ msg: String) {
        guard !quitting, recovery.isActive else { return }
        let delay = recovery.failed { [weak self] in
            guard let self, !self.quitting else { return }
            self.connectSSH(Settings.load(), fallbackToWeb: false)
        }
        guard let delay else { return }
        if sshPageLive && keptPageOutage.failed(at: ProcessInfo.processInfo.systemUptime) {
            log("ssh: keeping the page; reconnecting in \(Int(delay))s: \(msg)")
            return
        }
        showStatus("连接已断开,\(Int(delay)) 秒后自动重连 …", msg, retry: true, settingsLink: true)
    }

    /// Makes the kept page's dsh client retry now instead of after its own backoff, which reaches 10 seconds.
    func nudgePageConnection() {
        webView.evaluateJavaScript("window.dispatchEvent(new Event('offline'));window.dispatchEvent(new Event('online'));0") { _, error in
            if let error { log("ssh: page reconnect signal failed: \(error.localizedDescription)") }
        }
    }

    func tunnelDropped(_ msg: String) {
        log("tunnel exited: \(msg)")
        guard !connecting else { return }
        scheduleSSHRetry(msg)
    }

    /// Replaces even a living SSH process: its old TCP session may no longer work.
    func restoreSSH() {
        guard !quitting, recovery.isActive else { return }
        recovery.reset()
        if connecting {
            restartSSHAfterConnect = true
            connectCommand?.cancel()
            tunnel.stop()
            return
        }
        tunnel.stop()
        connectSSH(Settings.load(), fallbackToWeb: false)
    }

    func networkChanged(_ available: Bool) {
        let wasAvailable = networkAvailable
        networkAvailable = available
        if wasAvailable == false && available {
            log("network restored; replacing SSH tunnel")
            restoreSSH()
        }
    }

    @objc func didWake() {
        log("system woke; replacing SSH tunnel")
        restoreSSH()
    }

    // MARK: settings

    @objc func openSettings() {
        if settingsWindow == nil {
            settingsWindow = SettingsWindowController(settings: Settings.load())
            settingsWindow?.onSave = { [weak self] _, password in
                self?.pendingPassword = password
                self?.reconnect()
            }
        } else {
            settingsWindow?.fill(Settings.load())
        }
        settingsWindow?.show()
    }

    // MARK: updates

    func scheduleUpdateChecks() {
        DispatchQueue.main.asyncAfter(deadline: .now() + 8) { [weak self] in self?.checkForUpdates(manual: false) }
        updateTimer = Timer.scheduledTimer(withTimeInterval: 6 * 3600, repeats: true) { [weak self] _ in
            self?.checkForUpdates(manual: false)
        }
    }

    @objc func checkForUpdatesManually() { checkForUpdates(manual: true) }

    func checkForUpdates(manual: Bool) {
        guard manual || Settings.load().autoUpdate, !updating else { return }
        Updater.latest { [weak self] result in
            guard let self else { return }
            switch result {
            case .failure(let e):
                log("update check failed: \(e.localizedDescription)")
                if manual { self.alert("检查更新失败", e.localizedDescription) }
            case .success(let r):
                let skipped = UserDefaults.standard.integer(forKey: "skippedBuild")
                guard r.build > Updater.currentBuild else {
                    if manual { self.alert("已是最新版本", "当前版本 \(Updater.currentVersion)") }
                    return
                }
                if !manual && r.build == skipped { return }
                self.offerUpdate(r)
            }
        }
    }

    func offerUpdate(_ r: Release) {
        let a = NSAlert()
        a.messageText = "DSH Remote 有新版本 \(r.version)"
        a.informativeText = "当前版本 \(Updater.currentVersion)。\n\(r.notes)"
        a.addButton(withTitle: "更新并重启")
        a.addButton(withTitle: "稍后")
        a.addButton(withTitle: "跳过此版本")
        switch a.runModal() {
        case .alertFirstButtonReturn:
            updating = true
            log("updating to \(r.version)")
            Updater.install(r) { [weak self] error in
                self?.updating = false
                if let error {
                    self?.alert("更新失败", error.localizedDescription)
                } else {
                    Updater.relaunch()
                }
            }
        case .alertThirdButtonReturn:
            UserDefaults.standard.set(r.build, forKey: "skippedBuild")
        default:
            break
        }
    }

    func alert(_ title: String, _ text: String) {
        let a = NSAlert()
        a.messageText = title
        a.informativeText = text
        a.runModal()
    }

    // MARK: menu actions

    @objc func reload() {
        switch route {
        case .ssh where tunnel.isRunning: webView.reload()
        case .web: webView.reload()
        default: connect()
        }
    }

    @objc func reconnect() {
        guard !quitting else { return }
        recovery.stop()
        restartSSHAfterConnect = false
        sshPageLive = false // settings may name another server
        if connecting {
            reconnectAfterConnect = true
            connectCommand?.cancel()
            tunnel.stop()
            return
        }
        tunnel.stop()
        route = .none
        connect()
    }

    func requireSSH() -> Bool {
        if !settings.server.isEmpty { return true }
        alert("需要 SSH", "这项操作需要在设置中填写服务器,并能用 SSH key 登录。")
        return false
    }

    @objc func restartService() {
        guard requireSSH() else { return }
        let a = NSAlert()
        a.messageText = "重启服务器上的 \(settings.service)?"
        a.informativeText = "正在运行的会话会被中断。"
        a.addButton(withTitle: "重启")
        a.addButton(withTitle: "取消")
        guard a.runModal() == .alertFirstButtonReturn else { return }
        let s = settings
        showStatus("正在重启服务 …")
        DispatchQueue.global().async {
            let r = Result { try SSH.run(s, SSH.restartCommand(s.service)) }
            DispatchQueue.main.async {
                if case .failure(let e) = r {
                    self.showStatus("重启失败", e.localizedDescription, retry: true)
                } else {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 3) { self.reconnect() }
                }
            }
        }
    }

    @objc func openClientLog() {
        let url = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Logs/DSHRemote.log")
        NSWorkspace.shared.open(url)
    }

    @objc func showLogs() {
        guard requireSSH() else { return }
        let s = settings
        DispatchQueue.global().async {
            let text: String
            do { text = try SSH.run(s, SSH.logsCommand(s.service)) } catch { text = "无法读取日志:\(error.localizedDescription)" }
            let redacted = text.replacingOccurrences(of: "token=[^ \\n]*", with: "token=<已隐藏>", options: .regularExpression)
            DispatchQueue.main.async {
                let a = NSAlert()
                a.messageText = "服务日志"
                let tv = NSTextView(frame: NSRect(x: 0, y: 0, width: 640, height: 360))
                tv.string = redacted
                tv.isEditable = false
                tv.font = .monospacedSystemFont(ofSize: 11, weight: .regular)
                let sv = NSScrollView(frame: tv.frame)
                sv.documentView = tv
                sv.hasVerticalScroller = true
                a.accessoryView = sv
                a.runModal()
            }
        }
    }

    @objc func openInBrowser() {
        let s = settings
        if let web = s.web { NSWorkspace.shared.open(web); return }
        guard route == .ssh else { return alert("无法打开", "尚未连接。") }
        // The browser has no dsh cookie of its own; give it a fresh token URL.
        DispatchQueue.global().async {
            let url = try? self.fetchLoginURL(s, using: SSHCommand())
            DispatchQueue.main.async { if let url { NSWorkspace.shared.open(url) } }
        }
    }

    @objc func openTerminal() {
        guard requireSSH() else { return }
        let s = settings
        let port = s.sshPort > 0 ? " -p \(s.sshPort)" : ""
        let cmd = "ssh -t\(port) \(s.sshDestination)"
        let script = "tell application \"Terminal\" to do script \"\(cmd.replacingOccurrences(of: "\"", with: "\\\""))\"\ntell application \"Terminal\" to activate"
        NSAppleScript(source: script)?.executeAndReturnError(nil)
    }

    @objc func webLogout() {
        guard case .web(let web) = route else {
            return alert("当前不是网页登录", "通过 SSH 连接时不使用访问密码。")
        }
        pendingPassword = ""
        webView.load(URLRequest(url: web.appendingPathComponent("__dsh/logout")))
    }

    // MARK: WKNavigationDelegate

    func isInternal(_ url: URL) -> Bool {
        if ["about", "blob", "data"].contains(url.scheme ?? "") { return true }
        return settings.internalHosts.contains(url.host ?? "")
    }

    func webView(_ wv: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { return decisionHandler(.allow) }
        log("navigate \(url.absoluteString) main=\(action.targetFrame?.isMainFrame ?? false)")
        if url.scheme == "dsh-remote" {
            decisionHandler(.cancel)
            if url.host == "settings" { openSettings() } else { reconnect() }
            return
        }
        if action.shouldPerformDownload { return decisionHandler(.download) }
        if !isInternal(url) && action.targetFrame?.isMainFrame != false {
            NSWorkspace.shared.open(url)
            return decisionHandler(.cancel)
        }
        decisionHandler(.allow)
    }

    func webView(_ wv: WKWebView, decidePolicyFor response: WKNavigationResponse,
                 decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        if let r = response.response as? HTTPURLResponse, response.isForMainFrame {
            log("response \(r.statusCode) \(r.url?.absoluteString ?? "")")
            if route == .ssh, let started = sshPageStarted {
                log("ssh: page response after \(String(format: "%.3f", ProcessInfo.processInfo.systemUptime - started))s")
            }
            // Over SSH a 401 means WebKit has no valid dsh login cookie; only a launch token can create one.
            if r.statusCode == 401 && route == .ssh {
                decisionHandler(.cancel)
                sshPageStarted = nil
                if sshLoadUsedToken {
                    sshLoadUsedToken = false
                    showStatus("服务拒绝了访问地址", "dsh 可能刚刚重启,请重新连接。", retry: true)
                } else {
                    log("ssh: page needs a launch token")
                    sshPageLive = false
                    sshNeedsToken = true
                    connectSSH(settings, fallbackToWeb: false)
                }
                return
            }
            if (r.value(forHTTPHeaderField: "Content-Disposition") ?? "").lowercased().hasPrefix("attachment") {
                return decisionHandler(.download)
            }
        }
        decisionHandler(response.canShowMIMEType ? .allow : .download)
    }

    func webView(_ wv: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) { download.delegate = self }
    func webView(_ wv: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) { download.delegate = self }

    func webView(_ wv: WKWebView, didFailProvisionalNavigation nav: WKNavigation!, withError error: Error) {
        log("provisional failure \(error)")
        if (error as NSError).code == NSURLErrorCancelled { return }
        if route == .ssh {
            guard !connecting, tunnel.isRunning else { return }
            tunnel.stop()
            scheduleSSHRetry(error.localizedDescription)
            return
        }
        if case .web = route, !settings.server.isEmpty, !webFellBack, !connecting {
            webFellBack = true
            log("web address unreachable, trying SSH")
            return connectSSH(settings, fallbackToWeb: false)
        }
        showStatus("页面加载失败", error.localizedDescription, retry: true, settingsLink: true)
    }

    func webView(_ wv: WKWebView, didFinish nav: WKNavigation!) {
        log("finished \(wv.url?.absoluteString ?? "")")
        if route == .ssh, wv.url?.host == "127.0.0.1" {
            sshPageLive = true
            sshLoadUsedToken = false
            if let started = sshPageStarted {
                log("ssh: page finished after \(String(format: "%.3f", ProcessInfo.processInfo.systemUptime - started))s")
                sshPageStarted = nil
            }
        }
        guard case .web(let web) = route, let url = wv.url, url.host == web.host else { return }
        guard url.path.hasSuffix("/__dsh/login") else {
            pendingPassword = "" // already logged in: the password is not needed
            return
        }
        guard !pendingPassword.isEmpty else { return }
        submitLogin(wv, password: pendingPassword)
        pendingPassword = "" // one attempt only; a wrong password leaves the page for manual entry
    }

    /// Fills and submits the gateway's login form. The page's own error message
    /// (wrong password, too many attempts) blocks the automatic submit.
    func submitLogin(_ wv: WKWebView, password: String) {
        guard let data = try? JSONSerialization.data(withJSONObject: [password]),
              let literal = String(data: data, encoding: .utf8) else { return }
        let js = """
        (function (p) {
          var f = document.querySelector('form[action$="/__dsh/login"]');
          if (!f || !f.elements.password || f.querySelector('.err')) return false;
          f.elements.password.value = p;
          f.submit();
          return true;
        })(\(literal)[0])
        """
        wv.evaluateJavaScript(js) { result, error in
            let outcome = error?.localizedDescription ?? String(describing: result ?? "nil")
            log("login form submitted: \(outcome)")
        }
    }

    func webView(_ wv: WKWebView, didFail nav: WKNavigation!, withError error: Error) { log("failed \(error)") }

    func webViewWebContentProcessDidTerminate(_ wv: WKWebView) { log("web content terminated"); reload() }

    // MARK: window chrome

    func userContentController(_ c: WKUserContentController, didReceive message: WKScriptMessage) {
        // Only the app's own pages may recolor the window.
        guard message.frameInfo.isMainFrame, let url = webView.url, isInternal(url) else { return }
        Chrome.handle(message.body, window: window)
    }

    // MARK: WKDownloadDelegate

    func download(_ d: WKDownload, decideDestinationUsing r: URLResponse, suggestedFilename name: String,
                  completionHandler: @escaping (URL?) -> Void) {
        let panel = NSSavePanel()
        panel.nameFieldStringValue = name
        panel.directoryURL = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask).first
        panel.beginSheetModal(for: window) { completionHandler($0 == .OK ? panel.url : nil) }
    }

    // MARK: WKUIDelegate

    func webView(_ wv: WKWebView, createWebViewWith c: WKWebViewConfiguration, for action: WKNavigationAction,
                 windowFeatures f: WKWindowFeatures) -> WKWebView? {
        if let url = action.request.url {
            if isInternal(url) { wv.load(action.request) } else { NSWorkspace.shared.open(url) }
        }
        return nil
    }

    func webView(_ wv: WKWebView, runOpenPanelWith p: WKOpenPanelParameters, initiatedByFrame f: WKFrameInfo,
                 completionHandler: @escaping ([URL]?) -> Void) {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = p.allowsMultipleSelection
        panel.canChooseDirectories = p.allowsDirectories
        panel.canChooseFiles = true
        panel.beginSheetModal(for: window) { completionHandler($0 == .OK ? panel.urls : nil) }
    }

    func webView(_ wv: WKWebView, runJavaScriptAlertPanelWithMessage m: String, initiatedByFrame f: WKFrameInfo,
                 completionHandler: @escaping () -> Void) {
        let a = NSAlert(); a.messageText = m
        a.beginSheetModal(for: window) { _ in completionHandler() }
    }

    func webView(_ wv: WKWebView, runJavaScriptConfirmPanelWithMessage m: String, initiatedByFrame f: WKFrameInfo,
                 completionHandler: @escaping (Bool) -> Void) {
        let a = NSAlert(); a.messageText = m
        a.addButton(withTitle: "确定"); a.addButton(withTitle: "取消")
        a.beginSheetModal(for: window) { completionHandler($0 == .alertFirstButtonReturn) }
    }

    func webView(_ wv: WKWebView, runJavaScriptTextInputPanelWithPrompt p: String, defaultText d: String?,
                 initiatedByFrame f: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
        let a = NSAlert(); a.messageText = p
        let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 300, height: 24))
        field.stringValue = d ?? ""
        a.accessoryView = field
        a.addButton(withTitle: "确定"); a.addButton(withTitle: "取消")
        a.beginSheetModal(for: window) { completionHandler($0 == .alertFirstButtonReturn ? field.stringValue : nil) }
    }

    func webView(_ wv: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin, initiatedByFrame f: WKFrameInfo,
                 type: WKMediaCaptureType, decisionHandler: @escaping (WKPermissionDecision) -> Void) {
        decisionHandler(settings.internalHosts.contains(origin.host) ? .grant : .deny)
    }

    // MARK: menu

    func buildMenu() {
        let main = NSMenu()
        func item(_ title: String, _ sel: Selector?, _ key: String = "", _ mods: NSEvent.ModifierFlags = .command, target: AnyObject? = nil) -> NSMenuItem {
            let i = NSMenuItem(title: title, action: sel, keyEquivalent: key)
            i.keyEquivalentModifierMask = mods
            i.target = target
            return i
        }
        func sub(_ title: String, _ items: [NSMenuItem]) -> NSMenuItem {
            let top = NSMenuItem(); let m = NSMenu(title: title)
            items.forEach(m.addItem); top.submenu = m; main.addItem(top); return top
        }
        _ = sub("DSH Remote", [
            item("关于 DSH Remote", #selector(NSApplication.orderFrontStandardAboutPanel(_:))),
            item("检查更新…", #selector(checkForUpdatesManually), target: self),
            .separator(),
            item("设置…", #selector(openSettings), ",", target: self),
            .separator(),
            item("隐藏 DSH Remote", #selector(NSApplication.hide(_:)), "h"),
            item("隐藏其他", #selector(NSApplication.hideOtherApplications(_:)), "h", [.command, .option]),
            .separator(),
            item("退出 DSH Remote", #selector(NSApplication.terminate(_:)), "q"),
        ])
        _ = sub("编辑", [
            item("撤销", Selector(("undo:")), "z"),
            item("重做", Selector(("redo:")), "z", [.command, .shift]),
            .separator(),
            item("剪切", #selector(NSText.cut(_:)), "x"),
            item("拷贝", #selector(NSText.copy(_:)), "c"),
            item("粘贴", #selector(NSText.paste(_:)), "v"),
            item("全选", #selector(NSText.selectAll(_:)), "a"),
        ])
        _ = sub("显示", [
            item("重新加载", #selector(reload), "r", target: self),
            item("放大", #selector(zoomIn), "=", target: self),
            item("缩小", #selector(zoomOut), "-", target: self),
            item("实际大小", #selector(zoomReset), "0", target: self),
            .separator(),
            item("切换全屏", #selector(NSWindow.toggleFullScreen(_:)), "f", [.command, .control]),
        ])
        _ = sub("服务", [
            item("重新连接", #selector(reconnect), "r", [.command, .shift], target: self),
            item("在浏览器中打开", #selector(openInBrowser), "o", [.command, .shift], target: self),
            item("在终端中登录服务器", #selector(openTerminal), "t", [.command, .shift], target: self),
            .separator(),
            item("打开客户端日志", #selector(openClientLog), target: self),
            item("查看日志", #selector(showLogs), "l", [.command, .shift], target: self),
            item("重启服务…", #selector(restartService), target: self),
            .separator(),
            item("退出网页登录", #selector(webLogout), target: self),
        ])
        let win = sub("窗口", [
            item("最小化", #selector(NSWindow.performMiniaturize(_:)), "m"),
            item("缩放", #selector(NSWindow.performZoom(_:))),
            item("关闭", #selector(NSWindow.performClose(_:)), "w"),
        ])
        NSApp.mainMenu = main
        NSApp.windowsMenu = win.submenu
    }

    @objc func zoomIn() { webView.pageZoom = min(webView.pageZoom + 0.1, 3) }
    @objc func zoomOut() { webView.pageZoom = max(webView.pageZoom - 0.1, 0.5) }
    @objc func zoomReset() { webView.pageZoom = 1 }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.activate(ignoringOtherApps: true)
app.run()
