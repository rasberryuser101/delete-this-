export const REACTIONS = ['😂','💀','🚩','👏','🥁','🦗','🔔','📣'] as const;
export type Reaction = typeof REACTIONS[number];
export const isReaction = (value: unknown): value is Reaction => REACTIONS.includes(value as Reaction);
export const REACTION_LABELS:Record<Reaction,string>={'😂':'Lachflash','💀':'Ich kann nicht mehr','🚩':'Rote Flagge','👏':'Applaus','🥁':'Trommelwirbel','🦗':'Peinliche Stille','🔔':'Ding!','📣':'Drama!'};
export const REACTION_SOUNDS = {'😂':'laugh','💀':'gasp','🚩':'alarm','👏':'applause','🥁':'drumroll','🦗':'crickets','🔔':'ding','📣':'airhorn'} as const;
export const reactionAllowed = (phase:string) => ['lobby','reveal','vote'].includes(phase);
const avatars=['🦝','🦆','🦖','🐸','🐙','🦄','🐡','🦥'];
export function playerAvatar(id:string):string {
  if(id==='host')return '👑';
  let hash=0;for(const char of id)hash=(hash*31+char.charCodeAt(0))>>>0;
  return avatars[hash%avatars.length];
}
export const REVEAL_LINES = [
  'Die Verteidigung beantragt dringend Kontext.',
  'LinkedIn nennt das wahrscheinlich Leadership.',
  'Das Krisen-PR-Team tippt …',
  'Ein Bild. Tausend offene Fragen.',
  'Kurz war die Galerie ein sicherer Ort.',
  'Der Gruppenchat hat Beweismittel eingereicht.',
  'Das stand so nicht im Businessplan.',
  'Die Kamera hätte auch einfach Nein sagen können.'
];
