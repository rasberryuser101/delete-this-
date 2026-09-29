import config from '../customization.json';
import type { Game } from './game';
import { isMatchOver } from './game';
export const CUSTOM = config;
// Only assets shipped with the app are eligible. Missing optional audio uses synthesis.
const files = import.meta.glob<string>('../public/media/**/*.{mp3,ogg,wav,svg,png,webp,jpg,jpeg}', {eager:true,query:'?url',import:'default'});
export function mediaUrl(path:string):string|undefined {
  if(!/^media\/[a-zA-Z0-9_./-]+$/.test(path)||path.includes('..'))return undefined;
  return files[`../public/${path}`];
}
export type MusicScene = keyof typeof config.audio.music;
export const musicScene=(game:Game|null):MusicScene=>game&&isMatchOver(game)?'finale':game?.phase??'lobby';
export function avatarPath(seed:string):string {
  let hash=0;for(const ch of seed)hash=(hash*31+ch.charCodeAt(0))>>>0;
  return config.art.avatars[hash%config.art.avatars.length];
}
