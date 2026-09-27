export const MAX_IMAGE_BYTES = 450_000;
export const MAX_EDGE = 1280;
async function openImage(blob: Blob): Promise<{source: CanvasImageSource; width:number; height:number; close:()=>void}> {
  if (typeof createImageBitmap === 'function') {
    try { const b = await createImageBitmap(blob, {imageOrientation:'from-image'}); return {source:b, width:b.width, height:b.height, close:()=>b.close()}; } catch { /* Safari format fallback below */ }
  }
  const url = URL.createObjectURL(blob);
  const img = new Image();
  try {
    await new Promise<void>((resolve,reject) => {
      const timer = setTimeout(() => { img.src=''; reject(new Error('Bild konnte nicht geöffnet werden.')); }, 15_000);
      img.onload=()=>{clearTimeout(timer); resolve();};
      img.onerror=()=>{clearTimeout(timer); reject(new Error('Dieses Bildformat wird nicht unterstützt. Bitte ein JPEG oder einen Screenshot wählen.'));};
      img.src=url;
    });
    return {source:img, width:img.naturalWidth, height:img.naturalHeight, close:()=>{img.src=''; URL.revokeObjectURL(url);}};
  } catch(e) { URL.revokeObjectURL(url); throw e; }
}
export async function validateImage(blob: Blob): Promise<void> {
  const image = await openImage(blob);
  try { if (image.width<1 || image.height<1 || image.width>MAX_EDGE || image.height>MAX_EDGE) throw new Error('Bildabmessungen ungültig.'); }
  finally { image.close(); }
}
export function isSafeImage(bytes: Uint8Array, mime: string): boolean {
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES || !['image/webp','image/jpeg'].includes(mime)) return false;
  return mime === 'image/jpeg' ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff :
    String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP';
}
export async function processImage(file: File): Promise<Blob> {
  if (!file.type.startsWith('image/') || file.size > 40_000_000) throw new Error('Bitte ein Bild bis 40 MB auswählen.');
  const bitmap = await openImage(file);
  const canvas = document.createElement('canvas');
  try {
    let scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    for (let step = 0; step < 6; step++) {
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Bildverarbeitung ist hier nicht verfügbar.');
      ctx.drawImage(bitmap.source, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.78, 0.62, 0.46, 0.32]) {
        for (const mime of ['image/webp', 'image/jpeg']) {
          const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, mime, quality));
          if (blob && blob.type === mime && blob.size <= MAX_IMAGE_BYTES && isSafeImage(new Uint8Array(await blob.slice(0, 12).arrayBuffer()), mime)) return blob;
        }
      }
      scale *= 0.75;
    }
    throw new Error('Das Foto konnte nicht ausreichend verkleinert werden.');
  } finally { bitmap.close(); canvas.width=0; canvas.height=0; }
}
