import { describe, expect, it } from 'vitest';
import { stripAnsi } from '../shell/text.ts';
import { formatProjects, formatSteckbrief } from './format.ts';
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
};
const PORTRAIT = {
  wide: Array.from({ length: 12 }, (_, i) => '@'.repeat(20 + (i % 3))),
  narrow: Array.from({ length: 8 }, () => '#'.repeat(12)),
};
const plain = (lines: string[]) => lines.map(stripAnsi);

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
    expect(formatSteckbrief(evil, PORTRAIT, 80).join('')).not.toContain('\u001b]');
  });
});

describe('formatProjects', () => {
  it('lists every project with language, description and link', () => {
    const lines = plain(formatProjects(DATA.repos, 100));
    const text = lines.join('\n');
    expect(text).toContain('maxim-os-website');
    expect(text).toContain('TypeScript');
    expect(text).toContain('vibe coded personal website');
    expect(text).toContain('https://github.com/MaximDieball/maxim-os-website');
    expect(text).toContain('★ 2');
  });

  it('keeps links unbroken and other lines within the width', () => {
    const lines = plain(formatProjects(DATA.repos, 40));
    for (const l of lines.filter((x) => !x.includes('https://'))) {
      expect(l.length).toBeLessThanOrEqual(40);
    }
    expect(
      lines.some((l) =>
        l.includes('https://github.com/MaximDieball/ESP-32-based-physical-password-manager'),
      ),
    ).toBe(true);
  });

  it('says when there are no projects', () => {
    expect(plain(formatProjects([], 80))[0]).toContain('Keine Projekte');
  });
});
