import { describe, expect, it } from 'vitest';
import { CACHE_KEY, loadGithub, parseProfileData, type GithubData } from './github.ts';
import type { KeyValueStore } from '../vfs/workspace.ts';

const PROFILE = {
  login: 'MaximDieball',
  name: 'Maxim',
  bio: null,
  location: 'Norderstedt',
  company: 'Otto GmbH & Co. KGaA',
  blog: 'maximdieball.de',
  html_url: 'https://github.com/MaximDieball',
  public_repos: 4,
  followers: 4,
};
const REPOS = [
  {
    name: 'maxim-os-website',
    description: 'vibe coded personal website',
    language: 'TypeScript',
    stargazers_count: 0,
    fork: false,
    html_url: 'https://github.com/MaximDieball/maxim-os-website',
    homepage: null,
  },
  {
    name: 'some-fork',
    description: 'not mine',
    language: 'C',
    stargazers_count: 9,
    fork: true,
    html_url: 'https://github.com/MaximDieball/some-fork',
    homepage: null,
  },
  {
    name: 'ESP-32-based-physical-password-manager',
    description: null,
    language: 'C++',
    stargazers_count: 2,
    fork: false,
    html_url: 'https://github.com/MaximDieball/ESP-32-based-physical-password-manager',
    homepage: '',
  },
];

function fakeFetch(
  responses: Record<string, { status: number; body: unknown }>,
  calls: string[] = [],
): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    const key = Object.keys(responses).find((k) => url.includes(k));
    const r = key ? responses[key]! : { status: 404, body: {} };
    return new Response(JSON.stringify(r.body), { status: r.status });
  }) as typeof fetch;
}

function memoryStore(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

const ok = {
  '/users/MaximDieball/repos': { status: 200, body: REPOS },
  '/users/MaximDieball': { status: 200, body: PROFILE },
};

describe('loadGithub', () => {
  it('loads profile and own repos (no forks)', async () => {
    const data = await loadGithub({
      user: 'MaximDieball',
      fetch: fakeFetch(ok),
      storage: memoryStore(),
    });
    expect(data?.source).toBe('github');
    expect(data?.profile).toMatchObject({
      login: 'MaximDieball',
      name: 'Maxim',
      location: 'Norderstedt',
    });
    expect(data?.profile.bio).toBeUndefined();
    expect(data?.repos.map((r) => r.name)).toEqual([
      'maxim-os-website',
      'ESP-32-based-physical-password-manager',
    ]);
    expect(data?.repos[1]).toMatchObject({ language: 'C++', stars: 2 });
    expect(data?.repos[1]?.homepage).toBeUndefined();
  });

  it('caches the answer in the session', async () => {
    const store = memoryStore();
    const calls: string[] = [];
    await loadGithub({ user: 'MaximDieball', fetch: fakeFetch(ok, calls), storage: store });
    await loadGithub({ user: 'MaximDieball', fetch: fakeFetch(ok, calls), storage: store });
    expect(calls).toHaveLength(2); // nur der erste Aufruf (Profil + Repos)
    expect(store.data.has(CACHE_KEY)).toBe(true);
  });

  it('returns undefined on errors, rate limits and network failures', async () => {
    const limited = { '/users/MaximDieball': { status: 403, body: { message: 'rate limit' } } };
    expect(
      await loadGithub({ user: 'MaximDieball', fetch: fakeFetch(limited), storage: memoryStore() }),
    ).toBeUndefined();
    const broken = (async () => {
      throw new TypeError('offline');
    }) as typeof fetch;
    expect(
      await loadGithub({ user: 'MaximDieball', fetch: broken, storage: memoryStore() }),
    ).toBeUndefined();
  });

  it('gives up after the timeout', async () => {
    const slow = ((_u: RequestInfo | URL, init?: RequestInit) =>
      new Promise((_r, reject) =>
        init?.signal?.addEventListener('abort', () => reject(new DOMException('x', 'AbortError'))),
      )) as typeof fetch;
    expect(
      await loadGithub({
        user: 'MaximDieball',
        fetch: slow,
        storage: memoryStore(),
        timeoutMs: 20,
      }),
    ).toBeUndefined();
  });
});

describe('parseProfileData', () => {
  it('accepts the fallback format from the content folder', () => {
    const data = parseProfileData({
      profile: {
        login: 'MaximDieball',
        name: 'Maxim',
        htmlUrl: 'https://github.com/MaximDieball',
        publicRepos: 4,
        followers: 4,
      },
      repos: [{ name: 'x', url: 'https://github.com/MaximDieball/x', stars: 1 }],
    });
    expect(data).toMatchObject<Partial<GithubData>>({ source: 'fallback' });
    expect(data?.repos[0]?.name).toBe('x');
  });

  it('drops wrong types, non-http links and overlong texts', () => {
    const data = parseProfileData({
      profile: {
        login: 'MaximDieball',
        name: 42,
        blog: 'javascript:alert(1)',
        htmlUrl: 'https://github.com/MaximDieball',
        location: 'x'.repeat(500),
      },
      repos: [{ name: 'evil', url: 'javascript:alert(1)' }, 'nope'],
    });
    expect(data?.profile.name).toBeUndefined();
    expect(data?.profile.blog).toBeUndefined();
    expect(data?.profile.location?.length).toBeLessThanOrEqual(200);
    expect(data?.repos).toEqual([]);
  });

  it('rejects garbage', () => {
    expect(parseProfileData(null)).toBeUndefined();
    expect(parseProfileData({ profile: {} })).toBeUndefined();
  });
});
