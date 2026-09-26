import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import QRCode from 'qrcode';
import jsQR from 'jsqr';
import { CATEGORIES, type Category } from './prompts';
import { allSubmitted, castVote, createGame, disconnectPlayer, joinPlayer, nextRound, reveal, submitPhoto, type Game, type Mode } from './game';
import { processImage } from './image';
import { decodeMessage, ImageReceiver, sendImage, sendMessage } from './protocol';
import { acceptAnswer, answerOffer, CONNECTION_ERROR, decodeSignal, encodeSignal, makeOffer, validStun, waitConnected, type Signal } from './webrtc';
import { isMuted, play, setMuted } from './sound';
import './style.css';

type Peer = {pc: RTCPeerConnection; channel: RTCDataChannel; receiver: ImageReceiver};
const DEFAULT_STUN = 'stun:stun.l.google.com:19302';
const nameKey = 'delete-this-name'; // Nur der Anzeigename, niemals Fotos.
function currentRoute() { const hash = location.hash.slice(1).split('?')[0]; return ['/spiel','/datenschutz','/info'].includes(hash) ? hash : '/'; }
function linkFor(signal: string, kind: 'offer'|'answer') { return `${location.origin}${location.pathname}#/spiel?${kind}=${encodeURIComponent(signal)}`; }
function labelError(e: unknown): string { return e instanceof Error ? e.message : 'Das hat leider nicht geklappt.'; }

function QrCard({value, title}: {value:string; title:string}) {
  const [src, setSrc] = useState('');
  const [error, setError] = useState(false);
  useEffect(() => { setError(false); setSrc(''); void QRCode.toDataURL(value, {width: 380, margin: 2, errorCorrectionLevel: 'L'}).then(setSrc).catch(() => setError(true)); }, [value]);
  return <div className="qr-card"><strong>{title}</strong>{src ? <img alt={title} src={src}/> : error ? <p>Für diesen Code ist der QR-Code zu dicht. Bitte den Copy-Code verwenden.</p> : <p>QR-Code wird vorbereitet …</p>}</div>;
}
function Scanner({onScan, onClose}: {onScan:(code:string)=>void; onClose:()=>void}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const callback = useRef(onScan); callback.current = onScan;
  const [error, setError] = useState('');
  useEffect(() => {
    let stopped = false; let stream: MediaStream | undefined; let timer: number;
    void navigator.mediaDevices?.getUserMedia({video:{facingMode:{ideal:'environment'}}}).then(s => {
      if (stopped) { s.getTracks().forEach(t => t.stop()); return; }
      stream = s; const video = videoRef.current; if (!video) return;
      video.srcObject = s; void video.play();
      const scan = () => {
        if (stopped) return;
        const canvas = canvasRef.current;
        if (canvas && video.readyState >= 2 && video.videoWidth) {
          canvas.width = video.videoWidth; canvas.height = video.videoHeight;
          const ctx = canvas.getContext('2d', {willReadFrequently:true});
          if (ctx) { ctx.drawImage(video, 0, 0); const pixels = ctx.getImageData(0,0,canvas.width,canvas.height); const result = jsQR(pixels.data, canvas.width, canvas.height); if (result) { callback.current(result.data); return; } }
        }
        timer = window.setTimeout(scan, 160);
      };
      scan();
    }).catch(() => setError('Kamera nicht verfügbar. Bitte den Code kopieren und einfügen.'));
    return () => { stopped = true; clearTimeout(timer); stream?.getTracks().forEach(t => t.stop()); };
  }, []);
  return <div className="scanner"><strong>QR-Code scannen</strong>{error ? <p role="alert">{error}</p> : <video ref={videoRef} playsInline muted autoPlay/>}<canvas ref={canvasRef} hidden/><button className="small" onClick={onClose}>Schließen</button></div>;
}
function App() {
  const [route, setRoute] = useState(currentRoute);
  const [mute, setMute] = useState(isMuted());
  const [name, setName] = useState(() => localStorage.getItem(nameKey) ?? '');
  const [mode, setMode] = useState<Mode>('party');
  const [stun, setStun] = useState(DEFAULT_STUN);
  const [categories, setCategories] = useState<Category[]>(['Normal','Freunde','Chaos','Roast','Dating','Party','Schule']);
  const [game, setGame] = useState<Game | null>(null);
  const gameRef = useRef<Game | null>(null);
  const [role, setRole] = useState<'host'|'guest'|null>(null);
  const [you, setYou] = useState('host');
  const [offerCode, setOfferCode] = useState('');
  const [answerCode, setAnswerCode] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [scanFor, setScanFor] = useState<'offer'|'answer'|null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [countdown, setCountdown] = useState(0);
  const [images, setImages] = useState<Record<string,string>>({});
  const imagesRef = useRef<Map<string,{url:string; blob:Blob}>>(new Map());
  const peersRef = useRef<Map<string,Peer>>(new Map());
  const pendingRef = useRef<{pc:RTCPeerConnection; channel:RTCDataChannel; signal:Signal}|null>(null);
  const guestRef = useRef<Peer|null>(null);
  const usedRef = useRef<string[]>([]);
  const myIdRef = useRef('host');
  const roundRef = useRef('');
  const disposedRef = useRef(false);
  const countdownTimer = useRef<number|undefined>(undefined);

  useEffect(() => {
    const change = () => { setRoute(currentRoute()); const code = new URLSearchParams(location.hash.split('?')[1] ?? '').get('offer'); if (code) setJoinCode(code); };
    window.addEventListener('hashchange', change); change();
    return () => { disposedRef.current = true; window.removeEventListener('hashchange', change); clearTimeout(countdownTimer.current); pendingRef.current?.pc.close(); guestRef.current?.pc.close(); peersRef.current.forEach(p => p.pc.close()); imagesRef.current.forEach(v => URL.revokeObjectURL(v.url)); imagesRef.current.clear(); };
  }, []);
  const saveName = () => { const clean = name.trim().slice(0,24); if (!clean) throw new Error('Bitte zuerst einen Namen eingeben.'); localStorage.setItem(nameKey, clean); return clean; };
  const fail = (e: unknown) => { setError(labelError(e)); play('error'); setBusy(false); };
  const clearImages = () => { imagesRef.current.forEach(({url}) => URL.revokeObjectURL(url)); imagesRef.current.clear(); setImages({}); };
  const storeImage = (id: string, blob: Blob) => {
    const prior = imagesRef.current.get(id); if (prior) URL.revokeObjectURL(prior.url);
    const url = URL.createObjectURL(blob); imagesRef.current.set(id, {url, blob});
    if (!disposedRef.current) setImages(Object.fromEntries([...imagesRef.current].map(([key,v]) => [key,v.url])));
  };
  const publish = (next: Game) => {
    gameRef.current = next; setGame(next);
    peersRef.current.forEach((peer,id) => sendMessage(peer.channel, {type:'sync', game:next, you:id}));
    if (next.phase === 'result') play('winner');
  };
  const handlePeerMessage = async (id: string, peer: Peer, data: unknown) => {
    if (typeof data !== 'string') {
      if (data instanceof ArrayBuffer && !peer.receiver.push(data)) sendMessage(peer.channel, {type:'error', message:'Bildübertragung ungültig.'});
      return;
    }
    const msg = decodeMessage(data);
    if (!msg) { sendMessage(peer.channel, {type:'error', message:'Nachricht ungültig.'}); return; }
    const current = gameRef.current;
    if (msg.type === 'hello' && current?.phase === 'lobby' && !current.players.some(p => p.id === id)) {
      try { publish(joinPlayer(current, {id, name:msg.name.trim(), score:0, connected:true})); sendMessage(peer.channel, {type:'sync', game:gameRef.current!, you:id}); play('connected'); setStatus(`${msg.name.trim()} ist dabei!`); }
      catch(e) { sendMessage(peer.channel, {type:'error', message:labelError(e)}); peer.pc.close(); }
    }
    if (msg.type === 'photo-begin') {
      if (!current || current.phase !== 'submit' || current.roundId !== msg.roundId || current.photos.some(p => p.ownerId === id) || !peer.receiver.begin(msg)) sendMessage(peer.channel, {type:'error', message:'Foto kann gerade nicht empfangen werden.'});
    }
    if (msg.type === 'photo-end') {
      const received = peer.receiver.finish(msg);
      if (!received || !current || current.phase !== 'submit' || received.roundId !== current.roundId) return;
      try {
        const bitmap = await createImageBitmap(received.blob);
        const valid = bitmap.width <= 1280 && bitmap.height <= 1280; bitmap.close();
        if (!valid || gameRef.current?.roundId !== received.roundId) throw new Error('Bild ungültig.');
        storeImage(received.id, received.blob);
        const next = submitPhoto(gameRef.current, id, received.id); publish(next); play('submit');
        if (allSubmitted(next)) void showReveal(next);
      } catch(e) { sendMessage(peer.channel, {type:'error', message:labelError(e)}); }
    }
    if (msg.type === 'vote' && current?.roundId === msg.roundId) {
      try { publish(castVote(gameRef.current!, id, msg.photoId)); play('vote'); }
      catch(e) { sendMessage(peer.channel, {type:'error', message:labelError(e)}); }
    }
  };
  const showReveal = async (source: Game) => {
    if (gameRef.current?.phase !== 'submit' || gameRef.current.roundId !== source.roundId) return;
    const next = reveal(source); publish(next); play('reveal');
    if (next.mode === 'remote') {
      for (const [id,peer] of peersRef.current) {
        if (!next.players.some(p => p.id === id && p.connected)) continue;
        for (const photo of next.photos) {
          const blob = imagesRef.current.get(photo.id)?.blob;
          if (blob) try { await sendImage(peer.channel, photo.id, next.roundId, blob); } catch { /* connection status handles disconnect */ }
        }
      }
    }
  };
  const startHost = () => {
    try { const clean = saveName(); if (!validStun(stun)) throw new Error('Bitte eine gültige STUN-Adresse eingeben.');
      const next = createGame(clean, mode); gameRef.current = next; setGame(next); setRole('host'); setYou('host'); setError(''); location.hash = '#/spiel'; play('button');
    } catch(e) { fail(e); }
  };
  const createInvite = async () => {
    if (gameRef.current?.phase !== 'lobby' || gameRef.current.players.length >= 8) return;
    setBusy(true); setError(''); setStatus('Verbindungscode wird erzeugt (ICE-Kandidaten sammeln) …');
    pendingRef.current?.pc.close(); pendingRef.current = null; setOfferCode(''); setAnswerCode('');
    try { const pending = await makeOffer(stun); pendingRef.current = {pc:pending.peer, channel:pending.channel, signal:pending.signal}; setOfferCode(encodeSignal(pending.signal)); setStatus('Einladung bereit. Dein Freund scannt den QR-Code und zeigt dir anschließend die Antwort.'); setBusy(false); }
    catch(e) { fail(e); }
  };
  const finishHostPair = async (code: string) => {
    const pending = pendingRef.current; if (!pending) { fail(new Error('Bitte zuerst eine Einladung erstellen.')); return; }
    setBusy(true); setError(''); setScanFor(null); setStatus('Direkte Verbindung wird hergestellt …');
    try {
      await acceptAnswer(pending.pc, pending.signal, code);
      const id = crypto.randomUUID(); const peer: Peer = {pc:pending.pc, channel:pending.channel, receiver:new ImageReceiver()};
      peer.channel.binaryType = 'arraybuffer'; peer.channel.onmessage = event => { void handlePeerMessage(id, peer, event.data); };
      peer.pc.addEventListener('connectionstatechange', () => {
        if (['failed','closed','disconnected'].includes(peer.pc.connectionState)) {
          peersRef.current.delete(id); peer.receiver.clear();
          if (gameRef.current?.players.some(p => p.id === id && p.connected)) { publish(disconnectPlayer(gameRef.current, id)); setStatus(`${id.slice(0,4)} hat die Verbindung verloren.`); }
        }
      });
      await waitConnected(peer.pc, peer.channel);
      peersRef.current.set(id, peer); pendingRef.current = null; setOfferCode(''); setAnswerCode(''); setBusy(false); setStatus('Verbunden! Weitere Mitspieler können jetzt beitreten.'); play('connected');
    } catch(e) { pending.pc.close(); pendingRef.current = null; setOfferCode(''); fail(e); }
  };
  const startGuest = async (code: string) => {
    let nameValue: string; try { nameValue = saveName(); } catch(e) { fail(e); return; }
    setBusy(true); setError(''); setStatus('Antwort wird vorbereitet (ICE-Kandidaten sammeln) …');
    try {
      const offer = decodeSignal(code);
      const answer = await answerOffer(offer);
      void answer.channel.then(channel => {
        if (answer.peer.signalingState === 'closed') return;
        const peer: Peer = {pc:answer.peer, channel, receiver:new ImageReceiver()}; guestRef.current = peer;
        channel.binaryType = 'arraybuffer';
        channel.onopen = () => { sendMessage(channel, {type:'hello', name:nameValue}); setStatus('Verbunden! Warte auf die Spielrunde.'); play('connected'); };
        channel.onmessage = event => { void handleGuestMessage(peer, event.data); };
        if (channel.readyState === 'open') { sendMessage(channel, {type:'hello', name:nameValue}); setStatus('Verbunden! Warte auf die Spielrunde.'); play('connected'); }
      }).catch(fail);
      answer.peer.addEventListener('connectionstatechange', () => { if (['failed','disconnected','closed'].includes(answer.peer.connectionState)) { setError(CONNECTION_ERROR); play('error'); } });
      setRole('guest'); setAnswerCode(encodeSignal(answer.signal)); setBusy(false); setStatus('Zeige dem Host diesen Antwort-QR-Code oder schicke ihm den Copy-Code.'); location.hash = '#/spiel';
    } catch(e) { guestRef.current?.pc.close(); guestRef.current = null; fail(e); }
  };
  const handleGuestMessage = async (peer: Peer, data: unknown) => {
    if (typeof data !== 'string') { if (data instanceof ArrayBuffer) peer.receiver.push(data); return; }
    const msg = decodeMessage(data); if (!msg) return;
    if (msg.type === 'error') { fail(new Error(msg.message)); return; }
    if (msg.type === 'sync') {
      if (roundRef.current !== msg.game.roundId) { clearImages(); roundRef.current = msg.game.roundId; }
      gameRef.current = msg.game; setGame(msg.game); myIdRef.current = msg.you; setYou(msg.you);
      if (msg.game.phase === 'submit') play('prompt');
      if (msg.game.phase === 'vote') play('reveal');
      if (msg.game.phase === 'result') play('winner');
      setAnswerCode('');
    }
    if (msg.type === 'photo-begin') {
      if (gameRef.current?.mode === 'remote' && msg.roundId === gameRef.current.roundId) peer.receiver.begin(msg);
    }
    if (msg.type === 'photo-end') {
      const result = peer.receiver.finish(msg);
      if (result && result.roundId === gameRef.current?.roundId && gameRef.current?.mode === 'remote') {
        try { const bitmap = await createImageBitmap(result.blob); const valid = bitmap.width <= 1280 && bitmap.height <= 1280; bitmap.close(); if (valid) storeImage(result.id, result.blob); } catch { /* corrupted photo ignored */ }
      }
    }
  };
  const selectPhoto = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; event.target.value = ''; if (!file || !gameRef.current || gameRef.current.phase !== 'submit') return;
    setBusy(true); setError('');
    try {
      const blob = await processImage(file); const current = gameRef.current;
      if (!current || current.phase !== 'submit') throw new Error('Diese Runde ist schon vorbei.');
      const photoId = crypto.randomUUID();
      if (role === 'host') {
        storeImage(photoId, blob); const next = submitPhoto(current, 'host', photoId); publish(next); play('submit'); if (allSubmitted(next)) void showReveal(next);
      } else {
        const channel = guestRef.current?.channel; if (!channel) throw new Error(CONNECTION_ERROR);
        await sendImage(channel, photoId, current.roundId, blob); storeImage(photoId, blob); setStatus('Foto gesendet. Warte auf die anderen.'); play('submit');
      }
      setBusy(false);
    } catch(e) { fail(e); }
  };
  const vote = (photoId: string) => {
    if (!gameRef.current || gameRef.current.votes[you]) return;
    try { if (role === 'host') publish(castVote(gameRef.current, 'host', photoId)); else if (guestRef.current) sendMessage(guestRef.current.channel, {type:'vote', roundId:gameRef.current.roundId, photoId}); play('vote'); }
    catch(e) { fail(e); }
  };
  const beginRound = () => {
    if (!gameRef.current) return;
    try {
      setError(''); const start = gameRef.current;
      let n = 3; setCountdown(n); play('countdown');
      const tick = () => { n--; if (n) {setCountdown(n); play('countdown'); countdownTimer.current = window.setTimeout(tick, 750);} else {
        setCountdown(0); clearImages(); const next = nextRound(start, categories, usedRef.current); usedRef.current.push(next.prompt); publish(next); play('prompt');
      }};
      countdownTimer.current = window.setTimeout(tick, 750);
    } catch(e) { fail(e); }
  };
  const leave = () => {
    clearTimeout(countdownTimer.current); pendingRef.current?.pc.close(); pendingRef.current = null;
    guestRef.current?.pc.close(); guestRef.current = null; peersRef.current.forEach(p => p.pc.close()); peersRef.current.clear(); clearImages();
    gameRef.current = null; setGame(null); setRole(null); setOfferCode(''); setAnswerCode(''); setStatus(''); setError(''); roundRef.current = ''; myIdRef.current = 'host'; setYou('host'); location.hash = '#/spiel';
  };
  const copy = async (value: string) => { try { await navigator.clipboard.writeText(value); setStatus('Code kopiert!'); play('button'); } catch { setError('Kopieren nicht möglich. Bitte den Code markieren und selbst kopieren.'); } };
  const toggleCategory = (category: Category) => { setCategories(current => current.includes(category) ? current.filter(c => c !== category) : [...current, category]); play('button'); };
  const me = game?.players.find(p => p.id === you);
  const hasSubmitted = !!game?.photos.some(p => p.ownerId === you);
  const voted = !!game?.votes[you];
  const winner = game?.players.find(p => p.id === game.winnerId);
  return <div className="app">
    <div className="confetti" aria-hidden="true">✦ ★ ✿ ✦ ★ ✿ ✦ ★</div>
    <header><a className="brand" href="#/">DELETE THIS! <span>📸</span></a><nav><a href="#/spiel">Spiel</a><a href="#/datenschutz">Datenschutz</a><a href="#/info">Info</a></nav><button className="mute" aria-label={mute ? 'Ton einschalten' : 'Ton ausschalten'} onClick={() => {setMuted(!mute); setMute(!mute); if(mute) play('button');}}>{mute ? '🔇' : '🔊'}</button></header>
    <main>
      {route === '/' && <section className="hero panel"><div className="sticker">DAS FOTO-CHAOS<br/>MIT DEINEN LEUTEN!</div><h1>DELETE<br/><em>THIS!</em></h1><p>Prompt lesen. Peinliches Foto finden. Anonym lachen. Abstimmen. Bereuen.</p><a className="button giant" href="#/spiel">JETZT SPIELEN ✨</a><p className="fine">2–8 Personen · ohne Account · Fotos bleiben zwischen euren Geräten</p></section>}
      {route === '/datenschutz' && <section className="panel prose"><h1>Datenschutz 🔒</h1><p>Delete This! benötigt keine Accounts. Es gibt keine Analytics, kein Tracking und keine KI-Auswertung.</p><p>Deine ausgewählten Fotos werden auf deinem Gerät per Canvas verkleinert und neu encodiert. Dabei werden Metadaten wie EXIF und GPS nicht übernommen. Die Originaldatei wird nicht übertragen. Spielbilder bleiben nur vorübergehend im Arbeitsspeicher, werden über direkte WebRTC-Verbindungen zwischen den Spielgeräten ausgetauscht und am Rundenwechsel oder beim Verlassen aus der App entfernt. Fotos werden nicht hochgeladen oder gespeichert, auch nicht im Browser-Speicher oder Service-Worker-Cache.</p><p>Zum Herstellen der Verbindung wird ein öffentlicher, in der Lobby änderbarer STUN-Server genutzt. Dieser kann technische Verbindungsdaten wie deine IP-Adresse sehen, erhält aber keine Fotos. Ohne direkte Verbindung ist das Spiel in manchen Netzwerken nicht möglich; es gibt keinen TURN- oder Server-Fallback.</p><p>Beim normalen Aufruf der Website erhält der Hostinganbieter technisch notwendige Verbindungsdaten, etwa IP-Adresse und Abrufzeit. Details zu dessen Verarbeitung stehen in dessen Datenschutzhinweisen. Der gespeicherte Anzeigename liegt ausschließlich in deinem Browser und kann über die Browserdaten gelöscht werden. Die App speichert keine Fotos.</p></section>}
      {route === '/info' && <section className="panel prose"><h1>So funktioniert’s 🎉</h1><ol><li>Eine Person erstellt das Spiel und wählt Party Mode oder Remote Mode.</li><li>Für jede weitere Person gibt es genau einmal ein QR-Paar: Host zeigt Einladung, Gast zeigt Antwort, Host scannt Antwort.</li><li>Ab dann bleibt ihr verbunden. Es gibt keine Codes zwischen den Runden.</li><li>Prompt lesen, eigenes Foto auswählen, anonym abstimmen. Für den Rundensieg gibt es einen Punkt.</li></ol><p><strong>Party Mode:</strong> Alle sehen die Fotos gemeinsam auf dem Gerät des Hosts. Auf den Handys erscheinen Prompt und Abstimmknöpfe.</p><p><strong>Remote Mode:</strong> Der Host verteilt die verkleinerten Fotos direkt über WebRTC; alle sehen sie auf dem eigenen Gerät.</p><p>Mindestens zwei Geräte sind nötig. Bei manchen Mobilfunk- und Firmennetzen ist eine direkte Verbindung ohne TURN nicht möglich.</p><a className="button" href="#/spiel">Zum Spiel →</a></section>}
      {route === '/spiel' && <section className="game-layout">
        {!role && <div className="panel"><span className="eyebrow">SPIELSTART 🎲</span><h1>Wer bist du?</h1><label className="field">Dein Name<input maxLength={24} value={name} onChange={e=>setName(e.target.value)} placeholder="z. B. Chaos-Chris"/></label><div className="two-col"><div className="option"><h2>🎤 Spiel erstellen</h2><p>Du bist Host und verbindest die Handys einmalig.</p><div className="mode-row"><button className={mode==='party'?'selected':''} onClick={()=>setMode('party')}>📺 Party Mode</button><button className={mode==='remote'?'selected':''} onClick={()=>setMode('remote')}>📱 Remote Mode</button></div><p className="fine">{mode === 'party' ? 'Fotos nur auf deinem Gerät; alle stimmen per Handy ab.' : 'Fotos auf allen Geräten; direkte Übertragung über dich.'}</p><details><summary>STUN-Server ändern</summary><input value={stun} onChange={e=>setStun(e.target.value)} aria-label="STUN-Server"/></details><button className="button" onClick={startHost}>SPIEL ERSTELLEN ✨</button></div><div className="option"><h2>📲 Mitspielen</h2><p>Einladung vom Host scannen oder einfügen.</p><button className="small" onClick={()=>setScanFor('offer')}>📷 QR scannen</button><label className="field">Einladungscode<textarea rows={3} value={joinCode} onChange={e=>setJoinCode(e.target.value)} placeholder="DT1. … oder Einladungslink"/></label><button className="button pink" disabled={busy || !joinCode.trim()} onClick={()=>void startGuest(joinCode)}>BEITRETEN →</button></div></div></div>}
        {role === 'host' && game?.phase === 'lobby' && <div className="panel"><span className="eyebrow">DU BIST HOST 👑</span><h1>Die Lobby</h1><p>Wählt einen gemeinsamen Bildschirm für Party Mode. Jeder weitere Mitspieler wird einmal verbunden.</p><div className="players">{game.players.filter(p=>p.connected).map(p=><span className="player" key={p.id}>⭐ {p.name}{p.id==='host'?' (Host)':''}</span>)}</div><p>{game.players.filter(p=>p.connected).length}/8 Spieler</p><div className="category-wrap"><h2>Prompt-Kategorien</h2><div className="category-list">{CATEGORIES.map(c=><button key={c} className={categories.includes(c)?'selected':''} onClick={()=>toggleCategory(c)}>{c==='18+'?'🔞 ':''}{c}</button>)}</div><p className="fine">18+ ist standardmäßig aus. Nur mit erwachsenen Mitspielern aktivieren.</p></div>{!offerCode && game.players.length < 8 && <button className="button" disabled={busy} onClick={()=>void createInvite()}>{busy?'Code wird erzeugt …':'➕ MIT FREUND VERBINDEN'}</button>}{offerCode && <div className="pair-box"><QrCard value={linkFor(offerCode,'offer')} title="1. Gast scannt diese Einladung"/><p>Alternativ Einladungslink senden:</p><button className="small" onClick={()=>void copy(linkFor(offerCode,'offer'))}>🔗 Link kopieren</button><details><summary>Copy-Code anzeigen</summary><textarea readOnly rows={3} value={offerCode} onClick={e=>e.currentTarget.select()}/><button className="small" onClick={()=>void copy(offerCode)}>Code kopieren</button></details><hr/><h3>2. Antwort des Gastes übernehmen</h3><button className="small" onClick={()=>setScanFor('answer')}>📷 Antwort scannen</button><textarea rows={3} value={answerCode} onChange={e=>setAnswerCode(e.target.value)} placeholder="Antwortcode oder Link hier einfügen"/><button className="button pink" disabled={busy || !answerCode.trim()} onClick={()=>void finishHostPair(answerCode)}>VERBINDUNG HERSTELLEN</button><button className="small quiet" onClick={()=>{pendingRef.current?.pc.close();pendingRef.current=null;setOfferCode('');setAnswerCode('');}}>Einladung abbrechen</button></div>}<button className="button green" disabled={game.players.filter(p=>p.connected).length<2 || !!offerCode || countdown>0 || !categories.length} onClick={beginRound}>{countdown ? `START IN ${countdown} …` : 'RUNDE STARTEN 🚀'}</button></div>}
        {role === 'guest' && !game && <div className="panel center"><span className="eyebrow">FAST DRIN! 📡</span><h1>Antwort an den Host</h1><p>Der Host scannt diesen QR-Code oder übernimmt deinen Copy-Code. Dann seid ihr für das ganze Spiel verbunden.</p>{answerCode && <><QrCard value={answerCode} title="Antwort-QR-Code"/><button className="small" onClick={()=>void copy(answerCode)}>📋 Antwortcode kopieren</button><details><summary>Copy-Code anzeigen</summary><textarea readOnly rows={3} value={answerCode} onClick={e=>e.currentTarget.select()}/></details></>}<button className="small quiet" onClick={leave}>Zurück</button></div>}
        {role==='guest' && game?.phase==='lobby' && <div className="panel center"><span className="eyebrow">VERBUNDEN! 🎊</span><h1>Warte auf den Host</h1><p>Du bist als <strong>{me?.name}</strong> dabei. Kein weiterer Code nötig.</p><div className="players">{game.players.filter(p=>p.connected).map(p=><span className="player" key={p.id}>{p.name}</span>)}</div></div>}
        {game && game.phase !== 'lobby' && <div className="panel round"><div className="round-top"><span className="eyebrow">RUNDE {game.round} · {game.category}</span><span className="pill">{game.mode==='party'?'📺 PARTY':'📱 REMOTE'}</span></div><h1 className="prompt">{game.prompt}</h1>
          {game.phase==='submit' && <div className="center"><h2>Such das passende Foto 🔎</h2><p>Wähle ein Bild aus deiner Galerie. Es wird vor dem Senden lokal verkleinert.</p>{!hasSubmitted && !busy && <label className="button file-button">📸 FOTO AUSWÄHLEN<input type="file" accept="image/*" onChange={e=>void selectPhoto(e)}/></label>}{busy && <p className="pill">Foto wird verarbeitet …</p>}{hasSubmitted && <p className="success">✅ Foto eingereicht!</p>}<p>{game.photos.length}/{game.players.filter(p=>p.connected).length} Fotos eingereicht</p><p className="fine">Identität der Fotos bleibt bis zum Ergebnis verborgen.</p></div>}
          {game.phase==='vote' && <div><h2>Welches Foto gewinnt? 🗳️</h2><p>{game.mode==='party' && role==='guest' ? 'Schau auf das Gerät des Hosts und wähle die Nummer deines Lieblingsfotos.' : 'Stimm für das lustigste Foto.'} Du kannst dein eigenes Foto nicht wählen.</p><div className={`photo-grid ${game.mode==='party'&&role==='guest'?'party-vote':''}`}>{game.photos.map((photo,index)=><div className="photo-card" key={photo.id}><div className="photo-frame">{(role==='host'||game.mode==='remote') && images[photo.id] ? <img src={images[photo.id]} alt={`Anonymes Foto ${index+1}`}/> : <span>{game.mode==='party'&&role==='guest'?'📺':'⏳'}</span>}</div><strong>FOTO {index+1}</strong><button disabled={voted || photo.ownerId===you || (game.mode==='remote' && role==='guest' && !images[photo.id])} onClick={()=>vote(photo.id)}>{photo.ownerId===you?'Dein Foto':voted?'Stimme abgegeben':'Dafür stimmen ⭐'}</button></div>)}</div><p className="center">{Object.keys(game.votes).length}/{game.players.filter(p=>p.connected).length} Stimmen · {voted ? 'Deine Stimme ist drin!' : 'Eine Stimme pro Person'}</p></div>}
          {game.phase==='result' && <div className="center"><div className="winner-burst">🏆</div><h2>{winner?.name ?? 'Überraschung'} gewinnt!</h2><p>Ein Punkt für das Foto, das diese Runde gerettet (oder ruiniert) hat.</p><div className="scoreboard">{[...game.players].sort((a,b)=>b.score-a.score).map((p,index)=><div key={p.id}><span>{index+1}. {p.name}{!p.connected?' (offline)':''}</span><strong>{p.score} ⭐</strong></div>)}</div>{role==='host' && <button className="button green" disabled={countdown>0 || game.players.filter(p=>p.connected).length<2} onClick={beginRound}>{countdown?`START IN ${countdown} …`:'NÄCHSTE RUNDE ➜'}</button>}{role==='guest' && <p>Warte auf die nächste Runde …</p>}{role==='host' && <button className="small" onClick={()=>{play('gameover');leave();}}>Spiel beenden</button>}</div>}
        </div>}
        {role && <button className="small leave" onClick={leave}>Spiel verlassen ↩</button>}
      </section>}
      {status && route==='/spiel' && <div className="toast" role="status">{status}</div>}
      {error && route==='/spiel' && <div className="error" role="alert">⚠️ {error}<button aria-label="Meldung schließen" onClick={()=>setError('')}>×</button></div>}
      {scanFor && <div className="overlay"><Scanner onClose={()=>setScanFor(null)} onScan={code=>{setScanFor(null); if(scanFor==='offer') {setJoinCode(code); setStatus('Einladung gescannt. Jetzt auf „Beitreten“ tippen.');} else {setAnswerCode(code); setStatus('Antwort gescannt. Jetzt Verbindung herstellen.');}}}/></div>}
    </main><footer>DELETE THIS! ✦ Fotos nur zwischen euren Geräten ✦ <a href="#/datenschutz">Datenschutz</a></footer>
  </div>;
}
export default App;
