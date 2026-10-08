import AppKit

@main
struct ChromeTests {
    static func main() {
        _ = NSApplication.shared
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 200, height: 100),
                              styleMask: [.titled], backing: .buffered, defer: false)
        Chrome.handle(["color": "#151517", "source": "dark"], window: window)
        precondition(window.appearance?.name == .darkAqua)
        Chrome.handle(["color": "#151517", "source": "system"], window: window)
        precondition(window.appearance == nil, "System must release the fixed dark appearance")
        Chrome.handle(["color": "#ffffff", "source": "system"], window: window)
        precondition(window.appearance == nil)
        Chrome.handle(["color": "#ffffff", "source": "light"], window: window)
        precondition(window.appearance?.name == .aqua)
        Chrome.handle(["color": "#ffffff", "source": "system"], window: window)
        precondition(window.appearance == nil, "System must release the fixed light appearance")
        Chrome.handle(["color": "#151517"], window: window)
        precondition(window.appearance?.name == .darkAqua)
        Chrome.handle(["color": "#ffffff"], window: window)
        precondition(window.appearance?.name == .aqua)
        Chrome.handle(["color": "invalid", "source": "system"], window: window)
        precondition(window.appearance?.name == .aqua)
        print("Chrome native appearance checks passed")
    }
}
