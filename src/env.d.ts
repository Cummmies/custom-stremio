/// <reference types="vite/client" />

interface ImportMetaEnv {
    /** Built for the Samsung TV (TV_BUILD=1, vite.config.js). */
    readonly TV_BUILD: boolean;
    /** The @stremio/stremio-core-web version this build carries (vite.config.js). */
    readonly CORE_VERSION: string;
}
