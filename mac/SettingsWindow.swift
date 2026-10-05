// The settings window: server address, SSH port and user, web address, updates.

import AppKit

final class SettingsWindowController: NSWindowController, NSWindowDelegate {
    var onSave: ((Settings) -> Void)?
    private var base: Settings
    private let server = NSTextField()
    private let sshPort = NSTextField()
    private let sshUser = NSTextField()
    private let webURL = NSTextField()
    private let autoUpdate = NSButton(checkboxWithTitle: "自动检查更新", target: nil, action: nil)

    init(settings: Settings) {
        base = settings
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 540, height: 300),
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
        server.placeholderString = "IP 或域名,例如 203.0.113.10"
        sshPort.placeholderString = "22"
        sshUser.placeholderString = "dsh"
        webURL.placeholderString = "可选,例如 https://dsh.example.com"
        for f in [server, sshPort, sshUser, webURL] { f.lineBreakMode = .byTruncatingTail }

        let grid = NSGridView(views: [
            [label("服务器"), server],
            [label("SSH 端口"), sshPort],
            [label("SSH 用户"), sshUser],
            [label("网页地址"), webURL],
            [NSGridCell.emptyContentView, autoUpdate],
        ])
        grid.rowSpacing = 10
        grid.columnSpacing = 10
        grid.column(at: 0).xPlacement = .trailing
        grid.column(at: 1).width = 380

        let note = hint("连接时优先使用本机的 SSH key 登录服务器;SSH 不可用时改用网页地址,在页面中输入访问密码。两项至少填一项。服务端安装方法见项目 README。")

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
        window?.makeFirstResponder(server)
    }

    @objc private func cancel() { window?.close() }

    @objc private func save() {
        var s = base
        s.server = server.stringValue.trimmed
        s.sshUser = sshUser.stringValue.trimmed
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
        if !s.isConfigured { return complain("请至少填写服务器或网页地址。") }
        s.save()
        window?.close()
        onSave?(s)
    }

    private func complain(_ msg: String) {
        let a = NSAlert()
        a.messageText = msg
        a.beginSheetModal(for: window!)
    }
}
