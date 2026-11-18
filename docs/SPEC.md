# Website Prompt v3: MAXIM OS

Lies zuerst die `CLAUDE.md` im Repo-Root. Sie enthält die verbindlichen Regeln zu Techstack, Docker, Sicherheit und Entwicklung. Dieser Prompt beschreibt die Features und die Arbeitsweise.

---

## 0. Ausgangslage und Arbeitsweise

- Das GitHub-Repo **`maxim-os-website`** existiert bereits, ist aber leer. Nutze es (klonen, nicht neu anlegen). Lege darin eine sinnvolle Struktur an.
- **Starte im Plan-Mode.** Lege mir zuerst einen Plan vor: Projektstruktur, Docker-Setup und Meilensteine mit Akzeptanzkriterien. Beginne erst nach meiner Freigabe mit Code.
- **Agile Herangehensweise:** Arbeite in den Meilensteinen aus Abschnitt 1. Nach jedem Meilenstein gilt:
  1. Alle Tests sind grün, die Pipeline-Checks laufen durch.
  2. Es gibt einen Commit (und ein Tag `mvp-N`), der Push erfolgt nur bei grüner Pipeline.
  3. Du gibst eine kurze Zusammenfassung (was geht jetzt, wie starte ich es, was ist als Nächstes dran).
  4. **Du hältst an und wartest auf mein Feedback**, bevor du den nächsten Meilenstein beginnst. Jeder Meilenstein ergibt ein lauffähiges MVP.
- **Subagents:**
  - Meilenstein 1 und 2 baust du selbst und sequenziell. Das Fundament (Typen, Command-Registry, Pfad-Validator) muss konsistent und sicher sein.
  - Ab Meilenstein 3 darfst du unabhängige Teile parallel an Subagents geben (z. B. Snake, Minecraft-Status, ASCII-Generator, CI-Feinschliff). Vorher definierst du die Schnittstellen (Typen im `shared`-Paket, Registry-Eintrag), damit nichts kollidiert.
  - Nach Meilenstein 2 startest du einen **separaten Review-Subagent**, der den Pfad-Validator und die FS-Commands gezielt angreift (Traversal, Symlinks, Encoding, Null-Bytes, überlange Pfade, unerlaubte Flags). Er hat den Code nicht geschrieben. Gefundene Lücken werden zuerst als Test festgehalten, dann behoben.
- Alles (Entwicklung, Tests, UI-Tests, Ausführen) läuft **in Docker-Containern**, siehe `CLAUDE.md`.
- **Ohne Ticket wird nichts gemacht.** Die Ticket-Regel aus der `CLAUDE.md` gilt für dich und alle Subagents, siehe Abschnitt 7a.

---

## 1. Meilensteine

1. **Skeleton:** Monorepo, Docker-Setup, CI-Pipeline, Startup-Animation, Startscreen, Command-Registry, `help`, `clear`, Fehlermeldung für unbekannte Commands.
2. **Dateisystem:** Content-Ordner, Allowlist-Generator, Pfad-Validator, `ls`, `cd`, `pwd`, `cat`, `tree`, Rate-Limiting und Eingabe-Limits. Danach der Review-Subagent.
3. **Steckbrief:** `steckbrief` mit GitHub-Daten und vorgerendertem ASCII-Bild, dazu `about`, `whoami`, `projects`.
4. **Spiele und Links:** `snake` und `watchthis`.
5. **Minecraft:** `minecraft`-Übersicht mit Status, Spielern und Ping.
6. **Release-Reife:** Production-Image, `docker-compose.prod.yml`, Härtung, README mit Übergabe-Anleitung (siehe Abschnitt 9).

---

## 2. Grundkonzept und Sicherheitsmodell

Auf dem Server liegt eine echte Ordnerstruktur (der "Content-Ordner"). Die Website simuliert darauf ein Dateisystem. Der User sieht sein aktuelles Verzeichnis, kann aber nie aus dem Content-Ordner ausbrechen.

Zentrale Regeln:

1. Der User führt **keine echten Commands** aus. Es gibt eine feste Menge erlaubter Commands.
2. **Es werden niemals Prozesse gestartet.** Kein `exec`, `spawn`, `child_process`, keine Shell. Die Dateisystem-Commands werden im Server **selbst implementiert**, mit `fs.readdir`, `fs.readFile` und `fs.stat`. Es werden keine Parameter an echte Programme durchgereicht.
3. Der User kann das Dateisystem **nur ansehen**, nie verändern.
4. Unbekannte oder nicht explizit erlaubte Flags und Parameter werden mit einer klaren Fehlermeldung abgelehnt (Allowlist, nicht Blocklist).
5. Custom Commands (`snake`, `watchthis`, `minecraft`, `help` usw.) existieren **nicht** auf dem Server. Sie werden vom Frontend simuliert. So braucht der User keine Rechte, Dateien auszuführen.

### Pfad-Validierung (bei jedem Command)

1. Der eingegebene Pfad wird relativ zum aktuellen Verzeichnis in einen **absoluten Pfad** aufgelöst.
2. Der Pfad wird mit `fs.realpath` aufgelöst, damit Symlinks keine Umgehung erlauben.
3. Der Pfad wird gegen die **Allowlist** geprüft. Die Allowlist ist die Menge aller Pfade innerhalb des Content-Ordners. Sie wird beim Serverstart einmal generiert, als Pfad zum Content-Ordner kombiniert mit allen Pfaden darin, und nur im Speicher gehalten. Spätere Commands (`cat`, `cd`, `tree` ...) nutzen dieselbe Allowlist.
4. Erst danach wird der Command wirklich ausgeführt.
5. Alles außerhalb der Allowlist wird abgelehnt (`..`-Tricks, absolute Pfade, URL-Encoding, Null-Bytes, Symlinks, überlange Pfade).

### Zustand

Der Client trackt das aktuelle Verzeichnis (relativ zur simulierten Root `/`) und schickt es bei jedem Request mit. Der Server ist stateless und **validiert das Verzeichnis bei jedem Request neu**. Der Server leakt nie echte Hostpfade, die Ausgabe zeigt nur simulierte Pfade.

---

## 3. Startup

Beim Laden der Seite läuft eine Animation. ASCII-Zeichen laufen "Matrix-mäßig" von oben nach unten, danach erscheint der erste Screen.

Der erste Screen enthält:

- oben einen ASCII-Schriftzug **"MAXIM OS"**
- darunter die Unterschrift **"an ai coding project"**
- einen Hinweis, `help` oder `steckbrief` auszuführen

Die Animation ist überspringbar (beliebige Taste/Klick) und respektiert `prefers-reduced-motion`.

---

## 4. Commands

Alle Commands stehen in einer zentralen **Command-Registry**. Jeder Eintrag enthält: Name, Aliase, Beschreibung, Benutzung (Usage), Beispiel und Handler (client- oder serverseitig). `help` wird automatisch aus dieser Registry generiert.

### help

Gibt eine Liste aller Commands aus, jeweils mit Beschreibung, Benutzung und Beispiel.

### ls (serverseitig)

Zeigt das simulierte Dateisystem an, das wirklich auf dem Server existiert. Pfad-Validierung wie in Abschnitt 2. Erlaubte Flags in v1: nur `-l` und `-a`, alles andere wird abgelehnt.

### cd, pwd, cat, tree (serverseitig)

Gleiche Validierung und Allowlist wie `ls`. Nur lesend. `cat` hat ein Größenlimit und gibt nur Textdateien aus.

### snake (clientseitig)

Ein Snake-Spiel, das mit dem Command gestartet und gespielt wird. Es ist komplett im Frontend implementiert und existiert nicht als Datei auf dem Server.

- Es läuft im Terminal im ASCII-Stil. Während des Spiels wird nichts anderes im Terminal angezeigt.
- Steuerung per Pfeiltasten und WASD, auf Mobilgeräten per Swipe oder On-Screen-Buttons.
- **Beenden:** `Ctrl+C` und `Esc`. Das muss auf Mac und Windows mit verschiedenen Tastaturlayouts funktionieren. Auf Mac ist die Taste `Ctrl` (nicht `Cmd`). Browser-Kollisionen mit Copy (Windows) beachten und im Spielmodus abfangen. Zusätzlich gibt es **oben links ein ✕**, mit dem man das Spiel verlässt.
- Zeige Score und Highscore (lokal, im `localStorage`).

### watchthis (Aliase: `wt`, `WatchThis`)

Zeigt eine Boot-Animation mit einem ASCII-Ladebalken. Danach öffnet die Website selbst einen neuen Tab mit `https://movies.maxim-dieball.de`. Es wird kein echtes Programm ausgeführt. Manche Browser blockieren `window.open` ohne User-Geste, biete daher einen anklickbaren Link im Terminal als Fallback an.

### minecraft

Zeigt eine kleine Übersicht meines Minecraft-Servers (Adresse `minecraft.maxim-dieball.de`): Online-Status, Spielerzahl, Spielerliste, Version, MOTD und Ping. Dafür nutzt du bestehende Möglichkeiten wie den Server-List-Ping (`minecraft-server-util`). Der Backend-Endpoint cached die Antwort einige Sekunden und hat ein Timeout. Die Serveradresse und der Port kommen aus Umgebungsvariablen. Wenn der Server offline ist, wird das freundlich angezeigt.

### steckbrief

Zeigt einen Steckbrief von mir. Die Daten kommen vorerst von GitHub (Profil, Repos), gecached oder zur Buildzeit geholt. Oben steht ein Bild von mir, **vorab in ASCII-Zeichen gerendert** und als Textdatei ausgeliefert (ich stelle das Foto bereit, bis dahin ein Platzhalter).

### Weitere Basis-Commands (clientseitig)

`clear`, `projects` (Liste meiner Projekte mit Links, Anzeige im Terminal oder neuer Tab), `about`, `whoami`, `history`. Unbekannte Commands geben `command not found: <name>. Tippe 'help'.` aus.

### Terminal-UX

Tab-Completion für Commands und Pfade, Pfeil hoch/runter für die History, Ctrl+L für `clear`, bedienbar auf Mobile (virtuelle Tastatur) und per Screenreader (ARIA-Live-Region für die Ausgabe).

---

## 5. Härtung des Backends

- Rate-Limiting (z. B. `@fastify/rate-limit`) pro IP. Da ein Tunnel die echte IP evtl. nicht durchreicht, ist das Limit zusätzlich global gesetzt.
- Eingabe-Limits: maximale Länge des Command-Strings, maximale Anzahl Argumente, maximale Größe von Ausgabe und Dateien.
- Strikte Schema-Validierung des Request-Bodys.
- Sicherheits-Header (CSP, `X-Content-Type-Options`, `Referrer-Policy`), z. B. über `@fastify/helmet`.
- Keine Stacktraces oder Hostpfade in Fehlerantworten.

---

## 6. Development Guidelines

- **Test-driven development:** zuerst der Test, dann die Implementierung. Besonders gründlich beim Pfad-Validator und beim Command-Parser.
- **Unit/API-Tests** mit Vitest, im Container.
- **UI-Tests mit Playwright, die Screenshots erzeugen.** Du schaust sie dir als Entwickler an, um das UI zu prüfen. Sie laufen lokal im Playwright-Container und **nicht** in der Pipeline. Die Screenshots landen in einem git-ignorierten Ordner.
- **In der Pipeline** laufen nur UI-Tests, die per `toHaveScreenshot()` prüfen, dass sich nichts verändert hat, was eigentlich unverändert bleiben sollte.
- Die Baselines werden ausschließlich im Playwright-Container erzeugt, damit lokal und in der CI identisch gerendert wird.

---

## 7. GitHub

- Repo: **`maxim-os-website`** (existiert, leer).
- Vor jedem Push läuft die Test-Pipeline (GitHub Actions): Lint, Typecheck, Vitest, Playwright-Regression, Build. Die CI nutzt dieselben Container wie die lokale Entwicklung.
- Ein lokaler Pre-push-Hook (z. B. via `husky`) führt mindestens Lint, Typecheck und Unit-Tests aus, ebenfalls im Container.
- `main` ist nur mit grüner Pipeline mergebar. Pro Meilenstein ein Tag (`mvp-1`, `mvp-2`, ...).

---

## 7a. Ticketsystem (GitHub Kanban)

Jede Arbeit läuft über Tickets auf einem **GitHub-Projects-Kanban-Board** des Repos. Die vollständigen Regeln stehen in der `CLAUDE.md`. Für dich als Overseer-Agent bedeutet das:

1. **Setup (vor dem ersten Code, in Meilenstein 1):** Prüfe, ob `gh` eingeloggt ist und die nötigen Rechte für Projects hat. Falls nicht, sag mir, was ich tun muss. Lege das Board mit den Spalten `Backlog`, `Ready`, `In Progress`, `In Review`, `Done` an, außerdem die Labels (`feature`, `bug`, `test`, `security`, `docs`, `chore`, `unplanned`) und die Meilensteine `mvp-1` bis `mvp-6`.
2. **Planung:** Nach meiner Freigabe des Plans legst du zu jedem Meilenstein ein Epic-Ticket und die Einzeltickets mit Akzeptanzkriterien an. Meilenstein 1 kommt auf `Ready`, die späteren bleiben im `Backlog`, bis sie dran sind.
3. **Delegation:** Du gibst Subagents ihre Aufgaben nur über Tickets. Im Auftrag steht die Ticketnummer. Ein Subagent ohne Ticketnummer darf nicht arbeiten.
4. **Spontane Änderungen:** Jeder Agent legt dafür **vorher selbst** ein Ticket mit dem Label `unplanned` an (siehe `CLAUDE.md`). Große oder meilensteinfremde Ideen landen nur im `Backlog`.
5. **Meilenstein-Abschluss:** Ein Meilenstein ist erst fertig, wenn alle seine Tickets auf `Done` stehen, das Epic geschlossen ist und die Zusammenfassung an mich auch die `unplanned`-Tickets auflistet, die währenddessen entstanden sind.
6. **Branches und PRs:** Ein Branch und ein PR pro Ticket (oder pro kleiner Ticketgruppe, dann nennt der PR alle Nummern). Commits und PRs enthalten immer die Ticketnummer.

---

## 8. Projektstruktur (Vorschlag, du darfst mit Begründung abweichen)

```
maxim-os-website/
├─ CLAUDE.md
├─ apps/
│  ├─ web/            # Vite + xterm.js, Command-Registry (Client), Snake, Animationen
│  └─ server/         # Fastify, Pfad-Validator, FS-Commands, Minecraft-Status
├─ packages/
│  └─ shared/         # Typen und Command-Schema für Client und Server
├─ content/           # simulierte Ordnerstruktur (Read-only im Container)
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
- Die `README.md` enthält: Voraussetzungen, Start und Stop, Update (neues Image ziehen/bauen), Logs, welcher Port freigegeben werden muss und welche Subdomains (`maxim-dieball.de`, `movies.`, `minecraft.`) ich im Tunnel einrichten muss.

---

## 10. Akzeptanzkriterien

- [ ] Alles (Dev, Tests, UI-Tests, Ausführen) läuft in Docker-Containern, auf dem Host ist nichts außer Docker nötig.
- [ ] Startup-Animation (Matrix) und Startscreen "MAXIM OS" funktionieren, die Animation ist überspringbar.
- [ ] `help` listet alle Commands mit Beschreibung, Usage und Beispiel (aus der Registry generiert).
- [ ] `ls`, `cd`, `pwd`, `cat`, `tree` arbeiten nur innerhalb des Content-Ordners. Alle Traversal- und Symlink-Tests schlagen erwartungsgemäß fehl, der Review-Subagent hat keine offenen Funde.
- [ ] Im Server wird nirgends ein Prozess gestartet (kein `child_process`).
- [ ] `snake` läuft im Terminal, lässt sich per Ctrl+C, Esc und ✕ beenden (Mac und Windows getestet).
- [ ] `watchthis` zeigt den Ladebalken und öffnet danach `movies.maxim-dieball.de` (mit Fallback-Link).
- [ ] `minecraft` zeigt Status, Spieler und Ping, auch sauber im Offline-Fall.
- [ ] `steckbrief` zeigt GitHub-Daten und das vorgerenderte ASCII-Bild.
- [ ] CI ist grün: Lint, Typecheck, Vitest, Playwright-Regression, Build.
- [ ] Das Kanban-Board existiert, jede Änderung ist einem Ticket zugeordnet, jeder Commit und PR nennt eine Ticketnummer.
- [ ] Spontane Änderungen haben ein eigenes `unplanned`-Ticket, das vor der Arbeit angelegt wurde.
- [ ] Jeder Meilenstein ist als Tag vorhanden und wurde mir vor dem nächsten vorgestellt.
- [ ] Die README erklärt die Übergabe an meinen Server vollständig.
