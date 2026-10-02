// Seek-bar thumbnails on iOS, the same way as the desktop app
// (src-tauri/src/player.rs): a second, silent mpv that seeks to the asked-for
// time and renders one small frame through libmpv's software render API.
// Frames go back to the page as JPEGs.

import Foundation
import Mpv
import UIKit

struct ThumbnailError: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

final class Thumbnailer {
    let url: String
    private let handle: OpaquePointer
    private var ctx: OpaquePointer?

    init(url: String) throws {
        guard let handle = mpv_create() else { throw ThumbnailError(message: "mpv couldn't be created.") }
        self.handle = handle
        self.url = url
        let options: [(String, String)] = [
            ("vo", "libmpv"),
            ("config", "no"),
            ("terminal", "no"),
            ("load-scripts", "no"),
            ("ytdl", "no"),
            ("idle", "yes"),
            ("pause", "yes"),
            ("keep-open", "always"),
            ("aid", "no"),
            ("sid", "no"),
            ("audio", "no"),
            // Hardware decoding, copied back to memory for the software renderer.
            ("hwdec", "videotoolbox-copy"),
            ("hr-seek", "no"),
            // A small cache so going back over a spot doesn't refetch it.
            ("cache", "yes"),
            ("demuxer-readahead-secs", "0"),
            ("cache-pause", "no"),
            ("demuxer-max-bytes", "32MiB"),
            ("demuxer-max-back-bytes", "32MiB"),
            ("vd-lavc-skiploopfilter", "all"),
            ("vd-lavc-fast", "yes"),
            ("network-timeout", "15"),
        ]
        for (k, v) in options { mpv_set_option_string(handle, k, v) }
        guard mpv_initialize(handle) >= 0 else {
            mpv_terminate_destroy(handle)
            throw ThumbnailError(message: "The thumbnail source couldn't be opened.")
        }

        let sw = strdup("sw")
        defer { free(sw) }
        var params = [
            mpv_render_param(type: MPV_RENDER_PARAM_API_TYPE, data: UnsafeMutableRawPointer(sw)),
            mpv_render_param(type: MPV_RENDER_PARAM_INVALID, data: nil),
        ]
        var context: OpaquePointer?
        guard mpv_render_context_create(&context, handle, &params) >= 0, let context else {
            mpv_terminate_destroy(handle)
            throw ThumbnailError(message: "The thumbnail source couldn't be opened.")
        }
        ctx = context

        command(["loadfile", url])
        try waitFor([MPV_EVENT_FILE_LOADED], timeout: 20)
    }

    deinit {
        // The render context must go before the handle it belongs to.
        if let ctx { mpv_render_context_free(ctx) }
        mpv_terminate_destroy(handle)
    }

    /// Seeks to `time` and returns a JPEG of that frame, `width` pixels wide.
    func frame(time: Double, width: Int) throws -> Data {
        command(["seek", String(format: "%.2f", time), "absolute+keyframes"])
        // mpv only reports the seek as done once its output has taken the new
        // frame, so keep drawing (and dropping) frames while waiting for that.
        let deadline = Date().addingTimeInterval(10)
        var restarted = false
        while !restarted {
            if Date() > deadline { throw ThumbnailError(message: "Timed out") }
            if let ev = mpv_wait_event(handle, 0.005)?.pointee, ev.event_id == MPV_EVENT_PLAYBACK_RESTART {
                restarted = true
            }
            let fresh = mpv_render_context_update(ctx) & UInt64(MPV_RENDER_UPDATE_FRAME.rawValue) != 0
            if !restarted && fresh { _ = try render(width: 16) }
        }
        return try render(width: width)
    }

    private func render(width: Int) throws -> Data {
        let dw = Double(property("video-params/dw") ?? "") ?? 16
        let dh = Double(property("video-params/dh") ?? "") ?? 9
        let w = max(64, min(640, width))
        let h = max(2, Int((Double(w) * dh / dw).rounded()) / 2 * 2)

        var size: [Int32] = [Int32(w), Int32(h)]
        var stride = w * 4
        var pixels = [UInt8](repeating: 0, count: stride * h)
        let format = strdup("rgb0")
        defer { free(format) }
        let code: Int32 = size.withUnsafeMutableBytes { sizePtr in
            withUnsafeMutablePointer(to: &stride) { stridePtr in
                pixels.withUnsafeMutableBytes { pixelPtr in
                    var params = [
                        mpv_render_param(type: MPV_RENDER_PARAM_SW_SIZE, data: sizePtr.baseAddress),
                        mpv_render_param(type: MPV_RENDER_PARAM_SW_FORMAT, data: UnsafeMutableRawPointer(format)),
                        mpv_render_param(type: MPV_RENDER_PARAM_SW_STRIDE, data: UnsafeMutableRawPointer(stridePtr)),
                        mpv_render_param(type: MPV_RENDER_PARAM_SW_POINTER, data: pixelPtr.baseAddress),
                        mpv_render_param(type: MPV_RENDER_PARAM_INVALID, data: nil),
                    ]
                    return mpv_render_context_render(ctx, &params)
                }
            }
        }
        guard code >= 0 else { throw ThumbnailError(message: "Couldn't draw the frame.") }

        guard let provider = CGDataProvider(data: Data(pixels) as CFData),
              let image = CGImage(
                  width: w, height: h, bitsPerComponent: 8, bitsPerPixel: 32, bytesPerRow: w * 4,
                  space: CGColorSpaceCreateDeviceRGB(),
                  bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.noneSkipLast.rawValue),
                  provider: provider, decode: nil, shouldInterpolate: false, intent: .defaultIntent
              ),
              let jpeg = UIImage(cgImage: image).jpegData(compressionQuality: 0.75)
        else { throw ThumbnailError(message: "Couldn't encode the frame.") }
        return jpeg
    }

    private func waitFor(_ ids: [mpv_event_id], timeout: TimeInterval) throws {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            guard let ev = mpv_wait_event(handle, 0.05)?.pointee else { continue }
            if ids.contains(ev.event_id) { return }
            if ev.event_id == MPV_EVENT_END_FILE,
               let end = ev.data?.assumingMemoryBound(to: mpv_event_end_file.self).pointee,
               end.reason == MPV_END_FILE_REASON_ERROR {
                throw ThumbnailError(message: "The thumbnail source couldn't be opened.")
            }
        }
        throw ThumbnailError(message: "Timed out")
    }

    private func command(_ args: [String]) {
        let owned = args.map { strdup($0) }
        defer { owned.forEach { free($0) } }
        var ptrs: [UnsafePointer<CChar>?] = owned.map { UnsafePointer($0) }
        ptrs.append(nil)
        _ = ptrs.withUnsafeMutableBufferPointer { mpv_command(handle, $0.baseAddress) }
    }

    private func property(_ name: String) -> String? {
        guard let p = mpv_get_property_string(handle, name) else { return nil }
        defer { mpv_free(p) }
        return String(cString: p)
    }
}
