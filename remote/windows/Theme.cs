using System.Runtime.InteropServices;
using System.Text.RegularExpressions;

namespace DshRemote;

internal static class Theme
{
    // The page remains a Web client; Electron's data-platform would require an unavailable preload bridge.
    internal const string Script = """
        (() => {
          if (window !== window.top) return;
          let last;
          function report() {
            const color = document.querySelector('meta[name="theme-color"]')?.content
              || (document.body && getComputedStyle(document.body).backgroundColor);
            if (color && color !== last) { last = color; window.chrome.webview.postMessage({ dshTheme: color }); }
          }
          new MutationObserver(report).observe(document, {
            subtree: true, childList: true, attributes: true,
            attributeFilter: ['content', 'data-ds-dark-theme', 'data-ds-theme-source']
          });
          document.addEventListener('DOMContentLoaded', report);
          window.addEventListener('load', report);
        })();
        """;

    internal static Color? Parse(string? raw)
    {
        if (raw == null) return null;
        var hex = Regex.Match(raw.Trim(), "^#([0-9a-fA-F]{6})$");
        if (hex.Success)
        {
            var value = Convert.ToInt32(hex.Groups[1].Value, 16);
            return Color.FromArgb((value >> 16) & 255, (value >> 8) & 255, value & 255);
        }
        var rgb = Regex.Match(raw.Trim(), @"^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*1(?:\.0*)?)?\s*\)$");
        if (!rgb.Success) return null;
        var channels = Enumerable.Range(1, 3).Select(i => int.Parse(rgb.Groups[i].Value)).ToArray();
        return channels.Any(c => c > 255) ? null : Color.FromArgb(channels[0], channels[1], channels[2]);
    }

    internal static void Apply(Form window, ToolStrip menu, ToolStrip strip, Color color)
    {
        var dark = 0.2126 * color.R + 0.7152 * color.G + 0.0722 * color.B < 128;
        window.BackColor = color;
        foreach (var bar in new[] { menu, strip })
        {
            bar.BackColor = color;
            bar.ForeColor = dark ? Color.WhiteSmoke : Color.FromArgb(24, 24, 24);
            foreach (ToolStripItem item in bar.Items) item.ForeColor = bar.ForeColor;
        }
        var mode = dark ? 1 : 0;
        // Windows 10 supports dark captions; Windows 11 also accepts an exact caption color.
        _ = DwmSetWindowAttribute(window.Handle, 20, ref mode, sizeof(int));
        if (OperatingSystem.IsWindowsVersionAtLeast(10, 0, 22000))
        {
            var caption = color.R | (color.G << 8) | (color.B << 16);
            _ = DwmSetWindowAttribute(window.Handle, 35, ref caption, sizeof(int));
        }
    }

    [DllImport("dwmapi.dll")]
    private static extern int DwmSetWindowAttribute(IntPtr window, int attribute, ref int value, int size);
}
