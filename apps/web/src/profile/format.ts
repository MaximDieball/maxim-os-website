import { clean } from '../shell/format.ts';
import type { LineAction } from '../shell/shell.ts';
import { style, wrap } from '../shell/text.ts';
import type { GithubData, GithubRepo } from './github.ts';
import { renderMarkdown } from './markdown.ts';

/** Zeilen plus klickbare Zeilen (gleiche Indizes), für `ShellOutput.print`. */
export interface Output {
  lines: string[];
  actions: (LineAction | undefined)[];
}

/** Command, das die Projektseite öffnet (nur für unverdächtige Namen). */
export const projectCommand = (name: string): LineAction | undefined =>
  /^[\w.-]+$/.test(name) ? { command: `project ${name}` } : undefined;

/** ASCII-Porträt in zwei Breiten (aus content/about/). */
export interface Portrait {
  wide?: string[];
  narrow?: string[];
}

/** Mindestbreite der Info-Spalte neben dem Porträt. */
const INFO_MIN = 38;
const GAP = '   ';
const LABEL = 9;

/** Link ohne Schema und Schrägstrich am Ende, für die Anzeige. */
const shortUrl = (url: string): string => url.replace(/^https?:\/\//, '').replace(/\/$/, '');

/** Info-Block: Name, Fakten, alle Projekte. `width` ist die verfügbare Breite. */
function infoLines(data: GithubData, width: number): Output {
  const p = data.profile;
  const out: string[] = [];
  const actions: (LineAction | undefined)[] = [];
  const name = p.name ? clean(p.name) : clean(p.login);
  out.push(`${style.bold(style.cyan(name))}  ${style.dim(`@${clean(p.login)}`)}`);
  if (p.bio) for (const l of wrap(clean(p.bio), width)) out.push(l);
  out.push('');

  const fact = (label: string, value: string | undefined): void => {
    if (!value) return;
    const lines = wrap(clean(value), Math.max(10, width - LABEL));
    lines.forEach((l, i) =>
      out.push(`${i === 0 ? style.dim(label.padEnd(LABEL)) : ' '.repeat(LABEL)}${l}`),
    );
  };
  for (const f of data.facts ?? []) fact(f.label, f.value);
  fact('Ort', p.location);
  fact('Arbeit', p.company);
  if (p.blog) out.push(`${style.dim('Web'.padEnd(LABEL))}${clean(p.blog)}`);
  out.push(`${style.dim('GitHub'.padEnd(LABEL))}${clean(p.htmlUrl)}`);
  const stats = [
    p.publicRepos !== undefined ? `${p.publicRepos} Repos` : '',
    p.followers !== undefined ? `${p.followers} Follower` : '',
  ].filter(Boolean);
  if (stats.length) fact('Zahlen', stats.join(' · '));

  if (data.repos.length) {
    out.push('', style.bold('Projekte'));
    for (const repo of data.repos) {
      // Schmal: Sprache weglassen und lange Namen kürzen, damit nichts umbricht.
      const room = width - 4;
      const name = clean(repo.name);
      const lang = repo.language ? clean(repo.language) : '';
      const withLang = lang !== '' && name.length + 2 + lang.length <= room;
      const shown = name.length <= room ? name : `${name.slice(0, room - 1)}…`;
      actions[out.length] = projectCommand(repo.name);
      out.push(
        `  ${style.blue('▸')} ${style.underline(shown)}${withLang ? style.dim(`  ${lang}`) : ''}`,
      );
    }
  }
  out.push('');
  const source =
    data.source === 'fallback' ? 'GitHub nicht erreichbar, gespeicherte Daten' : 'Daten von GitHub';
  for (const l of wrap(`Klick auf ein Projekt öffnet es. Alle: projects · ${source}`, width)) {
    out.push(style.dim(l));
  }
  return { lines: out, actions };
}

const widthOf = (lines: string[]): number => Math.max(0, ...lines.map((l) => [...l].length));

/** `steckbrief`: Porträt neben (breit) oder über (schmal) den Infos. */
export function formatSteckbrief(data: GithubData, portrait: Portrait, cols: number): Output {
  const wide = portrait.wide?.map(clean) ?? [];
  const pw = widthOf(wide);
  if (wide.length && cols >= pw + GAP.length + INFO_MIN) {
    const info = infoLines(data, cols - pw - GAP.length);
    // Infos vertikal neben dem Porträt zentrieren
    const offset = Math.max(0, Math.floor((wide.length - info.lines.length) / 2));
    const rows = Math.max(wide.length, info.lines.length + offset);
    const lines: string[] = [];
    const actions: (LineAction | undefined)[] = [];
    for (let r = 0; r < rows; r++) {
      const left = (wide[r] ?? '').padEnd(pw);
      const right = info.lines[r - offset] ?? '';
      const action = info.actions[r - offset];
      // Nur die Info-Spalte ist klickbar, nicht das Porträt daneben.
      if (action) actions[r] = { ...action, from: pw + GAP.length };
      lines.push(`${style.cyan(left)}${right ? GAP + right : ''}`.trimEnd());
    }
    return { lines, actions };
  }
  const narrow = (portrait.narrow ?? []).map(clean);
  const fitsNarrow = narrow.length > 0 && widthOf(narrow) <= cols;
  const pad = fitsNarrow ? ' '.repeat(Math.max(0, Math.floor((cols - widthOf(narrow)) / 2))) : '';
  const head = fitsNarrow ? [...narrow.map((l) => style.cyan(pad + l)), ''] : [];
  const info = infoLines(data, cols - 1);
  return {
    lines: [...head, ...info.lines],
    actions: [...head.map(() => undefined), ...Array.from(info.lines, (_, i) => info.actions[i])],
  };
}

/** `projects`: alle Projekte mit Sprache, Sternen und Beschreibung. Antippen öffnet `project <name>`. */
export function formatProjects(repos: readonly GithubRepo[], cols: number): Output {
  if (repos.length === 0) return { lines: [style.dim('Keine Projekte gefunden.')], actions: [] };
  const lines: string[] = [];
  const actions: (LineAction | undefined)[] = [];
  const push = (line: string, action?: LineAction): void => {
    actions[lines.length] = action;
    lines.push(line);
  };
  repos.forEach((repo, i) => {
    if (i > 0) push('');
    const action = projectCommand(repo.name);
    const meta = clean(
      [repo.language, repo.stars ? `★ ${repo.stars}` : ''].filter(Boolean).join('  '),
    );
    const name = clean(repo.name);
    const title = name.length <= cols - 1 ? name : `${name.slice(0, cols - 2)}…`;
    if (meta && title.length + 2 + meta.length <= cols - 1) {
      push(`${style.bold(style.cyan(style.underline(title)))}  ${style.dim(meta)}`, action);
    } else {
      // Zu schmal: Sprache und Sterne in eine eigene Zeile
      push(style.bold(style.cyan(style.underline(title))), action);
      if (meta) push(`  ${style.dim(meta)}`, action);
    }
    if (repo.description) {
      for (const l of wrap(clean(repo.description), Math.max(10, cols - 3))) push(`  ${l}`, action);
    }
  });
  push('');
  for (const l of wrap(
    `Klick oder 'project <name>' zeigt Details und README.`,
    Math.max(10, cols - 1),
  )) {
    push(style.dim(l));
  }
  return { lines, actions };
}

/** Datum aus ISO (2026-11-20T…) als 20.11.2026. */
const germanDate = (iso: string): string => {
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}.${m}.${y}`;
};

/** `project <name>`: Infos, Links und README eines Projekts (#89). */
export function formatProject(repo: GithubRepo, readme: string | undefined, cols: number): Output {
  const width = Math.max(20, cols - 1);
  const lines: string[] = [style.bold(style.cyan(clean(repo.name)))];
  if (repo.description) lines.push(...wrap(clean(repo.description), width));
  lines.push('');
  const fact = (label: string, value: string | undefined, url = false): void => {
    if (!value) return;
    const v = clean(value);
    // Links nie umbrechen (bleiben klickbar), sonst in der Breite halten.
    const parts = url ? [style.blue(v)] : wrap(v, Math.max(10, width - LABEL));
    parts.forEach((p, i) =>
      lines.push(`${i === 0 ? style.dim(label.padEnd(LABEL)) : ' '.repeat(LABEL)}${p}`),
    );
  };
  fact('Sprache', repo.language);
  if (repo.stars) fact('Sterne', `★ ${repo.stars}`);
  if (repo.updatedAt) fact('Update', germanDate(repo.updatedAt));
  fact('GitHub', repo.url, true);
  if (repo.homepage && shortUrl(repo.homepage) !== shortUrl(repo.url)) {
    fact('Web', repo.homepage, true);
  }
  lines.push('', style.dim(`── README ${'─'.repeat(Math.max(0, Math.min(width, 48) - 10))}`), '');
  lines.push(...(readme ? renderMarkdown(readme, cols) : [style.dim('Keine README gefunden.')]));
  lines.push('');
  const actions: (LineAction | undefined)[] = [];
  actions[lines.length] = { command: 'projects' };
  lines.push(`${style.blue('◂')} ${style.underline('Alle Projekte')}`);
  return { lines, actions };
}
