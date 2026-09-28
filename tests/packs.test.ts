import { expect, it } from 'vitest';
import { CATEGORIES, PACKS, pickPrompt, validatePack } from '../src/prompts';
import { createGame, joinPlayer, nextRound } from '../src/game';

it('lädt alle JSON-Dateien automatisch als wählbare Packs', () => {
  expect(PACKS.some(pack => pack.id === 'beispiel-pack' && pack.prompts.length === 3)).toBe(true);
  expect(PACKS.reduce((sum, pack) => sum + pack.prompts.length, 0)).toBeGreaterThanOrEqual(500);
});
it('prüft eigene Pack-Dateien und verhindert ungültige Kategorien oder große Texte', () => {
  expect(validatePack({ id: 'mein-pack', title: 'Mein Pack', description: '', category: 'Freunde', prompts: ['Bitte dieses Bild sofort erklären.'] })?.id).toBe('mein-pack');
  expect(validatePack({ id: 'kaputt', title: 'Okay', description: '', category: 'Freunde', prompts: ['x'.repeat(351)] })).toBeNull();
  expect(validatePack({ id: '../angriff', title: 'Okay', description: '', category: 'Freunde', prompts: ['Bitte dieses Bild sofort erklären.'] })).toBeNull();
});
it('nutzt nur aktivierte Packs und vermeidet Wiederholungen bis alle Texte verbraucht sind', () => {
  const first = pickPrompt(CATEGORIES, [], () => 0, ['beispiel-pack']);
  expect(first.text).toContain('LinkedIn');
  expect(pickPrompt(CATEGORIES, [first.text], () => 0, ['beispiel-pack']).text).not.toBe(first.text);
  expect(() => pickPrompt(['Normal'], [], () => 0, ['beispiel-pack'])).toThrow('Pack');
  const game = joinPlayer(createGame('Host', 'PARTY'), { id: 'guest', name: 'Gast', score: 0, connected: true });
  expect(nextRound(game, ['Freunde'], [], () => 0, ['beispiel-pack']).prompt).toBe(first.text);
});
