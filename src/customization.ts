import config from '../customization.json';
import type { Game } from './game';
import { isMatchOver } from './game';
export const CUSTOM = config;
// Only assets shipped with the app are eligible. Missing optional audio stays silent.
const files = import.meta.glob<string>('../public/media/**/*.{mp3,ogg,wav,svg,png,webp,jpg,jpeg}', {eager:true,query:'?url',import:'default'});
export const AVATARS = Object.keys(files).filter(path=>/^\.\.\/public\/media\/art\/avatars\/[\w-]+\.(svg|png|webp|jpg|jpeg)$/.test(path)).sort().map(path=>path.replace('../public/',''));
export function mediaUrl(path:string):string|undefined {
  if(!/^media\/[a-zA-Z0-9_./-]+$/.test(path)||path.includes('..'))return undefined;
  return files[`../public/${path}`];
}
export type MusicScene = keyof typeof config.audio.music | null;
export const musicScene=(game:Game|null):MusicScene=>{
  if(!game||game.phase==='lobby')return 'lobby';
  if(isMatchOver(game))return 'finale';
  return ['submit','write','caption'].includes(game.phase)?'submit':null;
};
export function avatarPath(seed:string):string {
  let hash=0;for(const ch of seed)hash=(hash*31+ch.charCodeAt(0))>>>0;
  return AVATARS[hash%AVATARS.length] ?? '';
}
