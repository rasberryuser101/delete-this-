import { expect, it } from 'vitest';
import { DEFAULT_PACKS, PACKS, pickPrompt, validatePack } from '../src/prompts';
import { createGame, joinPlayer, nextRound } from '../src/game';
const custom = { id:'mein-pack', title:'Mein Pack', description:'Eigene Fragen', icon:'🛸', prompts:['Bitte dieses Bild sofort erklären.'] };
it('lädt alle JSON-Dateien als Packs mit eigenen Icons und lässt 18+ zunächst aus', () => {
  expect(PACKS.some(pack => pack.id === 'beispiel-pack' && pack.icon === '💼')).toBe(true);
  expect(PACKS.reduce((sum, pack) => sum + pack.prompts.length, 0)).toBeGreaterThanOrEqual(500);
  expect(PACKS.filter(p=>p.adult).every(p=>!DEFAULT_PACKS.includes(p.id))).toBe(true);
});
it('akzeptiert eigene Packs ohne Kategorie und validiert Icon, Alter und Texte', () => {
  expect(validatePack(custom)).toMatchObject({id:'mein-pack',icon:'🛸',adult:false});
  expect(validatePack({...custom,icon:''})).toBeNull();
  expect(validatePack({...custom,adult:'false'})).toBeNull();
  expect(validatePack({...custom,prompts:['x'.repeat(351)]})).toBeNull();
  expect(validatePack({...custom,id:'../angriff'})).toBeNull();
});
it('nutzt ausschließlich ausgewählte Packs und vermeidet Wiederholungen', () => {
  const first = pickPrompt(['beispiel-pack'], [], () => 0);
  expect(first.text).toContain('LinkedIn');
  expect(first.pack).toEqual({id:'beispiel-pack',title:'Beispiel-Extras',icon:'💼'});
  expect(pickPrompt(['beispiel-pack'], [first.text], () => 0).text).not.toBe(first.text);
  expect(() => pickPrompt([], [], () => 0)).toThrow('Pack');
  const game = joinPlayer(createGame('Host', 'PARTY'), { id: 'guest', name: 'Gast', score: 0, connected: true });
  expect(nextRound(game, ['beispiel-pack'], [], () => 0).prompt).toBe(first.text);
});
