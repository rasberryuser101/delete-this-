import type { Game } from './game';
import { REVEAL_LINES } from './party';
import './show.css';

type Props = {game:Game;images:Record<string,string>;host:boolean;display?:boolean;busy:boolean;next:()=>void};
export function RevealStage({game,images,host,display=false,busy,next}:Props) {
  const photo=game.photos[game.revealIndex];
  const partyPhone=game.mode==='PARTY'&&!host&&!display;
  const last=game.revealIndex===game.photos.length-1;
  return <section className="reveal-show center" aria-label="Die Foto-Show">
    <div className="show-marquee">✦ DIE GALERIE STEHT VOR GERICHT ✦</div>
    <div className={`show-stage ${photo?'is-open':'is-closed'}`} key={`${game.roundId}-${game.revealIndex}`}>
      {photo?<>
        <span className="evidence-tag">BEWEISSTÜCK {game.revealIndex+1}</span>
        {partyPhone?<div className="show-placeholder"><span>📺</span><h2>Alle Augen zum Host!</h2><p>Foto {game.revealIndex+1} wird dort gezeigt.</p></div>:images[photo.id]?<img className="show-photo" src={images[photo.id]} alt={`Anonymes Foto ${game.revealIndex+1}`} />:<div className="show-placeholder" role="status"><span>📦</span><h2>Beweisstück unterwegs …</h2><p>Das Foto wird verschlüsselt übertragen.</p></div>}
      </>:<div className="show-placeholder"><span className="show-drum" aria-hidden="true">🥁</span><h2>Die Galerie schweigt noch.</h2><p>Lest den Prompt noch einmal laut.<br/>Danach wird es schwer, sich rauszureden.</p></div>}
    </div>
    <p className="show-caption" aria-live="polite">{photo?REVEAL_LINES[(game.round+game.revealIndex-1)%REVEAL_LINES.length]:'Alle Fotos sind da. Bereit für die Beweisaufnahme?'}</p>
    <div className="show-progress" aria-label={`${Math.max(0,game.revealIndex+1)} von ${game.photos.length} Fotos gezeigt`}>{game.photos.map((p,i)=><span key={p.id} className={i<=game.revealIndex?'shown':''}>{i+1}</span>)}</div>
    {host?<><button className="button giant pink" disabled={busy||game.players.some(p=>!p.connected)} onClick={next}>{busy?'Übertragung läuft …':!photo?'VORHANG AUF! 🎬':last?'ABSTIMMUNG ÖFFNEN! 🗳️':'NÄCHSTES BEWEISSTÜCK →'}</button><p className="fine">Du bestimmst das Tempo. Die Abstimmung startet nach dem letzten Foto.</p></>:<p className="fine">Der Host führt durch die Show. Abstimmen könnt ihr danach.</p>}
  </section>;
}
