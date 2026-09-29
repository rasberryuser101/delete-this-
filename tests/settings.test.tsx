import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { configureGame, createGame, displayView, rematch, viewFor } from '../src/game';
import { validateMessage } from '../src/protocol';
import { Leaderboard } from '../src/Leaderboard';
import { GameSettings } from '../src/GameSettings';
import { RevealStage } from '../src/RevealStage';
import { ReactionBar } from '../src/ReactionBar';
it('versteckt Zwischenstände auf dem Host-Bildschirm und im Gast-/Display-Spielstand bis zum Finale',()=>{
 const game={...configureGame(createGame('Anna','PARTY',3),{hideScores:true}),phase:'result' as const,round:1,winnerId:'host',roundPoints:{host:4,b:1},players:[{id:'host',name:'Anna',connected:true,score:42},{id:'b',name:'Ben',connected:true,score:17}]};
 const guest=viewFor(game,'b'),display=displayView(game);
 expect(guest.players.map(p=>p.score)).toEqual([0,0]);expect(display.players.map(p=>p.score)).toEqual([0,0]);expect(guest.roundPoints).toEqual({});expect(display.roundPoints).toEqual({});expect(game.players[0].score).toBe(42);
 const hidden=renderToStaticMarkup(<Leaderboard game={game}/>);expect(hidden).not.toContain('aria-label="Rangliste"');expect(hidden).not.toContain('42 Punkte');expect(hidden).not.toContain('+4 diese Runde');expect(hidden).toContain('Anna gewinnt die Runde');
 const finale={...game,round:3};expect(viewFor(finale,'b').players[0].score).toBe(42);expect(displayView(finale).roundPoints.host).toBe(4);expect(renderToStaticMarkup(<Leaderboard game={finale}/>)).toContain('42 Punkte');expect(validateMessage({type:'sync',game:guest,you:'b'})).not.toBeNull();
});
it('behält Lobby-Einstellungen für eine Revanche und validiert nur echte boolesche Werte',()=>{
 const game=configureGame(createGame('Host','PARTY'),{hideScores:true,reactionsEnabled:false,reactionSounds:false,autoReveal:false});const fresh=rematch({...game,phase:'result',round:5});
 expect(fresh).toMatchObject({phase:'lobby',hideScores:true,reactionsEnabled:false,reactionSounds:false,autoReveal:false});
 for(const key of ['hideScores','reactionsEnabled','reactionSounds','autoReveal'])expect(validateMessage({type:'sync',game:{...game,[key]:'false'},you:'host'})).toBeNull();
 expect(validateMessage({type:'reaction',emoji:'🥁',roundId:''})).not.toBeNull();expect(validateMessage({type:'reaction',emoji:'🦗',roundId:'round'})).not.toBeNull();expect(validateMessage({type:'reaction',emoji:'🥁',roundId:null})).toBeNull();
});
it('bietet die Show-Steuerung in den Lobby-Einstellungen und keine Umschaltung unter dem Foto',()=>{
 const game=createGame('Host','PARTY');const settings=renderToStaticMarkup(<GameSettings game={game} disabled={false} configure={()=>{}} chooseRounds={()=>{}}/>);
 expect(settings).toContain('Punkte erst im Finale');expect(settings).toContain('Reactions erlauben');expect(settings).toContain('Sounds für Reactions');expect(settings).toContain('Automatisch');expect(settings).toContain('Manuell');
 const show=renderToStaticMarkup(<RevealStage game={{...game,phase:'reveal'}} host busy={false} images={{}} next={()=>{}} auto/>);expect(show).not.toContain('Show pausieren');expect(show).not.toContain('aria-pressed');
 const bar=renderToStaticMarkup(<ReactionBar disabled={false} react={()=>{}} lobby/>);expect(bar.match(/class="reaction-button"/g)).toHaveLength(8);expect(bar).toContain('Peinliche Stille');
});
