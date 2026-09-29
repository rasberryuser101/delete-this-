import { CUSTOM, mediaUrl, type MusicScene } from './customization';
import { BackgroundMusic } from './music';
export type Sound = 'button'|'connected'|'prompt'|'countdown'|'submit'|'reveal'|'vote'|'winner'|'gameover'|'error'|'drumroll'|'camera'|'voting'|'reaction'|'laugh'|'gasp'|'alarm'|'applause'|'crickets'|'ding'|'airhorn';
let context:AudioContext|null=null,master:GainNode|null=null,fx:GainNode|null=null;
let muted=false,musicEnabled=false,active=false;
const effects=new Map<string,AudioBuffer>();
const loading=new Set<string>();
const unavailable=new Set<string>();
const background=new BackgroundMusic(track=>mediaUrl(CUSTOM.audio.music[track]),element=>{
 const ctx=audio(),source=ctx.createMediaElementSource(element),gain=ctx.createGain();
 gain.gain.value=CUSTOM.audio.musicVolume;source.connect(gain).connect(master!);
});
export const subscribeMusic=background.subscribe;
export const musicStatus=background.snapshot;
export const retryMusic=()=>{audio();background.retry();};
function audio(){
 if(!context){context=new AudioContext();master=context.createGain();master.gain.value=muted?0:1;master.connect(context.destination);fx=context.createGain();fx.gain.value=CUSTOM.audio.effectsVolume;fx.connect(master);}
 if(context.state==='suspended')void context.resume().catch(()=>{});
 return context;
}
function track(node:AudioScheduledSourceNode,gain:GainNode){
 node.onended=()=>{node.disconnect();gain.disconnect();};
}
function note(frequency:number,at:number,duration:number,volume:number,type:OscillatorType='triangle'){
 const ctx=audio(),osc=ctx.createOscillator(),gain=ctx.createGain();osc.type=type;osc.frequency.setValueAtTime(frequency,at);
 gain.gain.setValueAtTime(.0001,at);gain.gain.exponentialRampToValueAtTime(volume,at+.008);gain.gain.exponentialRampToValueAtTime(.0001,at+duration);
 osc.connect(gain).connect(fx!);track(osc,gain);osc.start(at);osc.stop(at+duration+.02);
}
function percussion(at:number,kind:'kick'|'snare'|'hat',volume=1){
 const ctx=audio(),gain=ctx.createGain();let source:OscillatorNode|AudioBufferSourceNode;
 const duration=kind==='hat'?.045:kind==='snare'?.11:.18;
 if(kind==='kick'){const osc=ctx.createOscillator();osc.frequency.setValueAtTime(140,at);osc.frequency.exponentialRampToValueAtTime(45,at+.15);source=osc;}
 else{const buffer=ctx.createBuffer(1,Math.ceil(ctx.sampleRate*duration),ctx.sampleRate),samples=buffer.getChannelData(0);for(let i=0;i<samples.length;i++)samples[i]=(Math.random()*2-1)*(1-i/samples.length);const noise=ctx.createBufferSource();noise.buffer=buffer;source=noise;}
 gain.gain.setValueAtTime((kind==='hat'?.025:.09)*volume,at);gain.gain.exponentialRampToValueAtTime(.0001,at+duration);
 source.connect(gain).connect(fx!);track(source,gain);source.start(at);source.stop(at+duration+.02);
}
async function load(url:string,signal?:AbortSignal){
 const response=await fetch(url,{signal});if(!response.ok)throw new Error('Audio fehlt');
 const limit=1_000_000;if(Number(response.headers.get('Content-Length'))>limit)throw new Error('Audio zu groß');
 const bytes=await response.arrayBuffer();if(bytes.byteLength>limit)throw new Error('Audio zu groß');
 const buffer=await audio().decodeAudioData(bytes);if(buffer.duration>10)throw new Error('Audio zu lang');return buffer;
}
export const isMuted=()=>muted;
export const isMusicEnabled=()=>musicEnabled;
export function setMuted(value:boolean){muted=value;if(master&&context)master.gain.setTargetAtTime(value?0:1,context.currentTime,.015);background.setMuted(value);}
export function setMusicEnabled(value:boolean){musicEnabled=value;if(value)audio();background.setEnabled(value);}
export function setMusicScene(value:MusicScene){background.setScene(value);}
export function startMusic(){if(!active){active=true;background.start();
 for(const path of Object.values(CUSTOM.audio.effects)){
  const url=mediaUrl(path);if(!url||effects.has(url)||loading.has(url)||unavailable.has(url))continue;
  loading.add(url);void load(url).then(b=>effects.set(url,b)).catch(()=>unavailable.add(url)).finally(()=>loading.delete(url));
 }
}}
export function stopMusic(){active=false;background.stop();}
export function play(sound:Sound){
 if(muted||typeof window==='undefined')return;
 try{
  const ctx=audio(),at=ctx.currentTime+.005,url=mediaUrl(CUSTOM.audio.effects[sound]),buffer=url&&effects.get(url);
  if(buffer){const source=ctx.createBufferSource(),gain=ctx.createGain();source.buffer=buffer;source.connect(gain).connect(fx!);track(source,gain);source.start();return;}
  // The short UI effect plays immediately while its optional replacement loads.
  if(url&&!loading.has(url)&&!unavailable.has(url)){loading.add(url);void load(url).then(b=>effects.set(url,b)).catch(()=>unavailable.add(url)).finally(()=>loading.delete(url));}
  if(sound==='drumroll'){for(let i=0;i<20;i++)percussion(at+i*.065,'snare',.3+i*.025);percussion(at+1.35,'kick');return;}
  if(sound==='laugh'){[520,450,520,380,450,300].forEach((f,i)=>note(f,at+i*.1,.09,.08,'square'));return;}
  if(sound==='gasp'){[660,480,320,160].forEach((f,i)=>note(f,at+i*.12,.18,.08));return;}
  if(sound==='alarm'){[880,590,880,590].forEach((f,i)=>note(f,at+i*.15,.13,.07,'square'));return;}
  if(sound==='applause'){for(let i=0;i<7;i++)percussion(at+i*.1,'snare',.5);return;}
  if(sound==='crickets'){for(let i=0;i<3;i++){note(2600,at+i*.28,.06,.04,'sine');note(2900,at+i*.28+.09,.05,.03,'sine');}return;}
  if(sound==='ding'){note(1568,at,.65,.09,'sine');note(2352,at,.45,.025,'sine');return;}
  if(sound==='airhorn'){[330,415,494].forEach(f=>note(f,at,.48,.04,'sawtooth'));return;}
  if(sound==='camera'||sound==='reveal'){percussion(at,'hat',2);percussion(at+.045,'kick');[196,294,392].forEach((f,i)=>note(f,at+.07+i*.025,.36,.055));return;}
  const tones:Record<Sound,number[]>={button:[620,930],connected:[392,523,659,784],prompt:[523,784,1046],countdown:[880],submit:[520,780,1040],reveal:[],vote:[784,1046],winner:[523,659,784,1046],gameover:[523,659,784,1046,784,1046,1319],error:[220,165],drumroll:[],camera:[],voting:[392,523,659,1046],reaction:[420,840],laugh:[],gasp:[],alarm:[],applause:[],crickets:[],ding:[],airhorn:[]};
  const big=sound==='winner'||sound==='gameover';tones[sound].forEach((f,i)=>{note(f,at+i*(big?.12:.065),big?.38:.12,.09);if(big)note(f/2,at+i*.12,.4,.055,'sine');});
 }catch{/* Audio must never interrupt a game. */}
}
