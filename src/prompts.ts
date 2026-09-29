export type PackLabel = { id: string; title: string; icon: string };
export type PromptPack = PackLabel & { description: string; adult: boolean; prompts: string[] };
const files = import.meta.glob('./packs/*.json', { eager: true, import: 'default' }) as Record<string, unknown>;
export function validatePack(value: unknown): PromptPack | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== 'string' || !/^[a-z0-9-]{3,40}$/.test(v.id) || typeof v.title !== 'string' || v.title.trim().length < 2 || v.title.length > 60 ||
      typeof v.description !== 'string' || v.description.length > 160 || typeof v.icon !== 'string' || !v.icon.trim() || v.icon.length > 16 ||
      (v.adult !== undefined && typeof v.adult !== 'boolean') ||
      !Array.isArray(v.prompts) || !v.prompts.length || v.prompts.length > 1000 || !v.prompts.every(p => typeof p === 'string' && p.trim().length >= 5 && p.length <= 350)) return null;
  return { id: v.id, title: v.title.trim(), icon: v.icon.trim(), description: v.description.trim(), adult: v.adult === true, prompts: [...new Set(v.prompts.map(p => (p as string).trim()))] };
}
export const PACKS: PromptPack[] = Object.entries(files).sort(([a], [b]) => a.localeCompare(b)).map(([path, content]) => {
  const pack = validatePack(content);
  if (!pack) throw new Error(`Ungültiges Prompt-Pack: ${path}`);
  return pack;
});
if (new Set(PACKS.map(p => p.id)).size !== PACKS.length) throw new Error('Jedes Prompt-Pack braucht eine eigene ID.');
export const DEFAULT_PACKS = PACKS.filter(p => !p.adult).map(p => p.id);
export function pickPrompt(packs: string[], used: string[], random = Math.random): { pack: PackLabel; text: string } {
  const pool = PACKS.filter(p => packs.includes(p.id)).flatMap(({ id, title, icon, prompts }) => prompts.map(text => ({ pack: { id, title, icon }, text })));
  if (!pool.length) throw new Error('Wähle mindestens ein Prompt-Pack.');
  const fresh = pool.filter(item => !used.includes(item.text));
  const choices = fresh.length ? fresh : pool;
  return choices[Math.min(choices.length - 1, Math.max(0, Math.floor(random() * choices.length)))];
}
