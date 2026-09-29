import { REACTIONS, REACTION_LABELS, type Reaction } from './party';
export function ReactionBar({disabled,react,lobby=false}:{disabled:boolean;react:(emoji:Reaction)=>void;lobby?:boolean}) {
 return <section className={`reactions ${lobby?'lobby-reactions':''}`} aria-label="Reaktionen"><p>{lobby?'Soundcheck. Benehmt euch halbwegs.':'Die Jury hat Gefühle.'}</p><div className="reaction-bar">{REACTIONS.map(emoji=><button type="button" key={emoji} className="reaction-button" disabled={disabled} title={REACTION_LABELS[emoji]} aria-label={REACTION_LABELS[emoji]} onClick={()=>react(emoji)}>{emoji}</button>)}</div></section>;
}
