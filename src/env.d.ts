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
     * The hosted Lightboxd every profile signs in to with its Stremio account
     * (docs/lightboxd.md), e.g. https://lightboxd.example.com. Unset: this PC,
     * then lightboxd.local, as before.
     */
    readonly VITE_LIGHTBOXD_SERVER?: string;
}
