# Website Prompt v4: MAXIM OS

Lies zuerst die `CLAUDE.md` im Repo-Root. Sie enthält die verbindlichen Regeln zu Techstack, Architektur, Docker, Sicherheit und Entwicklung. Dieses Dokument beschreibt die Features und die Arbeitsweise.

> **v4 (Client-first):** Gegenüber v3 läuft fast alles im Browser. Der Server liefert nur noch einen Snapshot des Content-Ordners. Alle Commands arbeiten auf einer Kopie im Browser, deshalb gibt es jetzt auch bearbeitende Commands. Abschnitt 2 beschreibt das Modell, Abschnitt 5 was an Sicherheitsmaßnahmen dadurch entfällt.

---

## 0. Ausgangslage und Arbeitsweise

- Repo **`maxim-os-website`** mit Monorepo, Docker-Setup, CI und Kanban-Board ist vorhanden.
- **Stand:** `mvp-1` (Skeleton) ist fertig. `mvp-2` (Dateisystem in der v3-Variante: Commands auf dem Server mit Pfad-Validator und Allowlist) ist gemergt und durch ein Security-Review gegangen. Es wird als historischer Stand abgeschlossen (Tag `mvp-2`) und in Meilenstein 3 auf das Client-Modell umgebaut.
- **Agile Herangehensweise:** Arbeite in den Meilensteinen aus Abschnitt 1. Nach jedem Meilenstein gilt:
  1. Alle Tests sind grün, die Pipeline-Checks laufen durch.
  2. Es gibt einen Merge nach `main` und ein Tag `mvp-N`. Gepusht wird nur bei grüner Pipeline.
  3. Du gibst eine kurze Zusammenfassung (was geht jetzt, wie starte ich es, was ist als Nächstes dran, welche `unplanned`-Tickets sind entstanden).
  4. **Du hältst an und wartest auf mein Feedback**, bevor du den nächsten Meilenstein beginnst. Jeder Meilenstein ergibt ein lauffähiges MVP.
- **Subagents:**
  - Meilenstein 3 (Umbau) baust du selbst und sequenziell. Das Fundament (virtuelles Dateisystem, Snapshot-Format, Command-Registry) muss konsistent sein.
  - Ab Meilenstein 4 darfst du unabhängige Teile parallel an Subagents geben (z. B. Snake, Minecraft-Status, ASCII-Generator). Vorher definierst du die Schnittstellen (Typen im `shared`-Paket, Registry-Eintrag), damit nichts kollidiert.
  - Am Ende von Meilenstein 3 prüft ein **separater Review-Subagent**, der den Code nicht geschrieben hat, kurz den Snapshot-Generator (Symlinks, Limits, Hostpfade) und die Terminal-Ausgabe (Escape-Sequenzen aus Dateinamen und Inhalten). Funde werden zuerst als Test festgehalten, dann behoben.
- Alles (Entwicklung, Tests, UI-Tests, Ausführen) läuft **in Docker-Containern**, siehe `CLAUDE.md`.
- **Ohne Ticket wird nichts gemacht.** Die Ticket-Regel aus der `CLAUDE.md` gilt für dich und alle Subagents, siehe Abschnitt 7a.

---

## 1. Meilensteine

1. **Skeleton** ✅: Monorepo, Docker-Setup, CI-Pipeline, Startup-Animation, Startscreen, Command-Registry, `help`, `clear`, Fehlermeldung für unbekannte Commands, mobiles Terminal-Layout inklusive Eingabe-Spike.
2. **Dateisystem (v3, Server)** ✅: Content-Ordner, Allowlist, Pfad-Validator, `ls`, `cd`, `pwd`, `cat`, `tree` auf dem Server, Rate-Limiting, Security-Review. Wird in Meilenstein 3 ersetzt.
3. **Umbau: Client-Dateisystem:** Snapshot-Endpunkt `GET /api/fs`, virtuelles Dateisystem im Browser, lesende Commands im Client, bearbeitende Commands (`mkdir`, `touch`, `rm`, `rmdir`, `mv`, `cp`, `echo` mit `>`/`>>`), Persistenz im `localStorage`, `reset`. Rückbau von Pfad-Validator, `/api/command`, `/api/complete` und Server-Commands. Kurzes Review (siehe Abschnitt 0).
4. **Steckbrief und Design:** Design-Auswahl (Schrift und Theme), neues Logo, `steckbrief` mit GitHub-Daten und vorgerendertem ASCII-Bild, dazu `about`, `whoami`, `projects`, `history`.
5. **Spiele und Links:** `snake` und `watchthis`.
6. **Minecraft:** `minecraft`-Übersicht mit Status, Spielern und Ping.
7. **Release-Reife:** Production-Image, `docker-compose.prod.yml`, Härtung, mobiler Feinschliff, README mit Übergabe-Anleitung (siehe Abschnitt 9).

Die bestehenden Tickets der früheren Meilensteine `mvp-3` bis `mvp-6` werden auf `mvp-4` bis `mvp-7` umgehängt.

---

## 2. Architektur und Sicherheitsmodell

```
Browser                                              Server (Fastify)
┌──────────────────────────────────────────┐         ┌───────────────────────────────┐
│ Terminal (xterm.js) + Command-Registry    │  GET    │ Snapshot-Generator            │
│ Virtuelles Dateisystem (im Speicher)      │ ──────► │  liest content/ beim Start    │
│  ← Snapshot (Original)                    │ /api/fs │  (read-only, ohne Symlinks)   │
│  ← lokale Änderungen (localStorage)       │         │ statisches Frontend           │
│ Alle Commands laufen hier                 │         │ /api/health, später Minecraft │
└──────────────────────────────────────────┘         └───────────────────────────────┘
```

### Grundsätze

1. Der User führt **keine echten Commands** aus. Es gibt eine feste Menge simulierter Commands im Browser.
2. Der Server startet **niemals Prozesse** und nimmt **keine Pfade, Dateinamen oder Commands** vom User entgegen.
3. Der Server liefert den Content-Ordner nur **lesend und vollständig** als Snapshot aus. Alles darin ist öffentlich.
4. Der User darf seine **lokale Kopie** frei bearbeiten. Änderungen bleiben in seinem Browser und gehen nie an den Server.
5. Unbekannte Commands, Flags und Parameter werden mit klarer Meldung abgelehnt (Allowlist aus der Registry).

### Snapshot (`GET /api/fs`)

- Wird **einmal beim Serverstart** aus dem Content-Ordner erzeugt und im Speicher gehalten. Neue Inhalte: Content-Ordner ändern, Container neu starten.
- Format (Typen im `shared`-Paket):
  ```ts
  type FsNode =
    | { type: 'dir'; name: string; mtime: string; children: FsNode[] }
    | { type: 'file'; name: string; mtime: string; size: number; text?: string; binary?: true };
  interface Snapshot { version: string; root: FsNode }   // version = Hash über den Inhalt
  ```
- Der Generator
  - liest nur Ordner und reguläre Dateien **innerhalb** des Content-Ordners und **ignoriert Symlinks** (kein Folgen, kein Eintrag),
  - überspringt Einträge mit ungültigen Namen (Steuerzeichen, `/`, `\`, länger als 255 Zeichen),
  - liefert Textdateien (UTF-8, ohne Null-Bytes) mit Inhalt aus, Binärdateien nur als Eintrag mit `binary: true`,
  - hat feste Limits: Datei max. 64 KB Text, Snapshot max. 2 MB, max. 2000 Einträge, max. Tiefe 12. Was darüber liegt, wird weggelassen und geloggt,
  - enthält nur relative Namen, nie Hostpfade.
- Antwort mit `ETag` (= `version`) und `Cache-Control`, damit der Browser bei unveränderten Inhalten nichts neu lädt.

### Virtuelles Dateisystem (Browser)

- Baum aus Ordnern und Dateien im Speicher, aufgebaut aus dem Snapshot. Keine Symlinks.
- Pfade wie in einer Shell: relativ zum aktuellen Ordner oder absolut ab `/`. `..` endet an `/`, `~` ist `/`. Mehrfache `/` und `.` werden normalisiert.
- Dateien mit `binary: true` lassen sich auflisten, aber nicht mit `cat` anzeigen.
- **Limits für die lokale Kopie:** Datei max. 64 KB, gesamte lokale Kopie max. 1 MB, max. 2000 Einträge, Name max. 255 Zeichen, Pfad max. 1024 Zeichen, keine Steuerzeichen und kein `/` in Namen. Überschreitungen ergeben eine klare Fehlermeldung.

### Persistenz

- Nach jeder Änderung wird die lokale Kopie im `localStorage` gespeichert (zusammen mit der Snapshot-`version`, auf der sie beruht). Beim nächsten Besuch geht es dort weiter.
- Liefert der Server eine **neue `version`**, wird die lokale Kopie verworfen und ein kurzer Hinweis gezeigt (z. B. `Inhalte wurden aktualisiert, deine Änderungen wurden zurückgesetzt.`).
- `reset` stellt jederzeit den Originalzustand aus dem Snapshot her.
- Ist `localStorage` nicht verfügbar (privater Modus, voll), funktioniert alles weiter, nur ohne Speichern über den Besuch hinaus.

### Zustand

Das aktuelle Verzeichnis lebt nur im Browser. Wird der aktuelle Ordner gelöscht oder verschoben, wechselt die Shell nach `/`.

---

## 3. Startup

Beim Laden der Seite läuft eine Animation. ASCII-Zeichen laufen "Matrix-mäßig" von oben nach unten und geben dabei den darunter schon gerenderten ersten Screen frei.

Der erste Screen enthält:

- oben einen ASCII-Schriftzug **"MAXIM OS"**
- darunter die Unterschrift **"an ai coding project"**
- einen Hinweis, `help` oder `steckbrief` auszuführen

Die Animation ist überspringbar (beliebige Taste/Klick) und respektiert `prefers-reduced-motion`. Der Snapshot wird parallel geladen. Schlägt das fehl, erscheint ein Hinweis; Commands ohne Dateisystem (`help`, `clear`, ...) funktionieren trotzdem.

---

## 4. Commands

Alle Commands stehen in einer zentralen **Command-Registry**. Jeder Eintrag enthält: Name, Aliase, Beschreibung, Benutzung (Usage), Beispiel, erlaubte Flags, Anzahl Argumente und Handler. `help` wird automatisch aus dieser Registry generiert. Alle Handler laufen im Browser.

### help

Gibt eine Liste aller Commands aus, jeweils mit Beschreibung, Benutzung und Beispiel.

### Dateisystem: lesen

| Command | Flags | Beschreibung |
| --- | --- | --- |
| `ls [ordner]` | `-l`, `-a` (auch `-la`) | Inhalt anzeigen, `-l` ausführlich, `-a` mit versteckten Dateien |
| `cd [ordner]` | – | Ordner wechseln, ohne Angabe nach `/` |
| `pwd` | – | aktuellen Ordner anzeigen |
| `cat <datei>` | – | Textdatei anzeigen (keine Binärdateien) |
| `tree [ordner]` | `-L <1–5>` | Baumansicht mit Tiefen- und Ausgabelimit |

### Dateisystem: bearbeiten (nur lokale Kopie)

| Command | Flags | Beschreibung |
| --- | --- | --- |
| `mkdir <ordner>` | `-p` | Ordner anlegen, `-p` auch Zwischenordner |
| `touch <datei>` | – | leere Datei anlegen bzw. Zeitstempel setzen |
| `rm <pfad>` | `-r`, `-f` | Datei löschen, `-r` auch Ordner mit Inhalt |
| `rmdir <ordner>` | – | leeren Ordner löschen |
| `mv <quelle> <ziel>` | – | verschieben oder umbenennen |
| `cp <quelle> <ziel>` | `-r` | kopieren, `-r` für Ordner |
| `echo <text>` | – | Text ausgeben |
| `reset` | – | lokale Änderungen verwerfen, Original wiederherstellen (mit Rückfrage `y/N`) |

- **Umleitung:** Commands mit Textausgabe (`echo`, `cat`, `ls`, `tree`, `pwd`) unterstützen `> datei` (überschreiben) und `>> datei` (anhängen). Weitere Shell-Syntax (Pipes, `;`, `&&`, Variablen, Globs) gibt es nicht.
- Fehlermeldungen wie in einer Shell, z. B. `rm: docs: Ist ein Ordner (rm -r verwenden)`.
- Ein Editor (`nano`/`edit`) ist eine spätere Erweiterung und nicht Teil von Meilenstein 3.

### snake (clientseitig)

Ein Snake-Spiel, das mit dem Command gestartet und gespielt wird. Es ist komplett im Frontend implementiert und existiert nicht als Datei.

- Es läuft im Terminal im ASCII-Stil. Während des Spiels wird nichts anderes im Terminal angezeigt.
- Steuerung per Pfeiltasten und WASD. Auf Mobilgeräten wird das Spiel **nicht unterstützt** (siehe Abschnitt 4a: Warnung vor dem Start).
- **Beenden:** `Ctrl+C` und `Esc`. Das muss auf Mac und Windows mit verschiedenen Tastaturlayouts funktionieren. Auf Mac ist die Taste `Ctrl` (nicht `Cmd`). Browser-Kollisionen mit Copy (Windows) beachten und im Spielmodus abfangen. Zusätzlich gibt es **oben links ein ✕**, mit dem man das Spiel verlässt.
- Zeige Score und Highscore (lokal, im `localStorage`).

### watchthis (Aliase: `wt`, `WatchThis`)

Zeigt eine Boot-Animation mit einem ASCII-Ladebalken. Danach öffnet die Website selbst einen neuen Tab mit `https://movies.maxim-dieball.de`. Manche Browser blockieren `window.open` ohne User-Geste, biete daher einen anklickbaren Link im Terminal als Fallback an.

### minecraft

Zeigt eine kleine Übersicht meines Minecraft-Servers (Adresse `minecraft.maxim-dieball.de`): Online-Status, Spielerzahl, Spielerliste, Version, MOTD und Ping. Der Browser kann das Minecraft-Protokoll nicht selbst sprechen, deshalb gibt es dafür **einen Server-Endpunkt** (`GET /api/minecraft`, Server-List-Ping mit `minecraft-server-util`). Er nimmt keine Parameter vom User, cached die Antwort einige Sekunden und hat ein Timeout. Adresse und Port kommen aus Umgebungsvariablen. Ist der Server offline, wird das freundlich angezeigt.

### steckbrief

Zeigt einen Steckbrief von mir. Die Daten kommen von GitHub (Profil, Repos): Der Browser fragt die öffentliche GitHub-API direkt ab und cached die Antwort (z. B. `sessionStorage`). Schlägt das fehl (Rate-Limit, offline), wird ein Fallback aus dem Content-Ordner angezeigt. Oben steht ein Bild von mir, **vorab in ASCII-Zeichen gerendert** und als Textdatei im Content-Ordner abgelegt (breite und schmale Variante; ich stelle das Foto bereit, bis dahin ein Platzhalter).

### Weitere Basis-Commands (clientseitig)

`clear`, `projects` (Liste meiner Projekte mit Links, Anzeige im Terminal oder neuer Tab), `about`, `whoami`, `history`. Unbekannte Commands geben `command not found: <name>. Tippe 'help'.` aus.

### Terminal-UX

Tab-Completion für Commands und Pfade (lokal, ohne Server), Pfeil hoch/runter für die History, Ctrl+L für `clear`, Ctrl+C bricht Eingabe bzw. laufende Commands ab, bedienbar per Screenreader (ARIA-Live-Region für die Ausgabe). Die mobile Bedienung ist in Abschnitt 4a beschrieben.

---

## 4a. Mobile (Hochformat, Tastatur immer offen)

Die Website muss zu einem großen Teil **hochkant auf dem Handy** funktionieren. Da es ein Terminal ist, gehst du davon aus, dass die **Bildschirmtastatur die ganze Zeit offen ist**. Das UI ist dafür gebaut, nicht nur "irgendwie nutzbar".

**Layout und Tastatur**
- Das Terminal nutzt nur die **sichtbare Fläche über der Tastatur** (`window.visualViewport`, `dvh`), nicht `100vh`. Die Eingabezeile wird nie verdeckt.
- Die Ausgabe scrollt automatisch zur neuesten Zeile, auch wenn sich die sichtbare Höhe ändert. Wischen über die Ausgabe scrollt den Verlauf.
- Die Tastatur bleibt offen. Der Fokus geht beim Absenden, beim Scrollen und beim Tippen auf die Ausgabe nicht verloren.
- Eingabe über ein natives `<input>` auf der aktuellen Prompt-Zeile (Spike-Ergebnis) mit `autocapitalize="off"`, `autocorrect="off"`, `autocomplete="off"`, `spellcheck="false"`, `enterkeyhint="send"` und mindestens 16 px Schrift.
- Sicherheitsbereiche (`env(safe-area-inset-*)`) werden beachtet.

**Quick-Keys**
Direkt über der Tastatur gibt es die Tasten, die mobil fehlen: `Tab`, `↑`, `↓` (History), `Ctrl+C` (Abbrechen) und `/`, `~`, `-`. Sie nehmen der Tastatur nicht den Fokus. (Geplant für Meilenstein 7: hinter einem kleinen runden `>`-Button unten links einklappbar.)

**Darstellung**
- Schmale Bildschirme (ab ca. **360 px Breite**) werden unterstützt, mit einer sinnvollen Zeilenbreite (ca. 40–45 Zeichen).
- Ausgaben von `help`, `ls`, `tree`, `minecraft` und `steckbrief` brechen sinnvoll um oder haben eine **schmale Variante**.
- Der ASCII-Schriftzug "MAXIM OS" und das ASCII-Bild des Steckbriefs haben jeweils eine **schmale mobile Version**, die ohne Zeilenumbruch in die Breite passt.
- Die Matrix-Animation läuft auch mobil flüssig und ist überspringbar.

**Minigames auf dem Handy**
- Minigames (`snake` und künftige) sind mobil **nicht unterstützt**, es gibt keine Touch-Steuerung.
- Erkennung: Touch-Gerät ohne feinen Zeiger (`matchMedia('(pointer: coarse)')` kombiniert mit `(hover: none)`) oder sehr schmaler Viewport.
- Vor dem Start erscheint im Terminal eine Warnung, z. B. `⚠ Snake wird auf Handys nicht unterstützt. Trotzdem starten? (y/N)`. Standard ist Abbruch. Bei `y` startet das Spiel, ohne dass die Steuerung angepasst wird.

---

## 5. Sicherheit und Härtung

### Was bleibt

- Kein Prozessstart im Server (`child_process` per Lint-Regel und Test verboten).
- Snapshot-Generator ohne Symlinks, mit Limits und ohne Hostpfade (Abschnitt 2), mit Tests für Symlinks nach außen, Symlink-Schleifen, Binärdateien, ungültige Namen und Limits.
- Keine Stacktraces oder Hostpfade in Antworten.
- Keine Terminal-Injection: Steuer- und Escape-Zeichen aus Dateinamen, Inhalten und Eingaben werden vor der Ausgabe entfernt; Inhalte nie als HTML einfügen.
- Sicherheits-Header über `@fastify/helmet`, inklusive CSP (`script-src 'self'`; `connect-src` nur `'self'` und `https://api.github.com`).
- Ein einfaches globales Rate-Limit für `/api/*` (der Snapshot ist gecached, Minecraft hat eigenen Cache).
- Container-Härtung (Abschnitt 9).

### Was gegenüber v3 entfällt (und warum)

| Entfällt | Grund |
| --- | --- |
| Pfad-Validator mit `realpath` und Allowlist pro Request | Der Server bekommt keine Pfade mehr vom User. Die einzige Dateisystem-Grenze ist der Snapshot-Generator, der nur den eigenen Content-Ordner liest. |
| Server-seitiger Command-Parser, `POST /api/command`, `POST /api/complete` | Commands laufen im Browser. Der Server hat keinen Endpunkt mehr, der Eingaben verarbeitet. |
| Strikte Schema-Validierung von Request-Bodys | Es gibt keine Request-Bodys mehr (nur `GET`). |
| Rate-Limit pro Client plus global mit eigener Logik | Ein globales Limit reicht für zwei gecachte `GET`-Endpunkte. |
| Großes Security-Review des Pfad-Validators | Ersetzt durch ein kurzes Review von Snapshot-Generator und Terminal-Ausgabe. |
| Schutz der lokalen Kopie vor dem User | Der User verändert nur seine eigene Kopie in seinem eigenen Browser. Das betrifft niemanden sonst. |

---

## 6. Development Guidelines

- **Test-driven development:** zuerst der Test, dann die Implementierung. Besonders gründlich beim virtuellen Dateisystem (Pfadauflösung, alle bearbeitenden Operationen inkl. Randfälle wie `mv` in sich selbst, Limits, Persistenz), beim Command-Parser (Flags, Anführungszeichen, `>`/`>>`) und beim Snapshot-Generator.
- **Unit/API-Tests** mit Vitest, im Container.
- **UI-Tests mit Playwright, die Screenshots erzeugen.** Du schaust sie dir als Entwickler an, um das UI zu prüfen. Sie laufen lokal im Playwright-Container und **nicht** in der Pipeline. Die Screenshots landen in einem git-ignorierten Ordner.
- **In der Pipeline** laufen nur Regressionstests (`toHaveScreenshot()` und funktionale UI-Tests), die prüfen, dass sich nichts verändert hat, was unverändert bleiben sollte.
- Die Baselines werden ausschließlich im Playwright-Container erzeugt, damit lokal und in der CI identisch gerendert wird.
- Playwright läuft mit mehreren Projekten: Desktop (1280×800) und mobiles Hochformat (mindestens 390×844 und 360×640), dazu WebKit für die mobile Eingabe. Mobile Tests simulieren die offene Tastatur, indem sie die sichtbare Höhe verkleinern (ca. 40–50 %), und prüfen: Eingabezeile sichtbar, Ausgabe scrollt nach unten, Quick-Keys sichtbar, kein horizontales Scrollen, Snake zeigt die Warnung.

---

## 7. GitHub

- Repo: **`maxim-os-website`**.
- Vor jedem Push läuft die Test-Pipeline (GitHub Actions): Lint, Typecheck, Vitest, Playwright-Regression, Build. Die CI nutzt dieselben Container wie die lokale Entwicklung.
- Ein lokaler Pre-push-Hook führt mindestens Ticket-Check, Lint, Typecheck und Unit-Tests aus, ebenfalls im Container.
- `main` ist nur mit grüner Pipeline mergebar. Pro Meilenstein ein Tag (`mvp-1`, `mvp-2`, ...).

---

## 7a. Ticketsystem (GitHub Kanban)

Jede Arbeit läuft über Tickets auf dem **GitHub-Projects-Kanban-Board** des Repos. Die vollständigen Regeln stehen in der `CLAUDE.md`. Für dich als Overseer-Agent bedeutet das:

1. **Board und Labels** sind eingerichtet (`Backlog`, `Ready`, `In Progress`, `In Review`, `Done`; Labels `feature`, `bug`, `test`, `security`, `docs`, `chore`, `unplanned`, `epic`). Für v4 kommt der Meilenstein `mvp-7` dazu.
2. **Planung:** Zu jedem Meilenstein gibt es ein Epic-Ticket und Einzeltickets mit Akzeptanzkriterien. Der aktuelle Meilenstein steht auf `Ready`, die späteren bleiben im `Backlog`, bis sie dran sind.
3. **Delegation:** Du gibst Subagents ihre Aufgaben nur über Tickets. Im Auftrag steht die Ticketnummer. Ein Subagent ohne Ticketnummer darf nicht arbeiten.
4. **Spontane Änderungen:** Jeder Agent legt dafür **vorher selbst** ein Ticket mit dem Label `unplanned` an (siehe `CLAUDE.md`). Große oder meilensteinfremde Ideen landen nur im `Backlog`.
5. **Meilenstein-Abschluss:** Ein Meilenstein ist erst fertig, wenn alle seine Tickets auf `Done` stehen, das Epic geschlossen ist und die Zusammenfassung an mich auch die `unplanned`-Tickets auflistet, die währenddessen entstanden sind.
6. **Branches und PRs:** Ein Branch und ein PR pro Ticket (oder pro kleiner Ticketgruppe, dann nennt der PR alle Nummern). Commits und PRs enthalten immer die Ticketnummer.

---

## 8. Projektstruktur

```
maxim-os-website/
├─ CLAUDE.md
├─ apps/
│  ├─ web/            # Vite + xterm.js: Terminal, Shell, Command-Handler,
│  │                  # virtuelles Dateisystem (vfs/), Persistenz, Snake, Animationen
│  └─ server/         # Fastify: Snapshot-Generator, /api/fs, /api/health, später /api/minecraft
├─ packages/
│  └─ shared/         # Command-Registry, Parser, Snapshot-Typen
├─ content/           # Inhalte für den Snapshot (öffentlich, Read-only im Container)
├─ scripts/           # ASCII-Bild-Generator
├─ docker/            # Dockerfiles
├─ docker-compose.yml        # dev und test
├─ docker-compose.prod.yml   # Production
├─ Makefile
└─ .github/workflows/ci.yml
```

---

## 9. Hosting und Übergabe

**Den Heimserver und die playit.gg-Tunnel richte ich selbst ein.** Baue dafür keine Tunnel-Container und keine Server-Konfiguration. Deine Aufgabe ist ein lauffähiges, gehärtetes Docker-Setup:

- Production-Image (Multi-Stage), Nicht-Root-User, `read_only: true`, `cap_drop: ALL`, `no-new-privileges`, Content-Ordner als Read-only-Volume.
- `docker-compose.prod.yml` startet die Website auf **einem** klar dokumentierten Port, auf den ich den Tunnel zeigen lasse.
- Konfiguration über Umgebungsvariablen mit einer `.env.example` (z. B. Minecraft-Host und -Port, Port der App, GitHub-Username). Es werden keine Secrets committed.
- Healthcheck-Endpoint und Healthcheck im Compose-File.
- Die `README.md` enthält: Voraussetzungen, Start und Stop, Update (neues Image ziehen/bauen), Inhalte aktualisieren (Content-Ordner ändern, Container neu starten), Logs, welcher Port freigegeben werden muss und welche Subdomains (`maxim-dieball.de`, `movies.`, `minecraft.`) ich im Tunnel einrichten muss.

---

## 10. Akzeptanzkriterien

- [ ] Alles (Dev, Tests, UI-Tests, Ausführen) läuft in Docker-Containern, auf dem Host ist nichts außer Docker nötig.
- [ ] Startup-Animation (Matrix) und Startscreen "MAXIM OS" funktionieren, die Animation ist überspringbar.
- [ ] `help` listet alle Commands mit Beschreibung, Usage und Beispiel (aus der Registry generiert).
- [ ] Die Seite funktioniert im Hochformat ab 360 px Breite mit dauerhaft offener Tastatur: Eingabezeile immer sichtbar, Auto-Scroll, Fokus bleibt, keine Autokorrektur, kein iOS-Zoom, Quick-Keys vorhanden.
- [ ] Schmale Varianten für Schriftzug, Steckbrief-Bild und breite Ausgaben sind vorhanden, es gibt kein horizontales Scrollen.
- [ ] Der Server liefert den Content-Ordner nur als Snapshot (`GET /api/fs`) und nimmt keine Pfade oder Commands entgegen. Der Snapshot folgt keinen Symlinks, hält seine Limits ein und enthält keine Hostpfade.
- [ ] `ls`, `cd`, `pwd`, `cat`, `tree` und die bearbeitenden Commands (`mkdir`, `touch`, `rm`, `rmdir`, `mv`, `cp`, `echo` mit `>`/`>>`) laufen im Browser auf der lokalen Kopie.
- [ ] Änderungen bleiben über einen Reload erhalten (`localStorage`), `reset` stellt das Original her, eine neue Snapshot-Version setzt die Kopie mit Hinweis zurück.
- [ ] Im Server wird nirgends ein Prozess gestartet (kein `child_process`).
- [ ] Dateinamen und Inhalte können das Terminal nicht steuern (keine Escape-Sequenzen in der Ausgabe). Das Review von Meilenstein 3 hat keine offenen Funde.
- [ ] `snake` zeigt auf Handys eine Warnung mit Abfrage (y/N) und startet standardmäßig nicht.
- [ ] `snake` läuft im Terminal, lässt sich per Ctrl+C, Esc und ✕ beenden (Mac und Windows getestet).
- [ ] `watchthis` zeigt den Ladebalken und öffnet danach `movies.maxim-dieball.de` (mit Fallback-Link).
- [ ] `minecraft` zeigt Status, Spieler und Ping, auch sauber im Offline-Fall.
- [ ] `steckbrief` zeigt GitHub-Daten (mit Fallback) und das vorgerenderte ASCII-Bild.
- [ ] CI ist grün: Lint, Typecheck, Vitest, Playwright-Regression, Build.
- [ ] Das Kanban-Board existiert, jede Änderung ist einem Ticket zugeordnet, jeder Commit und PR nennt eine Ticketnummer.
- [ ] Spontane Änderungen haben ein eigenes `unplanned`-Ticket, das vor der Arbeit angelegt wurde.
- [ ] Jeder Meilenstein ist als Tag vorhanden und wurde mir vor dem nächsten vorgestellt.
- [ ] Die README erklärt die Übergabe an meinen Server vollständig.
