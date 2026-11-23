import { describe, expect, it } from 'vitest';
import { stripAnsi } from '../shell/text.ts';
import { formatProject, formatProjects, formatSteckbrief, type Output } from './format.ts';
import type { LineAction } from '../shell/shell.ts';
import type { GithubData } from './github.ts';

const DATA: GithubData = {
  source: 'github',
  profile: {
    login: 'MaximDieball',
    name: 'Maxim',
    location: 'Norderstedt',
    company: 'Otto GmbH & Co. KGaA',
    blog: 'https://maximdieball.de/',
    htmlUrl: 'https://github.com/MaximDieball',
    publicRepos: 4,
    followers: 4,
  },
  repos: [
    {
      name: 'maxim-os-website',
      description: 'vibe coded personal website',
      language: 'TypeScript',
      stars: 0,
      url: 'https://github.com/MaximDieball/maxim-os-website',
    },
    {
      name: 'ESP-32-based-physical-password-manager',
      language: 'C++',
      stars: 2,
      url: 'https://github.com/MaximDieball/ESP-32-based-physical-password-manager',
    },
  ],
  facts: [{ label: 'Studium', value: 'Angewandte Informatik (dual), Nordakademie' }],
};
const PORTRAIT = {
  wide: Array.from({ length: 12 }, (_, i) => '@'.repeat(20 + (i % 3))),
  narrow: Array.from({ length: 8 }, () => '#'.repeat(12)),
};
const plain = (o: Output | string[]) => (Array.isArray(o) ? o : o.lines).map(stripAnsi);
/** Klickbare Zeilen als [Text, Command]. */
const actionsAt = (o: Output, i: number): LineAction[] => {
  const a = o.actions[i];
  return a === undefined ? [] : Array.isArray(a) ? [...a] : [a as LineAction];
};
const clickable = (o: Output) =>
  o.lines.flatMap((l, i): [string, string][] =>
    actionsAt(o, i).map((a) => [stripAnsi(l), a.command]),
  );

describe('formatSteckbrief', () => {
  it('puts the portrait next to the info on wide screens', () => {
    const lines = plain(formatSteckbrief(DATA, PORTRAIT, 120));
    const first = lines.find((l) => l.includes('@@@@'))!;
    expect(first).toMatch(/@+ {2,}\S/);
    expect(lines.join('\n')).toContain('Norderstedt');
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(120);
  });

  it('stacks the narrow portrait above the info on phones', () => {
    const lines = plain(formatSteckbrief(DATA, PORTRAIT, 40));
    const portraitEnd = lines.findLastIndex((l) => l.includes('####'));
    const nameAt = lines.findIndex((l) => l.includes('Maxim'));
    expect(portraitEnd).toBeGreaterThanOrEqual(0);
    expect(nameAt).toBeGreaterThan(portraitEnd);
    expect(lines.some((l) => l.includes('@@@@'))).toBe(false);
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(40);
  });

  it('shows the profile facts and the newest projects', () => {
    const text = plain(formatSteckbrief(DATA, PORTRAIT, 120)).join('\n');
    for (const s of [
      'Maxim',
      '@MaximDieball',
      'Otto GmbH & Co. KGaA',
      'maximdieball.de',
      'github.com/MaximDieball',
      'maxim-os-website',
      'projects',
    ]) {
      expect(text).toContain(s);
    }
  });

  it('leaves out missing fields and works without portrait', () => {
    const lines = plain(
      formatSteckbrief(
        { ...DATA, profile: { login: 'x', htmlUrl: 'https://github.com/x' }, repos: [] },
        {},
        80,
      ),
    );
    expect(lines.join('\n')).not.toContain('Ort');
    expect(lines.join('\n')).toContain('github.com/x');
  });

  it('marks fallback data', () => {
    expect(
      plain(formatSteckbrief({ ...DATA, source: 'fallback' }, PORTRAIT, 80)).join('\n'),
    ).toContain('gespeicherte Daten');
  });

  it('removes control characters from GitHub texts', () => {
    const evil = { ...DATA, profile: { ...DATA.profile, name: 'Ma\u001b]0;x\u0007xim' } };
    expect(formatSteckbrief(evil, PORTRAIT, 80).lines.join('')).not.toContain('\u001b]');
  });

  it('shows own facts like the study programme', () => {
    for (const cols of [120, 40]) {
      const text = plain(formatSteckbrief(DATA, PORTRAIT, cols)).join(' ');
      expect(text).toContain('Studium');
      expect(text.replace(/\s+/g, ' ')).toContain('Angewandte Informatik (dual), Nordakademie');
    }
  });

  it('lists all projects as clickable lines', () => {
    for (const cols of [120, 40]) {
      const out = formatSteckbrief(DATA, PORTRAIT, cols);
      expect(clickable(out).map(([, c]) => c)).toEqual([
        'project maxim-os-website',
        'project ESP-32-based-physical-password-manager',
        'projects',
      ]);
    }
  });

  it('only makes the info column clickable next to the portrait', () => {
    const out = formatSteckbrief(DATA, PORTRAIT, 120);
    const i = out.actions.findIndex(Boolean);
    const a = actionsAt(out, i)[0]!;
    expect(a.from).toBeGreaterThanOrEqual(20);
    expect(stripAnsi(out.lines[i]!).slice(a.from)).toContain('maxim-os-website');
  });
});

describe('formatProjects', () => {
  it('lists every project with language and description, without external links', () => {
    const text = plain(formatProjects(DATA.repos, 100)).join('\n');
    expect(text).toContain('maxim-os-website');
    expect(text).toContain('TypeScript');
    expect(text).toContain('vibe coded personal website');
    expect(text).toContain('★ 2');
    expect(text).not.toContain('https://');
    expect(text).toContain('project <name>');
  });

  it('opens the project page when a project is clicked', () => {
    const out = formatProjects(DATA.repos, 100);
    const rows = clickable(out);
    expect(
      rows.some(([t, c]) => t.includes('maxim-os-website') && c === 'project maxim-os-website'),
    ).toBe(true);
    expect(
      rows.some(([t, c]) => t.includes('vibe coded') && c === 'project maxim-os-website'),
    ).toBe(true);
  });

  it('keeps all lines within the width', () => {
    for (const l of plain(formatProjects(DATA.repos, 40))) expect(l.length).toBeLessThanOrEqual(40);
  });

  it('says when there are no projects', () => {
    expect(plain(formatProjects([], 80))[0]).toContain('Keine Projekte');
  });
});

describe('formatProject', () => {
  const repo = {
    ...DATA.repos[0]!,
    homepage: 'https://maximdieball.de',
    updatedAt: '2026-11-20T10:00:00Z',
  };

  it('shows the typical info, links and the README', () => {
    const out = formatProject(repo, '# Hallo\n\nDas ist **mein** Projekt.', 80);
    const text = plain(out).join('\n');
    for (const s of [
      'maxim-os-website',
      'vibe coded personal website',
      'TypeScript',
      '20.11.2026',
      'https://github.com/MaximDieball/maxim-os-website',
      'https://maximdieball.de',
      'README',
      'Hallo',
      'Das ist mein Projekt.',
    ]) {
      expect(text).toContain(s);
    }
    expect(clickable(out).some(([, c]) => c === 'projects')).toBe(true);
  });

  it('explains a missing README', () => {
    expect(plain(formatProject(repo, undefined, 80)).join('\n')).toContain('Keine README');
  });

  it('stays within narrow screens except for links', () => {
    for (const l of plain(formatProject(repo, 'wort '.repeat(40), 40)).filter(
      (x) => !x.includes('https://'),
    )) {
      expect(l.length).toBeLessThanOrEqual(40);
    }
  });
});
