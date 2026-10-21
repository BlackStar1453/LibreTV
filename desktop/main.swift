// LibreTV 菜单栏壳：WKWebView 加载本机常驻服务（LaunchAgent com.yao.libretv）
import Cocoa
import ServiceManagement
import WebKit

let serverURL = URL(string: "http://localhost:8080")!
let launchAgentLabel = "com.yao.libretv"

final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate,
    WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler
{
    var statusItem: NSStatusItem!
    var window: NSWindow!
    var webView: WKWebView!
    let menu = NSMenu()

    func applicationDidFinishLaunching(_ notification: Notification) {
        setupStatusItem()
        setupWindow()
        registerLoginItem()
        webView.load(URLRequest(url: serverURL))
        showWindow()
    }

    // MARK: 菜单栏图标

    func setupStatusItem() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        let image = NSImage(systemSymbolName: "play.tv", accessibilityDescription: "LibreTV")
        image?.isTemplate = true
        statusItem.button?.image = image
        statusItem.button?.target = self
        statusItem.button?.action = #selector(statusItemClicked)
        statusItem.button?.sendAction(on: [.leftMouseUp, .rightMouseUp])

        menu.addItem(withTitle: "打开窗口", action: #selector(showWindow), keyEquivalent: "")
        menu.addItem(withTitle: "在浏览器中打开", action: #selector(openInBrowser), keyEquivalent: "")
        menu.addItem(withTitle: "刷新页面", action: #selector(reloadPage), keyEquivalent: "")
        menu.addItem(withTitle: "重启服务", action: #selector(restartServer), keyEquivalent: "")
        menu.addItem(.separator())
        menu.addItem(withTitle: "退出 LibreTV", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        for item in menu.items where item.action != #selector(NSApplication.terminate(_:)) {
            item.target = self
        }
    }

    @objc func statusItemClicked() {
        if NSApp.currentEvent?.type == .rightMouseUp {
            // 临时挂上菜单再弹出，左键仍然走切换窗口
            statusItem.menu = menu
            statusItem.button?.performClick(nil)
            statusItem.menu = nil
        } else if window.isVisible && NSApp.isActive {
            window.orderOut(nil)
        } else {
            showWindow()
        }
    }

    // MARK: 窗口

    func setupWindow() {
        let config = WKWebViewConfiguration()
        config.preferences.isElementFullscreenEnabled = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.userContentController.add(self, name: "libretv")

        webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true

        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1200, height: 780),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered, defer: false)
        window.title = "LibreTV"
        window.contentView = webView
        window.delegate = self
        window.isReleasedWhenClosed = false
        window.collectionBehavior = [.fullScreenPrimary]
        window.setFrameAutosaveName("LibreTVMainWindow")
        if !window.setFrameUsingName("LibreTVMainWindow") { window.center() }
    }

    @objc func showWindow() {
        NSApp.activate(ignoringOtherApps: true)
        window.makeKeyAndOrderFront(nil)
    }

    // 关窗口只隐藏，不退出
    func windowShouldClose(_ sender: NSWindow) -> Bool {
        sender.orderOut(nil)
        return false
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        showWindow()
        return true
    }

    // MARK: 菜单动作

    @objc func openInBrowser() {
        NSWorkspace.shared.open(webView.url?.scheme == "http" ? webView.url! : serverURL)
    }

    @objc func reloadPage() {
        if webView.url?.host == serverURL.host { webView.reload() } else { webView.load(URLRequest(url: serverURL)) }
    }

    @objc func restartServer() {
        let task = Process()
        task.executableURL = URL(fileURLWithPath: "/bin/launchctl")
        task.arguments = ["kickstart", "-k", "gui/\(getuid())/\(launchAgentLabel)"]
        try? task.run()
        task.waitUntilExit()
        // Next.js 冷启动需要几秒
        DispatchQueue.main.asyncAfter(deadline: .now() + 4) { [weak self] in
            self?.webView.load(URLRequest(url: serverURL))
        }
    }

    // MARK: 开机自启

    func registerLoginItem() {
        if SMAppService.mainApp.status != .enabled {
            try? SMAppService.mainApp.register()
        }
    }

    // MARK: WebView

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        showOfflinePage()
    }

    // target=_blank 链接在当前窗口打开
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView?
    {
        if let url = navigationAction.request.url { webView.load(URLRequest(url: url)) }
        return nil
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        if message.body as? String == "restart" { restartServer() }
    }

    func showOfflinePage() {
        let html = """
        <html><body style="font-family:-apple-system;display:flex;flex-direction:column;align-items:center;
        justify-content:center;height:100vh;margin:0;background:#111;color:#ddd">
        <h2>LibreTV 服务未运行</h2>
        <p style="color:#888">无法连接 \(serverURL.absoluteString)</p>
        <button onclick="this.disabled=true;this.innerText='正在重启…';webkit.messageHandlers.libretv.postMessage('restart')"
          style="font-size:15px;padding:8px 20px;border-radius:8px;border:0;background:#e50914;color:#fff;cursor:pointer">
          重启服务</button>
        </body></html>
        """
        webView.loadHTMLString(html, baseURL: nil)
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
