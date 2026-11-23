import { clean } from '../shell/format.ts';
import { style, wrap } from '../shell/text.ts';
import type { GithubData, GithubRepo } from './github.ts';

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

/** Info-Block: Name, Fakten, neueste Projekte. `width` ist die verfügbare Breite. */
function infoLines(data: GithubData, width: number): string[] {
  const p = data.profile;
  const out: string[] = [];
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
    out.push('', style.bold('Neueste Projekte'));
    for (const repo of data.repos.slice(0, 3)) {
      // Schmal: Sprache weglassen und lange Namen kürzen, damit nichts umbricht.
      const room = width - 4;
      const name = clean(repo.name);
      const lang = repo.language ? clean(repo.language) : '';
      const withLang = lang !== '' && name.length + 2 + lang.length <= room;
      const shown = name.length <= room ? name : `${name.slice(0, room - 1)}…`;
      out.push(`  ${style.blue('▸')} ${shown}${withLang ? style.dim(`  ${lang}`) : ''}`);
    }
  }
  out.push('');
  const hint = `Mehr: ${style.yellow('projects')}`;
  out.push(
    data.source === 'fallback'
      ? `${hint}  ${style.dim('(GitHub nicht erreichbar, gespeicherte Daten)')}`
      : `${hint}  ${style.dim('· Daten von GitHub')}`,
  );
  return out;
}

const widthOf = (lines: string[]): number => Math.max(0, ...lines.map((l) => [...l].length));

/** `steckbrief`: Porträt neben (breit) oder über (schmal) den Infos. */
export function formatSteckbrief(data: GithubData, portrait: Portrait, cols: number): string[] {
  const wide = portrait.wide?.map(clean) ?? [];
  const pw = widthOf(wide);
  if (wide.length && cols >= pw + GAP.length + INFO_MIN) {
    const info = infoLines(data, cols - pw - GAP.length);
    const rows = Math.max(wide.length, info.length);
    // Infos vertikal neben dem Porträt zentrieren
    const offset = Math.max(0, Math.floor((wide.length - info.length) / 2));
    const lines: string[] = [];
    for (let r = 0; r < rows; r++) {
      const left = (wide[r] ?? '').padEnd(pw);
      const right = info[r - offset] ?? '';
      lines.push(`${style.cyan(left)}${right ? GAP + right : ''}`.trimEnd());
    }
    return lines;
  }
  const narrow = (portrait.narrow ?? []).map(clean);
  const fitsNarrow = narrow.length > 0 && widthOf(narrow) <= cols;
  const pad = fitsNarrow ? ' '.repeat(Math.max(0, Math.floor((cols - widthOf(narrow)) / 2))) : '';
  return [
    ...(fitsNarrow ? [...narrow.map((l) => style.cyan(pad + l)), ''] : []),
    ...infoLines(data, cols - 1),
  ];
}

/** `projects`: alle Projekte mit Sprache, Sternen, Beschreibung und Link. */
export function formatProjects(repos: readonly GithubRepo[], cols: number): string[] {
  if (repos.length === 0) return [style.dim('Keine Projekte gefunden.')];
  const out: string[] = [];
  repos.forEach((repo, i) => {
    if (i > 0) out.push('');
    const meta = clean(
      [repo.language, repo.stars ? `★ ${repo.stars}` : ''].filter(Boolean).join('  '),
    );
    const name = clean(repo.name);
    const title = name.length <= cols ? name : `${name.slice(0, cols - 1)}…`;
    if (meta && name.length + 2 + meta.length <= cols) {
      out.push(`${style.bold(style.cyan(title))}  ${style.dim(meta)}`);
    } else {
      // Zu schmal: Sprache und Sterne in eine eigene Zeile
      out.push(style.bold(style.cyan(title)));
      if (meta) out.push(`  ${style.dim(meta)}`);
    }
    if (repo.description) {
      for (const l of wrap(clean(repo.description), Math.max(10, cols - 3))) out.push(`  ${l}`);
    }
    // Links nie umbrechen, damit sie klickbar bleiben
    out.push(`  ${style.blue(clean(repo.url))}`);
    if (repo.homepage && shortUrl(repo.homepage) !== shortUrl(repo.url)) {
      out.push(`  ${style.blue(clean(repo.homepage))}`);
    }
  });
  return out;
}
