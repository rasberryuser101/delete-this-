import { readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
const c=JSON.parse(readFileSync(new URL('../customization.json',import.meta.url),'utf8'));
const check=(ok,text)=>{if(!ok)throw new Error(`customization.json: ${text}`);};
check(typeof c.brand==='string'&&c.brand.length>0&&c.brand.length<=35,'brand braucht 1–35 Zeichen.');
check(typeof c.tagline==='string'&&c.tagline.length<=120,'tagline: höchstens 120 Zeichen.');
for(const k of ['accent','ink'])check(/^#[0-9a-f]{6}$/i.test(c.theme?.[k]),`${k}: Farbe wie #f22882.`);
for(const k of ['introMs','photoMs'])check(Number.isInteger(c.show?.[k])&&c.show[k]>=1500&&c.show[k]<=20000,`${k}: 1500–20000 Millisekunden.`);
for(const k of ['musicVolume','effectsVolume'])check(Number.isFinite(c.audio?.[k])&&c.audio[k]>=0&&c.audio[k]<=1,`${k}: Lautstärke von 0 bis 1.`);
const music=['lobby','submit','finale'];
const effects=['button','connected','prompt','countdown','submit','reveal','vote','winner','gameover','error','drumroll','camera','voting','reaction'];
const safe=(path,ext)=>typeof path==='string'&&/^media\/[a-zA-Z0-9_./-]+$/.test(path)&&!path.includes('..')&&ext.test(path);
for(const [keys,group,max] of [[music,c.audio?.music,8_000_000],[effects,c.audio?.effects,1_000_000]])for(const key of keys){
 const path=group?.[key];check(safe(path,/\.(mp3|wav|ogg)$/i),`Audio ${key}: lokaler media/-Pfad zu MP3, WAV oder OGG.`);
 const file=join('public',path);if(existsSync(file))check(statSync(file).size<=max,`${path} ist zu groß (max. ${max/1000000} MB).`);
}
check(Array.isArray(c.art?.avatars)&&c.art.avatars.length>=1&&c.art.avatars.length<=30,'1–30 Avatar-Dateien eintragen.');
for(const path of [c.art.camera,c.art.drum,c.art.curtain,c.art.trophy,c.art.ticket,...c.art.avatars]){
 check(safe(path,/\.(svg|png|webp|jpg|jpeg)$/i),'Grafik: lokaler media/-Pfad zu SVG, PNG, WebP oder JPEG.');
 check(existsSync(join('public',path)),`Grafik fehlt: public/${path}`);
 check(statSync(join('public',path)).size<=2_000_000,`Grafik ${path}: maximal 2 MB.`);
}
console.log('Branding, Show, Audio-Einstellungen und Grafiken geprüft. Musik wird nur aus den konfigurierten Dateien geladen.');

check(Array.isArray(c.credits)&&c.credits.length<=50,'credits: Liste mit höchstens 50 Nachweisen.');
for(const credit of c.credits){for(const key of ['title','author','license'])check(typeof credit[key]==='string'&&credit[key].length>0&&credit[key].length<=200,`Nachweis: ${key} fehlt oder ist zu lang.`);check(typeof credit.url==='string'&&/^https:\/\/[^\s]+$/.test(credit.url),'Nachweis braucht einen HTTPS-Link.');}
