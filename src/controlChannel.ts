import { parseNetwork } from './networkProtocol';
import { decodeMessage, encodeMessage } from './protocol';
import { waitForBuffer } from './photoChannel';
import { withDeadline } from './transfer';
import type { RequestContext, RequestOptions } from './actions';

/** Small controls use their own SCTP stream on the existing authenticated peer
 * connection. No HTTP/WebSocket fallback, no images, bounded requests and RAM. */
export class ControlChannel {
  private pending = new Map<string, { resolve: () => void; reject: (error: Error) => void }>();
  private received = new Map<string, boolean>();
  private processing = new Set<string>();
  private closed = false;
  private abort = new AbortController();
  private window = Date.now();
  private count = 0;
  private outgoing = 0;
  constructor(readonly channel: RTCDataChannel, private peerId: string,
    private permitted: () => boolean,
    private receive: (data: string, context: RequestContext) => Promise<unknown>,
    private limit: number) {
    channel.addEventListener('message', this.onMessage);
    channel.addEventListener('close', this.onClose);
    channel.addEventListener('error', this.onClose);
  }
  get active() { return this.pending.size + this.processing.size; }
  private send(value: object) {
    if (this.closed || !this.permitted() || this.channel.readyState !== 'open') throw new Error('Spielverbindung unterbrochen.');
    this.channel.send(JSON.stringify(value));
  }
  request(data: string, options: RequestOptions): Promise<{ ok: true }> {
    const message = decodeMessage(data);
    if (!message || this.closed || !this.permitted() || this.outgoing >= 64) return Promise.reject(new Error('Spielverbindung nicht bereit.'));
    const notify = options.acknowledge === false;
    if (notify && message.type !== 'reaction') return Promise.reject(new Error('Diese Aktion benötigt eine Bestätigung.'));
    const requestId = crypto.randomUUID();
    this.outgoing++;
    return withDeadline(async signal => {
      await waitForBuffer(this.channel, signal);
      if (notify) { this.send({ type: 'CONTROL', requestId, message, ack: false }); return { ok: true as const }; }
      return await new Promise<{ ok: true }>((resolve, reject) => {
        const finish = (error?: Error) => {
          signal.removeEventListener('abort', cancel); this.pending.delete(requestId);
          if (error) reject(error); else resolve({ ok: true });
        };
        const cancel = () => finish(new Error('Spielaktion abgebrochen oder Zeitlimit überschritten.'));
        this.pending.set(requestId, { resolve: () => finish(), reject: finish });
        signal.addEventListener('abort', cancel, { once: true });
        if (signal.aborted) cancel();
        else try { this.send({ type: 'CONTROL', requestId, message }); } catch (error) { finish(error as Error); }
      });
    }, options.timeoutMs ?? 10_000, options.signal).finally(() => { this.outgoing--; });
  }
  private onMessage = (event: MessageEvent) => { void this.handle(event.data).catch(() => this.close()); };
  private async handle(data: unknown) {
    if (this.closed || !this.permitted()) return;
    const now = Date.now();
    if (now - this.window >= 60_000) { this.window = now; this.count = 0; }
    if (++this.count > this.limit || typeof data !== 'string' || new TextEncoder().encode(data).byteLength > 32_768) { this.close(); return; }
    const value = (() => { try { return JSON.parse(data); } catch { return null; } })();
    const message = parseNetwork(value);
    if (!message || !['CONTROL', 'ACK'].includes(message.type)) return;
    if (message.type === 'ACK') {
      const pending = this.pending.get(message.requestId);
      if (message.ok) pending?.resolve(); else pending?.reject(new Error('Spielaktion wurde abgelehnt.'));
      return;
    }
    if (message.type !== 'CONTROL') return;
    if (this.received.has(message.requestId)) {
      if (message.ack !== false) this.send({ type: 'ACK', requestId: message.requestId, ok: this.received.get(message.requestId) });
      return;
    }
    if (this.processing.has(message.requestId)) return;
    if (this.processing.size >= 32) { this.close(); return; }
    this.processing.add(message.requestId);
    let ok = false;
    try { await this.receive(encodeMessage(message.message), { peerId: this.peerId, signal: this.abort.signal }); ok = true; }
    catch { /* Never acknowledge an invalid game action as successful. */ }
    finally { this.processing.delete(message.requestId); }
    if (this.closed) return;
    this.received.set(message.requestId, ok);
    if (this.received.size > 256) this.received.delete(this.received.keys().next().value!);
    if (message.ack !== false) this.send({ type: 'ACK', requestId: message.requestId, ok });
  }
  private onClose = () => this.close();
  close() {
    if (this.closed) return;
    this.closed = true; this.abort.abort();
    for (const pending of [...this.pending.values()]) pending.reject(new Error('Spielverbindung unterbrochen.'));
    this.pending.clear(); this.received.clear(); this.processing.clear();
    this.channel.removeEventListener('message', this.onMessage);
    this.channel.removeEventListener('close', this.onClose);
    this.channel.removeEventListener('error', this.onClose);
    this.channel.close();
  }
}
