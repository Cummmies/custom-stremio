// swift-tools-version:5.9

import PackageDescription

let package = Package(
    name: "tauri-plugin-mpv",
    platforms: [.iOS("18.0"), .macOS(.v12)],
    products: [
        .library(name: "tauri-plugin-mpv", type: .static, targets: ["MpvPlugin"]),
    ],
    dependencies: [
        .package(name: "Tauri", path: "../.tauri/tauri-api"),
    ],
    targets: [
        .target(
            name: "MpvPlugin",
            dependencies: [
                .byName(name: "Tauri"),
                "Mpv",
                "MPVKit",
                "MpvSystemLinks",
            ],
            path: "Sources/MpvPlugin"
        ),
        .target(name: "MpvSystemLinks", path: "Sources/MpvSystemLinks"),
        // mpv's headers (import Mpv); see its module.modulemap.
        .target(name: "Mpv", path: "Sources/Mpv"),
        // mpv with FFmpeg and everything else in one static framework, from
        // Streamyfin's MPVKit fork: its vo_avfoundation draws into an
        // AVSampleBufferDisplayLayer, which Picture in Picture shows too (one
        // stream). GPL build. Only its iOS slice is used, by build.rs, which
        // links it into the app; Swift sees mpv through the Mpv target.
        .binaryTarget(
            name: "MPVKit",
            url: "https://github.com/streamyfin/MPVKit/releases/download/0.41.0-av5/MPVKit.xcframework.zip",
            checksum: "80a79fbb34b1a3ae84744fe7bb9d365d2a006a5f617460933b7ce777251d3618"
        ),
    ]
)
