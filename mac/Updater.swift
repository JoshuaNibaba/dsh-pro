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

    /// Fetches the latest release; completes on the main queue.
    static func latest(_ done: @escaping (Result<Release, Error>) -> Void) {
        guard let repo else { return done(.failure(fail("此版本未配置更新源(DSHRemoteUpdateRepo)"))) }
        var req = URLRequest(url: URL(string: "https://api.github.com/repos/\(repo)/releases/latest")!)
        req.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        req.setValue("DSH-Remote/\(currentBuild)", forHTTPHeaderField: "User-Agent")
        req.cachePolicy = .reloadIgnoringLocalCacheData
        URLSession.shared.dataTask(with: req) { data, resp, err in
            let result: Result<Release, Error> = Result {
                if let err { throw err }
                guard let http = resp as? HTTPURLResponse, http.statusCode == 200, let data,
                      let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                      let tag = json["tag_name"] as? String else {
                    throw fail("无法读取 \(repo) 的最新版本(HTTP \((resp as? HTTPURLResponse)?.statusCode ?? 0))")
                }
                let assets = json["assets"] as? [[String: Any]] ?? []
                guard let asset = assets.first(where: { $0["name"] as? String == "DSH-Remote.zip" }),
                      let urlString = asset["browser_download_url"] as? String, let zip = URL(string: urlString) else {
                    throw fail("最新版本 \(tag) 中没有 DSH-Remote.zip")
                }
                let build = Int(tag.split(separator: ".").last ?? "") ?? 0
                return Release(build: build, version: String(tag.drop(while: { $0 == "v" })),
                               zip: zip, notes: json["body"] as? String ?? "")
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

    private static func runTool(_ path: String, _ args: [String]) throws {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: path)
        p.arguments = args
        try p.run()
        p.waitUntilExit()
        if p.terminationStatus != 0 { throw fail("\(path) 失败(\(p.terminationStatus))") }
    }
}
