// Easy Mode's source ranking. Addons describe streams in free text (Torrentio:
// "[TB+] Torrentio\n1080p" + "👤 58 💾 254 MB ⚙️ EXT"), so we read what we can
// from name/title/description/behaviorHints and rank with explicit priorities.
import type { Stream } from '$lib/core/types';

export type Kind =
    | 'debrid' // cached on a debrid service (or any direct web link): plays instantly
    | 'debrid-uncached' // debrid, but the service still has to download it
    | 'torrent' // plain P2P through the local streaming server
    | 'skip'; // not a video to auto-play (external links, YouTube…)

export type Parsed = {
    kind: Kind;
    resolution: number | null;
    seeders: number | null;
    sizeBytes: number | null;
    languages: string[]; // ISO 639-2; empty when the name doesn't say
    multiAudio: boolean;
    /** No audio language named, but from a service whose releases often carry
     *  several audio tracks (Netflix, Amazon, Disney+…): worth trying for a dub. */
    maybeMultiAudio: boolean;
    /** Says it's an English dub ("English Dub", "Dubbed", a dub group). */
    dub: boolean;
    tier: number; // release quality: remux 5 … hdtv 1
    junk: boolean; // cam/ts/screener/sample/3D/hardcoded subs
    dolbyVisionOnly: boolean; // DV without an HDR10 fallback layer
};

export type Candidate = { stream: Stream; addon: string; addonUrl?: string | null; addonIndex: number; parsed: Parsed };

export type EasyPrefs = {
    maxResolution: number;
    language: string | null;
    allowTorrents: boolean;
    /** Anime: sources that don't name a language are Japanese, and your language comes first. */
    anime: boolean;
};

const FLAGS: Record<string, string> = {
    '🇬🇧': 'eng', '🇺🇸': 'eng', '🇪🇸': 'spa', '🇲🇽': 'spa', '🇫🇷': 'fre', '🇩🇪': 'ger', '🇮🇹': 'ita',
    '🇵🇹': 'por', '🇧🇷': 'por', '🇷🇺': 'rus', '🇯🇵': 'jpn', '🇰🇷': 'kor', '🇨🇳': 'chi', '🇹🇼': 'chi',
    '🇮🇳': 'hin', '🇹🇷': 'tur', '🇵🇱': 'pol', '🇳🇱': 'dut', '🇸🇪': 'swe', '🇳🇴': 'nor', '🇩🇰': 'dan',
    '🇫🇮': 'fin', '🇬🇷': 'gre', '🇮🇱': 'heb', '🇺🇦': 'ukr', '🇨🇿': 'cze', '🇭🇺': 'hun', '🇷🇴': 'rum',
    '🇧🇬': 'bul', '🇻🇳': 'vie', '🇹🇭': 'tha', '🇮🇩': 'ind', '🇸🇦': 'ara',
};

const WORDS: [RegExp, string][] = [
    [/\b(eng|english)\b/i, 'eng'],
    [/\b(spa|spanish|castellano|latino|esp)\b/i, 'spa'],
    [/\b(fre|french|vostfr|vff|truefrench)\b/i, 'fre'],
    [/\b(ger|german|deutsch)\b/i, 'ger'],
    [/\b(ita|italian|italiano)\b/i, 'ita'],
    [/\b(por|portuguese|dublado)\b/i, 'por'],
    [/\b(rus|russian)\b/i, 'rus'],
    [/\b(jpn|japanese)\b/i, 'jpn'],
    [/\b(kor|korean)\b/i, 'kor'],
    [/\b(hin|hindi)\b/i, 'hin'],
];

const SUBS = /\b(?:eng(?:lish)?|multi(?:ple)?|softs?)[ ._-]*(?:sub(?:s|bed|titles?)?|srt)\b|\bsub(?:s|bed|titles?)?[ ._-]*(?:eng(?:lish)?)\b|\be?subs?\b|\bm[ ._-]?subs\b/gi;
const DUAL_AUDIO = /\bdual\b/i; // "Dual Audio", "Dual-Audio", "[DUAL]", ".DUAL."
const ENGLISH_DUB = /\beng(?:lish)?[ ._-]*dub(?:bed)?\b|\bdub(?:bed)?[ ._-]*eng(?:lish)?\b/i;
const DUBBED = /\bdub(?:bed|s)?\b/i;
// "English audio", "Eng AAC", "ENG DDP5.1"…
const ENGLISH_AUDIO = /\beng(?:lish)?[ ._-]*(?:audio|aac|ac-?3|e-?ac-?3|ddp?|dts|flac|opus|truehd)/i;
// Both languages named together: "JPN+ENG", "Jap-Eng", "JP/EN", "English + Japanese".
const JP_AND_EN = /\b(?:jpn?|jap(?:anese)?)[ ._+&/-]+(?:en|eng(?:lish)?)\b|\b(?:en|eng(?:lish)?)[ ._+&/-]+(?:jpn?|jap(?:anese)?)\b/i;
// Anime release groups that only put out the original audio with subtitles (or raws).
// A release group as addons write it: "[SubsPlease] Show - 01…" at the start of a
// line (also after AIOStreams' 📁), or AIOStreams' "🏷️ SubsPlease".
const group = (names: string) => new RegExp(`(?:^[ \\t]*(?:📁\\s*)?\\[|🏷\\uFE0F?\\s*)(?:${names})(?=\\]|\\s|$)`, 'imu');
const SUB_ONLY_GROUP = group('SubsPlease|Erai-raws|HorribleSubs|ASW|Tsundere-Raws|SubsPlus\\+?|Ohys-Raws|Lilith-Raws|NanakoRaws|Skymoon-Raws|Moozzi2|Leopard-Raws');
// Anime release groups that put out English dubs.
const DUB_GROUP = group('Yameii');
// Streaming-service WEB releases, which often keep every audio track.
const MULTI_AUDIO_SERVICE = /\b(?:NF|AMZN|DSNP|HMAX|MAX|ATVP|HULU|PCOK)[ ._-]+WEB/i;

const SERVICES = 'RD|AD|PM|DL|TB|OC|ED|PK|PKP|DB|EN|TRD|DLS|SR|TD';
// Torrentio "[RD+]" (cached) / "[RD]", "[RD download]"; AIOStreams "[TB⚡]" / "[TB⏳]".
const DEBRID_TAG = new RegExp(`\\[(${SERVICES})(\\+|⚡|⏳| ?download)?\\]`, 'iu');
// AIOStreams name template "AIOStreams (Instant TB) (1080p)" / "AIOStreams (TB) (1080p)".
const DEBRID_PAREN = new RegExp(`\\(([Ii]nstant\\s+)?(${SERVICES})\\)`);

// A video file or stream by its address: "….mkv", "….m3u8?token=…".
const VIDEO_URL = /\.(?:mkv|mp4|m4v|avi|mov|webm|ts|m2ts|m3u8|mpd|flv|wmv)$/i;
// What describes a video: a resolution, a size, a release type or a codec.
const VIDEO_WORDS =
    /\b(?:\d{3,4}p|4k|uhd|sd|hd|remux|blu-?ray|bdrip|brrip|web-?dl|webrip|web|hdtv|dvdrip|x26[45]|h\.?26[45]|hevc|avc|av1|hdr(?:10)?\+?|dv|atmos|aac|ac-?3|ddp?5?|dts)\b|\d+(?:[.,]\d+)?\s*(?:TB|GB|MB)\b/i;

/**
 * An untagged link that says something about being a video. Addons that only
 * show information in the source list (Age Ratings, parents' guides) send
 * plain links with a rating or a note and nothing like a resolution, size or
 * file: not something to auto-play (you can still open them yourself).
 */
function saysVideo(s: Stream, text: string): boolean {
    const hints = s.behaviorHints;
    if (hints?.filename || hints?.videoSize || hints?.bingeGroup) return true;
    if (s.url && VIDEO_URL.test(s.url.split(/[?#]/)[0])) return true;
    return VIDEO_WORDS.test(text);
}

function parseSize(text: string, hint?: number): number | null {
    if (hint && hint > 0) return hint;
    const m = text.match(/(?:💾\s*)?(\d+(?:[.,]\d+)?)\s*(TB|GB|MB)\b/i);
    if (!m) return null;
    const n = parseFloat(m[1].replace(',', '.'));
    const unit = m[2].toUpperCase();
    return n * (unit === 'TB' ? 1024 ** 4 : unit === 'GB' ? 1024 ** 3 : 1024 ** 2);
}

/**
 * `anime` changes how dubs read: in anime, "Dubbed" / "Dual Audio" mean an
 * English dub; elsewhere they're usually a dub into another language
 * ("English | Dubbed | Russian" is English original plus a Russian dub).
 */
export function parseStream(s: Stream, { anime = false }: { anime?: boolean } = {}): Parsed {
    const text = [s.name, s.title, s.description, s.behaviorHints?.filename].filter(Boolean).join('\n');

    let kind: Kind;
    if (s.externalUrl || s.ytId || (!s.url && !s.infoHash)) kind = 'skip';
    else if (s.infoHash && !s.url) kind = 'torrent';
    else {
        // "[RD+]" / "[TB⚡]" / "(Instant TB)" = cached; "[RD]" / "[RD download]" /
        // "[TB⏳]" / "(TB)" = not cached yet. Other addons mark uncached with ⏳.
        // An untagged web link plays directly.
        const tag = text.match(DEBRID_TAG);
        const paren = (s.name ?? '').match(DEBRID_PAREN);
        if (/\[P2P\]/i.test(s.name ?? '')) kind = 'torrent';
        else if (tag) kind = tag[2] && /[+⚡]/u.test(tag[2]) ? 'debrid' : 'debrid-uncached';
        else if (paren) kind = paren[1] ? 'debrid' : 'debrid-uncached';
        else if (!saysVideo(s, text)) kind = 'skip';
        else kind = /⏳/.test(text) ? 'debrid-uncached' : 'debrid';
    }

    const res = /\b(2160p|4k|uhd)\b/i.test(text)
        ? 2160
        : /\b1440p\b/i.test(text)
          ? 1440
          : /\b1080p\b/i.test(text)
            ? 1080
            : /\b720p\b/i.test(text)
              ? 720
              : /\b(576p|480p|sd)\b/i.test(text)
                ? 480
                : null;

    const seed = text.match(/(?:👤|👥)\s*(\d+)/u) ?? text.match(/(\d+)\s*seed/i);

    const languages = new Set<string>();
    // Subtitle languages ("Eng Subs", "English Subtitles", "ESub") aren't audio: an
    // anime release "with English subs" is Japanese audio.
    // AIOStreams lists subtitle languages on their own 📝 line: leave that line out.
    const noSubLines = text
        .split('\n')
        .filter((l) => !/^\s*📝/u.test(l))
        .join('\n');
    const audioText = noSubLines.replace(SUBS, ' ');
    // Torrentio's flag line lists every language in the torrent name, subtitles
    // included, so when the name talks about subtitles the flags can't be trusted
    // for audio ("(Multi-Subs)" + 🇬🇧 is Japanese audio with English subs).
    const mentionsSubs = audioText !== noSubLines;
    if (!mentionsSubs) for (const [flag, code] of Object.entries(FLAGS)) if (noSubLines.includes(flag)) languages.add(code);
    for (const [re, code] of WORDS) if (re.test(audioText)) languages.add(code);
    // Always English: "English Dub", "English Audio" / "ENG AAC", "JPN+ENG", dub groups.
    // Anime only: "Dual Audio" (Japanese + English) and "Dubbed" with no other language.
    const dualAudio = DUAL_AUDIO.test(text) || JP_AND_EN.test(audioText);
    const dub = ENGLISH_DUB.test(text) || DUB_GROUP.test(text) || (anime && DUBBED.test(text));
    if (
        ENGLISH_DUB.test(text) ||
        ENGLISH_AUDIO.test(audioText) ||
        JP_AND_EN.test(audioText) ||
        DUB_GROUP.test(text) ||
        (anime && DUAL_AUDIO.test(text)) ||
        (anime && DUBBED.test(text) && [...languages].every((l) => l === 'jpn' || l === 'eng'))
    )
        languages.add('eng');
    if (JP_AND_EN.test(audioText)) languages.add('jpn');
    // A sub-only group with nothing saying otherwise: Japanese audio.
    if (!languages.size && SUB_ONLY_GROUP.test(text)) languages.add('jpn');

    const tier = /\bremux\b/i.test(text)
        ? 5
        : /\b(blu-?ray|bdrip|brrip)\b/i.test(text)
          ? 4
          : /\bweb-?dl\b|\bweb\b/i.test(text)
            ? 3
            : /\bwebrip\b/i.test(text)
              ? 2
              : /\bhdtv\b/i.test(text)
                ? 1
                : 2;

    return {
        kind,
        resolution: res,
        seeders: seed ? Number(seed[1]) : null,
        sizeBytes: parseSize(text, s.behaviorHints?.videoSize),
        languages: [...languages],
        multiAudio: dualAudio || /\bmulti[ .-]?(audio|lang)?\b/i.test(audioText),
        maybeMultiAudio: !languages.size && MULTI_AUDIO_SERVICE.test(text),
        dub,
        tier,
        junk:
            /\b(cam|camrip|hdcam|telesync|hdts|telecine|hdtc|screener|scr|dvdscr)\b/i.test(text) ||
            /\bts\b/.test(text) ||
            /\bsample\b/i.test(text) ||
            /\b3d\b/i.test(text) ||
            /\b(hc|hardsub|hardcoded)\b/i.test(text),
        dolbyVisionOnly: /\b(dv|dovi|dolby[ .]?vision)\b/i.test(text) && !/\bhdr(10)?\+?\b/i.test(text),
    };
}

/** How likely a source is to have audio in `language`, from its name alone. */
export type AudioMatch = 'match' | 'maybe' | 'unknown' | 'other';
export function audioMatch(p: Parsed, language: string | null): AudioMatch {
    if (!language || p.languages.includes(language)) return 'match';
    if (p.multiAudio || p.maybeMultiAudio) return 'maybe';
    return p.languages.length ? 'other' : 'unknown';
}

// Anime release groups and trackers, for guessing when the anime list isn't available.
const ANIME_TRACKER = /\bnyaa(?:si)?\b/i;
const ANIME_GROUP = group('Judas|EMBER|DB|Anime Time|Cytox|Kametsu|Yameii|Doomdos|NanDesuKa');

/** A guess from the sources alone: several of them come from anime trackers or groups. */
export function looksLikeAnime(streams: Stream[]): boolean {
    const text = (s: Stream) => [s.name, s.title, s.description, s.behaviorHints?.filename].filter(Boolean).join('\n');
    return streams.filter((s) => ANIME_TRACKER.test(text(s)) || ANIME_GROUP.test(text(s)) || SUB_ONLY_GROUP.test(text(s))).length >= 2;
}

const KIND_RANK: Record<Kind, number> = { debrid: 0, 'debrid-uncached': 1, torrent: 2, skip: 9 };

/**
 * Orders candidates best-first. Priorities, in order:
 * cached debrid > uncached debrid > torrent · language (the other way round
 * for anime) · not Dolby-Vision-only ·
 * highest resolution within the cap · release quality · seeders · smaller size ·
 * the addon order you set.
 */
export function rankStreams(candidates: Candidate[], prefs: EasyPrefs): Candidate[] {
    // Anime: sources that don't name a language are Japanese, so your language
    // comes first, even before speed (an English torrent beats a cached Japanese
    // release). Anything else: unnamed means the original, usually your language,
    // so language only sets apart sources that are clearly in another language,
    // and speed and quality decide the rest.
    const langRank = (p: Parsed) => {
        if (!prefs.language) return 0;
        if (p.languages.includes(prefs.language)) return 0;
        if (!prefs.anime) return p.languages.length && !p.multiAudio ? 1 : 0;
        if (p.multiAudio || p.maybeMultiAudio) return 1;
        return 2;
    };
    const kindRank = (p: Parsed) => KIND_RANK[p.kind];

    return candidates
        .filter((c) => {
            const p = c.parsed;
            if (p.kind === 'skip' || p.junk) return false;
            if (p.kind === 'torrent' && !prefs.allowTorrents) return false;
            if (p.resolution != null && p.resolution > prefs.maxResolution) return false;
            return true;
        })
        .sort((a, b) => {
            const pa = a.parsed;
            const pb = b.parsed;
            return (
                (prefs.anime
                    ? langRank(pa) - langRank(pb) || kindRank(pa) - kindRank(pb)
                    : kindRank(pa) - kindRank(pb) || langRank(pa) - langRank(pb)) ||
                // DV-only files show wrong colours without a DV display; a clean lower
                // resolution beats that.
                Number(pa.dolbyVisionOnly) - Number(pb.dolbyVisionOnly) ||
                (pb.resolution ?? 0) - (pa.resolution ?? 0) ||
                pb.tier - pa.tier ||
                (pb.seeders ?? 0) - (pa.seeders ?? 0) ||
                (pa.sizeBytes ?? Infinity) - (pb.sizeBytes ?? Infinity) ||
                a.addonIndex - b.addonIndex
            );
        });
}
