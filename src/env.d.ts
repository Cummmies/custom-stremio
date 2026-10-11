/// <reference types="vite/client" />

interface ImportMetaEnv {
    /** Built for the Samsung TV (TV_BUILD=1, vite.config.js). */
    readonly TV_BUILD: boolean;
    /** The @stremio/stremio-core-web version this build carries (vite.config.js). */
    readonly CORE_VERSION: string;
    /** This build's commit time, in seconds (vite.config.js; 0 without git). */
    readonly BUILD_TIME: number;
    /** Recent commits' subjects, newest first, for What's New (vite.config.js). */
    readonly CHANGES: { at: number; text: string }[];
    /**
     * The hosted tracker every profile signs in to with its Stremio account
     * (docs/tracker.md), e.g. https://tracker.example.com. Unset: this PC,
     * then the server on the home network, as before.
     */
    readonly VITE_TRACKER_SERVER?: string;
}
