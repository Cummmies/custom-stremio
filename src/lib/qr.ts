// A QR code drawn here, as SVG: for screens that show a link to open on a
// phone, like pairing the TV with Lightboxd. No network involved.
import qrcode from 'qrcode-generator';

/** SVG markup for `text`: dark modules on a transparent background, scaling to its box. */
export function qrSvg(text: string): string {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount();
    let d = '';
    for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) if (qr.isDark(y, x)) d += `M${x} ${y}h1v1h-1z`;
    }
    // A quiet zone of 2 modules; the caller's white box adds the rest.
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-2 -2 ${n + 4} ${n + 4}" shape-rendering="crispEdges" role="img" aria-label="QR code"><path d="${d}" fill="#000"/></svg>`;
}
