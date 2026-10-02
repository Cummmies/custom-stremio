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
//
// Now Playing (Control Center, the Lock Screen): mpv doesn't report to iOS
// the way AVPlayer does, so the page sends the title, episode and artwork
// (`nowPlaying`) and this file adds the position, length and play/pause
// state from mpv's own properties. The system's buttons (play/pause, ±10s,
// dragging the bar) act on mpv here; the page hears the result as usual.

import AVFoundation
import Foundation
import Libmpv
import MediaPlayer
import MpvSystemLinks
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

private struct ThumbArgs: Decodable {
    let url: String
    let time: Double
    let width: Int
}

private struct ThumbResult: Encodable {
    /// Base64 JPEG.
    let data: String
}

private struct NowPlayingArgs: Decodable {
    let title: String
    let subtitle: String
    /// Artwork (an http(s) URL), if any.
    let image: String?
}

private struct OrientationArgs: Decodable {
    /// true: landscape only (while a video plays); false: back to portrait.
    let landscape: Bool
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

    // HDR: mpv turns on the screen's extended range (EDR) for HDR video
    // (target-colorspace-hint), which iOS only honours on the main thread.
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

    // Now Playing: what the page sent, and mpv's playback state (written on
    // the event thread, read on the main thread).
    private var nowPlayingInfo: [String: Any]?
    private var artworkURL: String?
    private var remoteCommandsReady = false
    private let stateLock = NSLock()
    private var position = 0.0
    private var duration = 0.0
    private var paused = true
    private var speed = 1.0

    override func load(webview: WKWebView) {
        webView = webview
        // Let the video behind the page show through where the page is transparent.
        webview.isOpaque = false
        webview.backgroundColor = .clear
        webview.scrollView.backgroundColor = .clear

        // Browsing is portrait (the phone layout); the player switches to landscape.
        // (A moment later: the web view isn't in its window yet while loading.)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
            guard let vc = webview.window?.rootViewController else { return }
            OrientationLock.install(on: vc)
            OrientationLock.mask = .portrait
            vc.setNeedsUpdateOfSupportedInterfaceOrientations()
        }

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

    /// Landscape while a video plays; portrait (the browsing layout) otherwise.
    @objc public func orientation(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(OrientationArgs.self)
        DispatchQueue.main.async { [self] in
            guard let vc = webView?.window?.rootViewController,
                  let scene = webView?.window?.windowScene
            else { return invoke.resolve() }
            OrientationLock.install(on: vc)
            OrientationLock.mask = args.landscape ? .landscape : .portrait
            vc.setNeedsUpdateOfSupportedInterfaceOrientations()
            scene.requestGeometryUpdate(.iOS(interfaceOrientations: OrientationLock.mask!)) { error in
                NSLog("mpv: orientation change refused: \(error)")
            }
            invoke.resolve()
        }
    }

    // MARK: Seek-bar thumbnails (Thumbnailer.swift), one at a time off the main thread.

    private let thumbQueue = DispatchQueue(label: "mpv thumbnails", qos: .utility)
    private var thumbnailer: Thumbnailer?

    @objc public func thumbFrame(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(ThumbArgs.self)
        thumbQueue.async { [self] in
            do {
                if thumbnailer?.url != args.url {
                    thumbnailer = nil
                    thumbnailer = try Thumbnailer(url: args.url)
                }
                let jpeg = try thumbnailer!.frame(time: args.time, width: args.width)
                invoke.resolve(ThumbResult(data: jpeg.base64EncodedString()))
            } catch {
                invoke.reject(error.localizedDescription)
            }
        }
    }

    @objc public func thumbClose(_ invoke: Invoke) {
        thumbQueue.async { [self] in
            thumbnailer = nil
            invoke.resolve()
        }
    }

    // MARK: Now Playing

    /// Shows (or updates) what's playing in Control Center and on the Lock Screen.
    @objc public func nowPlaying(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(NowPlayingArgs.self)
        DispatchQueue.main.async { [self] in
            var info = nowPlayingInfo ?? [:]
            info[MPMediaItemPropertyTitle] = args.title
            info[MPMediaItemPropertyArtist] = args.subtitle
            info[MPNowPlayingInfoPropertyMediaType] = MPNowPlayingInfoMediaType.video.rawValue
            let image = args.image.flatMap { $0.hasPrefix("http") ? $0 : nil }
            if image != artworkURL {
                artworkURL = image
                info[MPMediaItemPropertyArtwork] = nil
                if let image { loadArtwork(image) }
            }
            nowPlayingInfo = info
            setUpRemoteCommands()
            setRemoteCommands(enabled: true)
            publishNowPlaying()
            invoke.resolve()
        }
    }

    /// Takes the app out of Now Playing (leaving the player).
    @objc public func nowPlayingClear(_ invoke: Invoke) {
        DispatchQueue.main.async { [self] in
            clearNowPlaying()
            invoke.resolve()
        }
    }

    /// Sends the latest title and playback state to the system (main thread).
    private func publishNowPlaying() {
        guard var info = nowPlayingInfo else { return }
        stateLock.lock()
        let (position, duration, paused, speed) = (self.position, self.duration, self.paused, self.speed)
        stateLock.unlock()
        info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = position
        if duration > 0 { info[MPMediaItemPropertyPlaybackDuration] = duration }
        // The system moves the bar along by itself at this rate between updates.
        info[MPNowPlayingInfoPropertyPlaybackRate] = paused ? 0.0 : speed
        info[MPNowPlayingInfoPropertyDefaultPlaybackRate] = 1.0
        nowPlayingInfo = info
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }

    private func clearNowPlaying() {
        nowPlayingInfo = nil
        artworkURL = nil
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
        setRemoteCommands(enabled: false)
    }

    private func loadArtwork(_ url: String) {
        guard let u = URL(string: url) else { return }
        URLSession.shared.dataTask(with: u) { [weak self] data, _, _ in
            guard let data, let image = UIImage(data: data) else { return }
            let artwork = MPMediaItemArtwork(boundsSize: image.size) { _ in image }
            DispatchQueue.main.async {
                guard let self, self.artworkURL == url, self.nowPlayingInfo != nil else { return }
                self.nowPlayingInfo?[MPMediaItemPropertyArtwork] = artwork
                self.publishNowPlaying()
            }
        }.resume()
    }

    /// Control Center's and the Lock Screen's buttons, acting on mpv directly.
    private func setUpRemoteCommands() {
        guard !remoteCommandsReady else { return }
        remoteCommandsReady = true
        let center = MPRemoteCommandCenter.shared()
        let run: ([String]) -> MPRemoteCommandHandlerStatus = { [weak self] args in
            guard let mpv = self?.mpv else { return .noActionableNowPlayingItem }
            return withCStrings(args) { mpv_command(mpv, $0) } >= 0 ? .success : .commandFailed
        }
        center.playCommand.addTarget { _ in run(["set", "pause", "no"]) }
        center.pauseCommand.addTarget { _ in run(["set", "pause", "yes"]) }
        center.togglePlayPauseCommand.addTarget { _ in run(["cycle", "pause"]) }
        center.skipForwardCommand.preferredIntervals = [10]
        center.skipForwardCommand.addTarget { _ in run(["seek", "10", "relative"]) }
        center.skipBackwardCommand.preferredIntervals = [10]
        center.skipBackwardCommand.addTarget { _ in run(["seek", "-10", "relative"]) }
        center.changePlaybackPositionCommand.addTarget { event in
            guard let event = event as? MPChangePlaybackPositionCommandEvent else { return .commandFailed }
            return run(["seek", String(event.positionTime), "absolute"])
        }
        // Not tracks: the player's own Next Episode does that.
        center.nextTrackCommand.isEnabled = false
        center.previousTrackCommand.isEnabled = false
    }

    private func setRemoteCommands(enabled: Bool) {
        guard remoteCommandsReady else { return }
        let center = MPRemoteCommandCenter.shared()
        for command in [center.playCommand, center.pauseCommand, center.togglePlayPauseCommand,
                        center.skipForwardCommand, center.skipBackwardCommand, center.changePlaybackPositionCommand] {
            command.isEnabled = enabled
        }
    }

    /// mpv's playback state as it changes (event thread): kept for Now
    /// Playing, and sent on when it changes in a way the clock wouldn't.
    private func trackPlayback(_ name: String, _ value: String?) {
        let number = value.flatMap(Double.init)
        stateLock.lock()
        var changed = true
        switch name {
        case "time-pos": position = number ?? 0; changed = false
        case "duration": duration = number ?? 0
        case "pause": paused = value == "yes"
        case "speed": speed = number ?? 1
        default: changed = false
        }
        stateLock.unlock()
        if changed { DispatchQueue.main.async { [weak self] in self?.publishNowPlaying() } }
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
                    self?.trackPlayback(name, value)
                    // Position changes every frame; the UI only needs a few updates a second.
                    if name == "time-pos", let self {
                        if Date().timeIntervalSince(self.lastTimeEmit) < 0.2 { break }
                        self.lastTimeEmit = Date()
                    }
                    self?.emit("prop", PropEvent(name: name, value: value))
                case MPV_EVENT_FILE_LOADED:
                    self?.emit("event", PlayerEvent(kind: "file-loaded"))
                case MPV_EVENT_PLAYBACK_RESTART:
                    // After a seek: Now Playing's bar jumps to the new position.
                    DispatchQueue.main.async { self?.publishNowPlaying() }
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
                        self?.clearNowPlaying()
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

// MARK: - Orientation

/// Tauri's root view controller decides which orientations are allowed. Its
/// `supportedInterfaceOrientations` is replaced (once) with one that returns
/// `mask` when set, and the original answer otherwise.
enum OrientationLock {
    static var mask: UIInterfaceOrientationMask?
    private static var installed = false

    static func install(on vc: UIViewController) {
        guard !installed else { return }
        installed = true
        let cls: AnyClass = type(of: vc)
        let sel = #selector(getter: UIViewController.supportedInterfaceOrientations)
        guard let method = class_getInstanceMethod(cls, sel) else { return }
        typealias Getter = @convention(c) (AnyObject, Selector) -> UInt
        let original = unsafeBitCast(method_getImplementation(method), to: Getter.self)
        let replacement: @convention(block) (AnyObject) -> UInt = { obj in
            mask?.rawValue ?? original(obj, sel)
        }
        class_replaceMethod(cls, sel, imp_implementationWithBlock(replacement), method_getTypeEncoding(method))
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
