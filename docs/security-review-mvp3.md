# Security-Review MVP 3 (#66): Snapshot-Generator und Terminal-Ausgabe

Unabhängiges, kurzes Review nach SPEC v4, Abschnitte 0, 2 und 5. Branch `security/66-review`.
Der Implementierungscode wurde nicht geändert. Neue Tests:

- `apps/server/src/review-mvp3.test.ts` (19 Tests): Snapshot-Generator, `GET /api/fs`, statische Dateien
- `apps/web/src/review-mvp3.test.ts` (14 Tests): Terminal-Ausgabe, lokale Kopie, `localStorage`, HTML

Grüne Tests sind Regressionstests für abgewehrte Angriffe. Tests mit `[FINDING-n]` erwarten das
sichere Sollverhalten und schlagen fehl, solange der Fund besteht.

## Umfang

- `apps/server/src/snapshot.ts`, `apps/server/src/app.ts`, `apps/server/src/index.ts`
- `packages/shared/src/snapshot.ts`, `packages/shared/src/parse.ts`
- `apps/web/src/shell/{shell,commands,format,text}.ts`, `apps/web/src/terminal/{term,prompt-line,native-input,live}.ts`,
  `apps/web/src/vfs/{vfs,workspace,load}.ts`

## Geprüfte Klassen

| Klasse                                                                                                                       | Ergebnis                                            | Test                                                                        |
| ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | --------------------------------------------------------------------------- |
| Symlinks: nach außen, absolut, Ketten, Schleifen, Ordner-Symlinks, Root-Kind, tief im Baum, auf `/`, `/etc/passwd`, dangling | abgewehrt (nie gefolgt, nie gelistet)               | `ignores symlinks at any depth …` (+ bestehende Tests)                      |
| Sonderdateien (Unix-Socket)                                                                                                  | abgewehrt                                           | `ignores unix sockets`                                                      |
| Namen mit C0, DEL, C1, `\n`, `\t`, `\r`, OSC, RTL-Override, Isolates, LRM/RLM, Backslash                                     | abgewehrt                                           | `skips names with control characters …`                                     |
| Name mit U+061C (Arabic Letter Mark, Bidi-Steuerzeichen)                                                                     | **Fund**                                            | `[FINDING-2] …` (Server und Web)                                            |
| Name, der kein gültiges UTF-8 ist                                                                                            | **Fund**                                            | `[FINDING-1] …`                                                             |
| Skip-Log ohne Hostpfade und ohne den ungültigen Namen                                                                        | ok                                                  | `never reports the invalid name itself …`                                   |
| Binärerkennung: Null-Byte, Overlong, Surrogate, einzelnes Folgebyte, abgeschnittene Sequenz                                  | ok (`binary: true`, kein Inhalt)                    | `treats null bytes and invalid UTF-8 …`                                     |
| BOM, Emoji, leere Datei                                                                                                      | ok (Text, BOM entfernt)                             | `keeps valid UTF-8 …`                                                       |
| Limits genau an der Grenze (Dateigröße, Gesamtgröße, Einträge inkl. 0, Tiefe) und Standardwerte                              | ok                                                  | `review #66: snapshot limits at the boundary`                               |
| Hostpfade/Stacktraces in Antworten (kaputte URL, `%00`, kaputtes JSON, zu großer Body)                                       | ok                                                  | `returns errors without stack traces …`                                     |
| Eingaben an `/api/fs` (Query, Pfad-Suffix), andere Methoden, `/api/command`, `/api/complete`                                 | ok (alles 404 bzw. unveränderter Snapshot)          | `does not process input …`, `only allows GET/HEAD …`                        |
| ETag/304: nur exakte Version, nie Body bei 304                                                                               | ok                                                  | `answers 304 only for the exact ETag …`                                     |
| Rate-Limit-Umgehung über `X-Forwarded-For`, `X-Real-IP`, `Forwarded`, `CF-Connecting-IP` u. a.                               | abgewehrt (globaler Schlüssel, `trustProxy: false`) | `has a global rate limit …`                                                 |
| Statische Dateien: Traversal (`..`, `%2e%2e`, `%2f`, `\`), `%00`, Dotfiles                                                   | abgewehrt                                           | `serves nothing outside the public folder …`                                |
| Terminal: Escape/OSC/CSI/C1/DCS/Bidi aus Snapshot-Namen und -Inhalten (`ls`, `ls -l/-a`, `tree`, `cat`, breit und schmal)    | abgewehrt                                           | `drops snapshot entries …`, `never prints escape …`                         |
| Terminal: Umleitung `>`/`>>` schreibt keine Steuerzeichen in Dateien                                                         | ok                                                  | `keeps escape sequences out of files …`                                     |
| Terminal: eigene Namen/Inhalte (`mkdir`, `mkdir -p`, `touch`, `echo >`, `cp`, `mv`)                                          | abgewehrt (Eingabe bereinigt, Namen geprüft)        | `never creates names with control …`, `rejects such names when resolving …` |
| Terminal: Eingaben in Fehlermeldungen, Tab-Completion, `error()`/`fsError()` direkt, Prompt (`clean`)                        | abgewehrt                                           | `review #66: input echoed in error messages`                                |
| Manipulierter `localStorage`: Namen, Inhalte, `mtime`                                                                        | abgewehrt                                           | `drops bad names and filters content …`                                     |
| Manipulierter `localStorage`: `size` einer Binärdatei                                                                        | **Fund**                                            | `[FINDING-3] …`                                                             |
| Lokale Kopie: Pfadlimit 1024 über `cp -r`/`mv`                                                                               | **Fund (Info)**                                     | `[FINDING-4] …`                                                             |
| HTML-Injection (`innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `DOMParser`, `srcdoc`)                     | nicht vorhanden; Live-Region nutzt `textContent`    | `never assigns HTML strings to the DOM …`                                   |

## Funde

### FINDING-1: Ein Dateiname ohne gültiges UTF-8 verhindert den Serverstart (niedrig)

- **Beschreibung:** Node liest einen Namen wie `0xE4 ".txt"` (Latin-1 `ä.txt`) als `"�.txt"`. Dieser
  Name ist laut `isValidName` gültig, `stat(join(real, name))` findet den Pfad aber nicht (`ENOENT`).
  Die Exception bricht `buildSnapshot` komplett ab, der Server startet nicht. Dasselbe gilt für jede
  andere Exception pro Eintrag (z. B. `EACCES` bei einer Datei, die der Nicht-Root-User im Container
  nicht lesen darf; als root im Test-Container nicht reproduzierbar). Kein Datenleck, aber die
  Verfügbarkeit hängt an einem einzelnen Eintrag. Typischer Auslöser: ein entpacktes ZIP mit Latin-1-Namen.
- **Reproduktion:** Datei mit Namen `Buffer.from([0xe4, ...'.txt'])` in den Content-Ordner legen,
  `buildSnapshot` aufrufen → `ENOENT`.
- **Behebung:** `readdir(real, { withFileTypes: true, encoding: 'buffer' })` und Namen mit
  `new TextDecoder('utf-8', { fatal: true })` prüfen (ungültig → überspringen und loggen). Zusätzlich
  `stat`/`readFile` pro Eintrag in `try/catch`, Fehler als `skip(path, 'nicht lesbar')` loggen.
  Gern auch `lstat` statt `stat`, damit kein Symlink zwischen `readdir` und `stat` verfolgt wird.
- **Test:** `[FINDING-1] skips entries whose name is not valid UTF-8 instead of failing`
- **Status:** Behoben in `apps/server/src/snapshot.ts`: Namen werden als Bytes gelesen und streng als UTF-8 dekodiert (sonst übersprungen), Fehler pro Eintrag (`lstat`, `readFile`) überspringen nur diesen Eintrag.

### FINDING-2: Bidi-Steuerzeichen U+061C wird nicht gefiltert (niedrig)

- **Beschreibung:** Die Filter (`CONTROL_CHARS` in `parse.ts`, `CONTROL` in `text.ts` und `format.ts`)
  decken die Bidi-Zeichen U+200E/F, U+202A–U+202E und U+2066–U+2069 ab, aber nicht U+061C (Arabic Letter
  Mark), das einzige weitere Zeichen mit der Unicode-Eigenschaft `Bidi_Control`. Es kommt über
  Snapshot-Namen, Inhalte (`cat`) und Eingaben ins Terminal. xterm.js rendert kein Bidi, die
  Auswirkung im Terminal ist gering. In kopiertem Text und in der Screenreader-Live-Region kann es die
  Leserichtung beeinflussen. Verstößt gegen SPEC 5 („Steuer- und Escape-Zeichen … werden entfernt“).
- **Reproduktion:** Datei `alm؜name.txt` im Content-Ordner → steht im Snapshot; `cat` einer Datei mit
  `a؜b` → Zeichen landet im Terminal.
- **Behebung:** `؜` in alle drei Regexe aufnehmen, am besten eine gemeinsame Konstante in `shared`
  statt drei Kopien (die Web-Variante in `format.ts` lässt bewusst `\t` und `\n` durch).
- **Tests:** `[FINDING-2] skips names with the bidi control U+061C (Arabic letter mark)` (Server),
  `[FINDING-2] removes the bidi control U+061C (Arabic letter mark) from output` (Web)
- **Status:** Behoben: U+061C steht jetzt in allen drei Filtern (`packages/shared/src/parse.ts`, `apps/web/src/shell/text.ts`, `apps/web/src/shell/format.ts`).

### FINDING-3: `size` einer Binärdatei aus dem `localStorage` geht ungeprüft ins Terminal (Info)

- **Beschreibung:** `fromFsNode` übernimmt `size` bei Binärdateien ohne Typprüfung. `formatSize` vergleicht
  `bytes < 1000` (JS wandelt Strings dabei in Zahlen um und ignoriert Leerraum) und gibt dann `String(bytes)`
  aus. Ein String wie `"\r\n\v\f5"` erscheint so in `ls -l` und erzeugt CR/LF/VT/FF (Zeilen
  überschreiben, Ausgabe fälschen). ESC/C1 sind nicht möglich (der Wert wäre dann `NaN`). Nur der User
  selbst kann seinen `localStorage` so verändern, daher Info.
- **Reproduktion:** `localStorage['maxim-os:fs:v1']` mit `{ base: <version>, root: { …, children: [{ type: 'file',
name: 'x.bin', size: "\r\n\u000b\f5", binary: true, … }] } }` setzen, Seite laden, `ls -l`.
- **Behebung:** In `fromFsNode` `size` nur übernehmen, wenn `Number.isSafeInteger(size) && size >= 0`,
  sonst `0`. Allgemein den gespeicherten Baum beim Laden strikt validieren (Typen von `name`, `text`,
  `mtime`, `children`).
- **Test:** `[FINDING-3] does not print control characters from a stored binary file size`
- **Status:** Behoben in `apps/web/src/vfs/vfs.ts`: `size` wird nur übernommen, wenn es eine gültige nicht-negative Ganzzahl ist, sonst 0.

### FINDING-4: Pfadlimit 1024 lässt sich mit `cp -r` und `mv` umgehen (Info)

- **Beschreibung:** Die Pfadlänge wird nur in `resolve` geprüft. Wird ein tiefer Ordner (Pfad knapp unter 1024) mit `cp -r` oder `mv` unter einen anderen Ordner gelegt, entstehen Pfade über 1024 Zeichen, die
  danach per Pfad nicht mehr erreichbar sind (`Pfad zu lang`). Betrifft nur die eigene Kopie; SPEC
  verlangt das Limit aber.
- **Reproduktion:** `mkdir -p` mit fünf Ebenen à 200 Zeichen (Pfad 1005), `mkdir` eines Ordners mit 200
  Zeichen, `cp -r` (oder `mv`) des ersten Ordners hinein → längster Pfad 1206.
- **Behebung:** In `checkTransfer` die längste Pfadlänge des Quell-Teilbaums unter dem Ziel berechnen
  und bei mehr als `NAME_LIMITS.path` mit `MSG.pathTooLong` ablehnen.
- **Test:** `[FINDING-4] keeps the 1024-character path limit when moving or copying folders`
- **Status:** Behoben in `apps/web/src/vfs/vfs.ts`: `checkTransfer` prüft die längste Pfadlänge des verschobenen bzw. kopierten Teilbaums gegen das Limit.

## Nicht-Funde / bewusste Entscheidungen

- **Rohtext im Snapshot:** Der Server liefert Inhalte mit Escape-Zeichen unverändert aus; gefiltert wird
  bei der Ausgabe im Browser (`clean`, `printable`, `sanitizeInput`). Das ist so dokumentiert und an
  allen Ausgabestellen umgesetzt (Ausgaben laufen alle über `formatLs`/`formatTree`/`formatCat`/`error`,
  `echo` und `pwd` bekommen nur bereits bereinigte bzw. validierte Werte).
- **Prompt-Zeile:** `renderPromptLine` filtert selbst nicht, der Wert des `<input>` wird aber bei jedem
  `input`-Event und beim Einfügen mit `sanitizeInput` bereinigt; `promptFor` nutzt `clean`.
- **`Vfs.writeText` & Co. prüfen Namen nicht selbst**, sondern erwarten einen Pfad aus `resolve`. Alle
  Aufrufer halten das ein. Hinweis für spätere Commands: immer über `resolve` gehen.
- **Unsichtbare, aber keine Steuerzeichen** (U+200B Zero-Width-Space, U+00AD, U+FEFF, U+2028/U+2029) in
  Namen sind erlaubt, SPEC verlangt keinen Filter. Sie erlauben nur gleich aussehende Namen; der Content
  gehört dem Besitzer, eigene Namen betreffen nur den User. xterm.js wertet U+2028/U+2029 nicht als
  Zeilenumbruch.
- **Hardlinks** im Content-Ordner sind reguläre Dateien und werden ausgeliefert. Sie können nur vom
  Besitzer und nur innerhalb desselben Dateisystems angelegt werden; der Content-Ordner ist read-only
  gemountet. Kein Test, da kein Angreiferpfad.
- **TOCTOU zwischen `readdir` und `stat`/`readFile`** (die Symlinks folgen): nur durch Schreibzugriff auf
  den Content-Ordner ausnutzbar, also durch den Besitzer. Im Container ist der Ordner read-only. Die
  Umstellung auf `lstat` (siehe FINDING-1) schließt das zusätzlich.
- **Gesamtgröße 2 MB** zählt Rohbytes der Texte, nicht die JSON-Antwort; JSON-Escaping und Metadaten
  können die Antwort größer machen. Inhalt ist vom Besitzer, kein Risiko.
- **Snapshot-Limit (2 MB) > Limit der lokalen Kopie (1 MB):** so in der SPEC. Liegt der Content über
  1 MB, kann der User keine neuen Bytes anlegen. Funktional, kein Sicherheitsproblem.
- **Limits beim Laden aus `localStorage`** werden nicht erneut geprüft (mehr als 2000 Einträge oder 1 MB
  möglich). SPEC 5: Schutz der lokalen Kopie vor dem User entfällt.
- **Globales Rate-Limit:** Ein einzelner Client kann das Limit für alle ausschöpfen. Bewusst so (SPEC 5),
  da der Tunnel keine echte Client-IP liefert; Snapshot ist gecached.
- **Schwache ETags / Listen in `If-None-Match`** führen zu `200` statt `304`. Nur Performance.
- **FIFOs/Gerätedateien** lassen sich ohne Prozessstart bzw. root nicht im Test anlegen; der Code lässt
  nur `isDirectory() || isFile()` zu, das deckt sie ab (Unix-Socket als Stellvertreter getestet).
- **Namen über 255 Zeichen** können unter Linux nicht entstehen (max. 255 Bytes); `isValidName` prüft das
  zusätzlich, bestehende Unit-Tests decken es ab.

## Status

Alle vier Funde sind behoben. Die `[FINDING]`-Tests waren zuerst rot und sind jetzt grün; sie bleiben als Regressionstests. Offene Funde: keine.
