import type { RequestAction } from '@trystero-p2p/core';
import { isSafeImage, MAX_IMAGE_BYTES, validateImage } from './image';
export type PhotoMetadata = {version: 2; id: string; roundId: string; bytes: number; mime: 'image/webp' | 'image/jpeg'};
export type PhotoAck = {ok: true; id: string; roundId: string};
export type PhotoAction = RequestAction<Uint8Array, PhotoAck>;
const safeId = (value: unknown): value is string => typeof value === 'string' && /^[\w-]{1,100}$/.test(value);
export function parsePhotoMetadata(value: unknown): PhotoMetadata | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (v.version !== 2 || !safeId(v.id) || !safeId(v.roundId) || !Number.isInteger(v.bytes) || (v.bytes as number) < 1 || (v.bytes as number) > MAX_IMAGE_BYTES || !['image/jpeg','image/webp'].includes(v.mime as string)) return null;
  return v as PhotoMetadata;
}
/** Trystero 0.25 receives binary as Uint8Array, not Blob. */
export async function receivePhoto(data: unknown, meta: PhotoMetadata, decode = validateImage): Promise<Blob> {
  const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : null;
  if (!bytes || bytes.byteLength !== meta.bytes || bytes.byteLength > MAX_IMAGE_BYTES || !isSafeImage(bytes, meta.mime)) throw new Error('Bilddaten oder Bildgröße ungültig.');
  const blob = new Blob([Uint8Array.from(bytes)], {type: meta.mime});
  await decode(blob); return blob;
}
export async function withDeadline<T>(run: (signal: AbortSignal) => Promise<T>, milliseconds: number, parent?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const abort = () => controller.abort();
  if (parent?.aborted) controller.abort(); else parent?.addEventListener('abort', abort, {once:true});
  try {
    return await new Promise<T>((resolve, reject) => {
      const cancelled = () => reject(new Error('Vorgang abgebrochen oder Zeitlimit überschritten.'));
      controller.signal.addEventListener('abort', cancelled, {once:true});
      if (controller.signal.aborted) { cancelled(); return; }
      timer = setTimeout(abort, milliseconds);
      Promise.resolve().then(() => run(controller.signal)).then(resolve, reject);
    });
  } finally { clearTimeout(timer); parent?.removeEventListener('abort', abort); controller.abort(); }
}
export async function transferPhoto(action: PhotoAction, peer: string, blob: Blob, meta: PhotoMetadata, signal: AbortSignal, progress: (n: number) => void): Promise<void> {
  if (blob.size !== meta.bytes || !parsePhotoMetadata(meta)) throw new Error('Bildgröße ungültig.');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const ack = await withDeadline(s => action.request(bytes, {target:peer, metadata:meta, signal:s, timeoutMs:20_000, onProgress:n => progress(Math.round(n * 95))}), 25_000, signal);
      if (!ack || ack.ok !== true || ack.id !== meta.id || ack.roundId !== meta.roundId) throw new Error('Empfang wurde nicht bestätigt.');
      progress(100); return;
    } catch (e) {
      if (signal.aborted || attempt === 1 || (e as {kind?:string})?.kind === 'rejected') throw e;
      progress(0);
    }
  }
}
