# MAXIM OS: Architektur für Entwickler

Übersicht über Aufbau und Abläufe der Website. **Diese Datei wird mit jedem PR gepflegt** (Regel in `CLAUDE.md`): Wer Struktur, Module, Datenflüsse, Endpunkte, Build oder Tests ändert, aktualisiert sie vor dem Merge.

- Verbindliche Regeln: [`CLAUDE.md`](../CLAUDE.md) · Features und Meilensteine: [`docs/SPEC.md`](SPEC.md)
- Entscheidungen mit Begründung: [`mobile-input-spike.md`](mobile-input-spike.md), [`security-review-mvp2.md`](security-review-mvp2.md), [`security-review-mvp3.md`](security-review-mvp3.md)

## 1. Grundidee

Eine Website, die wie ein Terminal aussieht. **Client-first:** Alle Commands laufen im Browser auf einer Kopie des Dateisystems. Der Server ist klein und nimmt keine Pfade oder Commands entgegen.

```
Browser (apps/web)                                     Server (apps/server, Fastify)
┌────────────────────────────────────────────┐         ┌──────────────────────────────────┐
│ xterm.js-Ausgabe + natives <input>          │         │ Snapshot-Generator (beim Start)   │
│ Shell: Parser, Registry, Command-Handler    │  GET    │   liest content/, keine Symlinks  │
│ Virtuelles Dateisystem (Vfs) im Speicher    │ ──────► │ GET /api/fs      (Snapshot, ETag) │
│ Workspace: Kopie im localStorage, reset     │ /api/fs │ GET /api/health  (Status, Version)│
│ Theme "Glass", Matrix-Animation, Logo       │         │ statisches Frontend (apps/web)    │
└────────────────────────────────────────────┘         └──────────────────────────────────┘
        │ steckbrief, projects
        └──► api.github.com (direkt vom Browser, 30 min gecacht, Fallback content/about/)
```

Geplant (siehe SPEC): `minecraft` (mvp-6) und `ask` mit einem LLM-Container (mvp-7) bekommen je einen eigenen Server-Endpunkt.

## 2. Repo-Aufbau

| Pfad                    | Inhalt                                                                                                                                           |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/web/`             | Frontend: Vite + TypeScript + xterm.js, kein UI-Framework                                                                                        |
| `apps/server/`          | Backend: Fastify, Snapshot, statische Auslieferung                                                                                               |
| `packages/shared/`      | Gemeinsam für Web und Server: Command-Registry, Parser, Snapshot-Typen, API-Typen                                                                |
| `content/`              | Inhalte des simulierten Dateisystems. **Öffentlich**, wird komplett an jeden Besucher ausgeliefert                                               |
| `e2e/`                  | Playwright: `tests/regression/` (Pipeline), `tests/review/` (Entwickler-Screenshots, nicht in der Pipeline)                                      |
| `docker/`               | `Dockerfile.dev` (Entwicklung, Tools), `Dockerfile.prod` (Production), `Dockerfile.playwright`                                                   |
| `docker-compose.yml`    | Dev- und Test-Services (`dev`, `tools`, `app`, `playwright`)                                                                                     |
| `docker-compose.ci.yml` | Nur CI: Docker-Layer-Cache über den GitHub-Actions-Cache                                                                                         |
| `scripts/`              | Workspace-Paket `@maxim-os/scripts`: ASCII-Porträt-Generator (`src/portrait*.ts`, `make portrait`) und `check-ticket-ref.sh` für Commits und PRs |
| `.githooks/`            | `commit-msg` (Ticketnummer), `pre-push` (Ticketbezug, Lint, Typecheck, Tests)                                                                    |
| `.github/`              | CI-Workflow, PR-Vorlage                                                                                                                          |
| `assets/`               | Quellmaterial, das nicht ausgeliefert wird (z. B. `headshot/image.png` für das ASCII-Porträt)                                                    |
| `docs/`                 | SPEC, diese Datei, Spike und Reviews                                                                                                             |

## 3. Frontend (`apps/web/src`)

### Startablauf (`main.ts`)

1. Snapshot laden (`vfs/load.ts`) parallel zur Matrix-Animation (`boot/matrix.ts`).
2. Schrift laden (xterm.js misst Zeichen beim Öffnen), Terminal erzeugen (`terminal/term.ts`).
3. Editor und Shell verbinden (`terminal/native-input.ts` → `shell/shell.ts`).
4. Layout an die sichtbare Fläche koppeln (`terminal/viewport.ts`), Quick-Keys und Touch-Scrolling binden.
5. Startscreen sofort rendern (`boot/startscreen.ts`); die Animation liegt darüber und gibt ihn frei. Danach `data-ready` / `data-booted` am `<html>` (nutzen die Tests).

### Module

| Ordner                                  | Aufgabe                                                                                                                                                                                                                             |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `terminal/term.ts`                      | xterm.js-Instanz (DOM-Renderer, transparent auf der Glasfläche), Prompt, Ausgabe (`print`, `clear`), Fit                                                                                                                            |
| `terminal/native-input.ts`              | **Eingabe:** unsichtbares natives `<input>` über der aktuellen Prompt-Zeile (Spike #15). Zeichnet Prompt, Text und Cursor über `prompt-line.ts` ins Terminal, puffert Eingaben während laufender Commands, Ctrl+C, Rückfragen (y/N) |
| `terminal/prompt-line.ts`               | Reine Funktion: Escape-Sequenz für die Prompt-Zeile inkl. Umbruch und Zellbreiten                                                                                                                                                   |
| `terminal/editor.ts`                    | Schnittstelle `LineEditor` für Shell, Quick-Keys und Tastatur                                                                                                                                                                       |
| `terminal/quickkeys.ts`                 | Leiste mit Tab, ↑, ↓, ^C, /, ~, - (nimmt der Tastatur nie den Fokus)                                                                                                                                                                |
| `terminal/viewport.ts`                  | `visualViewport`: Layout nur über der Bildschirmtastatur                                                                                                                                                                            |
| `terminal/touch-scroll.ts`              | Eigenes Wisch-Scrolling (xterm.js scrollt auf iOS nicht)                                                                                                                                                                            |
| `terminal/touch-debug.ts`               | Diagnose-Anzeige `?debug=touch`, nur im Dev-Server                                                                                                                                                                                  |
| `terminal/live.ts`                      | ARIA-Live-Region für Screenreader (`textContent`, nie HTML)                                                                                                                                                                         |
| `terminal/links.ts`                     | Klickbare Links: Klick/Tippen → Zelle → logische Zeile (auch umgebrochen) → http(s)-URL → neuer Tab mit `noopener`. Eigene Umsetzung statt xterm-Addon (das verlor Klicks durch unser Fokus-Handling)                               |
| `shell/shell.ts`                        | Shell: Tokenizer, Registry-Lookup, Flag-Prüfung, Umleitung `>`/`>>`, Rückfragen, Completion, cwd, Speichern nach schreibenden Commands                                                                                              |
| `shell/commands.ts`                     | Alle Command-Handler, Schlüssel = Registry-Name                                                                                                                                                                                     |
| `shell/format.ts`                       | Ausgabeformate für `ls`, `tree`, `cat` (breit und schmal), `clean()` gegen Terminal-Injection                                                                                                                                       |
| `shell/help.ts`                         | `help` aus der Registry, gruppiert nach Wichtigkeit: Tabelle (Beschreibung bricht in ihrer Spalte um) oder gestapelt auf schmalen Screens                                                                                           |
| `profile/github.ts`                     | GitHub-Profil und Repos direkt von `api.github.com`, 30 min im `sessionStorage` gecacht, Felder typgeprüft; `parseProfileData` für den Fallback `content/about/steckbrief.json`                                                     |
| `profile/format.ts`                     | Ausgabe von `steckbrief` (Porträt neben bzw. über den Infos) und `projects`                                                                                                                                                         |
| `shell/history.ts`, `shell/text.ts`     | History; Text-Helfer (Sanitizing, Farben, Umbruch)                                                                                                                                                                                  |
| `vfs/vfs.ts`                            | **Virtuelles Dateisystem:** Pfadauflösung (`..` endet an `/`, `~` = `/`), Lesen, Schreiben, Verschieben, Kopieren, Limits                                                                                                           |
| `vfs/workspace.ts`                      | Arbeitskopie: Snapshot + `localStorage`, neue Snapshot-Version setzt zurück, `reset`                                                                                                                                                |
| `vfs/load.ts`                           | `GET /api/fs` mit ETag, öffnet den Workspace                                                                                                                                                                                        |
| `boot/matrix.ts`, `boot/startscreen.ts` | Startanimation; erster Screen mit Logo, Tagline, Hinweis                                                                                                                                                                            |
| `ascii/logo.ts`                         | Logo: „Pixel“ aus eigener 5×7-Bitmap (Desktop), „Minimal“ (Handy)                                                                                                                                                                   |
| `theme/theme.ts` + `styles.css`         | Design „Glass“: Farben, Schrift, Glasfläche. CSS-Variablen in `styles.css` haben dieselben Werte                                                                                                                                    |

### Datenfluss eines Commands

```
<input> Enter → native-input: Zeile abschließen → shell.execute(line)
  → tokenize (shared/parse.ts: Anführungszeichen, >, >>)
  → findCommand (shared/commands.ts) → parseArgs (Flag-Allowlist)
  → Handler (shell/commands.ts) arbeitet auf ws.fs (Vfs)
  → Ausgabe über ShellOutput (bzw. in die Datei bei > / >>)
  → bei schreibenden Commands: ws.save() → localStorage
→ native-input zeichnet den nächsten Prompt
```

## 4. Shared (`packages/shared/src`)

| Datei         | Inhalt                                                                                                                                                                                                                                                                                                              |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `commands.ts` | **Command-Registry**: Name, **Gruppe**, Aliase, Beschreibung, Usage, Beispiel, Flags, Argumentzahl, `pathOperands`, `rawArgs`, `redirect`, `writes`. Einzige Quelle für `help` und die Flag-Allowlist. Sortiert nach `COMMAND_GROUPS`: Über mich → Projekte und Links → Im Terminal ausprobieren → Dateien → System |
| `parse.ts`    | `tokenize`, `parseArgs`, `printable`, Limits, `CONTROL_CHARS`                                                                                                                                                                                                                                                       |
| `snapshot.ts` | Typen `Snapshot`, `FsNode`, Limits, `isValidName`                                                                                                                                                                                                                                                                   |
| `api.ts`      | `HealthResponse`, `ErrorResponse`                                                                                                                                                                                                                                                                                   |

Im Dev-Betrieb wird über die Export-Condition `source` direkt `src/` verwendet, im Build `dist/`.

## 5. Server (`apps/server/src`)

| Datei         | Inhalt                                                                                                                                                             |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `index.ts`    | Start: Snapshot aus `CONTENT_DIR` bauen, `buildApp`, Port `PORT`                                                                                                   |
| `app.ts`      | Fastify: Helmet/CSP, globales Rate-Limit für `/api/*`, generische Fehler ohne Stacktrace, `GET /api/health`, `GET /api/fs`, statische Dateien                      |
| `snapshot.ts` | Snapshot-Generator: nur Ordner und reguläre Dateien, keine Symlinks, Namen als Bytes (ungültiges UTF-8 wird übersprungen), Binärerkennung, Limits, keine Hostpfade |

**Endpunkte**

| Route             | Antwort                                                                                                                    |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/health` | `{ status: 'ok', version }`, `version` = Commit aus dem Build-Arg `GIT_COMMIT` (sonst `dev`). Hängt von nichts Externem ab |
| `GET /api/fs`     | Snapshot als JSON, `ETag` = Snapshot-Version, `Cache-Control: no-cache`, 304 bei passendem `If-None-Match`                 |

**Umgebungsvariablen:** `PORT` (3000), `HOST`, `CONTENT_DIR` (`/content`), `PUBLIC_DIR` (`/app/public`), `APP_VERSION` (aus `GIT_COMMIT`).

## 6. Build, Docker, CI

- **Alles läuft in Containern** (Docker-Regel in `CLAUDE.md`). Wichtige Befehle: `make dev` (Vite auf 5173 + Fastify, Hot-Reload per Polling), `make lint`, `make typecheck`, `make test`, `make build`, `make test-ui`, `make update-baselines`, `make test-ui-screenshots`, `make ci`. Alle Targets: `make help`.
- **Production-Image** (`docker/Dockerfile.prod`): Build-Stage mit pnpm, Runtime `node:alpine` als `USER node`, Healthcheck. Commit mitgeben: `docker build -f docker/Dockerfile.prod --build-arg GIT_COMMIT=$(git rev-parse HEAD) .`
- **Laufzeit-Härtung:** `read_only`, `cap_drop: ALL`, `no-new-privileges`, `content/` read-only gemountet (siehe Service `app` in `docker-compose.yml`).
- **CI** (`.github/workflows/ci.yml`): Job „Ticketbezug“ (PR-Text und Commits) und Job `make ci` mit Layer-Cache.
- Stolperfallen: pnpm 12 lehnt sehr neue Pakete ab (`minimumReleaseAge`); TypeScript bleibt bei ~6.0; Imports mit `.ts`-Endung; unter Colima kommen Dateiänderungen nur per Polling in den Container.

## 7. Tests

| Art                                                      | Ort                                            | Läuft in der Pipeline |
| -------------------------------------------------------- | ---------------------------------------------- | --------------------- |
| Unit/API (Vitest)                                        | `**/src/**/*.test.ts`                          | ja                    |
| Regression (Playwright, `toHaveScreenshot` + funktional) | `e2e/tests/regression/`                        | ja                    |
| Review-Screenshots                                       | `e2e/tests/review/` → `artifacts/screenshots/` | nein                  |

- Projekte: `desktop` (1280×800), `mobile-390`, `mobile-360` (offene Tastatur simuliert), `mobile-webkit` (nur `@input`).
- Baselines nur im Playwright-Container erzeugen (`make update-baselines`).
- xterm.js rendert asynchron: in Tests immer wiederholende Assertions (`toContainText`, `expect.poll`). Mobil scrollen lange Ausgaben aus dem Bild; vollständigen Text über `#live` prüfen.
- Externe Dienste in E2E-Tests immer per `page.route` abfangen, nie echte Netzwerkaufrufe.

## 8. Rezepte

### Neuen Command hinzufügen

1. Ticket anlegen (Ticket-Regel).
2. Eintrag in `packages/shared/src/commands.ts` an der richtigen Stelle seiner **Gruppe** (Reihenfolge = Wichtigkeit für Besucher; Beschreibung, Usage, Beispiel, Flags, Argumente, ggf. `redirect`/`writes`/`pathOperands`).
3. Handler in `apps/web/src/shell/commands.ts` unter dem Registry-Namen; Ausgabe über `ctx.out`, Fehler über `ctx.shell.error` bzw. `ctx.shell.fsError`; Texte von außen mit `clean()` ausgeben.
4. Tests zuerst: Shell-Test in `shell/shell.test.ts`, bei UI-Wirkung ein Playwright-Test (Desktop und mobil).
5. Diese Datei aktualisieren, wenn sich Module oder Abläufe ändern.

### Neuen Server-Endpunkt hinzufügen

Nur wenn der Browser es technisch nicht selbst kann, mit Begründung in der SPEC. Keine Pfade oder Commands vom User annehmen, Eingaben strikt validieren, Limits und Rate-Limit, generische Fehler, Tests gegen Fakes. Hier in Abschnitt 5 eintragen.

### Inhalte ändern

Dateien in `content/` ändern und den Server neu starten (der Snapshot entsteht beim Start). Lokale Kopien der Besucher werden bei neuer Snapshot-Version automatisch zurückgesetzt.

- `content/about/`: `about.txt` (für `about`), `steckbrief.json` (Fallback, wenn GitHub nicht erreichbar ist), `portrait.txt` und `portrait-narrow.txt` (ASCII-Porträt).
- Porträt neu erzeugen: Foto nach `assets/headshot/image.png`, dann `make portrait`.

### Externe Daten im Browser

GitHub wird direkt vom Browser abgefragt (CSP `connect-src` erlaubt `https://api.github.com`). Immer: Timeout, Cache, Fallback aus `content/`, Felder prüfen und bei der Ausgabe mit `clean()` filtern. In E2E-Tests per `page.route` abfangen.

## 9. Pflege dieser Datei

Vor jedem Merge prüfen: Stimmen Repo-Aufbau, Module, Endpunkte, Umgebungsvariablen, Befehle und Rezepte noch? Wenn nicht, im selben PR anpassen. Die PR-Vorlage hat dafür einen Punkt.
