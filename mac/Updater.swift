// In-app updates from the GitHub releases of the repository named by the
// DSHRemoteUpdateRepo Info.plist key (set at build time). Releases are tagged
// v1.0.<build>; a release is newer when its build number exceeds CFBundleVersion.

import AppKit

struct Release {
    let build: Int
    let version: String
    let zip: URL
    let notes: String
}

enum Updater {
    static var repo: String? {
        let r = (Bundle.main.object(forInfoDictionaryKey: "DSHRemoteUpdateRepo") as? String ?? "").trimmed
        return r.isEmpty ? nil : r
    }

    static var currentBuild: Int {
        Int(Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "") ?? 0
    }

    static var currentVersion: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "?"
    }

    static func fail(_ msg: String) -> NSError {
        NSError(domain: "update", code: 1, userInfo: [NSLocalizedDescriptionKey: msg])
    }

    /// Fetches the latest release; completes on the main queue. Uses the
    /// github.com/<repo>/releases/latest redirect to the newest tag rather than
    /// the REST API, whose anonymous limit is shared by everyone behind one IP.
    static func latest(_ done: @escaping (Result<Release, Error>) -> Void) {
        guard let repo else { return done(.failure(fail("此版本未配置更新源(DSHRemoteUpdateRepo)"))) }
        var req = URLRequest(url: URL(string: "https://github.com/\(repo)/releases/latest")!)
        req.httpMethod = "HEAD"
        req.cachePolicy = .reloadIgnoringLocalCacheData
        req.setValue("DSH-Remote/\(currentBuild)", forHTTPHeaderField: "User-Agent")
        URLSession.shared.dataTask(with: req) { _, resp, err in
            let result: Result<Release, Error> = Result {
                if let err { throw err }
                guard let http = resp as? HTTPURLResponse, http.statusCode == 200, let final = http.url,
                      final.path.contains("/releases/tag/") else {
                    throw fail("无法读取 \(repo) 的最新版本(HTTP \((resp as? HTTPURLResponse)?.statusCode ?? 0))")
                }
                let tag = final.lastPathComponent
                guard tag.hasPrefix("v"), let build = Int(tag.split(separator: ".").last ?? "") else {
                    throw fail("无法识别的版本标签 \(tag)")
                }
                let zip = URL(string: "https://github.com/\(repo)/releases/download/\(tag)/DSH-Remote.zip")!
                return Release(build: build, version: String(tag.dropFirst()), zip: zip,
                               notes: "https://github.com/\(repo)/releases/tag/\(tag)")
            }
            DispatchQueue.main.async { done(result) }
        }.resume()
    }

    /// Downloads the release and replaces the running app bundle; completes on the main queue.
    static func install(_ r: Release, _ done: @escaping (Error?) -> Void) {
        URLSession.shared.downloadTask(with: r.zip) { tmp, resp, err in
            let error: Error? = {
                do {
                    if let err { throw err }
                    guard let tmp, (resp as? HTTPURLResponse)?.statusCode == 200 else { throw fail("下载失败") }
                    let fm = FileManager.default
                    let dir = fm.temporaryDirectory.appendingPathComponent("dsh-remote-update-\(UUID().uuidString)")
                    try fm.createDirectory(at: dir, withIntermediateDirectories: true)
                    let zip = dir.appendingPathComponent("DSH-Remote.zip")
                    try fm.moveItem(at: tmp, to: zip)
                    try runTool("/usr/bin/ditto", ["-x", "-k", zip.path, dir.path])
                    let app = dir.appendingPathComponent("DSH Remote.app")
                    guard Bundle(url: app)?.bundleIdentifier == Bundle.main.bundleIdentifier else {
                        throw fail("下载的文件不是 DSH Remote")
                    }
                    try? runTool("/usr/bin/xattr", ["-dr", "com.apple.quarantine", app.path])
                    let target = Bundle.main.bundleURL
                    guard fm.isWritableFile(atPath: target.deletingLastPathComponent().path) else {
                        throw fail("没有权限写入 \(target.deletingLastPathComponent().path),请把应用放到「应用程序」或 ~/Applications 后重试")
                    }
                    _ = try fm.replaceItemAt(target, withItemAt: app)
                    try? fm.removeItem(at: dir)
                    refreshIcon(target)
                    return nil
                } catch {
                    return error
                }
            }()
            DispatchQueue.main.async { done(error) }
        }.resume()
    }

    /// Reopens the (replaced) bundle after this process exits.
    static func relaunch() {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/bin/sh")
        p.arguments = ["-c", "sleep 1; /usr/bin/open \"$0\"", Bundle.main.bundlePath]
        try? p.run()
        NSApp.terminate(nil)
    }

    /// The bundle keeps its path across updates, so Finder and the Dock keep showing
    /// the cached icon. A new modification date plus re-registering the bundle with
    /// LaunchServices makes them read the new one.
    static func refreshIcon(_ bundle: URL) {
        try? FileManager.default.setAttributes([.modificationDate: Date()], ofItemAtPath: bundle.path)
        try? runTool("/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister",
                     ["-f", bundle.path])
        NSWorkspace.shared.noteFileSystemChanged(bundle.path)
    }

    private static func runTool(_ path: String, _ args: [String]) throws {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: path)
        p.arguments = args
        try p.run()
        p.waitUntilExit()
        if p.terminationStatus != 0 { throw fail("\(path) 失败(\(p.terminationStatus))") }
    }
}
