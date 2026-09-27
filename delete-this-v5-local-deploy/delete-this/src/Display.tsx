import type { Game } from './game';
import { RevealStage } from './RevealStage';
import { JoinQr } from './JoinQr';
import { roomLink } from './room';
export function Display({game,images,code,hostKey}:{game:Game;images:Record<string,string>;code:string;hostKey:string}) {
 return <section className="panel round"><span className="eyebrow">📺 DISPLAY · NUR ZUSCHAUEN</span>
 {game.phase==='lobby'?<><h1>Die Lobby</h1><div className="lobby-code">{code}</div><JoinQr link={roomLink(code,location,false,hostKey)}/><div className="players">{game.players.map(p=><span className="player" key={p.id}>{p.name}</span>)}</div></>:<><div className="round-top">RUNDE {game.round} · {game.category}</div><h1 className="prompt">{game.prompt}</h1>
 {game.phase==='submit'&&<p className="center">Die Spieler suchen ihre Fotos …</p>}
 {game.phase==='reveal'&&<RevealStage game={game} images={images} host={false} display busy={false} next={()=>{}}/>}
 {game.phase==='vote'&&<><h2>Stimmt jetzt auf euren Handys ab! 🗳️</h2><div className="photo-grid">{game.photos.map((p,i)=><div className="photo-card" key={p.id}><div className="photo-frame">{images[p.id]?<img src={images[p.id]} alt={`Anonymes Foto ${i+1}`}/>:<span>⏳</span>}</div><strong>FOTO {i+1}</strong></div>)}</div></>}
 {game.phase==='result'&&<><div className="winner-burst">🏆</div><h2>{game.players.find(p=>p.id===game.winnerId)?.name} gewinnt!</h2><div className="scoreboard">{[...game.players].sort((a,b)=>b.score-a.score).map(p=><div key={p.id}><span>{p.name}</span><strong>{p.score} ⭐</strong></div>)}</div></>}
 </>}</section>;
}
