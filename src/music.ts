type Track = 'lobby' | 'submit' | 'finale';
const MAX_BYTES = 8_000_000;

/** One reusable streaming player. Only public soundtrack files enter this cache. */
export class BackgroundMusic {
  private element: HTMLAudioElement | null = null;
  private active = false;
  private enabled = false;
  private muted = false;
  private scene: Track | null = 'lobby';
  private source = '';
  private generation = 0;
  private cache = new Map<string, string>();
  private failedPrefetch = new Set<string>();
  private warming: AbortController | null = null;
  private message = '';
  private listeners = new Set<() => void>();

  constructor(private url: (track: Track) => string | undefined, private connect: (element: HTMLAudioElement) => void) {}
  snapshot = () => this.message;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private status(message: string) { if (this.message === message) return; this.message = message; this.listeners.forEach(fn => fn()); }
  private wanted() { return this.active && this.enabled && !this.muted && this.scene !== null; }
  private player() {
    if (this.element) return this.element;
    const element = new Audio();
    element.loop = true; element.preload = 'auto'; element.setAttribute('playsinline', '');
    this.connect(element);
    element.addEventListener('playing', () => { if (this.wanted()) { this.status(''); void this.preloadNext(); } });
    element.addEventListener('waiting', () => { if (this.wanted()) this.status('Musik lädt …'); });
    element.addEventListener('error', () => { if (this.wanted()) this.status('Musik konnte nicht geladen werden.'); });
    this.element = element;
    return element;
  }
  private sync() {
    const token = ++this.generation;
    if (!this.wanted()) { this.element?.pause(); this.status(''); return; }
    const url = this.url(this.scene!);
    if (!url) { this.element?.pause(); this.status('Für diese Phase ist keine Musik hinterlegt.'); return; }
    try {
      const player = this.player();
      if (this.source !== url) {
        player.pause(); this.source = url;
        player.src = this.cache.get(url) ?? url;
        player.load(); this.status('Musik lädt …');
      }
      if (!player.paused) return;
      // Called synchronously from the user's music/start/retry gesture. A phase
      // change reuses this same element rather than creating a new autoplay target.
      void player.play().then(() => {
        if (token === this.generation && this.wanted()) { this.status(''); void this.preloadNext(); }
      }).catch((error: unknown) => {
        if (token !== this.generation || !this.wanted()) return;
        this.status(error instanceof Error && error.name === 'NotAllowedError'
          ? 'Zum Starten der Musik bitte auf „Musik starten“ tippen.'
          : 'Musik konnte nicht geladen werden.');
      });
    } catch { this.status('Musik konnte nicht gestartet werden.'); }
  }
  private async preloadNext() {
    if (this.warming || !this.active || !this.enabled || this.muted) return;
    const request = new AbortController(); this.warming = request;
    // Let the current track start first, then prepare the following tracks one
    // at a time. Store compressed bytes, never full decoded multi-minute buffers.
    try {
      for (const track of ['submit', 'finale', 'lobby'] as const) {
        const url = this.url(track);
        if (request.signal.aborted) break;
        if (!url || track === this.scene || this.cache.has(url) || this.failedPrefetch.has(url)) continue;
        const timeout = new AbortController();
        const cancel = () => timeout.abort();
        request.signal.addEventListener('abort', cancel, { once: true });
        const timer = setTimeout(cancel, 30_000);
        try {
          const response = await fetch(url, { signal: timeout.signal, cache: 'force-cache' });
          if (!response.ok || Number(response.headers.get('Content-Length')) > MAX_BYTES || !response.body) throw new Error('Audio unavailable');
          const reader = response.body.getReader();
          const chunks: Uint8Array<ArrayBuffer>[] = []; let size = 0;
          try {
            while (true) {
              const { done, value } = await reader.read(); if (done) break;
              size += value.byteLength;
              if (size > MAX_BYTES) throw new Error('Audio too large');
              chunks.push(Uint8Array.from(value));
            }
          } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
          if (!request.signal.aborted && size > 0) {
            const mime = /\.ogg(?:\?|$)/i.test(url) ? 'audio/ogg' : /\.wav(?:\?|$)/i.test(url) ? 'audio/wav' : 'audio/mpeg';
            this.cache.set(url, URL.createObjectURL(new Blob(chunks, { type: mime })));
          }
        } catch { if (!request.signal.aborted) this.failedPrefetch.add(url); }
        finally { clearTimeout(timer); request.signal.removeEventListener('abort', cancel); }
      }
    } finally { if (this.warming === request) this.warming = null; }
  }
  private cancelWarm() { this.warming?.abort(); this.warming = null; }
  start() { if (this.active) return; this.active = true; this.sync(); }
  setEnabled(value: boolean) { this.enabled = value; if (!value) this.cancelWarm(); this.sync(); }
  setMuted(value: boolean) { this.muted = value; if (value) this.cancelWarm(); this.sync(); }
  setScene(value: Track | null) {
    if (value === this.scene) return;
    this.scene = value;
    // Start each new phase from the beginning, including repeated photo rounds.
    if (this.element) { this.element.pause(); try { this.element.currentTime = 0; } catch { /* not loaded */ } }
    this.sync();
  }
  retry() { this.source = ''; this.failedPrefetch.clear(); this.sync(); }
  stop() {
    this.active = false; ++this.generation; this.cancelWarm();
    if (this.element) { this.element.pause(); this.element.removeAttribute('src'); this.element.load(); }
    this.source = '';
    for (const url of this.cache.values()) URL.revokeObjectURL(url);
    this.cache.clear(); this.failedPrefetch.clear(); this.status('');
  }
}
