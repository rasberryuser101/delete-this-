import { isMatchOver, leaderboard, type Game } from './game';
import { Artwork, Avatar } from './Artwork';
export function Leaderboard({game}:{game:Game}){
 const final=isMatchOver(game),rows=leaderboard(game),champions=rows.filter(p=>p.rank===1);
 return <section className={`center leaderboard ${final?'match-finale':''}`} aria-label={final?'Endergebnis':'Zwischenstand'}>
  <Artwork name="trophy" className="trophy-art"/>
  {final?<><span className="eyebrow">FINALE · {game.roundLimit} RUNDEN</span><h2>{champions.map(p=>p.name).join(' & ')} {champions.length===1?'gewinnt die Partie!':'teilen sich den Sieg!'}</h2><p>Die Galerie ist leer. Der Ruf bleibt ruiniert.</p></>:game.roundSkipped?<><h2>Runde übersprungen.</h2><p>Keine Punkte. Keine weiteren Fragen.</p></>:<><h2>{game.winnerId?`${game.players.find(p=>p.id===game.winnerId)?.name} gewinnt die Runde!`:'Keine Stimmen, kein Sieger.'}</h2><p>Eine Stimme = ein Punkt.{game.winnerBonus&&game.winnerId?' Plus ein Bonuspunkt für den Rundensieg.':''}</p></>}
  {game.hideScores&&!final?<div className="scores-hidden"><span aria-hidden="true">?</span><h3>Die Punkte bleiben unter Verschluss.</h3><p>Wer vorne liegt? Das erfahrt ihr im Finale.</p></div>:<ol className="scoreboard" aria-label="Rangliste">{rows.map(p=><li key={p.id} className={final&&p.rank===1?'champion':''}><span className="score-rank">{p.rank}.</span><Avatar name={p.name} path={p.avatar}/><span className="score-name">{p.name}{p.removed?' (ausgestiegen)':!p.connected?' (offline)':''}{game.roundPoints[p.id]>0&&<small className="round-gain">+{game.roundPoints[p.id]} diese Runde</small>}</span><strong>{p.score} {p.score===1?'Punkt':'Punkte'}</strong></li>)}</ol>}
 </section>;
}
