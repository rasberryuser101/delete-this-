import { expect,it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createGame,joinPlayer,nextRound,submitPhoto,reveal,nextReveal,castVote,isMatchOver,leaderboard,rematch,setRoundLimit,displayView,viewFor,type RoundLimit } from '../src/game';
import { validateMessage } from '../src/protocol';
import { Leaderboard } from '../src/Leaderboard';
import { CUSTOM, musicScene,mediaUrl,avatarPath } from '../src/customization';
it('verwendet nur drei Hintergrundmusik-Phasen',()=>{expect(Object.keys(CUSTOM.audio.music)).toEqual(['lobby','submit','finale']);});
it.each([3,5,10] as RoundLimit[])('beendet nach genau %i Runden, verteilt Punkte und startet eine Revanche',limit=>{
 let game=setRoundLimit(joinPlayer(createGame('Host','REMOTE'),{id:'guest',name:'Gast',score:0,connected:true}),limit);
 expect(musicScene(game)).toBe('lobby');
 for(let i=0;i<limit;i++){
  game=nextRound(game,['classic'],[],()=>0);expect(musicScene(game)).toBe('submit');expect(()=>setRoundLimit(game,3)).toThrow();
  game=reveal(submitPhoto(submitPhoto(game,'host','a'),'guest','b'),()=>.99);expect(musicScene(game)).toBeNull();
  while(game.phase==='reveal')game=nextReveal(game);expect(musicScene(game)).toBeNull();
  game=castVote(castVote(game,'host','b',()=>0),'guest','a',()=>0);
  expect(isMatchOver(game)).toBe(i===limit-1);expect(musicScene(game)).toBe(i===limit-1?'finale':null);
  expect(validateMessage({type:'sync',game:viewFor(game,'guest'),you:'guest'})).not.toBeNull();
  expect(validateMessage({type:'display-sync',state:displayView({...game,mode:'PARTY'})})).not.toBeNull();
 }
 expect(game.players.reduce((n,p)=>n+p.score,0)).toBe(limit);expect(()=>nextRound(game,['classic'],[])).toThrow('beendet');
 const fresh=rematch(game);expect(fresh).toMatchObject({phase:'lobby',round:0,roundLimit:limit,photos:[],votes:{}});expect(fresh.players.every(p=>p.score===0)).toBe(true);
});
it('zeigt geteilte Gesamtsiege ohne zufälligen Gesamtsieger',()=>{
 const game={...createGame('Anna','PARTY',3),phase:'result' as const,round:3,players:[{id:'host',name:'Anna',score:1,connected:true},{id:'b',name:'Ben',score:1,connected:true},{id:'c',name:'Chris',score:1,connected:true}]};
 expect(leaderboard(game).map(p=>p.rank)).toEqual([1,1,1]);
 expect(renderToStaticMarkup(<Leaderboard game={game}/>)).toContain('teilen sich den Sieg');
});
it('verwirft manipulierte Rundenzahlen und unsichere Medienpfade',()=>{
 const game=createGame('Host','PARTY');for(const limit of [0,4,999,'3'])expect(validateMessage({type:'sync',you:'host',game:{...game,roundLimit:limit}})).toBeNull();
 expect(mediaUrl('https://example.org/music.mp3')).toBeUndefined();expect(mediaUrl('media/../private.mp3')).toBeUndefined();expect(mediaUrl('media/music/not-installed-test-file.mp3')).toBeUndefined();
 expect(mediaUrl(avatarPath('Anna'))).toBeTruthy();expect(avatarPath('Anna')).toBe(avatarPath('Anna'));
});
