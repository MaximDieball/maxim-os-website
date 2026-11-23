# Website Prompt v4: MAXIM OS

Lies zuerst die `CLAUDE.md` im Repo-Root. Sie enthält die verbindlichen Regeln zu Techstack, Architektur, Docker, Sicherheit und Entwicklung. Dieses Dokument beschreibt die Features und die Arbeitsweise.

> **v4 (Client-first):** Gegenüber v3 läuft fast alles im Browser. Der Server liefert nur noch einen Snapshot des Content-Ordners. Alle Commands arbeiten auf einer Kopie im Browser, deshalb gibt es jetzt auch bearbeitende Commands. Abschnitt 2 beschreibt das Modell, Abschnitt 5 was an Sicherheitsmaßnahmen dadurch entfällt.
>
> **v4.1 (KI-Assistent):** Ein zweiter Container hostet ein kleines Sprachmodell, das man im Terminal mit `ask` fragen kann (Abschnitt 4b). Dafür gibt es einen eigenen Meilenstein vor dem Release.

---

## 0. Ausgangslage und Arbeitsweise

- Repo **`maxim-os-website`** mit Monorepo, Docker-Setup, CI und Kanban-Board ist vorhanden.
- **Stand:** `mvp-1` (Skeleton) ist fertig. `mvp-2` (Dateisystem in der v3-Variante: Commands auf dem Server mit Pfad-Validator und Allowlist) ist gemergt und durch ein Security-Review gegangen. Es wird als historischer Stand abgeschlossen (Tag `mvp-2`) und in Meilenstein 3 auf das Client-Modell umgebaut.
- **Agile Herangehensweise:** Arbeite in den Meilensteinen aus Abschnitt 1. Nach jedem Meilenstein gilt:
  1. Alle Tests sind grün, die Pipeline-Checks laufen durch.
  2. Alle PRs des Meilensteins sind nach grüner Pipeline in `main` gemergt (das darfst du ohne Rückfrage, siehe `CLAUDE.md`, Arbeitsweise).
  3. Du gibst eine kurze Zusammenfassung (was geht jetzt, wie starte ich es, was ist als Nächstes dran, welche `unplanned`-Tickets sind entstanden).
  4. **Du hältst an und wartest auf mein OK.** Ich sehe mir den Meilenstein an. Erst danach schließt du das Epic, setzt den Tag `mvp-N` und beginnst den nächsten Meilenstein. Jeder Meilenstein ergibt ein lauffähiges MVP.
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
7. **KI-Assistent:** Spike zur Modellwahl auf der Ziel-Hardware, `llm`-Container (llama.cpp) mit GPU- und CPU-Variante, `POST /api/ask` mit Streaming, Command `ask`, Tests mit Fake-Modell, kurzes Review (Abschnitt 4b).
8. **Release-Reife:** Production-Image, `docker-compose.prod.yml` (inkl. KI-Container), Härtung, mobiler Feinschliff, README mit Übergabe-Anleitung (siehe Abschnitt 9).

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
│ ask: Fragen an den KI-Assistenten  ───────┼──POST──►│ /api/ask ──► llm (intern)     │
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

## 4b. KI-Assistent (`ask`)

Ein zweiter Container hostet ein kleines Sprachmodell. Im Terminal stellt man ihm mit `ask` Fragen, die Antwort erscheint Wort für Wort.

### Command

| Command | Flags | Beschreibung |
| --- | --- | --- |
| `ask <frage>` | `-n` | Fragt den KI-Assistenten. Die Antwort wird gestreamt. `-n` beginnt ein neues Gespräch. |

- Der Browser merkt sich die letzten 4 Frage-Antwort-Paare der Sitzung (nur im Speicher) und schickt sie als Kontext mit. `clear` leert nur den Bildschirm; den Verlauf verwerfen nur `ask -n` oder ein Neuladen der Seite.
- `Ctrl+C` bricht eine laufende Antwort ab, der Server bricht dann auch die Anfrage an das Modell ab.
- Während das Modell rechnet, zeigt das Terminal einen kurzen Hinweis (z. B. `denkt nach …`). Ist der KI-Container nicht erreichbar oder ausgelastet, kommt eine freundliche Meldung (`Der KI-Assistent ist gerade nicht erreichbar.` bzw. `… ist gerade beschäftigt, versuch es gleich nochmal.`).
- Die Antwort wird wie jede Ausgabe gefiltert (keine Escape-Sequenzen) und bricht auf schmalen Bildschirmen sinnvoll um. Umleitung mit `>` ist erlaubt (`ask ... > antwort.txt`).
- Der Assistent hat eine feste Rolle (Systemprompt auf dem Server): Er beantwortet Fragen rund um MAXIM OS, mich und meine Projekte, antwortet kurz und auf Deutsch, außer man fragt ihn in einer anderen Sprache. Er hat **keine Werkzeuge**, kann keine Commands ausführen und keine Dateien lesen. Optional bekommt er öffentliche Infos (z. B. aus `content/about/`) als Kontext im Systemprompt.

### Architektur

```
Browser ──POST /api/ask──► Fastify (app) ──HTTP, internes Netz──► llm (llama.cpp-Server)
        ◄── Text-Stream ──                ◄── Token-Stream ─────
```

- **`llm`-Container:** llama.cpp-Server (`llama-server`, OpenAI-kompatibel, `/v1/chat/completions` mit Streaming, `/health`). Ein festes GGUF-Modell aus einem Read-only-Volume. Kein veröffentlichter Port, nur im internen Docker-Netz, kein Internetzugang (`internal: true`).
- **Server-Endpunkt `POST /api/ask`** (begründet: der Browser kann das Modell nicht selbst ausführen):
  - Body: `{ messages: [{ role: 'user' | 'assistant', content: string }] }`, max. 9 Nachrichten, letzte ist `user`; User-Nachricht max. 500 Zeichen, Assistant-Nachricht max. 2000 Zeichen; strikte Validierung, unbekannte Felder abgelehnt.
  - Der Server setzt den Systemprompt davor, begrenzt die Antwort (`max_tokens` ca. 384), setzt Kontextgröße und Temperatur fest und streamt den Text als `text/plain` (chunked) zurück. Kein WebSocket.
  - **Gleichzeitigkeit:** höchstens 1 Anfrage läuft am Modell, höchstens 3 warten; sonst `503` mit „beschäftigt“. Timeout für die ganze Antwort 90 s. Bricht der Browser ab, bricht der Server die Upstream-Anfrage ab.
  - **Rate-Limit** eigenes, strengeres Limit: z. B. 10 Fragen pro Minute pro Client und 60 pro Minute global.
  - Fehler und Ausfälle des Modells ergeben generische Meldungen, nie Details aus dem Container.
  - `GET /api/ask/status` liefert `{ online: boolean }` (gecacht), damit `ask` und `help` den Zustand zeigen können.
- Ohne `llm`-Container läuft die Website vollständig weiter, nur `ask` meldet „nicht erreichbar“.

### Modellwahl für die Ziel-Hardware

Server: Intel i7-7700 (4 Kerne / 8 Threads), 11 GB RAM (davon ca. 6 GB frei), **NVIDIA GeForce GTX 1050 Ti mit 4 GB VRAM** (Pascal, Compute Capability 6.1).

- **GPU-Variante (Standard):** Das Modell muss samt KV-Cache in 4 GB VRAM passen. Das reicht für ein Modell mit **etwa 3 bis 4 Milliarden Parametern in 4-Bit-Quantisierung** (Q4_K_M, ca. 2 bis 2,6 GB Datei) bei einem Kontext von 2048 bis 4096 Tokens. Erwartet sind grob 15 bis 30 Tokens pro Sekunde; der Spike misst das.
- **CPU-Variante (Fallback):** Für den Fall, dass die GPU nicht nutzbar ist (Treiber, CUDA) oder für die Entwicklung auf dem Mac: ein Modell mit **1 bis 2 Milliarden Parametern** in Q4, ca. 1 bis 1,5 GB RAM, grob 5 bis 15 Tokens pro Sekunde auf dem i7-7700.
- **Kandidaten** (Stand der Planung, der Spike prüft die aktuelle Lage):
  - GPU: Qwen3 4B Instruct (Apache 2.0, gut mehrsprachig), Gemma 3 4B IT (gutes Deutsch, Gemma-Lizenz), Llama 3.2 3B Instruct (Llama-Community-Lizenz).
  - CPU: Qwen3 1.7B, Gemma 3 1B.
  - **Startempfehlung:** Qwen3 4B Instruct, Q4_K_M, auf der GPU; als CPU-Fallback Qwen3 1.7B. Endgültig entscheidet der Spike zusammen mit mir.
- **Achtung Pascal:** Neuere CUDA-Versionen (ab 13) und neue NVIDIA-Treiberzweige unterstützen Pascal-Karten wie die 1050 Ti nicht mehr. Das llama.cpp-Image wird deshalb auf einen **CUDA-12-Build** festgelegt, und die CPU-Variante bleibt immer lauffähig.
- **Spike (erstes Ticket des Meilensteins):** auf dem echten Server 2 bis 3 Kandidaten vergleichen. Kriterien: passt in VRAM bzw. RAM, Tokens pro Sekunde, Zeit bis zum ersten Token, Qualität auf Deutsch an 10 festen Testfragen, Lizenz. Dafür gibt es `make llm-bench`. Ergebnis in `docs/llm-spike.md`, Entscheidung durch mich.

### Betrieb und Vertrag zum Server

Trennung (abgestimmt mit dem Server-Setup, #84): **Das Repo enthält die App, das Dockerfile und generische Compose-Dateien. Server-Spezifisches (Pfade, Netze wie `llm-net`, Cron/Timer, Secrets) liegt auf dem Server in `~/stacks`, nicht im Repo.**

- **Vertrag Website → LLM:** Die Website kennt nur `LLM_URL` (Standard `http://llm:8080`) und optional `LLM_API_KEY`. Die API ist **OpenAI-kompatibel** (`POST /v1/chat/completions` mit Streaming, `GET /health`), damit auch andere Container das Modell nutzen können. Wer das LLM betreibt (Repo-Compose oder eigener Stack auf dem Server), ist der Website egal.
- **Limits im Vertrag:** Kontextlänge (z. B. 4096), parallele Anfragen (z. B. 1 Slot), maximale Antwortlänge; `llama-server` setzt sie per Startparameter (`--ctx-size`, `--parallel`, `--api-key` optional).
- **`docker-compose.llm.yml`** im Repo (optional, Referenz und lokal): zwei Profile `llm-cpu` und `llm-gpu` (GPU mit `deploy.resources.reservations.devices` für NVIDIA). Man kann auf dem Server erst mit CPU anfangen.
- **Modell-Doku statt Modell im Repo:** `docs/llm-model.md` nennt Modell, Quantisierung, Download-Quelle, **SHA-256-Prüfsumme** und den Bedarf an RAM/VRAM, **ausdrücklich neben Minecraft** (auf dem Server sind ca. 6 GB RAM frei). `make llm-model` lädt das Modell mit dieser URL und Prüfsumme in ein Volume; das Modell liegt nie im Image oder Repo.
- **Unabhängigkeit:** `/api/health` hängt nie vom LLM oder Minecraft ab. Die Website läuft normal, wenn das LLM aus ist oder noch fehlt (`ask` meldet dann „nicht erreichbar“).
- Limits für den LLM-Container: Speicher (z. B. 5 GB), CPU (z. B. 6 von 8 Threads), damit Website und Minecraft-Server flüssig bleiben.

### Tests

- Vitest: `/api/ask` gegen einen **Fake-Upstream** (streamt feste Tokens): Validierung, Limits, Warteschlange, Timeout, Abbruch, Ausfall, keine Details im Fehlerfall.
- Playwright: gegen einen kleinen **Stub-Container** (OpenAI-kompatibel, feste Antwort) statt des echten Modells, damit die CI kein Modell braucht. Geprüft: Streaming-Ausgabe, Ctrl+C, Offline-Meldung, Umbruch auf 360 px, keine Escape-Sequenzen aus der Antwort.
- Das echte Modell wird nur im Spike und manuell auf dem Server getestet.

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
- **KI-Assistent:** `llm`-Container nur im internen Netz und ohne Internetzugang, keine Werkzeuge und keine Secrets im Modellkontext, fester Systemprompt auf dem Server, harte Limits (Eingabelänge, Antwort-Tokens, Zeit, Warteschlange, eigenes Rate-Limit), Antworten werden wie alle Ausgaben gefiltert. Prompt-Injection gegen das Modell ist möglich, kann aber nichts auslösen außer Text: Das Modell hat keinen Zugriff auf irgendetwas.

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

1. **Board und Labels** sind eingerichtet (`Backlog`, `Ready`, `In Progress`, `In Review`, `Done`; Labels `feature`, `bug`, `test`, `security`, `docs`, `chore`, `unplanned`, `epic`). Für v4 kamen `mvp-7` (KI-Assistent) und `mvp-8` (Release) dazu.
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
│  └─ server/         # Fastify: Snapshot-Generator, /api/fs, /api/health, später /api/minecraft, /api/ask
├─ packages/
│  └─ shared/         # Command-Registry, Parser, Snapshot-Typen
├─ content/           # Inhalte für den Snapshot (öffentlich, Read-only im Container)
├─ scripts/           # ASCII-Bild-Generator
├─ docker/            # Dockerfiles, llm/ (Modell-Download, Bench), llm-stub/ (Fake-Modell für Tests)
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
- `docker-compose.prod.yml` enthält **nur die Website**. Das LLM kommt über `docker-compose.llm.yml` oder einen eigenen Stack auf dem Server dazu (Abschnitt 4b).
- Konfiguration über Umgebungsvariablen mit einer `.env.example`, die **alle** Variablen enthält: Port der App, `LLM_URL`, `LLM_API_KEY` (optional), Minecraft-Host und -Port (mvp-6), GitHub-Username, Modell-Einstellungen für `docker-compose.llm.yml`. Es werden keine Secrets committed.
- **Build-Version:** Das Image bekommt den Commit per Build-Arg (`docker build --build-arg GIT_COMMIT=$(git rev-parse HEAD) ...`). `GET /api/health` liefert `{ "status": "ok", "version": "<commit>" }`, damit ein Deploy-Skript prüfen kann, dass wirklich der neue Stand läuft (#83).
- KI-Container: GPU-Variante braucht auf dem Server einen NVIDIA-Treiber mit Pascal-Unterstützung und das NVIDIA Container Toolkit (richte ich selbst ein, die README beschreibt es). Die CPU-Variante läuft ohne GPU. Der KI-Container bekommt **keinen** eigenen Port im Tunnel.
- Healthcheck-Endpoint und Healthcheck im Compose-File.
- Die `README.md` enthält: Voraussetzungen, Start und Stop, Update (neues Image ziehen/bauen), Inhalte aktualisieren (Content-Ordner ändern, Container neu starten), KI-Modell herunterladen und wechseln, GPU- vs. CPU-Variante, Logs, welcher Port freigegeben werden muss und welche Subdomains (`maxim-dieball.de`, `movies.`, `minecraft.`) ich im Tunnel einrichten muss.

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
- [ ] `ask` beantwortet Fragen über den `llm`-Container mit gestreamter Antwort, Ctrl+C bricht ab, ohne Container kommt eine freundliche Meldung. Das Modell läuft auf der Ziel-Hardware (GPU-Variante, CPU-Fallback), der Spike ist dokumentiert.
- [ ] Der `llm`-Container ist nicht von außen erreichbar, hat keinen Internetzugang und harte Limits; das Review des KI-Endpunkts hat keine offenen Funde.
- [ ] CI ist grün: Lint, Typecheck, Vitest, Playwright-Regression, Build.
- [ ] Das Kanban-Board existiert, jede Änderung ist einem Ticket zugeordnet, jeder Commit und PR nennt eine Ticketnummer.
- [ ] Spontane Änderungen haben ein eigenes `unplanned`-Ticket, das vor der Arbeit angelegt wurde.
- [ ] Jeder Meilenstein ist als Tag vorhanden und wurde mir vor dem nächsten vorgestellt.
- [ ] Die README erklärt die Übergabe an meinen Server vollständig.
