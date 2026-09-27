import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { CATEGORIES, type Category } from './prompts';
import { allSubmitted, castVote, createGame, disconnectPlayer, joinPlayer, nextRound, reveal, submitPhoto, viewFor, type Game, type Mode } from './game';
import { isSafeImage, processImage } from './image';
import { PhotoStore } from './photoStore';
import { decodeMessage, encodeMessage, type WireMessage } from './protocol';
import { CONNECTION_ERROR, NETWORK_ERROR, createLobbySession, makeRoomCode, normalizeRoomCode, parsePhotoMetadata, roomLink, type LobbySession } from './room';
import { isMuted, isMusicEnabled, play, setMuted, setMusicEnabled, startMusic, stopMusic } from './sound';
import './style.css';

const nameKey = 'delete-this-name'; // Nur der Anzeigename, niemals Fotos.
function currentRoute() { const hash = location.hash.slice(1).split('?')[0]; return ['/spiel','/datenschutz','/info'].includes(hash) ? hash : '/'; }
function labelError(e: unknown): string { return e instanceof Error ? e.message : 'Das hat leider nicht geklappt.'; }

function App() {
  const [route, setRoute] = useState(currentRoute);
  const [mute, setMute] = useState(isMuted());
  const [music, setMusic] = useState(isMusicEnabled());
  const [name, setName] = useState(() => localStorage.getItem(nameKey) ?? '');
  const [mode, setMode] = useState<Mode>('party');
  const [categories, setCategories] = useState<Category[]>(['Normal','Freunde','Chaos','Roast','Dating','Party','Schule']);
  const [game, setGame] = useState<Game | null>(null);
  const gameRef = useRef<Game | null>(null);
  const [role, setRole] = useState<'host'|'guest'|null>(null);
  const [you, setYou] = useState('host');
  const [roomCode, setRoomCode] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [countdown, setCountdown] = useState(0);
  const [images, setImages] = useState<Record<string,string>>({});
  const imagesRef = useRef(new PhotoStore());
  const peersRef = useRef<Set<string>>(new Set());
  const sessionRef = useRef<LobbySession|null>(null);
  const hostIdRef = useRef('');
  const pendingNamesRef = useRef<Map<string,string>>(new Map());
  const usedRef = useRef<string[]>([]);
  const myIdRef = useRef('host');
  const roundRef = useRef('');
  const disposedRef = useRef(false);
  const countdownTimer = useRef<number|undefined>(undefined);

  useEffect(() => {
    disposedRef.current = false;
    const change = () => { setRoute(currentRoute()); const code = new URLSearchParams(location.hash.split('?')[1] ?? '').get('code'); if (code) setJoinCode(code); };
    window.addEventListener('hashchange', change); change();
    return () => { disposedRef.current = true; window.removeEventListener('hashchange', change); clearTimeout(countdownTimer.current); stopMusic(); void sessionRef.current?.room.leave(); imagesRef.current.clear(); };
  }, []);
  const saveName = () => { const clean = name.trim().slice(0,24); if (!clean) throw new Error('Bitte zuerst einen Namen eingeben.'); localStorage.setItem(nameKey, clean); return clean; };
  const fail = (e: unknown) => { setError(labelError(e)); play('error'); setBusy(false); };
  const clearImages = () => { imagesRef.current.clear(); setImages({}); };
  const storeImage = (id: string, blob: Blob) => {
    imagesRef.current.put(id, blob);
    if (!disposedRef.current) setImages(imagesRef.current.urls());
  };
  const sendControl = (id: string, message: WireMessage) => {
    const action = sessionRef.current?.control;
    if (!action) return;
    void action.send(encodeMessage(message), {target:id}).catch(()=>setStatus('Eine Verbindung wurde unterbrochen.'));
  };
  const sendPhoto = async (id: string, photoId: string, roundId: string, blob: Blob) => {
    const action = sessionRef.current?.photo;
    if (!action) throw new Error(CONNECTION_ERROR);
    await action.send(blob, {target:id, metadata:{version:1,id:photoId,roundId,bytes:blob.size,mime:blob.type as 'image/webp'|'image/jpeg'}});
  };
  const publish = (next: Game) => {
    gameRef.current = next; setGame(next);
    peersRef.current.forEach(id => sendControl(id,{type:'sync',game:viewFor(next,id),you:id}));
    if (next.phase === 'result') { clearImages(); play('winner'); }
  };
  const handlePeerMessage = (id: string, data: string) => {
    const msg = decodeMessage(data);
    if (!msg) { sendControl(id,{type:'error',message:'Nachricht ungültig.'}); return; }
    const current = gameRef.current;
    if (msg.type === 'vote' && current?.roundId === msg.roundId) {
      try { publish(castVote(gameRef.current!, id, msg.photoId)); play('vote'); }
      catch(e) { sendControl(id,{type:'error',message:labelError(e)}); }
    }
  };
  const handleHostPhoto = async (id: string, blob: Blob, metadata: unknown) => {
    const meta=parsePhotoMetadata(metadata as never); const current=gameRef.current;
    try {
      if (!meta || !(blob instanceof Blob) || blob.size!==meta.bytes || blob.type!==meta.mime || !current || current.phase!=='submit' || current.roundId!==meta.roundId || current.photos.some(p=>p.ownerId===id)) throw new Error('Foto kann gerade nicht empfangen werden.');
      if (!isSafeImage(new Uint8Array(await blob.slice(0,12).arrayBuffer()),blob.type)) throw new Error('Bild ungültig.');
      const bitmap=await createImageBitmap(blob); const valid=bitmap.width<=1280&&bitmap.height<=1280; bitmap.close();
      if(!valid || gameRef.current?.phase!=='submit' || gameRef.current.roundId!==meta.roundId) throw new Error('Bild ungültig.');
      storeImage(meta.id,blob); const next=submitPhoto(gameRef.current,id,meta.id); publish(next); play('submit');
      if(allSubmitted(next)) void showReveal(next);
    } catch(e) { sendControl(id,{type:'error',message:labelError(e)}); }
  };
  const showReveal = async (source: Game) => {
    if (gameRef.current?.phase !== 'submit' || gameRef.current.roundId !== source.roundId) return;
    const next = reveal(source); publish(next); play('reveal');
    if (next.mode === 'remote') {
      for (const id of peersRef.current) {
        if (!next.players.some(p => p.id === id && p.connected)) continue;
        for (const photo of next.photos) {
          const blob = imagesRef.current.getBlob(photo.id);
          if (blob) try { await sendPhoto(id,photo.id,next.roundId,blob); } catch { setStatus('Ein Foto konnte nicht an alle Geräte gesendet werden.'); }
        }
      }
    }
  };
  const startHost = async () => {
    let clean: string; try {clean=saveName();} catch(e) {fail(e);return;}
    play('button'); startMusic(); setBusy(true); setError(''); setStatus('Lobby wird geöffnet …');
    try {
      const code=makeRoomCode(); const next=createGame(clean,mode); gameRef.current=next; setGame(next);
      const session=createLobbySession({
        code,role:'host',
        authorize:(peerId,remote)=>{
          const lobby=gameRef.current;
          if(!lobby || lobby.phase!=='lobby' || lobby.players.length+pendingNamesRef.current.size>=8) throw new Error('Diese Lobby ist bereits voll oder das Spiel läuft schon.');
          pendingNamesRef.current.set(peerId,remote.name!.trim());
        },
        onJoinError:(peerId)=>pendingNamesRef.current.delete(peerId)
      });
      sessionRef.current=session;
      session.control.onMessage=(data,{peerId})=>handlePeerMessage(peerId,data);
      session.photo.onMessage=(blob,{peerId,metadata})=>{void handleHostPhoto(peerId,blob,metadata);};
      session.room.onPeerJoin=id=>{
        const playerName=pendingNamesRef.current.get(id); pendingNamesRef.current.delete(id);
        const lobby=gameRef.current;
        if(!playerName || !lobby || lobby.phase!=='lobby') { sendControl(id,{type:'error',message:'Diese Lobby ist bereits voll oder das Spiel läuft schon.'}); return; }
        try { peersRef.current.add(id); publish(joinPlayer(lobby,{id,name:playerName,score:0,connected:true})); play('connected'); setStatus(`${playerName} ist dabei!`); }
        catch(e) { peersRef.current.delete(id); sendControl(id,{type:'error',message:labelError(e)}); }
      };
      session.room.onPeerLeave=id=>{
        pendingNamesRef.current.delete(id); peersRef.current.delete(id);
        if(gameRef.current?.players.some(p=>p.id===id&&p.connected)) { publish(disconnectPlayer(gameRef.current,id)); setStatus('Ein Spieler hat die Verbindung verloren.'); }
      };
      setRoomCode(code); setRole('host'); setYou('host'); setBusy(false); setStatus('Lobby offen! Teile den Code mit deinen Freunden.'); location.hash='#/spiel'; play('connected');
    } catch(e) { stopMusic(); fail(e); }
  };
  const startGuest = async (input: string) => {
    let nameValue: string; let code: string;
    try {nameValue=saveName();code=normalizeRoomCode(input);} catch(e) {fail(e);return;}
    play('button'); startMusic(); setBusy(true); setError(''); setStatus('Suche Lobby und verbinde Geräte …');
    try {
      let candidateHost=''; let resolveConnected!:()=>void; let rejectConnected!:(reason:Error)=>void;
      const connected=new Promise<void>((resolve,reject)=>{resolveConnected=resolve;rejectConnected=reject;});
      const session=createLobbySession({
        code,role:'guest',name:nameValue,
        authorize:(peerId)=>{ if(candidateHost&&candidateHost!==peerId) throw new Error('Es wurde bereits ein Host gefunden.'); candidateHost=peerId; hostIdRef.current=peerId; },
        onJoinError:(peerId,error)=>{ if(peerId===candidateHost) rejectConnected(new Error(error.includes('timed out')?NETWORK_ERROR:CONNECTION_ERROR)); }
      });
      sessionRef.current=session;
      session.control.onMessage=(data,{peerId})=>{if(peerId===hostIdRef.current) void handleGuestMessage(data);};
      session.photo.onMessage=(blob,{peerId,metadata})=>{if(peerId===hostIdRef.current) void handleGuestPhoto(blob,metadata);};
      session.room.onPeerJoin=id=>{if(id===candidateHost) resolveConnected();};
      session.room.onPeerLeave=id=>{if(id===hostIdRef.current&&gameRef.current) setError('Die Verbindung zum Host wurde unterbrochen.');};
      const timer=window.setTimeout(()=>rejectConnected(new Error(CONNECTION_ERROR)),45_000);
      try { await connected; } finally { clearTimeout(timer); }
      setRole('guest'); setRoomCode(code); setBusy(false);
      setStatus('Direkt verbunden! Warte auf den Host.'); location.hash='#/spiel';
      play('connected');
    } catch(e) { void sessionRef.current?.room.leave(); sessionRef.current=null; hostIdRef.current=''; stopMusic(); fail(e); }
  };
  const handleGuestMessage = (data: string) => {
    const msg = decodeMessage(data); if (!msg) return;
    if (msg.type === 'error') { fail(new Error(msg.message)); return; }
    if (msg.type === 'sync') {
      const previousPhase = gameRef.current?.phase;
      if (roundRef.current !== msg.game.roundId) { clearImages(); roundRef.current = msg.game.roundId; }
      gameRef.current = msg.game; setGame(msg.game); myIdRef.current = msg.you; setYou(msg.you);
      if (previousPhase !== msg.game.phase && msg.game.phase === 'submit') play('prompt');
      if (previousPhase !== msg.game.phase && msg.game.phase === 'vote') play('reveal');
      if (msg.game.phase === 'result') { clearImages(); if (previousPhase !== 'result') play('winner'); }
    }
  };
  const handleGuestPhoto = async (blob: Blob, metadata: unknown) => {
    const meta=parsePhotoMetadata(metadata as never); const current=gameRef.current;
    if(!meta || !(blob instanceof Blob) || blob.size!==meta.bytes || blob.type!==meta.mime || current?.mode!=='remote' || current.phase!=='vote' || current.roundId!==meta.roundId) return;
    try { if(!isSafeImage(new Uint8Array(await blob.slice(0,12).arrayBuffer()),blob.type)) return; const bitmap=await createImageBitmap(blob); const valid=bitmap.width<=1280&&bitmap.height<=1280; bitmap.close(); if(valid&&gameRef.current?.phase==='vote'&&gameRef.current.roundId===meta.roundId) storeImage(meta.id,blob); } catch { /* beschädigtes Foto ignorieren */ }
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
        if (!hostIdRef.current) throw new Error(CONNECTION_ERROR);
        await sendPhoto(hostIdRef.current,photoId,current.roundId,blob); storeImage(photoId,blob); setStatus('Foto gesendet. Warte auf die anderen.'); play('submit');
      }
      setBusy(false);
    } catch(e) { fail(e); }
  };
  const vote = (photoId: string) => {
    if (!gameRef.current || gameRef.current.votes[you]) return;
    try { if (role === 'host') publish(castVote(gameRef.current,'host',photoId)); else if(hostIdRef.current) sendControl(hostIdRef.current,{type:'vote',roundId:gameRef.current.roundId,photoId}); play('vote'); }
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
    clearTimeout(countdownTimer.current); stopMusic(); gameRef.current=null; void sessionRef.current?.room.leave(); sessionRef.current=null;
    hostIdRef.current=''; pendingNamesRef.current.clear(); peersRef.current.clear(); clearImages();
    gameRef.current = null; setGame(null); setRole(null); setRoomCode(''); setStatus(''); setError(''); roundRef.current = ''; myIdRef.current = 'host'; setYou('host'); location.hash = '#/spiel';
  };
  const copy = async (value: string) => { try { await navigator.clipboard.writeText(value); setStatus('Code kopiert!'); play('button'); } catch { setError('Kopieren nicht möglich. Bitte den Code markieren und selbst kopieren.'); } };
  const toggleCategory = (category: Category) => { setCategories(current => current.includes(category) ? current.filter(c => c !== category) : [...current, category]); play('button'); };
  const me = game?.players.find(p => p.id === you);
  const hasSubmitted = !!game?.photos.some(p => p.ownerId === you);
  const voted = !!game?.votes[you];
  const remoteReady = game?.mode !== 'remote' || role === 'host' || game.photos.every(photo => !!images[photo.id]);
  const winner = game?.players.find(p => p.id === game.winnerId);
  return <div className="app">
    <div className="confetti" aria-hidden="true">✦ ★ ✿ ✦ ★ ✿ ✦ ★</div>
    <header><a className="brand" href="#/">DELETE THIS! <span>📸</span></a><nav><a href="#/spiel">Spiel</a><a href="#/datenschutz">Datenschutz</a><a href="#/info">Info</a></nav><button className="music-toggle" aria-label={music ? 'Musik ausschalten' : 'Musik einschalten'} title={music ? 'Musik ausschalten' : 'Musik einschalten'} onClick={() => {setMusicEnabled(!music); setMusic(!music); play('button');}}>{music ? '🎵' : '🎼'}</button><button className="mute" aria-label={mute ? 'Ton einschalten' : 'Ton ausschalten'} onClick={() => {setMuted(!mute); setMute(!mute); if(mute) play('button');}}>{mute ? '🔇' : '🔊'}</button></header>
    <main>
      {route === '/' && <section className="hero panel"><div className="sticker">DAS FOTO-CHAOS<br/>MIT DEINEN LEUTEN!</div><h1>DELETE<br/><em>THIS!</em></h1><p>Prompt lesen. Peinliches Foto finden. Anonym lachen. Abstimmen. Bereuen.</p><a className="button giant" href="#/spiel">JETZT SPIELEN ✨</a><p className="fine">2–8 Personen · ohne Account · Fotos bleiben zwischen euren Geräten</p></section>}
      {route === '/datenschutz' && <section className="panel prose"><h1>Datenschutz 🔒</h1><p>Delete This! benötigt keine Accounts. Es gibt keine Analytics, kein Tracking und keine KI-Auswertung. Die Musik und Sounds werden lokal per Web Audio API erzeugt.</p><p>Deine ausgewählten Fotos werden auf deinem Gerät per Canvas verkleinert und neu encodiert. Dabei werden Metadaten wie EXIF und GPS nicht übernommen. Die Originaldatei wird nicht übertragen. Spielbilder bleiben nur vorübergehend im Arbeitsspeicher, werden über direkte WebRTC-Verbindungen zwischen den Spielgeräten ausgetauscht und nach Rundenende oder beim Verlassen aus der App entfernt. Fotos werden nicht hochgeladen oder gespeichert, auch nicht im Browser-Speicher oder Service-Worker-Cache.</p><p>Für den sechsstelligen Lobbycode nutzt die App mehrere öffentliche Nostr-Relays zur kurzzeitigen, verschlüsselten Vermittlung der WebRTC-Verbindungsdaten. Diese Relays und die öffentlichen STUN-Dienste können technisch notwendige Verbindungsdaten wie IP-Adressen sehen, erhalten über die App aber keine Fotos oder Spielinhalte. Nach dem Verbindungsaufbau laufen Spielnachrichten und Fotos verschlüsselt über WebRTC zwischen den Geräten. Es wird kein TURN-Server verwendet und kein Fotoverkehr über einen Relay-Server geleitet. Manche besonders restriktiven Netzwerke können direkte Verbindungen deshalb weiterhin blockieren.</p><p>Beim normalen Aufruf der Website erhält der Hostinganbieter technisch notwendige Verbindungsdaten, etwa IP-Adresse und Abrufzeit. Details zu dessen Verarbeitung stehen in dessen Datenschutzhinweisen. Der gespeicherte Anzeigename liegt ausschließlich in deinem Browser und kann über die Browserdaten gelöscht werden. Die App speichert keine Fotos.</p></section>}
      {route === '/info' && <section className="panel prose"><h1>So funktioniert’s 🎉</h1><ol><li>Eine Person erstellt das Spiel und wählt Party Mode oder Remote Mode.</li><li>Der Host zeigt den sechsstelligen Lobbycode. Alle Freunde geben ihn ein oder öffnen den Einladungslink.</li><li>Die Verbindung entsteht automatisch. Zwischen den Runden gibt es keine weiteren Codes.</li><li>Prompt lesen, eigenes Foto auswählen, anonym abstimmen. Für den Rundensieg gibt es einen Punkt.</li></ol><p><strong>Party Mode:</strong> Alle sehen die Fotos gemeinsam auf dem Gerät des Hosts. Auf den Handys erscheinen Prompt und Abstimmknöpfe.</p><p><strong>Remote Mode:</strong> Der Host verteilt die verkleinerten Fotos direkt über WebRTC; alle sehen sie auf dem eigenen Gerät.</p><p>Mindestens zwei Geräte sind nötig. Mehrere öffentliche, redundante Vermittlungsdienste helfen beim Finden der Lobby, übertragen aber keine Fotos. Bei manchen stark eingeschränkten Mobilfunk- und Firmennetzen ist eine direkte Verbindung ohne TURN weiterhin nicht möglich.</p><a className="button" href="#/spiel">Zum Spiel →</a></section>}
      {route === '/spiel' && <section className="game-layout">
        {!role && <div className="panel"><span className="eyebrow">SPIELSTART 🎲</span><h1>Wer bist du?</h1><label className="field">Dein Name<input maxLength={24} value={name} onChange={e=>setName(e.target.value)} placeholder="z. B. Chaos-Chris"/></label><div className="two-col"><div className="option"><h2>🎤 Spiel erstellen</h2><p>Du bekommst einen kurzen Lobbycode. Freunde tippen ihn ein und sind direkt dabei.</p><div className="mode-row"><button className={mode==='party'?'selected':''} onClick={()=>setMode('party')}>📺 Party Mode</button><button className={mode==='remote'?'selected':''} onClick={()=>setMode('remote')}>📱 Remote Mode</button></div><p className="fine">{mode === 'party' ? 'Fotos nur auf deinem Gerät; alle stimmen per Handy ab.' : 'Fotos auf allen Geräten; direkte Übertragung über dich.'}</p><button className="button" disabled={busy} onClick={()=>void startHost()}>{busy?'Lobby wird geöffnet …':'SPIEL ERSTELLEN ✨'}</button></div><div className="option"><h2>📲 Mitspielen</h2><p>Sechsstelligen Lobbycode eingeben oder Einladungslink öffnen.</p><label className="field">Lobbycode<input className="code-input" maxLength={200} value={joinCode} onChange={e=>setJoinCode(e.target.value)} placeholder="ABCDEF" autoCapitalize="characters" autoComplete="off"/></label><button className="button pink" disabled={busy || !joinCode.trim()} onClick={()=>void startGuest(joinCode)}>{busy?'Verbinde …':'BEITRETEN →'}</button></div></div></div>}
        {role === 'host' && game?.phase === 'lobby' && <div className="panel"><span className="eyebrow">DU BIST HOST 👑</span><h1>Die Lobby</h1><p>Deine Freunde öffnen dieselbe Website und geben diesen Code ein. Kein QR-Code und keine Antwort nötig.</p><div className="lobby-code" aria-label={`Lobbycode ${roomCode}`}>{roomCode}</div><button className="small" onClick={()=>void copy(roomCode)}>📋 Code kopieren</button><button className="small" onClick={()=>void copy(roomLink(roomCode,location))}>🔗 Einladungslink kopieren</button><div className="players">{game.players.filter(p=>p.connected).map(p=><span className="player" key={p.id}>⭐ {p.name}{p.id==='host'?' (Host)':''}</span>)}</div><p>{game.players.filter(p=>p.connected).length}/8 Spieler</p><div className="category-wrap"><h2>Prompt-Kategorien</h2><div className="category-list">{CATEGORIES.map(c=><button key={c} className={categories.includes(c)?'selected':''} onClick={()=>toggleCategory(c)}>{c==='18+'?'🔞 ':''}{c}</button>)}</div><p className="fine">18+ ist standardmäßig aus. Nur mit erwachsenen Mitspielern aktivieren.</p></div><button className="button green" disabled={game.players.filter(p=>p.connected).length<2 || countdown>0 || !categories.length} onClick={beginRound}>{countdown ? `START IN ${countdown} …` : 'RUNDE STARTEN 🚀'}</button></div>}
        {role === 'guest' && !game && <div className="panel center"><span className="eyebrow">FAST DRIN! 📡</span><h1>Mit Lobby verbunden</h1><p>Warte kurz, bis dein Name in der Lobby erscheint. Kein weiterer Code nötig.</p><button className="small quiet" onClick={leave}>Zurück</button></div>}
        {role==='guest' && game?.phase==='lobby' && <div className="panel center"><span className="eyebrow">VERBUNDEN! 🎊</span><h1>Warte auf den Host</h1><p>Du bist als <strong>{me?.name}</strong> dabei. Kein weiterer Code nötig.</p><div className="players">{game.players.filter(p=>p.connected).map(p=><span className="player" key={p.id}>{p.name}</span>)}</div></div>}
        {game && game.phase !== 'lobby' && <div className="panel round"><div className="round-top"><span className="eyebrow">RUNDE {game.round} · {game.category}</span><span className="pill">{game.mode==='party'?'📺 PARTY':'📱 REMOTE'}</span></div><h1 className="prompt">{game.prompt}</h1>
          {game.phase==='submit' && <div className="center"><h2>Such das passende Foto 🔎</h2><p>Wähle ein Bild aus deiner Galerie. Es wird vor dem Senden lokal verkleinert.</p>{!hasSubmitted && !busy && <label className="button file-button">📸 FOTO AUSWÄHLEN<input type="file" accept="image/*" onChange={e=>void selectPhoto(e)}/></label>}{busy && <p className="pill">Foto wird verarbeitet …</p>}{hasSubmitted && <p className="success">✅ Foto eingereicht!</p>}<p>{game.photos.length}/{game.players.filter(p=>p.connected).length} Fotos eingereicht</p><p className="fine">Identität der Fotos bleibt bis zum Ergebnis verborgen.</p></div>}
          {game.phase==='vote' && <div><h2>Welches Foto gewinnt? 🗳️</h2><p>{game.mode==='party' && role==='guest' ? 'Schau auf das Gerät des Hosts und wähle die Nummer deines Lieblingsfotos.' : 'Stimm für das lustigste Foto.'} Du kannst dein eigenes Foto nicht wählen.</p>{!remoteReady && <p className="pill">Fotos werden noch übertragen …</p>}<div className={`photo-grid ${game.mode==='party'&&role==='guest'?'party-vote':''}`}>{game.photos.map((photo,index)=><div className="photo-card" key={photo.id}><div className="photo-frame">{(role==='host'||game.mode==='remote') && images[photo.id] ? <img src={images[photo.id]} alt={`Anonymes Foto ${index+1}`}/> : <span>{game.mode==='party'&&role==='guest'?'📺':'⏳'}</span>}</div><strong>FOTO {index+1}</strong><button disabled={voted || photo.ownerId===you || !remoteReady} onClick={()=>vote(photo.id)}>{photo.ownerId===you?'Dein Foto':voted?'Stimme abgegeben':'Dafür stimmen ⭐'}</button></div>)}</div><p className="center">{Object.keys(game.votes).length}/{game.players.filter(p=>p.connected).length} Stimmen · {voted ? 'Deine Stimme ist drin!' : 'Eine Stimme pro Person'}</p></div>}
          {game.phase==='result' && <div className="center"><div className="winner-burst">🏆</div><h2>{winner?.name ?? 'Überraschung'} gewinnt!</h2><p>Ein Punkt für das Foto, das diese Runde gerettet (oder ruiniert) hat.</p><div className="scoreboard">{[...game.players].sort((a,b)=>b.score-a.score).map((p,index)=><div key={p.id}><span>{index+1}. {p.name}{!p.connected?' (offline)':''}</span><strong>{p.score} ⭐</strong></div>)}</div>{role==='host' && <button className="button green" disabled={countdown>0 || game.players.filter(p=>p.connected).length<2} onClick={beginRound}>{countdown?`START IN ${countdown} …`:'NÄCHSTE RUNDE ➜'}</button>}{role==='guest' && <p>Warte auf die nächste Runde …</p>}{role==='host' && <button className="small" onClick={()=>{play('gameover');leave();}}>Spiel beenden</button>}</div>}
        </div>}
        {role && <button className="small leave" onClick={leave}>Spiel verlassen ↩</button>}
      </section>}
      {status && route==='/spiel' && <div className="toast" role="status">{status}</div>}
      {error && route==='/spiel' && <div className="error" role="alert">⚠️ {error}<button aria-label="Meldung schließen" onClick={()=>setError('')}>×</button></div>}

    </main><footer>DELETE THIS! ✦ Fotos nur zwischen euren Geräten ✦ <a href="#/datenschutz">Datenschutz</a></footer>
  </div>;
}
export default App;
