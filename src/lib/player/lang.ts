// Video files tag tracks with 2-letter codes ("en"), Stremio settings and addons
// use 3-letter ones ("eng", sometimes "fra" vs "fre"). Compare them as one.

const TO_2: Record<string, string> = {
    eng: 'en', spa: 'es', fre: 'fr', fra: 'fr', ger: 'de', deu: 'de', ita: 'it', por: 'pt', rus: 'ru',
    jpn: 'ja', kor: 'ko', chi: 'zh', zho: 'zh', ara: 'ar', hin: 'hi', tur: 'tr', pol: 'pl', dut: 'nl',
    nld: 'nl', swe: 'sv', nor: 'no', nob: 'no', dan: 'da', fin: 'fi', gre: 'el', ell: 'el', heb: 'he',
    ukr: 'uk', cze: 'cs', ces: 'cs', hun: 'hu', rum: 'ro', ron: 'ro', bul: 'bg', vie: 'vi', tha: 'th',
    ind: 'id', may: 'ms', msa: 'ms', per: 'fa', fas: 'fa', hrv: 'hr', srp: 'sr', slo: 'sk', slk: 'sk',
    slv: 'sl', est: 'et', lav: 'lv', lit: 'lt', ice: 'is', isl: 'is', cat: 'ca', baq: 'eu', eus: 'eu',
    glg: 'gl', tam: 'ta', tel: 'te', ben: 'bn', urd: 'ur', fil: 'tl', tgl: 'tl',
};

/** Canonical short code for any 2- or 3-letter language code (or null). */
export function langKey(code: string | null | undefined): string | null {
    if (!code) return null;
    const c = code.toLowerCase().split(/[-_]/)[0];
    return TO_2[c] ?? c;
}

export function sameLanguage(a: string | null | undefined, b: string | null | undefined) {
    const ka = langKey(a);
    return !!ka && ka === langKey(b);
}
