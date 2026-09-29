import { CUSTOM, mediaUrl, type MusicScene } from './customization';
export type Sound = 'button'|'connected'|'prompt'|'countdown'|'submit'|'reveal'|'vote'|'winner'|'gameover'|'error'|'drumroll'|'camera'|'voting'|'reaction';
let context:AudioContext|null=null,master:GainNode|null=null,fx:GainNode|null=null,musicBus:GainNode|null=null;
let muted=false,musicEnabled=false,active=false,scene:MusicScene='lobby';
let timer:ReturnType<typeof setTimeout>|undefined,nextBeat=0,beat=0,generation=0;
let musicRequest:AbortController|undefined;
const musicNodes=new Set<AudioScheduledSourceNode>();
const effects=new Map<string,AudioBuffer>();
const loading=new Set<string>();
const unavailable=new Set<string>();
const profiles:Record<MusicScene,{bpm:number;notes:number[];bass:number[]}>={
 lobby:{bpm:108,notes:[0,659,0,784,880,0,784,659,0,587,0,659,784,0,523,0],bass:[131,165,175,147]},
 submit:{bpm:116,notes:[523,0,0,659,0,587,0,0,440,0,0,523,0,392,0,0],bass:[131,110,147,98]},
 reveal:{bpm:84,notes:[147,0,0,156,0,0,147,0,0,0,220,0,0,208,0,0],bass:[73,73,78,69]},
 vote:{bpm:126,notes:[587,0,740,0,880,0,740,659,587,0,659,0,740,0,880,0],bass:[147,147,165,131]},
 result:{bpm:112,notes:[523,659,784,0,1046,0,784,0,880,784,659,0,587,0,523,0],bass:[131,175,147,196]},
 finale:{bpm:120,notes:[523,0,659,784,0,1046,0,988,880,0,784,659,587,659,784,0],bass:[131,165,175,196]}
};
function audio(){
 if(!context){context=new AudioContext();master=context.createGain();master.gain.value=muted?0:1;master.connect(context.destination);fx=context.createGain();fx.gain.value=CUSTOM.audio.effectsVolume;fx.connect(master);}
 if(context.state==='suspended')void context.resume().catch(()=>{});
 return context;
}
function track(node:AudioScheduledSourceNode,gain:GainNode,background:boolean){
 if(background)musicNodes.add(node);
 node.onended=()=>{musicNodes.delete(node);node.disconnect();gain.disconnect();};
}
function note(frequency:number,at:number,duration:number,volume:number,type:OscillatorType='triangle',background=false){
 const ctx=audio(),osc=ctx.createOscillator(),gain=ctx.createGain();osc.type=type;osc.frequency.setValueAtTime(frequency,at);
 gain.gain.setValueAtTime(.0001,at);gain.gain.exponentialRampToValueAtTime(volume,at+.008);gain.gain.exponentialRampToValueAtTime(.0001,at+duration);
 osc.connect(gain).connect(background?musicBus!:fx!);track(osc,gain,background);osc.start(at);osc.stop(at+duration+.02);
}
function percussion(at:number,kind:'kick'|'snare'|'hat',background=false,volume=1){
 const ctx=audio(),gain=ctx.createGain();let source:OscillatorNode|AudioBufferSourceNode;
 const duration=kind==='hat'?.045:kind==='snare'?.11:.18;
 if(kind==='kick'){const osc=ctx.createOscillator();osc.frequency.setValueAtTime(140,at);osc.frequency.exponentialRampToValueAtTime(45,at+.15);source=osc;}
 else{const buffer=ctx.createBuffer(1,Math.ceil(ctx.sampleRate*duration),ctx.sampleRate),samples=buffer.getChannelData(0);for(let i=0;i<samples.length;i++)samples[i]=(Math.random()*2-1)*(1-i/samples.length);const noise=ctx.createBufferSource();noise.buffer=buffer;source=noise;}
 gain.gain.setValueAtTime((kind==='hat'?.025:.09)*volume,at);gain.gain.exponentialRampToValueAtTime(.0001,at+duration);
 source.connect(gain).connect(background?musicBus!:fx!);track(source,gain,background);source.start(at);source.stop(at+duration+.02);
}
async function load(url:string,signal?:AbortSignal,background=false){
 const response=await fetch(url,{signal});if(!response.ok)throw new Error('Audio fehlt');
 const limit=background?8_000_000:1_000_000;if(Number(response.headers.get('Content-Length'))>limit)throw new Error('Audio zu groß');
 const bytes=await response.arrayBuffer();if(bytes.byteLength>limit)throw new Error('Audio zu groß');
 const buffer=await audio().decodeAudioData(bytes);if(buffer.duration>(background?120:10))throw new Error('Audio zu lang');return buffer;
}
function stopBackground(){
 clearTimeout(timer);musicRequest?.abort();musicRequest=undefined;
 if(context&&musicBus)musicBus.gain.setTargetAtTime(.0001,context.currentTime,.01);
 for(const node of musicNodes)try{node.stop((context?.currentTime??0)+.04);}catch{/* already stopped */}
 musicNodes.clear();const old=musicBus;musicBus=null;if(old)setTimeout(()=>old.disconnect(),80);
}
function schedule(){
 if(!active||muted||!musicEnabled||!context||!musicBus)return;
 const profile=profiles[scene];nextBeat=Math.max(nextBeat,context.currentTime);
 while(nextBeat<context.currentTime+.15){
  const slot=beat%16,bar=Math.floor(beat/16),pitch=profile.notes[slot];
  if(pitch)note(pitch*(bar%4===3?1.122:1),nextBeat,scene==='reveal'?.28:.13,.045,scene==='reveal'?'sine':'triangle',true);
  if(slot%4===0){note(profile.bass[Math.floor(slot/4)],nextBeat,.23,.075,'sine',true);percussion(nextBeat,'kick',true,.65);}
  if(scene!=='reveal'&&slot%4===2)percussion(nextBeat,'snare',true,.35);
  if(scene==='vote'&&slot%2===1)percussion(nextBeat,'hat',true,.45);
  beat++;nextBeat+=60/profile.bpm/2;
 }
 timer=setTimeout(schedule,70);
}
function refresh(){
 const token=++generation;stopBackground();
 if(!active||muted||!musicEnabled)return;
 try{
  const ctx=audio();musicBus=ctx.createGain();musicBus.gain.value=CUSTOM.audio.musicVolume;musicBus.connect(master!);beat=0;nextBeat=ctx.currentTime+.05;schedule();
  const url=mediaUrl(CUSTOM.audio.music[scene]);if(!url||unavailable.has(url))return;
  const request=new AbortController();musicRequest=request;
  void load(url,request.signal,true).then(buffer=>{
   if(token!==generation||request.signal.aborted||!musicBus)return;
   clearTimeout(timer);for(const node of musicNodes)try{node.stop();}catch{/* already stopped */}musicNodes.clear();
   const source=ctx.createBufferSource(),gain=ctx.createGain();source.buffer=buffer;source.loop=true;gain.gain.setValueAtTime(0,ctx.currentTime);gain.gain.linearRampToValueAtTime(1,ctx.currentTime+.25);source.connect(gain).connect(musicBus);track(source,gain,true);source.start();
  }).catch(()=>{if(!request.signal.aborted)unavailable.add(url);});
 }catch{/* Audio is optional. */}
}
export const isMuted=()=>muted;
export const isMusicEnabled=()=>musicEnabled;
export function setMuted(value:boolean){muted=value;if(master&&context)master.gain.setTargetAtTime(value?0:1,context.currentTime,.015);refresh();}
export function setMusicEnabled(value:boolean){musicEnabled=value;refresh();}
export function setMusicScene(value:MusicScene){if(scene!==value){scene=value;refresh();}}
export function startMusic(){if(!active){active=true;refresh();
 for(const path of Object.values(CUSTOM.audio.effects)){
  const url=mediaUrl(path);if(!url||effects.has(url)||loading.has(url)||unavailable.has(url))continue;
  loading.add(url);void load(url).then(b=>effects.set(url,b)).catch(()=>unavailable.add(url)).finally(()=>loading.delete(url));
 }
}}
export function stopMusic(){active=false;++generation;stopBackground();}
export function play(sound:Sound){
 if(muted||typeof window==='undefined')return;
 try{
  const ctx=audio(),at=ctx.currentTime+.005,url=mediaUrl(CUSTOM.audio.effects[sound]),buffer=url&&effects.get(url);
  if(buffer){const source=ctx.createBufferSource(),gain=ctx.createGain();source.buffer=buffer;source.connect(gain).connect(fx!);track(source,gain,false);source.start();return;}
  // The first use plays an immediate synthesized cue while a replacement loads.
  if(url&&!loading.has(url)&&!unavailable.has(url)){loading.add(url);void load(url).then(b=>effects.set(url,b)).catch(()=>unavailable.add(url)).finally(()=>loading.delete(url));}
  if(sound==='drumroll'){for(let i=0;i<20;i++)percussion(at+i*.065,'snare',false,.3+i*.025);percussion(at+1.35,'kick');return;}
  if(sound==='camera'||sound==='reveal'){percussion(at,'hat',false,2);percussion(at+.045,'kick');[196,294,392].forEach((f,i)=>note(f,at+.07+i*.025,.36,.055));return;}
  const tones:Record<Sound,number[]>={button:[620,930],connected:[392,523,659,784],prompt:[523,784,1046],countdown:[880],submit:[520,780,1040],reveal:[],vote:[784,1046],winner:[523,659,784,1046],gameover:[523,659,784,1046,784,1046,1319],error:[220,165],drumroll:[],camera:[],voting:[392,523,659,1046],reaction:[420,840]};
  const big=sound==='winner'||sound==='gameover';tones[sound].forEach((f,i)=>{note(f,at+i*(big?.12:.065),big?.38:.12,.09);if(big)note(f/2,at+i*.12,.4,.055,'sine');});
 }catch{/* Audio must never interrupt a game. */}
}
