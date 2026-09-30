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
        // libmpv + FFmpeg + libplacebo + MoltenVK, prebuilt for iOS.
        .package(url: "https://github.com/mpvkit/MPVKit.git", from: "1.0.0"),
    ],
    targets: [
        .target(
            name: "MpvPlugin",
            dependencies: [
                .byName(name: "Tauri"),
                .product(name: "MPVKit", package: "MPVKit"),
            ],
            path: "Sources/MpvPlugin"
        ),
    ]
)
