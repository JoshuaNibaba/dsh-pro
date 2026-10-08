// The settings window: web address and password, optional SSH access, updates.

import AppKit

final class SettingsWindowController: NSWindowController, NSWindowDelegate {
    /// Called with the saved settings and the password typed this time ("" = none).
    var onSave: ((Settings, String) -> Void)?
    private var base: Settings
    private let server = NSTextField()
    private let sshPort = NSTextField()
    private let sshUser = NSTextField()
    private let webURL = NSTextField()
    private let password = NSSecureTextField()
    private let preferSSH = NSButton(checkboxWithTitle: "优先使用 SSH 隧道(网页地址作为备用)", target: nil, action: nil)
    private let autoUpdate = NSButton(checkboxWithTitle: "自动检查更新", target: nil, action: nil)

    init(settings: Settings) {
        base = settings
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 540, height: 420),
                              styleMask: [.titled, .closable], backing: .buffered, defer: false)
        window.title = "DSH Remote 设置"
        super.init(window: window)
        window.delegate = self
        build()
        fill(settings)
    }

    required init?(coder: NSCoder) { fatalError("not used") }

    func fill(_ s: Settings) {
        base = s
        server.stringValue = s.server
        sshPort.stringValue = s.sshPort > 0 ? String(s.sshPort) : ""
        sshUser.stringValue = s.sshUser
        webURL.stringValue = s.webURL
        password.stringValue = ""
        preferSSH.state = s.preferSSH ? .on : .off
        autoUpdate.state = s.autoUpdate ? .on : .off
    }

    private func label(_ text: String) -> NSTextField {
        let l = NSTextField(labelWithString: text)
        l.alignment = .right
        return l
    }

    private func hint(_ text: String) -> NSTextField {
        let l = NSTextField(wrappingLabelWithString: text)
        l.font = .systemFont(ofSize: NSFont.smallSystemFontSize)
        l.textColor = .secondaryLabelColor
        return l
    }

    private func build() {
        webURL.placeholderString = "例如 https://dsh.example.com"
        password.placeholderString = "首次登录或密码修改后填写,不会保存"
        server.placeholderString = "可选,服务器 IP 或 ~/.ssh/config 别名"
        sshPort.placeholderString = "22"
        sshUser.placeholderString = "dsh"
        for f in [webURL, password, server, sshPort, sshUser] { f.lineBreakMode = .byTruncatingTail }

        let grid = NSGridView(views: [
            [label("网页地址"), webURL],
            [label("访问密码"), password],
            [label("SSH 服务器"), server],
            [label("SSH 端口"), sshPort],
            [label("SSH 用户"), sshUser],
            [NSGridCell.emptyContentView, preferSSH],
            [NSGridCell.emptyContentView, autoUpdate],
        ])
        grid.rowSpacing = 10
        grid.columnSpacing = 10
        grid.column(at: 0).xPlacement = .trailing
        grid.column(at: 1).width = 380

        let note = hint("推荐只填网页地址和访问密码:与浏览器登录相同,登录后保持一年,密码只用于这次登录,不会保存。"
            + "SSH 为可选项(需要本机 SSH key),用于查看日志、重启服务、在终端登录;网页地址打不开时也会改用 SSH 隧道。"
            + "网页地址和 SSH 服务器至少填一项。")

        let cancel = NSButton(title: "取消", target: self, action: #selector(cancel))
        cancel.keyEquivalent = "\u{1b}"
        let save = NSButton(title: "保存并连接", target: self, action: #selector(save))
        save.keyEquivalent = "\r"
        let buttons = NSStackView(views: [cancel, save])
        buttons.spacing = 8

        let stack = NSStackView(views: [grid, note, buttons])
        stack.orientation = .vertical
        stack.alignment = .trailing
        stack.spacing = 16
        stack.edgeInsets = NSEdgeInsets(top: 20, left: 20, bottom: 20, right: 20)
        note.widthAnchor.constraint(equalTo: grid.widthAnchor).isActive = true
        window?.contentView = stack
    }

    func show() {
        window?.center()
        window?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        window?.makeFirstResponder(webURL)
    }

    @objc private func cancel() {
        password.stringValue = ""
        window?.close()
    }

    @objc private func save() {
        var s = base
        s.server = server.stringValue.trimmed
        s.sshUser = sshUser.stringValue.trimmed
        s.preferSSH = preferSSH.state == .on
        s.autoUpdate = autoUpdate.state == .on
        let portText = sshPort.stringValue.trimmed
        if portText.isEmpty {
            s.sshPort = 0
        } else if let p = Int(portText), (1...65535).contains(p) {
            s.sshPort = p
        } else {
            return complain("SSH 端口必须是 1–65535 之间的数字。")
        }
        let webText = webURL.stringValue.trimmed
        if webText.isEmpty {
            s.webURL = ""
        } else if let u = Settings.normalizeWeb(webText) {
            s.webURL = u.absoluteString
        } else {
            return complain("网页地址无效,例如 https://dsh.example.com")
        }
        if !s.isConfigured { return complain("请至少填写网页地址或 SSH 服务器。") }
        if s.preferSSH && s.server.isEmpty { return complain("勾选「优先使用 SSH 隧道」时需要填写 SSH 服务器。") }
        let pw = password.stringValue
        password.stringValue = ""
        s.save()
        window?.close()
        onSave?(s, pw)
    }

    private func complain(_ msg: String) {
        let a = NSAlert()
        a.messageText = msg
        a.beginSheetModal(for: window!)
    }
}
