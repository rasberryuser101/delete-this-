import type { Game } from './game';
import { Artwork } from './Artwork';
import { CUSTOM, mediaUrl } from './customization';
import { REVEAL_LINES } from './party';
import './show.css';

type Props = {game:Game;images:Record<string,string>;host:boolean;display?:boolean;busy:boolean;next:()=>void;auto?:boolean};
export function RevealStage({game,images,host,display=false,busy,next,auto=false}:Props) {
  const photo=game.photos[game.revealIndex];
  const partyPhone=game.mode==='PARTY'&&!host&&!display;
  const last=game.revealIndex===game.photos.length-1;
  return <section className="reveal-show center" style={{'--curtain-art':`url("${mediaUrl(CUSTOM.art.curtain)}")`} as React.CSSProperties} aria-label="Die Foto-Show">
    <div className="show-marquee">✦ DIE GALERIE STEHT VOR GERICHT ✦</div>
    <div className={`show-stage ${photo?'is-open':'is-closed'}`} key={`${game.roundId}-${game.revealIndex}`}>
      {photo?<>
        <span className="evidence-tag">BEWEISSTÜCK {game.revealIndex+1}</span>
        {partyPhone?<div className="show-placeholder"><Artwork name="ticket" className="stage-art"/><h2>Alle Augen zum Bildschirm!</h2><p>Foto {game.revealIndex+1} wird dort gezeigt.</p></div>:images[photo.id]?<img className="show-photo" src={images[photo.id]} alt={`Anonymes Foto ${game.revealIndex+1}`} />:<div className="show-placeholder" role="status"><Artwork name="camera" className="stage-art"/><h2>Beweisstück unterwegs …</h2><p>Das Foto wird verschlüsselt übertragen.</p></div>}
        {photo.caption&&<h2 className="reveal-caption">{photo.caption}</h2>}
      </>:<div className="show-placeholder"><Artwork name="drum" className="stage-art show-drum"/><h2>Die Galerie schweigt noch.</h2><p>Lest den Prompt noch einmal laut.<br/>Danach wird es schwer, sich rauszureden.</p></div>}
    </div>
    <p className="show-caption" aria-live="polite">{photo?REVEAL_LINES[(game.round+game.revealIndex-1)%REVEAL_LINES.length]:'Alle Fotos sind da. Bereit für die Beweisaufnahme?'}</p>
    <div className="show-progress" aria-label={`${Math.max(0,game.revealIndex+1)} von ${game.photos.length} Fotos gezeigt`}>{game.photos.map((p,i)=><span key={p.id} className={i<=game.revealIndex?'shown':''}>{i+1}</span>)}</div>
    {host?<><button className="button giant pink" disabled={busy} onClick={next}>{busy?'Übertragung läuft …':!photo?'VORHANG AUF!':last?'ABSTIMMUNG ÖFFNEN!':'NÄCHSTES BEWEISSTÜCK →'}</button><p className="fine show-pace">{auto?'Die Show läuft automatisch weiter.':game.autoReveal?'Die Show wartet auf ein Foto. Mit Weiter erneut versuchen.':'Du führst durch die Show. Weiter, wenn alle bereit sind.'}</p></>:<p className="fine">Erst die Beweise. Dann das Urteil.</p>}
  </section>;
}
