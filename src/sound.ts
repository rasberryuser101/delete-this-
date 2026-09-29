export type Sound = 'button'|'connected'|'prompt'|'countdown'|'submit'|'reveal'|'vote'|'winner'|'gameover'|'error'|'drumroll'|'camera'|'voting'|'reaction';
let context: AudioContext | null = null;
let master: GainNode | null = null;
let muted = false;
let musicEnabled = false;
let active = false;
let timer: number | undefined;
let nextBeat = 0;
let beat = 0;
const tempo = 88;
const step = 60 / tempo / 2;
const melody = [523,0,659,784,0,659,587,0,523,0,440,523,0,392,440,0,587,0,698,880,0,698,659,0,587,0,523,440,0,392,523,0];
const bass = [131,131,175,175,147,147,131,131];
function audio(): AudioContext {
  if(!context){context=new AudioContext();master=context.createGain();master.gain.value=muted?0:1;master.connect(context.destination);}
  if (context.state === 'suspended') void context.resume();
  return context;
}
function note(freq:number, at:number, duration:number, volume:number, type:OscillatorType='triangle'): void {
  const ctx=audio(); const oscillator=ctx.createOscillator(); const gain=ctx.createGain();
  oscillator.type=type; oscillator.frequency.setValueAtTime(freq,at);
  gain.gain.setValueAtTime(.0001,at); gain.gain.exponentialRampToValueAtTime(volume,at+.012);
  gain.gain.exponentialRampToValueAtTime(.0001,at+duration);
  oscillator.connect(gain).connect(master!); oscillator.onended=()=>{oscillator.disconnect();gain.disconnect();};oscillator.start(at); oscillator.stop(at+duration+.015);
}
function drum(at:number, kind:'kick'|'hat'|'snare'): void {
  const ctx=audio(); const osc=ctx.createOscillator(); const gain=ctx.createGain();
  osc.type=kind==='hat'?'square':'sine';
  osc.frequency.setValueAtTime(kind==='kick'?130:kind==='snare'?210:900,at);
  if(kind==='kick') osc.frequency.exponentialRampToValueAtTime(55,at+.11);
  gain.gain.setValueAtTime(.0001,at);
  gain.gain.exponentialRampToValueAtTime(kind==='hat'?.018:.065,at+.004);
  gain.gain.exponentialRampToValueAtTime(.0001,at+(kind==='hat'?.04:.12));
  osc.connect(gain).connect(master!);osc.onended=()=>{osc.disconnect();gain.disconnect();}; osc.start(at); osc.stop(at+.15);
}
function schedule(): void {
  if(!active || muted || !musicEnabled || !context) return;
  nextBeat=Math.max(nextBeat,context.currentTime-.03); // No burst of missed beats after an iOS tab resumes.
  while(nextBeat<context.currentTime+.25) {
    const slot=beat%melody.length;
    if(slot%4===0&&melody[slot]) note(melody[slot]/2,nextBeat,1.1,.012,'sine');
    if(slot%8===0) note(bass[Math.floor(slot/4)],nextBeat,1.8,.012,'sine');
    beat++; nextBeat+=step;
  }
  timer=window.setTimeout(schedule,80);
}
function refresh(): void {
  clearTimeout(timer);
  if(active && !muted && musicEnabled) { try { nextBeat=audio().currentTime+.05; schedule(); } catch { active=false; } }
}
export const isMuted = () => muted;
export const isMusicEnabled = () => musicEnabled;
export function setMuted(value:boolean): void { muted=value;if(master&&context)master.gain.setValueAtTime(value?0:1,context.currentTime);refresh(); }
export function setMusicEnabled(value:boolean): void { musicEnabled=value; refresh(); }
export function startMusic(): void { active=true; refresh(); }
export function stopMusic(): void { active=false; clearTimeout(timer); timer=undefined; }
export function play(sound:Sound): void {
  if(muted || typeof window==='undefined') return;
  try {
    const at=audio().currentTime+.005;
    if(sound==='drumroll'){for(let i=0;i<14;i++)drum(at+i*.065,'snare');note(784,at+.92,.24,.05);return;}
    if(sound==='camera'){drum(at,'kick');note(1800,at,.045,.035,'square');[196,294,392].forEach((f,i)=>note(f,at+.07+i*.025,.42,.035,'triangle'));return;}
    const tones:Record<Sound,number[]>={
      button:[440,660], connected:[392,523,659,784], prompt:[784,988,1175],countdown:[660],
      submit:[520,780,1040],reveal:[392,587,784,1175],vote:[784,1046],
      winner:[523,659,784,1046,1319],gameover:[784,659,523,392],error:[220,165],
      drumroll:[],camera:[],voting:[392,523,659,1046],reaction:[420,840]
    };
    tones[sound].forEach((frequency,i)=>note(frequency,at+i*.08,sound==='winner'?.32:.14,sound==='error'?.075:.065,sound==='error'?'sawtooth':'triangle'));
  } catch { /* Ton ist optional, falls Web Audio gesperrt ist. */ }
}
