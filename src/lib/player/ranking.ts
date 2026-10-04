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
    /** DTS or TrueHD audio, which the Samsung TV's player can't play (silent or refused). */
    tvUnfriendlyAudio: boolean;
};

export type Candidate = { stream: Stream; addon: string; addonUrl?: string | null; addonIndex: number; parsed: Parsed };
type Scored = Candidate & { fit: EpisodeFit };

export type EasyPrefs = {
    maxResolution: number;
    language: string | null;
    allowTorrents: boolean;
    /** Anime: sources that don't name a language are Japanese, and your language comes first. */
    anime: boolean;
    /** The episode wanted, to leave out sources for a different one. */
    episode?: Episode | null;
    /** On the TV: DTS / TrueHD audio last, since its player can't play it. */
    tv?: boolean;
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

// Language names and codes, for subtitle lists ("Spa, Eng Subs").
const LANG_WORD =
    '(?:eng(?:lish)?|spa(?:nish)?|esp|fre(?:nch)?|fra|ger(?:man)?|deu|ita(?:lian)?|por(?:tuguese)?|pt-?br|rus(?:sian)?|jpn|jap(?:anese)?|kor(?:ean)?|hin(?:di)?|ara(?:bic)?|chi(?:nese)?|multi(?:ple)?)';
const SUBS = new RegExp(
    [
        // "Eng Subs", "English Softsubs", "Spa, Eng Subs", "Multi-Subs", "Eng SRT"
        String.raw`(?:\b${LANG_WORD}\b[ ,/+&|._-]*)+(?:soft|hard)?[ ._-]?(?:sub(?:s|bed|titles?)?|srt)\b`,
        // "Subs: English, Spanish", "Subtitles - Eng/Spa", "Sub ENG"
        String.raw`\bsub(?:s|bed|titles?)?\s*(?:[:=-]\s*)?(?:\b${LANG_WORD}\b[ ,/+&|._-]*)+`,
        // "ESub", "MSubs", "Subbed", "Softsubs" on their own
        String.raw`\b(?:e|m[ ._-]?|soft|hard)?sub(?:s|bed)?\b`,
    ].join('|'),
    'gi'
);
// Lines that only list subtitles: AIOStreams' "📝 …", Comet/MediaFusion's "💬 …", "Subtitles: …".
const SUB_LINE = /^\s*(?:📝|💬|🔤|sub(?:s|titles?)\s*:)/iu;
// Lines that only list audio: "🔊 English | Japanese", "🗣️ …", "Audio: …".
const AUDIO_LINE = /^\s*(?:🔊|🗣|🎧|🎙|audio\s*:)/iu;
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

// Words some addons use for not cached yet ("Uncached", "Not cached", ⏳).
const SAYS_UNCACHED = /\b(?:un-?cached|not[ ._-]cached)\b|⏳/iu;

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
        else kind = SAYS_UNCACHED.test(text) ? 'debrid-uncached' : 'debrid';
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
    // Same for Comet's / MediaFusion's 💬 and "Subtitles:" lines. And when a source
    // has a line just for audio ("🔊 English | Japanese"), that line is the answer.
    const lines = text.split('\n').filter((l) => !SUB_LINE.test(l));
    const audioLine = lines.find((l) => AUDIO_LINE.test(l));
    const noSubLines = audioLine ?? lines.join('\n');
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
        tvUnfriendlyAudio: /\b(?:dts(?:-?(?:hd|x|ma))?|true-?hd)\b/i.test(text) && !/\b(?:aac|e-?ac-?3|ddp|dd\+?|ac-?3)\b/i.test(text),
    };
}

// --- which episode a source is -------------------------------------------

/** The episode a Stremio video id points at. Season is null for ids numbered by episode only (Kitsu). */
export type Episode = { season: number | null; episode: number };

/** "tt0944947:1:3" / "tmdb:1399:1:3" → S1 E3; "kitsu:11:5" → E5. Null for movies. */
export function episodeOf(videoId: string | null | undefined): Episode | null {
    const parts = (videoId ?? '').split(':');
    const num = (v: string | undefined) => (v != null && /^\d+$/.test(v) ? Number(v) : null);
    if (parts.length >= 4 || (parts.length === 3 && /^tt\d+$/.test(parts[0]))) {
        const season = num(parts.at(-2));
        const episode = num(parts.at(-1));
        return season != null && episode != null ? { season, episode } : null;
    }
    if (parts.length === 3) {
        const episode = num(parts[2]);
        return episode != null ? { season: null, episode } : null;
    }
    return null;
}

/**
 * How well a source fits the episode wanted, from its name and file name:
 * - match: says this episode ("S01E03", "1x03", "S01E02-E04")
 * - pack: a whole season or series ("S01", "Season 1", "Complete"): the addon picks the file
 * - unknown: doesn't say
 * - likely-wrong: says another episode, but numbered a way that might not line up (anime's "- 27")
 * - wrong: says another episode or season
 */
export type EpisodeFit = 'match' | 'pack' | 'unknown' | 'likely-wrong' | 'wrong';

const SXE = /\bS(\d{1,2})[ ._-]?E(\d{1,4})(?:(?:[ ._-]?E|-E?)(\d{1,4}))?(?!\d)/gi;
const NXN = /\b(\d{1,2})x(\d{2,3})\b/gi;
const SEASON_PACK = /\bS(\d{1,2})(?:[ ._-]?-[ ._-]?S?(\d{1,2}))?\b(?![ ._-]?E\d)|\bseasons?[ ._-]?(\d{1,2})(?:[ ._-]?(?:-|to)[ ._-]?(\d{1,2}))?\b/gi;
const COMPLETE = /\b(?:complete|all[ ._-]seasons|series[ ._-]pack|batch)\b/i;
const EPISODE_WORD = /\b(?:ep(?:isode)?|E)[ ._-]?(\d{1,4})\b(?!p)/gi;
// Anime: "[Group] Show - 05 [1080p]", "Show S2 - 05", "Show - 05v2".
const DASH_EPISODE = /(?:^|\s)-\s(\d{1,4})(?:v\d)?(?=[\s.[(]|$)/gm;

export function episodeFit(text: string, want: Episode | null): EpisodeFit {
    if (!want) return 'unknown';
    // The size, seeders and source lines can't say an episode; keep them out.
    const lines = text.split('\n').filter((l) => !/^\s*(?:💾|👤|👥|⚙|🔎|🌐|🌎|🔗)/u.test(l));
    let match = false;
    let wrong = false;
    let likelyWrong = false;
    let pack = false;
    for (const line of lines) {
        let specific = false;
        for (const re of [SXE, NXN]) {
            for (const m of line.matchAll(re)) {
                specific = true;
                const first = Number(m[2]);
                const end = m[3] ? Number(m[3]) : first;
                const last = end > first && end - first < 50 ? end : first;
                const hasEpisode = want.episode >= first && want.episode <= last;
                if (want.season == null) {
                    // Numbered by episode only: S02E05 might be that list's 5th or its 30th.
                    if (hasEpisode) match = true;
                    else likelyWrong = true;
                } else if (Number(m[1]) === want.season && hasEpisode) match = true;
                else wrong = true;
            }
        }
        if (specific) continue;
        for (const m of line.matchAll(SEASON_PACK)) {
            const from = Number(m[1] ?? m[3]);
            const to = Math.max(from, Number(m[2] ?? m[4] ?? from));
            pack = true;
            if (want.season != null && (want.season < from || want.season > to)) wrong = true;
        }
        if (COMPLETE.test(line)) pack = true;
        for (const re of [EPISODE_WORD, DASH_EPISODE]) {
            for (const m of line.matchAll(re)) {
                const n = Number(m[1]);
                if (n === want.episode) match = true;
                // With a season wanted, a lone number may count from the first season ("One Piece - 1050").
                else if (want.season == null) likelyWrong = true;
            }
        }
    }
    // A file named for this episode inside a pack (Torrentio: pack name, then the file) is a match.
    if (match) return 'match';
    if (wrong) return 'wrong';
    if (likelyWrong) return 'likely-wrong';
    return pack ? 'pack' : 'unknown';
}

/** What a source says about its release, for `episodeFit` (not the addon's name: "Torrentio\n1080p"). */
export function releaseText(s: Stream): string {
    return [s.behaviorHints?.filename, s.title, s.description].filter(Boolean).join('\n');
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
    // Another episode is worse than anything else.
    const FIT_RANK: Record<EpisodeFit, number> = { match: 0, unknown: 0, pack: 0, 'likely-wrong': 1, wrong: 2 };

    const usable: Scored[] = candidates
        .filter((c) => {
            const p = c.parsed;
            if (p.kind === 'skip' || p.junk) return false;
            if (p.kind === 'torrent' && !prefs.allowTorrents) return false;
            if (p.resolution != null && p.resolution > prefs.maxResolution) return false;
            return true;
        })
        .map((c) => ({ ...c, fit: episodeFit(releaseText(c.stream), prefs.episode ?? null) }));
    // Sources that name another episode are left out, as long as some name this one.
    // (When none do, the addons and the catalog number episodes differently: keep them, last.)
    const anyMatch = usable.some((c) => c.fit === 'match');
    return usable
        .filter((c) => !(anyMatch && c.fit === 'wrong'))
        .sort((a, b) => {
            const pa = a.parsed;
            const pb = b.parsed;
            return (
                FIT_RANK[a.fit] - FIT_RANK[b.fit] ||
                (prefs.anime
                    ? langRank(pa) - langRank(pb) || kindRank(pa) - kindRank(pb)
                    : kindRank(pa) - kindRank(pb) || langRank(pa) - langRank(pb)) ||
                // A season pack: the addon has to pick the right file out of it, and
                // sometimes doesn't. A single file of the same kind and language first.
                Number(a.fit === 'pack') - Number(b.fit === 'pack') ||
                // DV-only files show wrong colours without a DV display; a clean lower
                // resolution beats that.
                Number(pa.dolbyVisionOnly) - Number(pb.dolbyVisionOnly) ||
                // The TV's player can't play DTS or TrueHD.
                (prefs.tv ? Number(pa.tvUnfriendlyAudio) - Number(pb.tvUnfriendlyAudio) : 0) ||
                (pb.resolution ?? 0) - (pa.resolution ?? 0) ||
                pb.tier - pa.tier ||
                (pb.seeders ?? 0) - (pa.seeders ?? 0) ||
                (pa.sizeBytes ?? Infinity) - (pb.sizeBytes ?? Infinity) ||
                a.addonIndex - b.addonIndex
            );
        });
}
