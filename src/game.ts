import { pickPrompt, type Category } from './prompts';
export type Mode = 'PARTY' | 'REMOTE';
export type Phase = 'lobby' | 'submit' | 'reveal' | 'vote' | 'result';
export interface Player { id: string; name: string; score: number; connected: boolean }
export interface Photo { id: string; ownerId: string }
export interface Game { phase: Phase; mode: Mode; round: number; roundId: string; prompt: string; category: Category | null; players: Player[]; photos: Photo[]; votes: Record<string, string>; winnerId: string | null; revealIndex: number }
export const createGame = (hostName: string, mode: Mode): Game => ({phase: 'lobby', mode, round: 0, roundId: '', prompt: '', category: null, players: [{id: 'host', name: hostName, score: 0, connected: true}], photos: [], votes: {}, winnerId: null, revealIndex:-1});
export function joinPlayer(game: Game, player: Player): Game {
  if (game.phase !== 'lobby' || game.players.length >= 10 || game.players.some(p => p.id === player.id)) throw new Error('Beitritt nur in der Lobby mit maximal 10 Personen.');
  return {...game, players: [...game.players, player]};
}
export function nextRound(game: Game, categories: Category[], used: string[], random = Math.random): Game {
  if (!['lobby', 'result'].includes(game.phase) || game.players.filter(p => p.connected).length < 2) throw new Error('Es braucht mindestens zwei verbundene Spieler.');
  const selected = pickPrompt(categories, used, random);
  return {...game, phase: 'submit', round: game.round + 1, roundId: crypto.randomUUID(), prompt: selected.text, category: selected.category, photos: [], votes: {}, winnerId: null, revealIndex:-1};
}
export function submitPhoto(game: Game, ownerId: string, photoId: string): Game {
  if (game.phase !== 'submit' || !game.players.some(p => p.id === ownerId && p.connected) || game.photos.some(p => p.ownerId === ownerId || p.id === photoId)) throw new Error('Foto kann in dieser Runde nicht eingereicht werden.');
  return {...game, photos: [...game.photos, { id: photoId, ownerId }]};
}
export function allSubmitted(game: Game): boolean { return game.players.filter(p => p.connected).every(p => game.photos.some(photo => photo.ownerId === p.id)); }
export function reveal(game: Game, random = Math.random): Game {
  if (!allSubmitted(game) || game.phase !== 'submit') throw new Error('Es fehlen noch Fotos.');
  const photos = [...game.photos];
  for (let i = photos.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [photos[i], photos[j]] = [photos[j], photos[i]]; }
  return {...game, phase: 'reveal', photos, revealIndex:-1};
}
export function nextReveal(game: Game): Game {
  if(game.phase!=='reveal') throw new Error('Gerade läuft keine Foto-Show.');
  if(game.players.some(p=>!p.connected)) throw new Error('Ein Gerät fehlt. Bitte warten oder den Spieler entfernen.');
  return game.revealIndex+1<game.photos.length ? {...game,revealIndex:game.revealIndex+1} : {...game,phase:'vote'};
}
/** Only photos already revealed by the host are sent to remote guests. */
export const visiblePhotos = (game: Game) => game.phase==='reveal' ? game.photos.slice(0,game.revealIndex+1) : game.phase==='vote' ? game.photos : [];
export function castVote(game: Game, voterId: string, photoId: string, random = Math.random): Game {
  const photo = game.photos.find(p => p.id === photoId);
  if (game.phase !== 'vote' || !game.players.some(p => p.id === voterId && p.connected) || !photo || photo.ownerId === voterId || game.votes[voterId]) throw new Error('Diese Stimme ist ungültig.');
  const votes = {...game.votes, [voterId]: photoId};
  const active = game.players.filter(p => p.connected);
  if (!active.every(p => votes[p.id])) return {...game, votes};
  const counts = new Map(game.photos.map(p => [p.id, 0]));
  Object.values(votes).forEach(id => counts.set(id, (counts.get(id) ?? 0) + 1));
  const max = Math.max(...counts.values());
  const tied = game.photos.filter(p => counts.get(p.id) === max);
  const winnerPhoto = tied[Math.floor(random() * tied.length)];
  return {...game, phase: 'result', votes, winnerId: winnerPhoto.ownerId, players: game.players.map(p => p.id === winnerPhoto.ownerId ? {...p, score: p.score + 1} : p)};
}
export function disconnectPlayer(game: Game, id: string, random = Math.random): Game {
  const players = game.phase === 'lobby' ? game.players.filter(p => p.id !== id) : game.players.map(p => p.id === id ? {...p, connected: false} : p);
  const photos = game.phase === 'submit' ? game.photos.filter(p => p.ownerId !== id) : game.photos;
  const votes = Object.fromEntries(Object.entries(game.votes).filter(([voter]) => voter !== id));
  let next = {...game, players, photos, votes};
  if (game.phase === 'vote' && players.filter(p => p.connected).length >= 2 && players.filter(p => p.connected).every(p => votes[p.id])) {
    const counts = new Map(photos.map(p => [p.id, 0]));
    Object.values(votes).forEach(photoId => counts.set(photoId, (counts.get(photoId) ?? 0) + 1));
    const max = Math.max(...counts.values());
    const tied = photos.filter(p => p.ownerId !== id && counts.get(p.id) === max);
    if (tied.length) { const winnerId = tied[Math.floor(random() * tied.length)].ownerId; next = {...next, phase: 'result', winnerId, players: players.map(p => p.id === winnerId ? {...p, score: p.score + 1} : p)}; }
  }
  return next;
}

/** Gastansicht: Bis zum Ergebnis lassen sich fremde Fotos keinem Namen zuordnen. */
export function viewFor(game: Game, viewerId: string): Game {
  return {
    ...game,
    photos: game.photos.map(photo => ({...photo, ownerId: photo.ownerId === viewerId ? viewerId : 'hidden'})),
    votes: Object.fromEntries(Object.keys(game.votes).map(id => [id, 'cast']))
  };
}

/** Only already-public information is eligible for the display control path. */
export type PublicDisplayState = Pick<Game,'phase'|'mode'|'round'|'roundId'|'prompt'|'category'|'players'|'winnerId'|'revealIndex'> & {photos:Photo[];countdown:number};
export function displayView(game:Game,countdown=0):PublicDisplayState {
  return {countdown,phase:game.phase,mode:game.mode,round:game.round,roundId:game.roundId,prompt:game.prompt,category:game.category,
    players:game.players.map((p,i)=>({...p,id:`player-${i}`})),winnerId:game.winnerId?`player-${game.players.findIndex(p=>p.id===game.winnerId)}`:null,revealIndex:visiblePhotos(game).length?game.revealIndex:-1,
    photos:visiblePhotos(game).map(p=>({id:p.id,ownerId:'hidden'}))};
}
