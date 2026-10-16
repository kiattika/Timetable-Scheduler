/**
 * Logo / emblem images are stored as base64 data URLs INSIDE the single `apps/{org}` Firestore document
 * (hard limit 1 MiB for the whole document). Un-resized photos (hundreds of KB each) can fill most of it.
 * These helpers downscale to a print-sufficient size and re-encode as PNG (keeps transparency; PNG/JPEG are the
 * only formats the DOCX/PDF exporters accept).
 */

/** Approximate stored size of a data URL in bytes (string length ≈ bytes for base64). */
export const dataUrlBytes = (u?: string | null): number => (u ? u.length : 0);

export const formatKB = (bytes: number): string => `${Math.round(bytes / 1024)} KB`;

/** Anything above this is worth shrinking (~40 KB base64 is plenty for a 300px PNG logo). */
export const SHRINK_THRESHOLD_BYTES = 80 * 1024;

const loadImage = (src: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('โหลดรูปภาพไม่สำเร็จ'));
    img.src = src;
  });

/**
 * Downscale so the longest side is at most `maxSide`, re-encode as PNG.
 * Returns the ORIGINAL when the result would not be smaller, or when the source is not a raster data URL.
 */
export const shrinkImageDataUrl = async (dataUrl: string, maxSide = 300): Promise<string> => {
  if (!dataUrl || !dataUrl.startsWith('data:image') || dataUrl.startsWith('data:image/svg')) return dataUrl;
  const img = await loadImage(dataUrl);
  const w0 = img.naturalWidth || img.width;
  const h0 = img.naturalHeight || img.height;
  if (!w0 || !h0) return dataUrl;
  const scale = Math.min(1, maxSide / Math.max(w0, h0));
  const w = Math.max(1, Math.round(w0 * scale));
  const h = Math.max(1, Math.round(h0 * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return dataUrl;
  ctx.drawImage(img, 0, 0, w, h);
  const out = canvas.toDataURL('image/png');
  return out.length < dataUrl.length ? out : dataUrl;
};
