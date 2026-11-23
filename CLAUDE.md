# CLAUDE.md: MAXIM OS (maxim-os-website)

Diese Regeln gelten immer, in jeder Session und für jeden Subagent. Die Feature-Spezifikation steht in `docs/SPEC.md`.

## Projekt

Persönliche Website, die ein Terminal simuliert ("MAXIM OS", "an ai coding project"). Der User bekommt nur eine feste Menge simulierter Commands, nie einen echten Shell-Zugriff.

## Architektur (Client-first)

**Fast alles läuft im Browser.** Der Server ist bewusst klein:

- Der Server liefert das gebaute Frontend aus und stellt den Inhalt des Content-Ordners **einmal als Snapshot** bereit (Ordnerstruktur und Textdateien als JSON). Er nimmt **keine Pfade und keine Commands** vom User entgegen.
- Der Browser lädt den Snapshot und baut daraus ein **virtuelles Dateisystem im Speicher**. Alle Commands (`ls`, `cd`, `cat`, `tree`, aber auch bearbeitende wie `mkdir`, `touch`, `rm`, `mv`, `cp`, `echo > datei`) arbeiten nur auf dieser Kopie.
- Änderungen des Users bleiben in seinem Browser (Speicher bzw. `localStorage`). Sie gehen **nie** zurück an den Server. `reset` stellt den Originalzustand wieder her.
- Weitere Server-Endpunkte gibt es nur, wenn der Browser etwas technisch nicht selbst kann (z. B. Minecraft-Server-Status, KI-Antworten). Jeder neue Endpunkt wird in `docs/SPEC.md` begründet.
- **KI-Assistent:** Ein zweiter Container (`llm`) hostet ein kleines Sprachmodell (llama.cpp-Server). Er ist nur im internen Docker-Netz erreichbar, nie direkt aus dem Internet. Der Browser fragt über den Fastify-Server an (`POST /api/ask`), der Server leitet weiter und streamt die Antwort zurück. Gestartet wird das im Terminal mit dem Command `ask`. Fällt der Container aus, läuft die Website normal weiter.
- **Alles im Content-Ordner ist öffentlich**, denn der komplette Snapshot wird an jeden Besucher ausgeliefert. Dort liegen nie private Daten, Secrets oder Konfiguration.

## Techstack

- TypeScript überall, pnpm-Workspace-Monorepo: `apps/web`, `apps/server`, `packages/shared`.
- Frontend: Vite + TypeScript + xterm.js, kein UI-Framework. Das virtuelle Dateisystem und alle Commands liegen in `apps/web`.
- Backend: Node.js (LTS) + Fastify. Routen: Snapshot (`GET /api/fs`), Health (`GET /api/health`), später Minecraft-Status. Fastify liefert auch das gebaute Frontend aus. Kein WebSocket.
- Minecraft-Status: `minecraft-server-util`.
- KI: llama.cpp-Server (OpenAI-kompatible API) mit einem kleinen GGUF-Modell, das auf der Ziel-Hardware läuft (GTX 1050 Ti, 4 GB VRAM; CPU-Fallback). Modellwahl siehe `docs/SPEC.md` Abschnitt 4b.
- Tests: Vitest (Unit/API), Playwright (UI).
- CI: GitHub Actions.

## Mobile-first (wichtig)

Die Website muss zu einem großen Teil **hochkant auf dem Handy** funktionieren. Das Terminal ist dort ein Terminal mit **dauerhaft geöffneter Bildschirmtastatur**. Davon geht das UI immer aus.

- Das Layout orientiert sich an der **sichtbaren Fläche über der Tastatur** (`visualViewport`, `dvh`), nicht an der Fensterhöhe ohne Tastatur. Die Eingabezeile und die letzte Ausgabe bleiben immer sichtbar, die Ausgabe scrollt automatisch nach unten.
- Getippt wird in ein natives `<input>` (Ergebnis des Eingabe-Spikes, `docs/mobile-input-spike.md`), das über der aktuellen Prompt-Zeile liegt. Es hat `autocapitalize="off"`, `autocorrect="off"`, `autocomplete="off"`, `spellcheck="false"` und mindestens 16 px Schrift (sonst zoomt iOS beim Fokus). Die Tastatur wird nicht durch Seitenwechsel oder Re-Rendern geschlossen.
- Für Tasten, die es mobil nicht gibt (Tab, Pfeil hoch/runter, Ctrl+C), gibt es **Quick-Keys** direkt über der Tastatur.
- Ausgaben (`help`, `ls`, `tree`, ASCII-Art) brechen auf schmalen Bildschirmen (ca. 360 px Breite) sinnvoll um bzw. nutzen eine schmale Variante.
- **Minigames (`snake` usw.) sind mobil nicht unterstützt.** Auf Handys erscheint vor dem Start eine Warnung (siehe SPEC). Es gibt dafür keine Touch-Steuerung.
- Alle UI-Änderungen werden auch im **mobilen Hochformat** getestet (Playwright-Viewports, siehe Entwicklungsregeln).

## Docker-Regel (wichtig)

**Alles läuft in Docker-Containern: Entwicklung, Tests, UI-Tests und Ausführen der Website.** Auf dem Host wird weder `node`, `pnpm` noch `playwright` direkt ausgeführt. Für alle Aufgaben gibt es Docker-Compose-Services und kurze Wrapper im Makefile: `make dev`, `make test`, `make test-ui`, `make test-ui-screenshots`, `make update-baselines`, `make lint`, `make typecheck`, `make build`, `make ci`.

- Playwright läuft im offiziellen Playwright-Docker-Image, damit Screenshots lokal und in der CI identisch gerendert werden. Baseline-Screenshots werden nur in diesem Container erzeugt.
- Die CI nutzt dieselben Container/Compose-Services wie die lokale Entwicklung.
- Das Production-Image ist ein Multi-Stage-Build und läuft als Nicht-Root-User.

## Sicherheitsregeln (nie verletzen)

Durch die Client-first-Architektur ist der Server nur noch ein kleines Angriffsziel. Diese Regeln bleiben trotzdem verbindlich:

1. **Niemals Prozesse starten.** Kein `child_process`, `exec`, `spawn`, keine Shell, nirgends im Server (Lint-Regel und Test erzwingen das).
2. **Der Server nimmt keine Pfade, Dateinamen oder Commands vom User entgegen.** Er liest nur den Content-Ordner, den er selbst konfiguriert bekommt. Einzige Ausnahme sind Freitext-Fragen an den KI-Assistenten (`POST /api/ask`): streng validiert und begrenzt, sie werden nur an das Modell weitergegeben und nie als Pfad, Command oder Code ausgewertet.
3. **Snapshot-Generator:** liest nur Ordner und reguläre Dateien **innerhalb** des Content-Ordners und **folgt keinen Symlinks**. Er hat feste Limits (Dateigröße, Gesamtgröße, Anzahl Einträge, Tiefe). Binärdateien werden nicht als Text ausgeliefert. Der Snapshot enthält nur relative Namen, nie echte Hostpfade.
4. **Der Server leakt nie Hostpfade oder Stacktraces.** Fehler gehen ins Log, der Client bekommt nur generische Meldungen.
5. **Keine Terminal-Injection:** Alles, was ins Terminal geschrieben wird (Dateinamen, Dateiinhalte, Eingaben in Fehlermeldungen), wird vorher von Steuer- und Escape-Zeichen befreit. Inhalte werden nie als HTML in die Seite eingefügt (kein `innerHTML` mit Inhalten).
6. **Schreibende Commands ändern nur die lokale Kopie** im Browser des Users. Es gibt keinen Endpunkt, der Änderungen annimmt.
7. **Allowlist für Commands und Flags:** Unbekannte Commands, Flags und Parameter werden mit klarer Meldung abgelehnt. (Das ist jetzt vor allem UX und Robustheit, keine Sicherheitsgrenze mehr.)
8. Custom Commands (`snake`, `watchthis`, `minecraft`, `ask`, `help`, ...) sind reine Client-Funktionen und existieren nicht als Dateien.
9. **KI-Container:** nur im internen Docker-Netz (kein veröffentlichter Port, kein Internetzugang), keine Werkzeuge, keine Secrets, kein Zugriff auf Dateien außer dem Modell (read-only). Der Systemprompt liegt fest auf dem Server und kann vom User nicht ersetzt werden. Eingaben und Antworten haben harte Limits (Länge, Tokens, Zeit, gleichzeitige Anfragen, Rate-Limit). Antworten des Modells sind unvertrauenswürdig und werden wie alle Ausgaben gefiltert (Regel 5).
10. Container (Website und KI): Nicht-Root, `read_only: true`, `cap_drop: ALL`, `no-new-privileges`, Content-Ordner und Modell als Read-only-Volumes, Speicher- und CPU-Limits für den KI-Container. Sicherheits-Header (CSP usw.) und ein einfaches Rate-Limit für die API bleiben.

## Entwicklungsregeln

- **Test-driven development:** zuerst der Test, dann der Code. Besonders gründlich beim virtuellen Dateisystem (Pfadauflösung, `..`, Symlink-freie Struktur, schreibende Operationen, Limits), beim Command-Parser und beim Snapshot-Generator.
- **UI-Screenshot-Tests (lokal):** Playwright erzeugt Screenshots, die du dir als Entwickler ansiehst. Sie sind **nicht** Teil der Pipeline und liegen in einem git-ignorierten Ordner.
- **Regressionstests (Pipeline):** Nur `toHaveScreenshot()`-Tests und funktionale UI-Tests, die prüfen, dass sich nichts verändert hat, was unverändert bleiben soll.
- **Playwright-Projekte:** mindestens Desktop (1280×800) und mobiles Hochformat (z. B. 390×844 und 360×640). Die mobilen Tests simulieren die offene Tastatur, indem sie die sichtbare Höhe verkleinern (ca. 40–50 %).
- Vor jedem Push muss die Pipeline-Checkliste lokal grün sein: Lint, Typecheck, Vitest, Playwright-Regression, Build (alles per Docker, `make ci`).
- Die Command-Registry (Name, Aliase, Beschreibung, Usage, Beispiel, Flags, Argumente) ist die einzige Quelle für `help` und für die Flag-Allowlist.
- Commit-Messages kurz und aussagekräftig, kleine Commits, nach jedem Meilenstein ein Commit/Tag.

## Arbeitsweise und Rückfragen

Der Agent arbeitet **selbstständig** und fragt nicht bei jedem Schritt nach. Ohne Rückfrage erlaubt:

- Branches anlegen, committen, pushen, Pull Requests öffnen.
- PRs nach **grüner CI** in `main` mergen.
- Tickets, Board-Status, Epics, Meilenstein-Zuordnung und Tags pflegen.

Der Agent **hält an und fragt**, wenn:

- der Besitzer etwas **entscheiden** muss (z. B. Design-, Logo- oder Modellwahl, Inhalte über ihn selbst, unklare Anforderungen);
- ein **Meilenstein fertig** ist: Bevor das Epic geschlossen, der Tag `mvp-N` gesetzt und der nächste Meilenstein begonnen wird, stellt der Agent den Stand vor (was geht, wie man es ansieht) und wartet auf das OK des Besitzers;
- etwas **nicht rückgängig** zu machen ist oder über das Repo hinausgeht: Löschen von Branches, Tags oder Daten ohne Weg zurück, Force-Push, Änderungen an Repo-Einstellungen (z. B. Branch-Protection), Aktionen außerhalb dieses Repos.

## Ticket-Regel (GitHub Kanban)

**Ohne Ticket wird nichts gemacht.** Jede Änderung (Code, Tests, Docs, Config, Refactoring) gehört zu einem GitHub-Issue auf dem Kanban-Board (GitHub Projects) des Repos `maxim-os-website`.

- **Board-Spalten:** `Backlog` → `Ready` → `In Progress` → `In Review` → `Done`.
- **Wer erstellt Tickets?**
  - Der **Overseer-Agent** (Haupt-Agent) legt die Tickets für geplante Arbeit an und gibt sie beim Delegieren an Subagents. Jeder Subagent bekommt in seinem Auftrag die Ticketnummer(n), an denen er arbeitet.
  - Jeder Agent, der **spontan** etwas ändern will, das zu keinem Ticket passt (Bug entdeckt, Refactoring, fehlender Test, neue Idee), **erstellt vorher selbst ein Ticket** mit dem Label `unplanned`, verlinkt das Eltern-Ticket und setzt es auf `In Progress`. Danach erst arbeitet er daran.
  - Ist die spontane Änderung groß oder gehört sie nicht zum aktuellen Meilenstein, wird nur das Ticket im `Backlog` angelegt und **nicht** umgesetzt. Der Overseer entscheidet.
- **Ticket-Inhalt:** Titel (kurz, imperativ), Beschreibung (Ziel und Kontext), Akzeptanzkriterien als Checkliste, Meilenstein (`mvp-1` bis `mvp-8`), Label (`feature`, `bug`, `test`, `security`, `docs`, `chore`, `unplanned`). Jeder Meilenstein hat ein Epic-Ticket, dessen Checkliste auf die Einzeltickets verweist.
- **Status pflegen:** Wer ein Ticket beginnt, setzt es auf `In Progress`, nach dem Push auf `In Review`, nach grüner Pipeline und Merge auf `Done`. Der Status stimmt immer mit der Realität überein.
- **Verknüpfung:** Branch-Namen `<typ>/<issue-nr>-<kurzname>` (z. B. `feature/12-snake`). Jeder Commit enthält `#<issue-nr>`. Jeder Pull Request enthält `Closes #<issue-nr>`. Ein Commit oder PR ohne Ticketbezug ist nicht erlaubt.
- **Durchsetzung:** Ein `commit-msg`-Hook und ein CI-Check prüfen, dass Commits und PRs eine Ticketnummer enthalten.
- **Tooling:** Die GitHub-CLI (`gh issue ...`, `gh project ...`, `gh pr ...`) läuft direkt auf dem Host. Das ist die einzige Ausnahme von der Docker-Regel, neben `git` und `docker`. Nie Tokens oder Secrets in Tickets schreiben.

## Zuständigkeiten

- Der Heimserver und die playit.gg-Tunnel werden **vom Besitzer selbst** eingerichtet. Der Agent baut keine Tunnel-Container und keine Server-Konfiguration, nur ein lauffähiges, dokumentiertes Docker-Setup.
- Auch NVIDIA-Treiber und NVIDIA Container Toolkit auf dem Server richtet der Besitzer ein. Der Agent dokumentiert, was nötig ist, und liefert eine CPU-Variante, die ohne GPU läuft.
