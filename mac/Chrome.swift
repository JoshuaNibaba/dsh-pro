// Window chrome in the style of the DSH desktop app: the dsh page fills the whole
// window, including the title bar, so the page's theme covers every pixel.
//
// The page is told it runs in the macOS desktop shell (<html data-platform="darwin">,
// as DSH's Electron preload does). dsh then reserves room for the traffic lights,
// marks its title rows with data-window-drag, and draws a transparent page with a
// translucent sidebar over the window's sidebar vibrancy. WKWebView has no
// -webkit-app-region, so a page script reports presses on those rows and the
// window drags itself; the theme preference drives the native appearance so the
// vibrancy and system controls match the page.

import AppKit
import WebKit

/// Traffic-light origin dsh lays its title rows out for (DSH desktop: trafficLightPosition 16, 18).
let trafficLightInset = NSPoint(x: 16, y: 18)

/// WKWebView that remembers the press a drag request refers to.
final class ChromeWebView: WKWebView {
    private(set) var lastMouseDown: NSEvent?

    override func mouseDown(with event: NSEvent) {
        lastMouseDown = event
        super.mouseDown(with: event)
    }

    override var mouseDownCanMoveWindow: Bool { false }
}

/// Forwards page messages without the content controller retaining the app delegate.
final class WeakScriptHandler: NSObject, WKScriptMessageHandler {
    weak var target: WKScriptMessageHandler?
    init(_ target: WKScriptMessageHandler) { self.target = target }
    func userContentController(_ c: WKUserContentController, didReceive m: WKScriptMessage) {
        target?.userContentController(c, didReceive: m)
    }
}

enum Chrome {
    static let handlerName = "dshChrome"

    /// Runs at document start in the main frame of every page the app loads.
    static let script = """
    (function () {
      var root = document.documentElement;
      root.dataset.platform = 'darwin';
      var post = function (m) { window.webkit.messageHandlers.\(handlerName).postMessage(m); };
      var controls = 'button,a,input,textarea,select,label,summary,[role=button],[role=tab],[role=menuitem],'
        + '[role=checkbox],[role=switch],[contenteditable=""],[contenteditable=true],[draggable=true]';
      function draggable(e) {
        if (e.button !== 0 || e.defaultPrevented) return false;
        var t = e.target instanceof Element ? e.target : null;
        if (!t || t.closest(controls)) return false;
        if (t.closest('[data-window-drag]')) return true;
        // Pages without dsh title rows (status, login) drag by the title bar band.
        return !document.querySelector('[data-window-drag]') && e.clientY < 36;
      }
      window.addEventListener('mousedown', function (e) {
        if (draggable(e)) post(e.detail === 2 ? 'zoom' : 'drag');
      }, true);
      var sent = null;
      function sendTheme() {
        var v = root.getAttribute('data-ds-theme-source') || 'system';
        if (v !== sent) { sent = v; post({ theme: v }); }
      }
      new MutationObserver(sendTheme).observe(root, { attributeFilter: ['data-ds-theme-source'] });
      sendTheme();
    })();
    """

    /// Adds the page script and its message handler to a configuration.
    static func configure(_ config: WKWebViewConfiguration, handler: WKScriptMessageHandler) {
        let c = config.userContentController
        c.addUserScript(WKUserScript(source: script, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        c.add(WeakScriptHandler(handler), name: handlerName)
    }

    /// Makes the title bar transparent and puts the page over sidebar vibrancy.
    static func install(_ window: NSWindow, webView: WKWebView) {
        window.styleMask.insert(.fullSizeContentView)
        window.titlebarAppearsTransparent = true
        window.titleVisibility = .hidden
        window.isMovableByWindowBackground = false

        let glass = NSVisualEffectView()
        glass.material = .sidebar
        glass.blendingMode = .behindWindow
        glass.state = .active
        webView.setValue(false, forKey: "drawsBackground")
        webView.underPageBackgroundColor = .clear
        webView.autoresizingMask = [.width, .height]
        glass.addSubview(webView)
        window.contentView = glass
        webView.frame = glass.bounds
        layoutTrafficLights(window)
    }

    /// Moves the traffic lights to `trafficLightInset`. AppKit resets them on
    /// resize and fullscreen changes, so callers repeat this after each.
    static func layoutTrafficLights(_ window: NSWindow) {
        guard !window.styleMask.contains(.fullScreen),
              let close = window.standardWindowButton(.closeButton),
              let mini = window.standardWindowButton(.miniaturizeButton),
              let zoom = window.standardWindowButton(.zoomButton),
              let container = close.superview?.superview else { return }
        let height = close.frame.height + trafficLightInset.y
        var bar = container.frame
        bar.size.height = height
        bar.origin.y = window.frame.height - height
        container.frame = bar
        let spacing = mini.frame.minX - close.frame.minX
        for (i, button) in [close, mini, zoom].enumerated() {
            button.setFrameOrigin(NSPoint(x: trafficLightInset.x + CGFloat(i) * spacing, y: button.frame.minY))
        }
    }

    /// Mirrors the window's fullscreen state onto `<html data-fullscreen>`, where dsh drops
    /// the traffic-light clearance.
    static func syncFullscreen(_ window: NSWindow, _ webView: WKWebView) {
        let on = window.styleMask.contains(.fullScreen)
        webView.evaluateJavaScript(on
            ? "document.documentElement.dataset.fullscreen = 'true'"
            : "delete document.documentElement.dataset.fullscreen", completionHandler: nil)
    }

    /// Handles one page message: start a window drag, zoom on double-click, or follow the theme.
    static func handle(_ body: Any, window: NSWindow, webView: ChromeWebView) {
        if let command = body as? String {
            guard NSEvent.pressedMouseButtons & 1 == 1 || command == "zoom" else { return }
            if command == "zoom" {
                switch UserDefaults.standard.string(forKey: "AppleActionOnDoubleClick") {
                case "Minimize": window.performMiniaturize(nil)
                case "None": break
                default: window.performZoom(nil)
                }
            } else if let press = webView.lastMouseDown {
                window.performDrag(with: press)
            }
            return
        }
        if let theme = (body as? [String: Any])?["theme"] as? String {
            switch theme {
            case "light": window.appearance = NSAppearance(named: .aqua)
            case "dark": window.appearance = NSAppearance(named: .darkAqua)
            default: window.appearance = nil
            }
        }
    }
}
