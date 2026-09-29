import type { ReactNode } from 'react';
import { activePlayers, capacity, type Game } from './game';
import { Avatar } from './Artwork';
import { AvatarPicker } from './AvatarPicker';
import { STYLE_LABELS } from './GameSettings';
type Props={game:Game;host:boolean;you:string;avatar:string;chooseAvatar:(path:string)=>void;remove:(id:string)=>void;share:ReactNode;settings:ReactNode;start:ReactNode;reactions:ReactNode};
export function Lobby({game,host,you,avatar,chooseAvatar,remove,share,settings,start,reactions}:Props){
 const me=game.players.find(p=>p.id===you),count=activePlayers(game).length;
 return <section className={`panel lobby-panel ${host?'host-lobby':'guest-lobby'}`}>
  <div className="lobby-heading"><div><span className="eyebrow">{host?me?.spectator?'BILDSCHIRM & SPIELLEITUNG':'DU BIST HOST':'DU BIST DABEI'}</span><h1>{host?'Die Lobby':'Gleich geht’s los.'}</h1><p>{host?'Freunde reinlassen. Regeln wählen. Ruf ruinieren.':'Der Host stellt noch eure Partie zusammen.'}</p></div><span className="lobby-capacity">{count}<small> / {capacity(game.mode)} Spieler</small></span></div>
  <div className="lobby-columns"><div className="lobby-main">{host?settings:<div className="guest-settings"><h2>Eure Partie</h2><div className="game-summary"><span>{game.roundLimit} Runden</span><span>{STYLE_LABELS[game.style]}</span><span>{game.mode==='PARTY'?'Gemeinsamer Bildschirm':'Eigene Handys'}</span></div><p className="fine">{game.hideScores?'Punkte werden erst im Finale gezeigt.':'Jede Stimme zählt.'} {game.autoReveal?'Die Foto-Show läuft automatisch.':'Der Host führt euch durch die Foto-Show.'}</p></div>}{host&&<div className="lobby-start">{start}<p className="fine">{count<2?'Noch mindestens einen Freund reinlassen.':'Alles bereit? Die Einstellungen gelten für die ganze Partie.'}</p></div>}</div>
  <aside className="lobby-side">{host&&<section className="lobby-invite"><h2>Freunde einladen</h2><p className="fine">Link teilen oder den Code schicken.</p>{share}</section>}<section className="lobby-roster"><div className="roster-heading"><h2>Eure Crew</h2><span>{count} dabei</span></div><div className="players">{game.players.map(p=><div className={`player ${!p.connected?'offline':''}`} key={p.id}><Avatar name={p.name} path={p.avatar}/><span className="player-name">{p.name}<small>{p.spectator?'Bildschirm':p.id==='host'?'Host':!p.connected?'Offline':p.id===you?'Das bist du':'Bereit'}</small></span>{host&&p.id!=='host'&&<button className="remove-player" aria-label={`${p.name} entfernen`} onClick={()=>remove(p.id)}>×</button>}</div>)}</div>{!me?.spectator&&<AvatarPicker value={me?.avatar??avatar} onChange={chooseAvatar}/>}</section>{reactions}</aside>
  </div>
 </section>;
}
