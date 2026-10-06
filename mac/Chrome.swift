// Title bar that follows the dsh theme.
//
// The title bar is transparent, so it shows the window background, and a page
// script reports the page's background color: dsh publishes it in
// <meta name="theme-color"> after every theme change (light, dark, or a custom
// theme). The window follows the page's theme source: system inherits macOS
// appearance, while fixed themes use their resolved light or dark scheme.
//
// The page is deliberately not marked as the DSH desktop shell
// (<html data-platform>): dsh then expects the Electron preload bridges, and
// its shortcuts plugin fails to start without them.

import AppKit
import WebKit

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

    /// Runs at document start in the main frame; reports background and theme-source changes.
    static let script = """
    (function () {
      var sent = null;
      function report() {
        var meta = document.querySelector('meta[name="theme-color"]');
        var color = meta && meta.content;
        var source = document.documentElement.getAttribute('data-ds-theme-source');
        if (!color && document.body) color = getComputedStyle(document.body).backgroundColor;
        var key = JSON.stringify([color, source]);
        if (color && key !== sent) {
          sent = key;
          window.webkit.messageHandlers.\(handlerName).postMessage({ color: color, source: source });
        }
      }
      new MutationObserver(report).observe(document.documentElement,
        { subtree: true, childList: true, attributes: true,
          attributeFilter: ['content', 'data-ds-dark-theme', 'data-ds-theme-source'] });
      document.addEventListener('DOMContentLoaded', report);
      window.addEventListener('load', report);
    })();
    """

    /// Adds the page script and its message handler to a configuration.
    static func configure(_ config: WKWebViewConfiguration, handler: WKScriptMessageHandler) {
        let c = config.userContentController
        c.addUserScript(WKUserScript(source: script, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        c.add(WeakScriptHandler(handler), name: handlerName)
    }

    /// Makes the title bar transparent so it shows the window background color.
    static func install(_ window: NSWindow) {
        window.titlebarAppearsTransparent = true
    }

    /// Applies the page background and theme source; older pages fall back to color luminance.
    static func handle(_ body: Any, window: NSWindow) {
        guard let message = body as? [String: Any], let text = message["color"] as? String,
              let color = parse(text) else { return }
        window.backgroundColor = color
        switch message["source"] as? String {
        case "system": window.appearance = nil
        case "light": window.appearance = NSAppearance(named: .aqua)
        case "dark": window.appearance = NSAppearance(named: .darkAqua)
        default:
            let rgb = color.usingColorSpace(.sRGB) ?? color
            let luminance = 0.2126 * rgb.redComponent + 0.7152 * rgb.greenComponent + 0.0722 * rgb.blueComponent
            window.appearance = NSAppearance(named: luminance < 0.5 ? .darkAqua : .aqua)
        }
    }

    /// Parses `rgb(r, g, b)`, `rgba(r, g, b, a)` (opaque only) and `#rrggbb`.
    static func parse(_ text: String) -> NSColor? {
        let s = text.trimmingCharacters(in: .whitespaces).lowercased()
        if s.hasPrefix("#"), s.count == 7, let v = Int(s.dropFirst(), radix: 16) {
            return NSColor(srgbRed: CGFloat((v >> 16) & 0xff) / 255, green: CGFloat((v >> 8) & 0xff) / 255,
                           blue: CGFloat(v & 0xff) / 255, alpha: 1)
        }
        guard s.hasPrefix("rgb"), let open = s.firstIndex(of: "("), let close = s.lastIndex(of: ")") else { return nil }
        let parts = s[s.index(after: open)..<close]
            .split(whereSeparator: { $0 == "," || $0 == " " || $0 == "/" })
            .compactMap { Double($0) }
        guard parts.count >= 3, parts.count < 4 || parts[3] > 0.99 else { return nil }
        return NSColor(srgbRed: parts[0] / 255, green: parts[1] / 255, blue: parts[2] / 255, alpha: 1)
    }
}
