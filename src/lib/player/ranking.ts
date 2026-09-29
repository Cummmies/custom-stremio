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

export type EasyPrefs = { maxResolution: number; language: string | null; allowTorrents: boolean };

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
const SUB_ONLY_GROUP = /^\s*\[(?:SubsPlease|Erai-raws|HorribleSubs|ASW|Tsundere-Raws|SubsPlus\+?|Ohys-Raws|Lilith-Raws|NanakoRaws|Skymoon-Raws|Moozzi2|Leopard-Raws)\]/im;
// Anime release groups that put out English dubs.
const DUB_GROUP = /^\s*\[(?:Yameii)\]/im;
// Streaming-service WEB releases, which often keep every audio track.
const MULTI_AUDIO_SERVICE = /\b(?:NF|AMZN|DSNP|HMAX|MAX|ATVP|HULU|PCOK)[ ._-]+WEB/i;

const DEBRID_TAG = /\[(RD|AD|PM|DL|TB|OC|ED|PK|DB|EN|TRD|DLS)(\+| ?download)?\]/i;

function parseSize(text: string, hint?: number): number | null {
    if (hint && hint > 0) return hint;
    const m = text.match(/(?:💾\s*)?(\d+(?:[.,]\d+)?)\s*(TB|GB|MB)\b/i);
    if (!m) return null;
    const n = parseFloat(m[1].replace(',', '.'));
    const unit = m[2].toUpperCase();
    return n * (unit === 'TB' ? 1024 ** 4 : unit === 'GB' ? 1024 ** 3 : 1024 ** 2);
}

export function parseStream(s: Stream): Parsed {
    const text = [s.name, s.title, s.description, s.behaviorHints?.filename].filter(Boolean).join('\n');

    let kind: Kind;
    if (s.externalUrl || s.ytId || (!s.url && !s.infoHash)) kind = 'skip';
    else if (s.infoHash && !s.url) kind = 'torrent';
    else {
        // "[RD+]" = cached on Real-Debrid; "[RD]" / "[RD download]" = not cached yet.
        // Other addons mark uncached with ⏳. An untagged web link plays directly.
        const tag = text.match(DEBRID_TAG);
        if (tag) kind = tag[2]?.includes('+') ? 'debrid' : 'debrid-uncached';
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

    const seed = text.match(/👤\s*(\d+)/) ?? text.match(/(\d+)\s*seed/i);

    const languages = new Set<string>();
    // Subtitle languages ("Eng Subs", "English Subtitles", "ESub") aren't audio: an
    // anime release "with English subs" is Japanese audio.
    const audioText = text.replace(SUBS, ' ');
    // Torrentio's flag line lists every language in the torrent name, subtitles
    // included, so when the name talks about subtitles the flags can't be trusted
    // for audio ("(Multi-Subs)" + 🇬🇧 is Japanese audio with English subs).
    const mentionsSubs = audioText !== text;
    if (!mentionsSubs) for (const [flag, code] of Object.entries(FLAGS)) if (text.includes(flag)) languages.add(code);
    for (const [re, code] of WORDS) if (re.test(audioText)) languages.add(code);
    // Dubs: "Dual Audio" is the original plus English (anime: Japanese + English);
    // "English Dub" / "Dubbed" with no other language named is English too.
    const dualAudio = DUAL_AUDIO.test(text) || JP_AND_EN.test(audioText);
    const dub = ENGLISH_DUB.test(text) || DUB_GROUP.test(text) || DUBBED.test(text);
    if (
        dualAudio ||
        ENGLISH_DUB.test(text) ||
        ENGLISH_AUDIO.test(audioText) ||
        DUB_GROUP.test(text) ||
        (DUBBED.test(text) && [...languages].every((l) => l === 'jpn' || l === 'eng'))
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

const KIND_RANK: Record<Kind, number> = { debrid: 0, 'debrid-uncached': 1, torrent: 2, skip: 9 };

/**
 * Orders candidates best-first. Priorities, in order:
 * cached debrid > uncached debrid > torrent · language match (the other way
 * round when the original audio isn't your language) · not Dolby-Vision-only ·
 * highest resolution within the cap · release quality · seeders · smaller size ·
 * the addon order you set.
 */
export function rankStreams(candidates: Candidate[], prefs: EasyPrefs): Candidate[] {
    // Is the original audio in another language (anime, K-dramas…)? Then the
    // sources that don't name a language are that original, and the language
    // matters more than speed: an English torrent beats a cached Japanese one.
    // Otherwise untagged sources are already in the original (usually your)
    // language, and speed comes first as before.
    const foreignOriginal =
        !!prefs.language &&
        candidates.some(
            (c) => c.parsed.dub || c.parsed.languages.some((l) => l !== prefs.language && ['jpn', 'kor', 'chi'].includes(l))
        );
    const langRank = (p: Parsed) => {
        if (!prefs.language) return 0;
        if (p.languages.includes(prefs.language)) return 0;
        if (p.multiAudio || p.maybeMultiAudio) return 1;
        if (p.languages.length === 0) return foreignOriginal ? 2 : 1; // unknown: the original audio
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
                (foreignOriginal
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
