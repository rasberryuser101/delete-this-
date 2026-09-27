export const REACTIONS = ['😂','💀','🚩','👏'] as const;
export type Reaction = typeof REACTIONS[number];
export const isReaction = (value: unknown): value is Reaction => REACTIONS.includes(value as Reaction);
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
