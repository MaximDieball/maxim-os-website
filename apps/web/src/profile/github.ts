import type { KeyValueStore } from '../vfs/workspace.ts';

/**
 * Öffentliche GitHub-Daten für Steckbrief und Projekte (#28). Der Browser fragt
 * die GitHub-API direkt (SPEC v4), cached die Antwort in der Sitzung und hat einen
 * Fallback aus dem Content-Ordner. Alle Felder werden auf Typ und Länge geprüft;
 * gefiltert (Steuerzeichen) wird zusätzlich bei der Ausgabe.
 */

export const GITHUB_USER = 'MaximDieball';
export const CACHE_KEY = 'maxim-os:github:v1';
const CACHE_TTL_MS = 30 * 60 * 1000;
const MAX_TEXT = 200;
const MAX_REPOS = 8;

export interface GithubProfile {
  login: string;
  name?: string;
  bio?: string;
  location?: string;
  company?: string;
  /** Website (nur http/https). */
  blog?: string;
  htmlUrl: string;
  publicRepos?: number;
  followers?: number;
}

export interface GithubRepo {
  name: string;
  description?: string;
  language?: string;
  stars?: number;
  url: string;
  homepage?: string;
}

export interface GithubData {
  profile: GithubProfile;
  repos: GithubRepo[];
  source: 'github' | 'fallback';
}

type Raw = Record<string, unknown>;
const isObj = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);

function text(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t ? t.slice(0, MAX_TEXT) : undefined;
}

function count(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : undefined;
}

/** Nur http(s)-Links; "maximdieball.de" (ohne Schema) wird zu https://. */
function link(v: unknown): string | undefined {
  const t = text(v);
  if (!t) return undefined;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(t) ? t : `https://${t}`;
  try {
    const url = new URL(withScheme);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function profileFrom(raw: Raw, api: boolean): GithubProfile | undefined {
  const login = text(raw.login);
  const htmlUrl = link(api ? raw.html_url : raw.htmlUrl);
  if (!login || !htmlUrl) return undefined;
  return {
    login,
    name: text(raw.name),
    bio: text(raw.bio),
    location: text(raw.location),
    company: text(raw.company),
    blog: link(raw.blog),
    htmlUrl,
    publicRepos: count(api ? raw.public_repos : raw.publicRepos),
    followers: count(raw.followers),
  };
}

function repoFrom(raw: unknown, api: boolean): GithubRepo | undefined {
  if (!isObj(raw) || (api && raw.fork === true)) return undefined;
  const name = text(raw.name);
  const url = link(api ? raw.html_url : raw.url);
  if (!name || !url) return undefined;
  return {
    name,
    description: text(raw.description),
    language: text(raw.language),
    stars: count(api ? raw.stargazers_count : raw.stars),
    url,
    homepage: link(raw.homepage),
  };
}

const repoList = (raw: unknown, api: boolean): GithubRepo[] =>
  (Array.isArray(raw) ? raw : [])
    .map((r) => repoFrom(r, api))
    .filter((r): r is GithubRepo => r !== undefined)
    .slice(0, MAX_REPOS);

/** Fallback-Format aus content/about/steckbrief.json (gleiche Felder wie GithubData). */
export function parseProfileData(raw: unknown): GithubData | undefined {
  if (!isObj(raw) || !isObj(raw.profile)) return undefined;
  const profile = profileFrom(raw.profile, false);
  if (!profile) return undefined;
  return { profile, repos: repoList(raw.repos, false), source: 'fallback' };
}

/** sessionStorage, falls nutzbar (privater Modus o. Ä. -> undefined). */
export function sessionStore(): KeyValueStore | undefined {
  try {
    const store = window.sessionStorage;
    store.getItem(CACHE_KEY);
    return store;
  } catch {
    return undefined;
  }
}

export interface LoadOptions {
  user?: string;
  fetch?: typeof fetch;
  storage?: KeyValueStore;
  timeoutMs?: number;
  now?: () => number;
}

/** Lädt Profil und Repos. `undefined`, wenn GitHub nicht erreichbar oder limitiert ist. */
export async function loadGithub(options: LoadOptions = {}): Promise<GithubData | undefined> {
  const user = options.user ?? GITHUB_USER;
  const doFetch = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const store = options.storage;

  try {
    const cached = store?.getItem(CACHE_KEY);
    if (cached) {
      const { at, data } = JSON.parse(cached) as { at: number; data: GithubData };
      if (typeof at === 'number' && now() - at < CACHE_TTL_MS && data?.profile) return data;
    }
  } catch {
    // kaputter Cache: neu laden
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 5000);
  try {
    const base = `https://api.github.com/users/${encodeURIComponent(user)}`;
    const get = async (url: string): Promise<unknown> => {
      const res = await doFetch(url, {
        signal: controller.signal,
        headers: { accept: 'application/vnd.github+json' },
      });
      if (!res.ok) throw new Error(`GitHub ${res.status}`);
      return res.json();
    };
    const [rawProfile, rawRepos] = await Promise.all([
      get(base),
      get(`${base}/repos?sort=updated&per_page=20`),
    ]);
    if (!isObj(rawProfile)) return undefined;
    const profile = profileFrom(rawProfile, true);
    if (!profile) return undefined;
    const data: GithubData = { profile, repos: repoList(rawRepos, true), source: 'github' };
    try {
      store?.setItem(CACHE_KEY, JSON.stringify({ at: now(), data }));
    } catch {
      // Cache ist optional
    }
    return data;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}
