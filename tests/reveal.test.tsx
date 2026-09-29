import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { RevealStage } from '../src/RevealStage';
import { createGame, nextReveal, type Game } from '../src/game';

it('zeigt im Vorhang keine Bilder und später nur das aktuelle Foto',()=>{
  const initial:Game={...createGame('Host','REMOTE'),phase:'reveal',photos:[{id:'one',ownerId:'host'},{id:'two',ownerId:'guest'}]};
  const props={images:{one:'blob:first-photo',two:'blob:future-photo'},host:true,busy:false,next:()=>{}};
  const curtain=renderToStaticMarkup(<RevealStage {...props} game={initial}/>);
  expect(curtain).not.toContain('blob:first-photo');expect(curtain).not.toContain('blob:future-photo');
  const first=renderToStaticMarkup(<RevealStage {...props} game={nextReveal(initial)}/>);
  expect(first).toContain('blob:first-photo');expect(first).not.toContain('blob:future-photo');
  const phone=renderToStaticMarkup(<RevealStage {...props} host={false} game={{...nextReveal(initial),mode:'PARTY'}}/>);
  expect(phone).not.toContain('blob:first-photo');expect(phone).toContain('Alle Augen zum Bildschirm');
});
