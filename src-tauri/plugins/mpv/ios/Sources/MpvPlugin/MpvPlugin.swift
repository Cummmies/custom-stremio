// mpv for the iOS app, built on MPVKit (streamyfin/MPVKit, Package.swift; its
// API through the Mpv target).
//
// Works like the desktop player (src-tauri/src/player.rs): the web page asks
// for `start`, `command`, `set`, `get` and `stop`, and gets every watched
// property back as a `prop` event (mpv's string form) plus `event`s for
// file-loaded, playback-restart, end-file and shutdown. So the web side's mpv
// client (src/lib/player/mpv.svelte.ts) is the same on both.
//
// The video: mpv's vo_avfoundation draws into an AVSampleBufferDisplayLayer in
// a view *behind* the web view, which is made see-through; the player page's
// own background is transparent, so the Svelte controls sit on top of the
// picture exactly as on Windows. That layer is also what Picture in Picture
// shows (AVKit takes it as PiP's content source): one picture, one stream, as
// Streamyfin's player does (streamyfin/streamyfin, modules/mpv-player/ios).
//
// Every call into mpv runs on `queue`, never the main thread: vo_avfoundation
// waits on the main thread while it sets up, so the main thread waiting on
// mpv at that moment would deadlock the app.
//
// Now Playing (Control Center, the Lock Screen): mpv doesn't report to iOS
// the way AVPlayer does, so the page sends the title, episode and artwork
// (`nowPlaying`) and this file adds the position, length and play/pause
// state from mpv's own properties. The system's buttons (play/pause, ±10s,
// dragging the bar) act on mpv here; the page hears the result as usual.

import AVFoundation
import AVKit
import CoreMedia
import Foundation
import MediaPlayer
import Mpv
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
    /// The frame at `time`, not just the nearest keyframe.
    let exact: Bool?
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

/// PiP's state for the page (its PiP button, and why PiP didn't start).
private struct PipEvent: Encodable {
    /// unsupported, ready, active, idle, failed, possible, impossible
    /// (the last two: iOS's own "PiP can start now").
    let state: String
    var detail: String? = nil
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

/// The picture: vo_avfoundation enqueues frames into this view's layer.
final class VideoView: UIView {
    override class var layerClass: AnyClass { AVSampleBufferDisplayLayer.self }
    var displayLayer: AVSampleBufferDisplayLayer { layer as! AVSampleBufferDisplayLayer }

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = .black
        isUserInteractionEnabled = false
        displayLayer.videoGravity = .resizeAspect
        displayLayer.backgroundColor = UIColor.black.cgColor
        // HDR video in HDR on the iPhone screen (EDR).
        displayLayer.wantsExtendedDynamicRangeContent = true
    }

    required init?(coder: NSCoder) { fatalError("not used") }
}

// MARK: - Plugin

class MpvPlugin: Plugin {
    /// Touched only on `queue` (see the top of this file).
    private var mpv: OpaquePointer?
    private let queue = DispatchQueue(label: "mpv", qos: .userInitiated)
    private weak var webView: WKWebView?
    private var videoView: VideoView?
    private var lastTimeEmit = Date.distantPast

    // Picture in Picture (main thread).
    private var pip: AVPictureInPictureController?
    /// The layer's clock, for PiP's progress bar and play/pause (as Streamyfin's).
    private var pipTimebase: CMTimebase?
    private var pipPossibleObservation: NSKeyValueObservation?

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
        DispatchQueue.main.async { [self] in
            let layer = attachVideoView().displayLayer
            queue.async { [self] in
                if mpv != nil { return invoke.resolve() }
                do {
                    try startPlayer(options: args.options, layer: layer)
                    invoke.resolve()
                } catch {
                    DispatchQueue.main.async { self.detachVideoView() }
                    invoke.reject(error.localizedDescription)
                }
            }
        }
    }

    @objc public func command(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(CommandArgs.self)
        queue.async { [self] in
            guard let mpv else { return invoke.reject("The player isn't running.") }
            let code = withCStrings(args.args) { mpv_command(mpv, $0) }
            code >= 0 ? invoke.resolve() : invoke.reject(errorString(code))
        }
    }

    @objc public func set(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(SetArgs.self)
        queue.async { [self] in
            guard let mpv else { return invoke.reject("The player isn't running.") }
            let code = mpv_set_property_string(mpv, args.name, args.value)
            code >= 0 ? invoke.resolve() : invoke.reject(errorString(code))
        }
    }

    @objc public func get(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(GetArgs.self)
        queue.async { [self] in
            guard let mpv else { return invoke.reject("The player isn't running.") }
            var value: String?
            if let p = mpv_get_property_string(mpv, args.name) {
                value = String(cString: p)
                mpv_free(p)
            }
            // The web side unwraps `value` (see mpv.svelte.ts).
            invoke.resolve(GetResult(value: value))
        }
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

    /// The player's PiP button: into PiP now, or back out. Rejects with why
    /// when it can't.
    @objc public func pipToggle(_ invoke: Invoke) {
        DispatchQueue.main.async { [self] in
            guard let pip else {
                return invoke.reject(AVPictureInPictureController.isPictureInPictureSupported()
                    ? "The video isn't ready for it yet."
                    : "This device doesn't support Picture in Picture.")
            }
            if pip.isPictureInPictureActive {
                pip.stopPictureInPicture()
                return invoke.resolve()
            }
            guard pip.isPictureInPicturePossible else {
                return invoke.reject("iOS says it can't start right now.")
            }
            pip.startPictureInPicture()
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
                let jpeg = try thumbnailer!.frame(time: args.time, width: args.width, exact: args.exact ?? false)
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
            guard let self else { return .noActionableNowPlayingItem }
            self.mpvCommand(args)
            return .success
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

    /// A command from the system (Now Playing, PiP), on mpv's queue.
    private func mpvCommand(_ args: [String]) {
        queue.async { [self] in
            guard let mpv else { return }
            _ = withCStrings(args) { mpv_command(mpv, $0) }
        }
    }

    /// mpv's playback state as it changes (event thread): kept for Now
    /// Playing and PiP, and sent on when it changes in a way the clock wouldn't.
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
        if changed {
            DispatchQueue.main.async { [weak self] in
                self?.publishNowPlaying()
                self?.syncPictureInPicture()
            }
        }
    }

    /// Stops playback and shuts mpv down; the event thread finishes the teardown.
    @objc public func stop(_ invoke: Invoke) {
        DispatchQueue.main.async { [self] in
            if pip?.isPictureInPictureActive == true { pip?.stopPictureInPicture() }
        }
        queue.async { [self] in
            if let mpv {
                _ = withCStrings(["quit"]) { mpv_command(mpv, $0) }
            }
            // Nothing else may use the handle now; the event thread destroys it.
            mpv = nil
            invoke.resolve()
        }
    }

    // MARK: Player

    /// On `queue`.
    private func startPlayer(options: [String: String], layer: AVSampleBufferDisplayLayer) throws {
        guard let handle = mpv_create() else { throw PlayerError("mpv couldn't be created.") }

        // Playback audio: keeps playing with the silent switch on, and in PiP.
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .moviePlayback, policy: .longFormAudio)
        try? AVAudioSession.sharedInstance().setActive(true)

        // The page's options, less the ones for mpv's other video outputs.
        var extra = options
        let hwdec = extra.removeValue(forKey: "hwdec") ?? "videotoolbox"
        for key in ["gpu-api", "gpu-context", "vo", "wid", "target-colorspace-hint"] {
            extra.removeValue(forKey: key)
        }

        // The picture goes into the display layer (vo_avfoundation takes it as wid).
        var layerPointer = Int64(Int(bitPattern: Unmanaged.passUnretained(layer).toOpaque()))
        mpv_set_option(handle, "wid", MPV_FORMAT_INT64, &layerPointer)
        mpv_set_option_string(handle, "vo", "avfoundation")
        // Subtitles drawn into the frames, so they show in PiP too. Right after
        // `vo`, before the decoder options (Streamyfin: elsewhere it can freeze
        // on leaving the player).
        mpv_set_option_string(handle, "avfoundation-composite-osd", "yes")
        mpv_set_option_string(handle, "hwdec", hwdec)
        mpv_set_option_string(handle, "hwdec-codecs", "all")
        mpv_set_option_string(handle, "hwdec-software-fallback", "yes")

        let defaults: [(String, String)] = [
            // The Svelte UI is the only on-screen display.
            ("osc", "no"),
            ("osd-level", "0"),
            ("input-default-bindings", "no"),
            ("input-vo-keyboard", "no"),
            ("keep-open", "yes"),
            ("idle", "yes"),
            ("config", "no"),
            ("terminal", "no"),
            ("ytdl", "no"),
            ("video-rotate", "no"),
        ]
        for (k, v) in defaults { mpv_set_option_string(handle, k, v) }
        for (k, v) in extra where mpv_set_option_string(handle, k, v) < 0 {
            NSLog("mpv: ignoring option \(k)=\(v)")
        }

        let code = mpv_initialize(handle)
        if code < 0 {
            mpv_terminate_destroy(handle)
            throw PlayerError("mpv failed to start: \(errorString(code))")
        }
        for name in observed { mpv_observe_property(handle, 0, name, MPV_FORMAT_STRING) }
        mpv = handle
        startEventLoop(handle)
    }

    /// Main thread.
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

    /// Main thread.
    private func detachVideoView() {
        tearDownPictureInPicture()
        videoView?.displayLayer.sampleBufferRenderer.flush(removingDisplayedImage: true, completionHandler: nil)
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
                        // PiP's progress bar follows while it's showing.
                        DispatchQueue.main.async { self.syncPictureInPicture(position: true) }
                    }
                    self?.emit("prop", PropEvent(name: name, value: value))
                case MPV_EVENT_FILE_LOADED:
                    self?.emit("event", PlayerEvent(kind: "file-loaded"))
                case MPV_EVENT_PLAYBACK_RESTART:
                    // The picture is up: PiP can take it from here (Streamyfin
                    // makes its controller at the same point). After a seek:
                    // Now Playing's and PiP's bars jump to the new position.
                    DispatchQueue.main.async {
                        self?.setUpPictureInPicture()
                        self?.publishNowPlaying()
                        self?.syncPictureInPicture(position: true)
                    }
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
                    // while another thread waits in mpv_wait_event. Never waits on the
                    // main thread (vo_avfoundation's cleanup may need it).
                    self?.queue.sync {
                        if self?.mpv == handle { self?.mpv = nil }
                    }
                    mpv_terminate_destroy(handle)
                    // The picture goes, unless a new player has started meanwhile.
                    self?.queue.async {
                        let restarted = self?.mpv != nil
                        DispatchQueue.main.async {
                            if !restarted { self?.detachVideoView() }
                            self?.clearNowPlaying()
                        }
                    }
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

    // In the background without PiP, the video pauses (as before); with PiP
    // it plays on in the PiP window. iOS may say the app went to the background
    // before it starts PiP, so a playing video PiP can start for isn't paused
    // here (if PiP then fails, failedToStart pauses it).
    @objc private func didEnterBackground() {
        if pip?.isPictureInPictureActive == true { return }
        stateLock.lock()
        let isPaused = paused
        stateLock.unlock()
        if pip?.canStartPictureInPictureAutomaticallyFromInline == true, !isPaused { return }
        mpvCommand(["set", "pause", "yes"])
    }

    /// Back in the app: PiP closes and the video returns to the player (as in
    /// Apple's apps); iOS would otherwise leave it floating over the app.
    @objc private func willEnterForeground() {
        guard pip?.isPictureInPictureActive == true else { return }
        pip?.stopPictureInPicture()
    }
}

// MARK: - Picture in Picture

extension MpvPlugin: AVPictureInPictureControllerDelegate, AVPictureInPictureSampleBufferPlaybackDelegate {
    /// Main thread, once the picture is up. PiP then starts by itself when
    /// the app goes to the home screen while the video plays.
    fileprivate func setUpPictureInPicture() {
        guard pip == nil, let layer = videoView?.displayLayer else { return }
        guard AVPictureInPictureController.isPictureInPictureSupported() else {
            emit("pip", PipEvent(state: "unsupported"))
            return
        }
        var timebase: CMTimebase?
        if CMTimebaseCreateWithSourceClock(allocator: kCFAllocatorDefault, sourceClock: CMClockGetHostTimeClock(), timebaseOut: &timebase) == noErr,
           let timebase {
            layer.controlTimebase = timebase
            pipTimebase = timebase
        }
        let controller = AVPictureInPictureController(
            contentSource: .init(sampleBufferDisplayLayer: layer, playbackDelegate: self)
        )
        controller.delegate = self
        controller.requiresLinearPlayback = false
        controller.canStartPictureInPictureAutomaticallyFromInline = true
        pip = controller
        pipPossibleObservation = controller.observe(\.isPictureInPicturePossible, options: [.initial, .new]) { [weak self] c, _ in
            self?.emit("pip", PipEvent(state: c.isPictureInPicturePossible ? "possible" : "impossible"))
        }
        syncPictureInPicture(position: true)
        emit("pip", PipEvent(state: "ready"))
    }

    /// Main thread.
    fileprivate func tearDownPictureInPicture() {
        pipPossibleObservation = nil
        pip?.delegate = nil
        pip = nil
        if let pipTimebase { CMTimebaseSetRate(pipTimebase, rate: 0) }
        videoView?.displayLayer.controlTimebase = nil
        pipTimebase = nil
    }

    /// PiP's clock follows mpv's play/pause and speed (and its position, on
    /// a seek or while PiP shows). Main thread.
    fileprivate func syncPictureInPicture(position updatePosition: Bool = false) {
        guard let pip else { return }
        stateLock.lock()
        let (position, paused, speed) = (self.position, self.paused, self.speed)
        stateLock.unlock()
        if let pipTimebase {
            if updatePosition, pip.isPictureInPictureActive || !paused || position > 0 {
                CMTimebaseSetTime(pipTimebase, time: CMTime(seconds: max(0, position), preferredTimescale: 1000))
            }
            CMTimebaseSetRate(pipTimebase, rate: paused ? 0 : speed)
        }
        if pip.isPictureInPictureActive { pip.invalidatePlaybackState() }
    }

    public func pictureInPictureControllerWillStartPictureInPicture(_ controller: AVPictureInPictureController) {
        syncPictureInPicture(position: true)
    }

    public func pictureInPictureControllerDidStartPictureInPicture(_ controller: AVPictureInPictureController) {
        syncPictureInPicture(position: true)
        emit("pip", PipEvent(state: "active"))
    }

    public func pictureInPictureController(
        _ controller: AVPictureInPictureController,
        failedToStartPictureInPictureWithError error: Error
    ) {
        NSLog("mpv: PiP failed to start: \(error.localizedDescription)")
        emit("pip", PipEvent(state: "failed", detail: error.localizedDescription))
        // Gone to the background expecting PiP: pause as without it.
        if UIApplication.shared.applicationState == .background { mpvCommand(["set", "pause", "yes"]) }
    }

    public func pictureInPictureControllerDidStopPictureInPicture(_ controller: AVPictureInPictureController) {
        syncPictureInPicture(position: true)
        emit("pip", PipEvent(state: "ready"))
    }

    public func pictureInPictureController(
        _ controller: AVPictureInPictureController,
        restoreUserInterfaceForPictureInPictureStopWithCompletionHandler completionHandler: @escaping (Bool) -> Void
    ) {
        // The player is still on screen behind PiP.
        completionHandler(true)
    }

    public func pictureInPictureController(_ controller: AVPictureInPictureController, setPlaying playing: Bool) {
        mpvCommand(["set", "pause", playing ? "no" : "yes"])
        if let pipTimebase {
            stateLock.lock()
            let speed = self.speed
            stateLock.unlock()
            CMTimebaseSetRate(pipTimebase, rate: playing ? speed : 0)
        }
    }

    public func pictureInPictureControllerTimeRangeForPlayback(_ controller: AVPictureInPictureController) -> CMTimeRange {
        stateLock.lock()
        let duration = self.duration
        stateLock.unlock()
        return duration > 0
            ? CMTimeRange(start: .zero, duration: CMTime(seconds: duration, preferredTimescale: 1000))
            : CMTimeRange(start: .zero, duration: .positiveInfinity)
    }

    public func pictureInPictureControllerIsPlaybackPaused(_ controller: AVPictureInPictureController) -> Bool {
        stateLock.lock()
        defer { stateLock.unlock() }
        return paused
    }

    public func pictureInPictureController(
        _ controller: AVPictureInPictureController,
        didTransitionToRenderSize newRenderSize: CMVideoDimensions
    ) {}

    public func pictureInPictureController(
        _ controller: AVPictureInPictureController,
        skipByInterval skipInterval: CMTime,
        completion completionHandler: @escaping () -> Void
    ) {
        mpvCommand(["seek", String(skipInterval.seconds), "relative"])
        completionHandler()
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
