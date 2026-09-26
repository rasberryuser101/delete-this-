import { deflateSync, inflateSync, strFromU8, strToU8 } from 'fflate';
export const CONNECTION_ERROR = 'Direkte Verbindung konnte in diesem Netzwerk leider nicht hergestellt werden.';
export interface Signal { v: 1; kind: 'offer' | 'answer'; session: string; sdp: string; stun?: string }
export function validStun(value: string): boolean { return /^stuns?:[a-z0-9.-]+(?::[0-9]{1,5})?$/i.test(value) && value.length < 150; }
export function encodeSignal(signal: Signal): string {
  const bytes = deflateSync(strToU8(JSON.stringify(signal)), {level: 9});
  let binary = ''; for (const b of bytes) binary += String.fromCharCode(b);
  return 'DT1.' + btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function decodeSignal(value: string): Signal {
  let token = value.trim();
  if (token.includes('offer=') || token.includes('answer=')) {
    try { const url = new URL(token); token = new URLSearchParams(url.hash.split('?')[1] ?? url.search).get('offer') ?? new URLSearchParams(url.hash.split('?')[1] ?? url.search).get('answer') ?? token; } catch { /* copy code handled below */ }
  }
  if (!/^DT1\.[A-Za-z0-9_-]{20,14000}$/.test(token)) throw new Error('Verbindungscode ungültig oder unvollständig.');
  const chars = atob(token.slice(4).replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = Uint8Array.from(chars, char => char.charCodeAt(0));
  const decoded = inflateSync(bytes);
  if (decoded.length > 60_000) throw new Error('Verbindungscode ist zu groß.');
  const parsed: unknown = JSON.parse(strFromU8(decoded));
  if (!parsed || typeof parsed !== 'object') throw new Error('Verbindungscode ungültig.');
  const s = parsed as Record<string, unknown>;
  if (s.v !== 1 || !['offer','answer'].includes(s.kind as string) || typeof s.session !== 'string' || !/^[\w-]{10,100}$/.test(s.session) || typeof s.sdp !== 'string' || s.sdp.length > 50_000 || !s.sdp.startsWith('v=0\r\n') || (s.stun !== undefined && (typeof s.stun !== 'string' || !validStun(s.stun)))) throw new Error('Verbindungscode ungültig.');
  return s as unknown as Signal;
}
export function createPeer(stun: string): RTCPeerConnection {
  if (!validStun(stun)) throw new Error('STUN-Adresse ungültig.');
  return new RTCPeerConnection({iceServers: [{urls: stun}], iceTransportPolicy: 'all'});
}
async function gathered(peer: RTCPeerConnection): Promise<string> {
  if (peer.iceGatheringState !== 'complete') await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => { peer.removeEventListener('icegatheringstatechange', check); reject(new Error(CONNECTION_ERROR)); }, 20000);
    const check = () => { if (peer.iceGatheringState === 'complete') { clearTimeout(timeout); peer.removeEventListener('icegatheringstatechange', check); resolve(); } };
    peer.addEventListener('icegatheringstatechange', check); check();
  });
  if (!peer.localDescription?.sdp) throw new Error(CONNECTION_ERROR);
  return peer.localDescription.sdp;
}
export async function makeOffer(stun: string): Promise<{peer:RTCPeerConnection; channel:RTCDataChannel; signal:Signal}> {
  const peer = createPeer(stun);
  try {
    const channel = peer.createDataChannel('delete-this', {ordered:true});
    await peer.setLocalDescription(await peer.createOffer());
    const sdp = await gathered(peer);
    return {peer, channel, signal:{v:1, kind:'offer', session:crypto.randomUUID(), sdp, stun}};
  } catch(e) { peer.close(); throw e; }
}
export async function answerOffer(offer: Signal): Promise<{peer:RTCPeerConnection; channel:Promise<RTCDataChannel>; signal:Signal}> {
  if (offer.kind !== 'offer') throw new Error('Bitte den Verbindungscode des Hosts verwenden.');
  const peer = createPeer(offer.stun ?? 'stun:stun.l.google.com:19302');
  try {
    const channel = new Promise<RTCDataChannel>((resolve, reject) => {
      peer.addEventListener('datachannel', event => resolve(event.channel), {once:true});
      peer.addEventListener('connectionstatechange', () => { if (peer.connectionState === 'failed') reject(new Error(CONNECTION_ERROR)); });
    });
    await peer.setRemoteDescription({type:'offer', sdp:offer.sdp});
    await peer.setLocalDescription(await peer.createAnswer());
    const sdp = await gathered(peer);
    return {peer, channel, signal:{v:1, kind:'answer', session:offer.session, sdp}};
  } catch(e) { peer.close(); throw e; }
}
export async function acceptAnswer(peer: RTCPeerConnection, offer: Signal, token: string): Promise<void> {
  const answer = decodeSignal(token);
  if (answer.kind !== 'answer' || answer.session !== offer.session) throw new Error('Dieser Antwortcode gehört zu einer anderen Einladung.');
  await peer.setRemoteDescription({type:'answer', sdp:answer.sdp});
}
export function waitConnected(peer: RTCPeerConnection, channel: RTCDataChannel, timeoutMs = 30000): Promise<void> {
  if (channel.readyState === 'open') return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => end(new Error(CONNECTION_ERROR)), timeoutMs);
    const end = (error?: Error) => { clearTimeout(timer); peer.removeEventListener('connectionstatechange', check); channel.removeEventListener('open', check); error ? reject(error) : resolve(); };
    const check = () => { if (channel.readyState === 'open') end(); else if (['failed','closed','disconnected'].includes(peer.connectionState)) end(new Error(CONNECTION_ERROR)); };
    peer.addEventListener('connectionstatechange', check); channel.addEventListener('open', check); check();
  });
}
