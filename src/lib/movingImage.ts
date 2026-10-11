// Moving pictures (a GIF or an animated WebP) are never converted: they go up
// exactly as chosen, with the part you framed in Move and Scale kept beside
// them as a crop, and ProfileMedia shows just that part. Still pictures are
// cut to the frame before they go up (ImageCropper). No videos go up from the
// app; one already on a profile (from the website) still plays.

/** The upload limit: 10 MB of file (the server's MAX_UPLOAD_BYTES). */
const MAX_BYTES = 10 * 1024 * 1024;

/** What a picture or banner can be chosen as: JPEG, PNG, WebP or GIF. */
export const PICTURE_TYPES = 'image/jpeg,image/png,image/webp,image/gif';

/** Whether a picture moves: any GIF, and a WebP with VP8X's "animation" flag (byte 20, bit 2). */
export async function isMoving(file: File) {
    if (file.type === 'image/gif') return true;
    if (file.type !== 'image/webp') return false;
    const head = new Uint8Array(await file.slice(0, 21).arrayBuffer());
    return String.fromCharCode(...head.subarray(12, 16)) === 'VP8X' && (head[20] & 0b10) !== 0;
}

/** A file as a data URL (the whole file, as chosen). */
export function toDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result as string);
        r.onerror = () => reject(r.error);
        r.readAsDataURL(blob);
    });
}

export const fitsUpload = (file: Blob) => file.size <= MAX_BYTES;

export const TOO_BIG = 'That picture is over 10 MB. Try a smaller one.';
