import { describe, expect, it } from 'vitest';
import { allSubmitted, castVote, createGame, disconnectPlayer, joinPlayer, nextRound, nextReveal, openSubmissions, reveal, submitPhoto, viewFor } from '../src/game';
import { PACKS, pickPrompt } from '../src/prompts';
function start() { let g = createGame('Host','PARTY'); g = joinPlayer(g,{id:'guest',name:'Gast',score:0,connected:true}); return openSubmissions(nextRound(g,['classic'],[],()=>0)); }
describe('Spielablauf', () => {
  it('spielt eine vollständige Runde und vergibt Stimmenpunkte und einen Bonus', () => {
    let g = start(); expect(g.phase).toBe('submit');
    g = submitPhoto(g,'host','a'); expect(allSubmitted(g)).toBe(false);
    g = submitPhoto(g,'guest','b'); expect(allSubmitted(g)).toBe(true);
    g = reveal(g,()=>0); expect(g.phase).toBe('reveal');expect(g.revealIndex).toBe(-1);
    expect(()=>castVote(g,'host','b')).toThrow();
    g=nextReveal(g);expect(g.revealIndex).toBe(0);g=nextReveal(g);expect(g.revealIndex).toBe(1);
    expect(()=>castVote(g,'host','b')).toThrow();g=nextReveal(g);expect(g.phase).toBe('vote');
    expect(() => castVote(g,'host','a')).toThrow();
    g = castVote(g,'host','b'); expect(g.phase).toBe('vote');
    expect(() => castVote(g,'host','b')).toThrow();
    g = castVote(g,'guest','a'); expect(g.phase).toBe('result');
    expect(g.players.reduce((sum,p)=>sum+p.score,0)).toBe(3);
    expect(g.winnerId).not.toBeNull();
    const next = nextRound(g,['classic'],[g.prompt],()=>0);
    expect(next.photos).toEqual([]); expect(next.votes).toEqual({}); expect(next.round).toBe(2);
    expect(next.players.reduce((sum,p)=>sum+p.score,0)).toBe(3);
  });
  it('begrenzt die Handy-Variante auf acht und entfernt getrennte Lobby-Gäste', () => {
    let g = createGame('Host','REMOTE'); for(let i=0;i<7;i++) g=joinPlayer(g,{id:`g${i}`,name:`Gast ${i}`,score:0,connected:true});
    expect(()=>joinPlayer(g,{id:'extra',name:'Extra',score:0,connected:true})).toThrow();
    g=disconnectPlayer(g,'g0'); expect(g.players).toHaveLength(7);
    expect(joinPlayer(g,{id:'extra',name:'Extra',score:0,connected:true}).players).toHaveLength(8);
  });
  it('verhindert zweite Einreichung und ungültige Stimmen', () => {
    let g=start(); g=submitPhoto(g,'host','a'); expect(()=>submitPhoto(g,'host','c')).toThrow();
    g=reveal(submitPhoto(g,'guest','b'));while(g.phase==='reveal')g=nextReveal(g);
    expect(()=>castVote(g,'stranger','b')).toThrow();
    expect(()=>castVote(g,'host','missing')).toThrow();
  });
});
it('blendet die Eigentümer fremder Fotos und die Stimmziele für Gäste aus',()=>{
  let g=start(); g=reveal(submitPhoto(submitPhoto(g,'host','a'),'guest','b')); while(g.phase==='reveal')g=nextReveal(g); g=castVote(g,'host','b');
  const guest=viewFor(g,'guest'); expect(guest.photos.find(p=>p.id==='a')?.ownerId).toBe('hidden');
  expect(guest.photos.find(p=>p.id==='b')?.ownerId).toBe('guest');
  expect(guest.votes).toEqual({host:'cast'});
});
describe('Prompts',()=>{
  it('hat die 108 ausgewählten einzigartigen Texte in vier Packs',()=>{
    const prompts=PACKS.flatMap(pack=>pack.prompts); expect(prompts.length).toBe(108);
    expect(new Set(prompts).size).toBe(prompts.length);
    expect(PACKS.every(pack=>pack.icon.length>0)).toBe(true);
  });
  it('vermeidet benutzte Prompts bis der Pool erschöpft ist',()=>{
    const first=pickPrompt(['classic'],[],()=>0); const second=pickPrompt(['classic'],[first.text],()=>0);
    expect(second.text).not.toBe(first.text);
  });
});
