import { readdir, readFile } from 'node:fs/promises';
const files = (await readdir(new URL('../src/packs/', import.meta.url))).filter(name => name.endsWith('.json'));
const ids = new Set(); let count = 0;
for (const name of files) {
  const data = JSON.parse(await readFile(new URL(`../src/packs/${name}`, import.meta.url), 'utf8'));
  if (!data || !/^[a-z0-9-]{3,40}$/.test(data.id) || ids.has(data.id) || typeof data.title !== 'string' || data.title.trim().length < 2 || data.title.length > 60 ||
    typeof data.description !== 'string' || data.description.length > 160 || typeof data.icon !== 'string' || !data.icon.trim() || data.icon.length > 16 || (data.adult !== undefined && typeof data.adult !== 'boolean') ||
    !Array.isArray(data.prompts) || !data.prompts.length || data.prompts.length > 1000 || !data.prompts.every(text => typeof text === 'string' && text.trim().length >= 5 && text.length <= 350))
    throw new Error(`Ungültiges Prompt-Pack in src/packs/${name}. Prüfe id, title, description, icon, adult und prompts.`);
  ids.add(data.id); count += data.prompts.length;
}
if (!count) throw new Error('Kein Prompt-Pack gefunden.');
process.stdout.write(`${files.length} Prompt-Packs, ${count} Texte geprüft.\n`);
