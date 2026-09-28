export type Category = string;
export type PromptPack = { id: string; title: string; description: string; category: Category; prompts: string[] };
const files = import.meta.glob('./packs/*.json', { eager: true, import: 'default' }) as Record<string, unknown>;
export function validatePack(value: unknown): PromptPack | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== 'string' || !/^[a-z0-9-]{3,40}$/.test(v.id) || typeof v.title !== 'string' || v.title.trim().length < 2 || v.title.length > 60 ||
      typeof v.description !== 'string' || v.description.length > 160 || typeof v.category !== 'string' || v.category.trim().length < 2 || v.category.length > 32 ||
      !Array.isArray(v.prompts) || !v.prompts.length || v.prompts.length > 1000 || !v.prompts.every(p => typeof p === 'string' && p.trim().length >= 5 && p.length <= 350)) return null;
  return { id: v.id, title: v.title.trim(), description: v.description.trim(), category: v.category.trim(), prompts: [...new Set(v.prompts.map(p => (p as string).trim()))] };
}
export const PACKS: PromptPack[] = Object.entries(files).sort(([a], [b]) => a.localeCompare(b)).map(([path, content]) => {
  const pack = validatePack(content);
  if (!pack) throw new Error(`Ungültiges Prompt-Pack: ${path}`);
  return pack;
});
if (new Set(PACKS.map(p => p.id)).size !== PACKS.length) throw new Error('Jedes Prompt-Pack braucht eine eigene ID.');
const original = ['Normal', 'Freunde', 'Chaos', 'Roast', 'Dating', 'Party', 'Schule', '18+'];
export const CATEGORIES = [...original.filter(c => PACKS.some(p => p.category === c)), ...new Set(PACKS.map(p => p.category).filter(c => !original.includes(c)))];
export const PROMPTS: Record<string, string[]> = Object.fromEntries(CATEGORIES.map(category => [category, PACKS.filter(p => p.category === category).flatMap(p => p.prompts)]));

export function pickPrompt(categories: Category[], used: string[], random = Math.random, packs = PACKS.map(p => p.id)): { category: Category; text: string } {
  const pool = PACKS.filter(p => packs.includes(p.id) && categories.includes(p.category)).flatMap(p => p.prompts.map(text => ({ category: p.category, text })));
  if (!pool.length) throw new Error('Wähle mindestens ein Pack und eine passende Kategorie.');
  const fresh = pool.filter(item => !used.includes(item.text));
  const choices = fresh.length ? fresh : pool;
  return choices[Math.min(choices.length - 1, Math.max(0, Math.floor(random() * choices.length)))];
}
