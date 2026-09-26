export type Sound = 'button'|'connected'|'prompt'|'countdown'|'submit'|'reveal'|'vote'|'winner'|'gameover'|'error';
let context: AudioContext | null = null;
let muted = false;
export const isMuted = () => muted;
export function setMuted(value: boolean): void { muted = value; }
export function play(sound: Sound): void {
  if (muted || typeof window === 'undefined') return;
  try {
    context ??= new AudioContext();
    if (context.state === 'suspended') void context.resume();
    const notes: Record<Sound, number[]> = {button:[440],connected:[480,680,900],prompt:[650,880],countdown:[440],submit:[520,700],reveal:[330,660,990],vote:[780],winner:[523,659,784,1046],gameover:[700,520,340],error:[210,160]};
    notes[sound].forEach((freq, i) => {
      const osc = context!.createOscillator(); const gain = context!.createGain();
      osc.type = sound === 'error' ? 'sawtooth' : 'triangle'; osc.frequency.value = freq;
      const start = context!.currentTime + i * 0.09;
      gain.gain.setValueAtTime(0.0001, start); gain.gain.exponentialRampToValueAtTime(0.12, start + 0.012); gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.17);
      osc.connect(gain).connect(context!.destination); osc.start(start); osc.stop(start + 0.18);
    });
  } catch { /* Audio ist optional. */ }
}
