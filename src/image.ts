export const MAX_IMAGE_BYTES = 450_000;
export const MAX_EDGE = 1280;
export function isSafeImage(bytes: Uint8Array, mime: string): boolean {
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES || !['image/webp','image/jpeg'].includes(mime)) return false;
  return mime === 'image/jpeg' ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff :
    String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP';
}
export async function processImage(file: File): Promise<Blob> {
  if (!file.type.startsWith('image/') || file.size > 40_000_000) throw new Error('Bitte ein Bild bis 40 MB auswählen.');
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch { throw new Error('Dieses Foto konnte nicht geöffnet werden.'); }
  try {
    let scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    for (let step = 0; step < 6; step++) {
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Bildverarbeitung ist hier nicht verfügbar.');
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.78, 0.62, 0.46, 0.32]) {
        for (const mime of ['image/webp', 'image/jpeg']) {
          const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, mime, quality));
          if (blob && blob.type === mime && blob.size <= MAX_IMAGE_BYTES && isSafeImage(new Uint8Array(await blob.slice(0, 12).arrayBuffer()), mime)) return blob;
        }
      }
      scale *= 0.75;
    }
    throw new Error('Das Foto konnte nicht ausreichend verkleinert werden.');
  } finally { bitmap.close(); }
}
