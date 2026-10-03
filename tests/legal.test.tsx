import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Privacy, Rules } from '../src/Legal';
import { AdultConfirm } from '../src/AdultConfirm';
import { DEFAULT_PACKS, PACKS, togglePack, withoutAdult } from '../src/prompts';
import { NAME_KEY, rememberedName, saveName } from '../src/identity';
import config from '../customization.json';

describe('Rechtstexte und Nutzungsregeln', () => {
  it('zeigt die Nutzungsregeln mit Kontakt und Altershinweis', () => {
    const html = renderToStaticMarkup(<Rules/>);
    expect(html).toContain('Fair spielen – die Regeln');
    expect(html).toContain('§§ 107c, 120a oder 207a StGB');
    expect(html).toContain('Empfohlen ab 16 Jahren');
    expect(html).toContain('mailto:christoph@scheiflinger.net');
    expect(html.match(/<li>/g)).toHaveLength(6);
  });
  it('beschreibt Edge-Rate-Limit mit IP und HMAC-Kennung ehrlich und die Speicherung des Namens nur auf Wunsch', () => {
    const html = renderToStaticMarkup(<Privacy/>);
    expect(html).toContain('von der Rate-Limiting-Funktion von Cloudflare kurzzeitig als Zählschlüssel verwendet');
    expect(html).toContain('mit einem geheimen Schlüssel gebildete Prüfsumme');
    expect(html).not.toContain('Pseudonymisierte IP-Kennungen dienen getrennt davon');
    expect(html).toContain('§ 165 Abs. 3 TKG 2021');
    expect(html).toContain('nur, wenn du ‚Name merken‘ auswählst');
    expect(html).not.toContain('Dein Anzeigename sowie zufällige');
  });
  it('weist die drei Musikstücke als Treblo-Output nach', () => {
    const music = config.credits.filter(c => c.author === 'KI-generiert mit Treblo');
    expect(music.map(c => c.title)).toEqual(['Lobby-Musik (lobby.mp3)', 'Fotoauswahl-Musik (submit.mp3)', 'Finale-Musik (finale.mp3)']);
    for (const c of music) expect(c).toMatchObject({ license: 'Nutzung laut Treblo-Nutzungsbedingungen, Abschnitt 8 (Output)', url: 'https://treblo.com/tos' });
  });
});

describe('After Dark nur nach Bestätigung', () => {
  const adult = PACKS.find(p => p.adult)!;
  it('fragt beim ersten Aktivieren in der Lobby nach und aktiviert erst danach', () => {
    expect(togglePack(DEFAULT_PACKS, adult.id, false)).toEqual({ packs: DEFAULT_PACKS, confirm: true });
    expect(togglePack(DEFAULT_PACKS, adult.id, true)).toEqual({ packs: [...DEFAULT_PACKS, adult.id], confirm: false });
    expect(togglePack([...DEFAULT_PACKS, adult.id], adult.id, false)).toEqual({ packs: DEFAULT_PACKS, confirm: false });
    expect(togglePack(DEFAULT_PACKS, 'classic', false).confirm).toBe(false);
    expect(withoutAdult([...DEFAULT_PACKS, adult.id])).toEqual(DEFAULT_PACKS);
  });
  it('zeigt den Dialogtext aus den Rechtstexten', () => {
    const html = renderToStaticMarkup(<AdultConfirm confirm={() => {}} cancel={() => {}}/>);
    expect(html).toContain('After Dark ist ab 18');
    expect(html).toContain('Aktiviere es nur, wenn alle in der Runde mindestens 18 Jahre alt sind.');
    expect(html).toContain('Alle sind 18+ – aktivieren');
    expect(html).toContain('Abbrechen');
  });
});

describe('Name merken', () => {
  afterEach(() => { vi.unstubAllGlobals(); });
  it('speichert den Anzeigenamen nur auf Wunsch und löscht ihn sonst', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); }, removeItem: (k: string) => { store.delete(k); } });
    saveName('Anna', false); expect(store.has(NAME_KEY)).toBe(false);
    saveName('  Anna  ', true); expect(rememberedName()).toBe('Anna');
    saveName('Anna', false); expect(rememberedName()).toBe('');
    saveName('x'.repeat(40), true); expect(rememberedName()).toHaveLength(30);
  });
});
