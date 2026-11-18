# CLAUDE.md: MAXIM OS (maxim-os-website)

Diese Regeln gelten immer, in jeder Session und für jeden Subagent. Die Feature-Spezifikation steht im Prompt bzw. in `docs/SPEC.md`.

## Projekt

Persönliche Website, die ein Terminal simuliert ("MAXIM OS", "an ai coding project"). Der User bekommt nur eine feste Menge simulierter Commands, kein echtes Shell-Zugriff.

## Techstack

- TypeScript überall, pnpm-Workspace-Monorepo: `apps/web`, `apps/server`, `packages/shared`.
- Frontend: Vite + TypeScript + xterm.js, kein UI-Framework.
- Backend: Node.js (LTS) + Fastify, eine Route `POST /api/command`, kein WebSocket. Fastify liefert auch das gebaute Frontend aus.
- Minecraft-Status: `minecraft-server-util`.
- Tests: Vitest (Unit/API), Playwright (UI).
- CI: GitHub Actions.

## Mobile-first (wichtig)

Die Website muss zu einem großen Teil **hochkant auf dem Handy** funktionieren. Das Terminal ist dort ein Terminal mit **dauerhaft geöffneter Bildschirmtastatur**. Davon geht das UI immer aus.

- Das Layout orientiert sich an der **sichtbaren Fläche über der Tastatur** (`visualViewport`, `dvh`), nicht an der Fensterhöhe ohne Tastatur. Die Eingabezeile und die letzte Ausgabe bleiben immer sichtbar, die Ausgabe scrollt automatisch nach unten.
- Das Eingabefeld hat `autocapitalize="off"`, `autocorrect="off"`, `autocomplete="off"`, `spellcheck="false"` und mindestens 16 px Schrift (sonst zoomt iOS beim Fokus). Die Tastatur wird nicht durch Seitenwechsel oder Re-Rendern geschlossen.
- Für Tasten, die es mobil nicht gibt (Tab, Pfeil hoch/runter, Ctrl+C), gibt es eine **Quick-Key-Leiste** direkt über der Tastatur.
- Ausgaben (`help`, `ls`, `tree`, ASCII-Art) brechen auf schmalen Bildschirmen (ca. 360 px Breite) sinnvoll um bzw. nutzen eine schmale Variante.
- **Minigames (`snake` usw.) sind mobil nicht unterstützt.** Auf Handys erscheint vor dem Start eine Warnung (siehe Prompt). Es gibt dafür keine Touch-Steuerung.
- Alle UI-Änderungen werden auch im **mobilen Hochformat** getestet (Playwright-Viewports, siehe Entwicklungsregeln).

## Docker-Regel (wichtig)

**Alles läuft in Docker-Containern: Entwicklung, Tests, UI-Tests und Ausführen der Website.** Auf dem Host wird weder `node`, `pnpm` noch `playwright` direkt ausgeführt. Für alle Aufgaben gibt es Docker-Compose-Services und kurze Wrapper (Makefile oder Skripte), z. B. `make dev`, `make test`, `make test-ui`, `make test-ui-screenshots`, `make lint`, `make build`.

- Playwright läuft im offiziellen Playwright-Docker-Image, damit Screenshots lokal und in der CI identisch gerendert werden. Baseline-Screenshots werden nur in diesem Container erzeugt.
- Die CI nutzt dieselben Container/Compose-Services wie die lokale Entwicklung.
- Das Production-Image ist ein Multi-Stage-Build, läuft als Nicht-Root-User.

## Sicherheitsregeln (nie verletzen)

1. **Niemals Prozesse starten.** Kein `child_process`, `exec`, `spawn`, keine Shell. Dateisystem-Commands (`ls`, `cd`, `pwd`, `cat`, `tree`) sind im Server selbst mit `fs` implementiert.
2. Das simulierte Dateisystem ist **nur lesbar**. Es gibt keine schreibenden Commands.
3. **Allowlist statt Blocklist:** Unbekannte Commands, Flags und Parameter werden abgelehnt.
4. Pfad-Validierung bei **jedem** Command: relativ zum aktuellen Verzeichnis zu absolutem Pfad auflösen, `fs.realpath`, gegen die beim Serverstart generierte Allowlist prüfen (Pfad des Content-Ordners kombiniert mit allen Pfaden darin), erst dann ausführen. Der Client trackt das Verzeichnis, der Server validiert es bei jedem Request neu.
5. Der Server leakt nie echte Hostpfade oder Stacktraces.
6. Custom Commands (`snake`, `watchthis`, `minecraft`, `help`, ...) sind clientseitig simuliert und existieren nicht als Dateien auf dem Server.
7. Container: Nicht-Root, `read_only: true`, `cap_drop: ALL`, `no-new-privileges`, Content-Ordner als Read-only-Volume.

## Entwicklungsregeln

- **Test-driven development:** zuerst der Test, dann der Code. Besonders gründlich beim Pfad-Validator (Traversal, Symlinks, Encoding, absolute Pfade, Null-Bytes) und beim Command-Parser.
- **UI-Screenshot-Tests (lokal):** Playwright erzeugt Screenshots, die du dir als Entwickler ansiehst. Sie sind **nicht** Teil der Pipeline und liegen in einem git-ignorierten Ordner.
- **Regressionstests (Pipeline):** Nur `toHaveScreenshot()`-Tests, die prüfen, dass sich nichts verändert hat, was unverändert bleiben soll.
- **Playwright-Projekte:** mindestens Desktop (1280×800) und mobiles Hochformat (z. B. 390×844 und 360×640). Die mobilen Tests simulieren die offene Tastatur, indem sie die sichtbare Höhe verkleinern (ca. 40–50 % der Höhe).
- Vor jedem Push muss die Pipeline-Checkliste lokal grün sein: Lint, Typecheck, Vitest, Playwright-Regression, Build (alles per Docker).
- Die Command-Registry (Name, Aliase, Beschreibung, Usage, Beispiel, Handler) ist die einzige Quelle für `help`.
- Commit-Messages kurz und aussagekräftig, kleine Commits, nach jedem Meilenstein ein Commit/Tag.

## Ticket-Regel (GitHub Kanban)

**Ohne Ticket wird nichts gemacht.** Jede Änderung (Code, Tests, Docs, Config, Refactoring) gehört zu einem GitHub-Issue auf dem Kanban-Board (GitHub Projects) des Repos `maxim-os-website`.

- **Board-Spalten:** `Backlog` → `Ready` → `In Progress` → `In Review` → `Done`.
- **Wer erstellt Tickets?**
  - Der **Overseer-Agent** (Haupt-Agent) legt die Tickets für geplante Arbeit an und gibt sie beim Delegieren an Subagents. Jeder Subagent bekommt in seinem Auftrag die Ticketnummer(n), an denen er arbeitet.
  - Jeder Agent, der **spontan** etwas ändern will, das zu keinem Ticket passt (Bug entdeckt, Refactoring, fehlender Test, neue Idee), **erstellt vorher selbst ein Ticket** mit dem Label `unplanned`, verlinkt das Eltern-Ticket und setzt es auf `In Progress`. Danach erst arbeitet er daran.
  - Ist die spontane Änderung groß oder gehört sie nicht zum aktuellen Meilenstein, wird nur das Ticket im `Backlog` angelegt und **nicht** umgesetzt. Der Overseer entscheidet.
- **Ticket-Inhalt:** Titel (kurz, imperativ), Beschreibung (Ziel und Kontext), Akzeptanzkriterien als Checkliste, Meilenstein (`mvp-1` bis `mvp-6`), Label (`feature`, `bug`, `test`, `security`, `docs`, `chore`, `unplanned`). Jeder Meilenstein hat ein Epic-Ticket, dessen Checkliste auf die Einzeltickets verweist.
- **Status pflegen:** Wer ein Ticket beginnt, setzt es auf `In Progress`, nach dem Push auf `In Review`, nach grüner Pipeline und Merge auf `Done`. Der Status stimmt immer mit der Realität überein.
- **Verknüpfung:** Branch-Namen `<typ>/<issue-nr>-<kurzname>` (z. B. `feature/12-snake`). Jeder Commit enthält `#<issue-nr>`. Jeder Pull Request enthält `Closes #<issue-nr>`. Ein Commit oder PR ohne Ticketbezug ist nicht erlaubt.
- **Durchsetzung:** Ein `commit-msg`-Hook und ein CI-Check prüfen, dass Commits und PRs eine Ticketnummer enthalten.
- **Tooling:** Die GitHub-CLI (`gh issue ...`, `gh project ...`, `gh pr ...`) läuft direkt auf dem Host. Das ist die einzige Ausnahme von der Docker-Regel, neben `git` und `docker`. Nie Tokens oder Secrets in Tickets schreiben.

## Zuständigkeiten

- Der Heimserver und die playit.gg-Tunnel werden **vom Besitzer selbst** eingerichtet. Der Agent baut keine Tunnel-Container und keine Server-Konfiguration, nur ein lauffähiges, dokumentiertes Docker-Setup.
