// mpv for the iOS app, built on MPVKit.
//
// Works like the desktop player (src-tauri/src/player.rs): the web page asks
// for `start`, `command`, `set`, `get` and `stop`, and gets every watched
// property back as a `prop` event (mpv's string form) plus `event`s for
// file-loaded, playback-restart, end-file and shutdown. So the web side's mpv
// client (src/lib/player/mpv.svelte.ts) is the same on both.
//
// The video draws into a Metal layer in a view *behind* the web view, which
// is made see-through; the player page's own background is transparent, so
// the Svelte controls sit on top of the picture exactly as on Windows.

import AVFoundation
import Foundation
import Libmpv
import Tauri
import UIKit
import WebKit

// MARK: - Arguments

private struct StartArgs: Decodable {
    let options: [String: String]
}

private struct CommandArgs: Decodable {
    let args: [String]
}

private struct SetArgs: Decodable {
    let name: String
    let value: String
}

private struct GetArgs: Decodable {
    let name: String
}

// MARK: - Events (same JSON as the desktop player's)

private struct PropEvent: Encodable {
    let name: String
    let value: String?
}

private struct GetResult: Encodable {
    let value: String?
}

private struct PlayerEvent: Encodable {
    let kind: String
    var reason: String? = nil
    var error: String? = nil
}

/// Properties the UI renders; the same list as OBSERVED in player.rs.
private let observed = [
    "time-pos", "duration", "pause", "paused-for-cache", "cache-buffering-state", "demuxer-cache-time",
    "volume", "mute", "track-list", "aid", "sid", "speed", "video-params/gamma", "video-params/w",
    "video-params/h", "hwdec-current", "eof-reached",
]

// MARK: - Video surface

/// MoltenVK briefly sets the drawable to 1×1 to finish presenting, which
/// flickers and can stick (https://github.com/mpv-player/mpv/pull/13651).
final class MpvMetalLayer: CAMetalLayer {
    override var drawableSize: CGSize {
        get { super.drawableSize }
        set {
            if Int(newValue.width) > 1 && Int(newValue.height) > 1 {
                super.drawableSize = newValue
            }
        }
    }

    // EDR (HDR) mode can only be switched on the main thread.
    override var wantsExtendedDynamicRangeContent: Bool {
        get { super.wantsExtendedDynamicRangeContent }
        set {
            if Thread.isMainThread {
                super.wantsExtendedDynamicRangeContent = newValue
            } else {
                DispatchQueue.main.sync { super.wantsExtendedDynamicRangeContent = newValue }
            }
        }
    }
}

final class VideoView: UIView {
    let metalLayer = MpvMetalLayer()

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = .black
        isUserInteractionEnabled = false
        metalLayer.contentsScale = UIScreen.main.nativeScale
        metalLayer.framebufferOnly = true
        metalLayer.backgroundColor = UIColor.black.cgColor
        layer.addSublayer(metalLayer)
    }

    required init?(coder: NSCoder) { fatalError("not used") }

    override func layoutSubviews() {
        super.layoutSubviews()
        metalLayer.frame = bounds
    }
}

// MARK: - Plugin

class MpvPlugin: Plugin {
    private var mpv: OpaquePointer?
    private weak var webView: WKWebView?
    private var videoView: VideoView?
    private var lastTimeEmit = Date.distantPast

    override func load(webview: WKWebView) {
        webView = webview
        // Let the video behind the page show through where the page is transparent.
        webview.isOpaque = false
        webview.backgroundColor = .clear
        webview.scrollView.backgroundColor = .clear

        let center = NotificationCenter.default
        center.addObserver(self, selector: #selector(didEnterBackground), name: UIApplication.didEnterBackgroundNotification, object: nil)
        center.addObserver(self, selector: #selector(willEnterForeground), name: UIApplication.willEnterForegroundNotification, object: nil)
    }

    // MARK: Commands

    /// Starts mpv behind the page (if it isn't running) with the given options.
    @objc public func start(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(StartArgs.self)
        if mpv != nil {
            invoke.resolve()
            return
        }
        DispatchQueue.main.async { [self] in
            do {
                try startPlayer(options: args.options)
                invoke.resolve()
            } catch {
                invoke.reject(error.localizedDescription)
            }
        }
    }

    @objc public func command(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(CommandArgs.self)
        guard let mpv else { return invoke.reject("The player isn't running.") }
        let code = withCStrings(args.args) { mpv_command(mpv, $0) }
        code >= 0 ? invoke.resolve() : invoke.reject(errorString(code))
    }

    @objc public func set(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(SetArgs.self)
        guard let mpv else { return invoke.reject("The player isn't running.") }
        let code = mpv_set_property_string(mpv, args.name, args.value)
        code >= 0 ? invoke.resolve() : invoke.reject(errorString(code))
    }

    @objc public func get(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(GetArgs.self)
        guard let mpv else { return invoke.reject("The player isn't running.") }
        var value: String?
        if let p = mpv_get_property_string(mpv, args.name) {
            value = String(cString: p)
            mpv_free(p)
        }
        // The web side unwraps `value` (see mpv.svelte.ts).
        invoke.resolve(GetResult(value: value))
    }

    /// Stops playback and shuts mpv down; the event thread finishes the teardown.
    @objc public func stop(_ invoke: Invoke) {
        if let mpv {
            _ = withCStrings(["quit"]) { mpv_command(mpv, $0) }
        }
        invoke.resolve()
    }

    // MARK: Player

    private func startPlayer(options: [String: String]) throws {
        guard let handle = mpv_create() else { throw PlayerError("mpv couldn't be created.") }

        // Playback audio: keeps playing with the silent switch on.
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .moviePlayback)
        try? AVAudioSession.sharedInstance().setActive(true)

        let view = attachVideoView()
        var layer = view.metalLayer
        mpv_set_option(handle, "wid", MPV_FORMAT_INT64, &layer)

        let defaults: [(String, String)] = [
            // The Svelte UI is the only on-screen display.
            ("osc", "no"),
            ("osd-level", "0"),
            ("input-default-bindings", "no"),
            ("input-vo-keyboard", "no"),
            ("keep-open", "yes"),
            ("idle", "yes"),
            ("force-window", "yes"),
            ("config", "no"),
            ("terminal", "no"),
            ("ytdl", "no"),
            ("video-rotate", "no"),
            ("background-color", "#000000"),
        ]
        for (k, v) in defaults { mpv_set_option_string(handle, k, v) }
        for (k, v) in options where mpv_set_option_string(handle, k, v) < 0 {
            NSLog("mpv: ignoring option \(k)=\(v)")
        }

        let code = mpv_initialize(handle)
        if code < 0 {
            mpv_terminate_destroy(handle)
            detachVideoView()
            throw PlayerError("mpv failed to start: \(errorString(code))")
        }
        for name in observed { mpv_observe_property(handle, 0, name, MPV_FORMAT_STRING) }
        mpv = handle
        startEventLoop(handle)
    }

    private func attachVideoView() -> VideoView {
        if let videoView { return videoView }
        let view = VideoView(frame: webView?.superview?.bounds ?? UIScreen.main.bounds)
        view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        if let webView, let parent = webView.superview {
            parent.insertSubview(view, belowSubview: webView)
        }
        videoView = view
        return view
    }

    private func detachVideoView() {
        videoView?.removeFromSuperview()
        videoView = nil
    }

    private func startEventLoop(_ handle: OpaquePointer) {
        let thread = Thread { [weak self] in
            while true {
                guard let ev = mpv_wait_event(handle, -1)?.pointee else { continue }
                switch ev.event_id {
                case MPV_EVENT_PROPERTY_CHANGE:
                    guard let prop = ev.data?.assumingMemoryBound(to: mpv_event_property.self).pointee else { break }
                    let name = String(cString: prop.name)
                    var value: String?
                    if prop.format == MPV_FORMAT_STRING, let data = prop.data,
                       let s = data.assumingMemoryBound(to: UnsafePointer<CChar>?.self).pointee {
                        value = String(cString: s)
                    }
                    // Position changes every frame; the UI only needs a few updates a second.
                    if name == "time-pos", let self {
                        if Date().timeIntervalSince(self.lastTimeEmit) < 0.2 { break }
                        self.lastTimeEmit = Date()
                    }
                    self?.emit("prop", PropEvent(name: name, value: value))
                case MPV_EVENT_FILE_LOADED:
                    self?.emit("event", PlayerEvent(kind: "file-loaded"))
                case MPV_EVENT_PLAYBACK_RESTART:
                    self?.emit("event", PlayerEvent(kind: "playback-restart"))
                case MPV_EVENT_END_FILE:
                    guard let end = ev.data?.assumingMemoryBound(to: mpv_event_end_file.self).pointee else { break }
                    let reason: String
                    switch end.reason {
                    case MPV_END_FILE_REASON_EOF: reason = "eof"
                    case MPV_END_FILE_REASON_STOP: reason = "stop"
                    case MPV_END_FILE_REASON_QUIT: reason = "quit"
                    case MPV_END_FILE_REASON_ERROR: reason = "error"
                    default: reason = "other"
                    }
                    let error = end.reason == MPV_END_FILE_REASON_ERROR ? String(cString: mpv_error_string(end.error)) : nil
                    self?.emit("event", PlayerEvent(kind: "end-file", reason: reason, error: error))
                case MPV_EVENT_SHUTDOWN:
                    // This thread owns the teardown: mpv forbids destroying the handle
                    // while another thread waits in mpv_wait_event.
                    DispatchQueue.main.sync {
                        if self?.mpv == handle { self?.mpv = nil }
                        self?.detachVideoView()
                    }
                    mpv_terminate_destroy(handle)
                    self?.emit("event", PlayerEvent(kind: "shutdown"))
                    return
                default:
                    break
                }
            }
        }
        thread.name = "mpv events"
        thread.qualityOfService = .userInitiated
        thread.start()
    }

    private func emit<T: Encodable>(_ event: String, _ payload: T) {
        do {
            try trigger(event, data: payload)
        } catch {
            NSLog("mpv: couldn't send \(event): \(error)")
        }
    }

    // Returning from the background with video on can leave a black picture;
    // turning the video track off and on again avoids it (as MPVKit's demo does).
    @objc private func didEnterBackground() {
        guard let mpv else { return }
        mpv_set_property_string(mpv, "pause", "yes")
        mpv_set_property_string(mpv, "vid", "no")
    }

    @objc private func willEnterForeground() {
        guard let mpv else { return }
        mpv_set_property_string(mpv, "vid", "auto")
    }
}

// MARK: - Helpers

private struct PlayerError: LocalizedError {
    let message: String
    init(_ message: String) { self.message = message }
    var errorDescription: String? { message }
}

private func errorString(_ code: Int32) -> String {
    String(cString: mpv_error_string(code))
}

/// Calls `body` with a NULL-terminated C array of the strings (for mpv_command).
private func withCStrings(_ strings: [String], _ body: (UnsafeMutablePointer<UnsafePointer<CChar>?>) -> Int32) -> Int32 {
    let owned = strings.map { strdup($0) }
    defer { owned.forEach { free($0) } }
    var ptrs: [UnsafePointer<CChar>?] = owned.map { UnsafePointer($0) }
    ptrs.append(nil)
    return ptrs.withUnsafeMutableBufferPointer { body($0.baseAddress!) }
}

@_cdecl("init_plugin_mpv")
func initPlugin() -> Plugin {
    MpvPlugin()
}
