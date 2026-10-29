import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const BUILTIN = fileURLToPath(new URL('../skills/', import.meta.url));
const nameSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Skill names use lowercase letters, digits and single dashes').max(64);

/** Parse an Agent Skills SKILL.md: YAML-style frontmatter (name, description, …) then Markdown instructions. */
export function parseSkill(source) {
  const match = String(source).replace(/^﻿/, '').match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) throw new Error('A SKILL.md must start with --- frontmatter containing name and description');
  const meta = {};
  let key = null;
  for (const line of match[1].split(/\r?\n/)) {
    const top = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/);
    if (top) { key = top[1]; meta[key] = top[2].replace(/^["']|["']$/g, '').trim(); }
    else if (key && /^\s+\S/.test(line) && typeof meta[key] === 'string') meta[key] = `${meta[key]} ${line.trim()}`.trim();
  }
  const name = nameSchema.parse(meta.name), description = z.string().min(10).max(1024).parse(meta.description);
  const body = match[2].trim();
  if (!body) throw new Error('The skill has no instructions');
  if (body.length > 20000) throw new Error('Skill instructions are limited to 20,000 characters');
  return { name, description, license: meta.license || null, body };
}

/**
 * Skills are instructions the Brain loads on demand (progressive disclosure):
 * the prompt lists only names and descriptions; use_skill returns the full
 * text. Built-in skills ship in skills/; imported ones live in the workspace.
 * Skills never execute code.
 */
export class Skills {
  constructor(store, directory) { this.store = store; this.userDir = join(directory, 'skills'); this.items = []; }
  async load() {
    const read = async (dir, source) => {
      const names = await readdir(dir).catch(() => []);
      return (await Promise.all(names.map(async n => { try { return { ...parseSkill(await readFile(join(dir, n, 'SKILL.md'), 'utf8')), source }; } catch { return null; } }))).filter(Boolean);
    };
    const user = await read(this.userDir, 'user'), builtin = (await read(BUILTIN, 'builtin')).filter(b => !user.some(u => u.name === b.name));
    this.items = [...builtin, ...user].sort((a, b) => a.name.localeCompare(b.name));
    return this.items;
  }
  disabled() { return new Set(this.store.list('skill-setting').filter(s => s.disabled).map(s => s.name)); }
  enabled() { const off = this.disabled(); return this.items.filter(s => !off.has(s.name)); }
  get(name) { return this.enabled().find(s => s.name === name); }
  info() { const off = this.disabled(); return this.items.map(({ body, ...s }) => ({ ...s, enabled: !off.has(s.name), words: body.split(/\s+/).length })); }
  setEnabled(name, enabled) {
    if (!this.items.some(s => s.name === name)) throw new Error('Unknown skill');
    const rec = this.store.list('skill-setting').find(s => s.name === name);
    this.store.put('skill-setting', { ...(rec || {}), name, disabled: !enabled });
  }
  async save(source) {
    const skill = parseSkill(source);
    await mkdir(join(this.userDir, skill.name), { recursive: true, mode: 0o700 });
    await writeFile(join(this.userDir, skill.name, 'SKILL.md'), source, { mode: 0o600 });
    this.store.log('skill.saved', { name: skill.name });
    await this.load(); return skill;
  }
  async remove(name) {
    nameSchema.parse(name);
    if (!this.items.some(s => s.name === name && s.source === 'user')) throw new Error('Only imported skills can be deleted; built-in skills can be turned off');
    await rm(join(this.userDir, name), { recursive: true, force: true });
    this.store.log('skill.deleted', { name }); await this.load();
  }
}
