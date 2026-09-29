import { isMatchOver, leaderboard, type Game } from './game';
import { Artwork, Avatar } from './Artwork';
export function Leaderboard({game}:{game:Game}){
 const final=isMatchOver(game),rows=leaderboard(game),champions=rows.filter(p=>p.rank===1);
 return <section className={`center leaderboard ${final?'match-finale':''}`} aria-label={final?'Endergebnis':'Zwischenstand'}>
  <Artwork name="trophy" className="trophy-art"/>
  {final?<><span className="eyebrow">FINALE · {game.roundLimit} RUNDEN</span><h2>{champions.map(p=>p.name).join(' & ')} {champions.length===1?'gewinnt die Partie!':'teilen sich den Sieg!'}</h2><p>Die Galerie ist leer. Der Ruf bleibt ruiniert.</p></>:<><h2>{game.players.find(p=>p.id===game.winnerId)?.name??'Überraschung'} gewinnt die Runde!</h2><p>Ein Punkt. Und sehr viele offene Fragen.</p></>}
  <ol className="scoreboard" aria-label="Rangliste">{rows.map(p=><li key={p.id} className={final&&p.rank===1?'champion':''}><span className="score-rank">{p.rank}.</span><Avatar name={p.name}/><span className="score-name">{p.name}{!p.connected?' (offline)':''}</span><strong>{p.score} {p.score===1?'Punkt':'Punkte'}</strong></li>)}</ol>
 </section>;
}
