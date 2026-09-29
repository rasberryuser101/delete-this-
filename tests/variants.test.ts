import {expect,it} from 'vitest';
import {activePlayers,assignCaptions,castVote,chooseWrittenPrompt,configureGame,createGame,disconnectPlayer,finishVoting,joinPlayer,nextReveal,nextRound,openSubmissions,photosFor,replacePrompt,reveal,skipMajority,skipRound,submitPhoto,viewFor,voteToSkip,writeCaption,writePrompt,type Game} from '../src/game';
import {validateMessage} from '../src/protocol';
const base=()=>joinPlayer(joinPlayer(createGame('Host','PARTY'),{id:'b',name:'Ben',score:0,connected:true}),{id:'c',name:'Clara',score:0,connected:true});
const submissions=(g:Game)=>['host','b','c'].reduce((state,id)=>submitPhoto(state,id,`photo-${id}`),openSubmissions(g));
const toVote=(g:Game)=>{let state=g;while(state.phase==='reveal')state=nextReveal(state);return state;};
it('trennt 8 Handy-Spieler von 20 Spielern plus reiner Bildschirm-Spielleitung',()=>{
 for(const [mode,limit] of [['REMOTE',8],['PARTY',20]] as const){let g=createGame('Host',mode);for(let i=1;i<limit;i++)g=joinPlayer(g,{id:`g${i}`,name:`Gast ${i}`,score:0,connected:true});expect(()=>joinPlayer(g,{id:'extra',name:'Extra',score:0,connected:true})).toThrow();expect(validateMessage({type:'sync',game:g,you:'host'})).not.toBeNull();}
 let g=createGame('Bildschirm','PARTY');g.players[0].spectator=true;for(let i=0;i<20;i++)g=joinPlayer(g,{id:`g${i}`,name:`Gast ${i}`,score:0,connected:true});expect(activePlayers(g)).toHaveLength(20);expect(validateMessage({type:'sync',game:g,you:'host'})).not.toBeNull();expect(()=>joinPlayer(g,{id:'extra',name:'Extra',score:0,connected:true})).toThrow();
});
it('liest den Prompt vor Einreichungen und lässt eine Mehrheit maximal dreimal wechseln',()=>{
 let g=nextRound(base(),['classic'],[],()=>0);expect(g.phase).toBe('prompt');expect(()=>submitPhoto(g,'host','early')).toThrow();
 const used=[g.prompt];for(let i=0;i<3;i++){const round=g.round,oldId=g.roundId;g=voteToSkip(g,'host');g=voteToSkip(g,'host');expect(skipMajority(g)).toBe(false);g=voteToSkip(g,'b');expect(skipMajority(g)).toBe(true);g=replacePrompt(g,['classic'],used,()=>0);used.push(g.prompt);expect(g.round).toBe(round);expect(g.roundId).not.toBe(oldId);expect(g.photos).toEqual([]);expect(g.promptSkips).toBe(i+1);}
 expect(()=>voteToSkip(g,'c')).toThrow();expect(new Set(used).size).toBe(4);
});
it('zählt jede Stimme und vergibt den optionalen Bonus nur einmal',()=>{
 let g=toVote(reveal(submissions(nextRound(base(),['classic'],[],()=>0))));
 g=castVote(g,'host','photo-b');g=castVote(g,'c','photo-b');g=castVote(g,'b','photo-host');expect(g.phase).toBe('result');expect(g.roundPoints).toEqual({host:1,b:3,c:0});
 const noBonus=configureGame(base(),{winnerBonus:false});g=toVote(reveal(submissions(nextRound(noBonus,['classic'],[],()=>0))));g=castVote(g,'host','photo-b');g=finishVoting(g);expect(g.players.find(p=>p.id==='b')?.score).toBe(1);expect(()=>finishVoting(g)).toThrow();
});
it('behält Einreichungen und Stimmen bei Disconnect und beendet oder überspringt kontrolliert',()=>{
 let g=toVote(reveal(submissions(nextRound(base(),['classic'],[],()=>0))));g=castVote(g,'b','photo-host');g=castVote(g,'host','photo-b');g=disconnectPlayer(g,'c');expect(g.phase).toBe('result');expect(g.photos).toHaveLength(3);expect(g.votes.b).toBe('photo-host');
 g=submissions(nextRound(base(),['classic'],[],()=>0));const points=g.players.map(p=>p.score);g=skipRound(g);expect(g.roundSkipped).toBe(true);expect(g.photos).toEqual([]);expect(g.players.map(p=>p.score)).toEqual(points);
});
it('sammelt eigene Prompts ohne andere Vorschläge im Gastzustand offenzulegen',()=>{
 let g=nextRound(configureGame(base(),{style:'CUSTOM'}),[],[],()=>0);expect(g.phase).toBe('write');g=writePrompt(g,'host','Wenn der Chef spontan Feierabend macht.');g=writePrompt(g,'b','Dieses Foto braucht einen Anwalt.');expect(viewFor(g,'c').suggestions).toEqual({});expect(()=>writePrompt(g,'host','Noch ein Prompt')).toThrow();g=chooseWrittenPrompt(g,()=>0);expect(g.phase).toBe('prompt');expect(g.prompt).toContain('Chef');expect(validateMessage({type:'sync',game:viewFor(g,'b'),you:'b'})).not.toBeNull();
});
it('verteilt Reverse-Fotos ohne Eigenzuweisung und belohnt die Textautoren',()=>{
 let g=assignCaptions(submissions(nextRound(configureGame(base(),{style:'REVERSE'}),[],[],()=>0)),()=>0);
 expect(new Set(Object.values(g.assignments)).size).toBe(3);for(const p of g.players){expect(photosFor(g,p.id)).toHaveLength(1);expect(photosFor(g,p.id)[0].ownerId).not.toBe(p.id);g=writeCaption(g,p.id,`Lustiger Text von ${p.id}`);}
 const guest=viewFor(g,'b');expect(Object.keys(guest.assignments)).toEqual(['b']);expect(guest.photos.filter(p=>p.caption)).toHaveLength(1);expect(validateMessage({type:'sync',game:guest,you:'b'})).not.toBeNull();
 g=toVote(reveal(g));const bPhoto=g.photos.find(p=>p.authorId==='b')!;expect(()=>castVote(g,'b',bPhoto.id)).toThrow();g=castVote(g,'host',bPhoto.id);g=finishVoting(g);expect(g.players.find(p=>p.id==='b')?.score).toBe(2);
});
it('mixt ausschließlich ausgewählte Modi und sperrt die Einstellungen ab Partiestart',()=>{
 const mixed=configureGame(base(),{style:'MIX',mixStyles:['CUSTOM','REVERSE']});expect(nextRound(mixed,[],[],()=>0).roundStyle).toBe('CUSTOM');expect(nextRound(mixed,[],[],()=>.9).roundStyle).toBe('REVERSE');expect(()=>configureGame(mixed,{mixStyles:[]})).toThrow();const round=nextRound(base(),['classic'],[],()=>0);expect(()=>configureGame(round,{style:'REVERSE'})).toThrow();expect(()=>configureGame(skipRound(round),{style:'REVERSE'})).toThrow('vor der Partie');
});
it('validiert neue Nachrichten und verwirft fremde Pfade und übergroße Texte',()=>{
 expect(validateMessage({type:'caption',text:'Ein guter Text',roundId:'round'})).not.toBeNull();expect(validateMessage({type:'caption',text:'x'.repeat(251),roundId:'round'})).toBeNull();expect(validateMessage({type:'avatar',path:'https://example.org/tracking.png'})).toBeNull();expect(validateMessage({type:'avatar',path:'media/art/avatars/../private.svg'})).toBeNull();expect(validateMessage({type:'skip-prompt',roundId:'round',score:9})).toBeNull();
});
