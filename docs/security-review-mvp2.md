# Security-Review MVP 2 (#26)

Unabhängiges Review des Pfad-Validators und der Dateisystem-Commands. Alle Aussagen sind durch
Tests in `apps/server/src/security-review.test.ts` belegt (39 Tests). Grüne Tests sind
Regressionstests für abgewehrte Angriffe. Tests mit `[FINDING-n]` beschreiben das sichere
Sollverhalten und schlagen bis zur Behebung fehl.

## Umfang

- `apps/server/src/fs/sandbox.ts`: Allowlist, Pfadauflösung (simulierter Pfad, `realpath`,
  Allowlist)
- `apps/server/src/fs/commands.ts`: `ls`, `cd`, `pwd`, `cat`, `tree`, Pfad-Completion
- `apps/server/src/app.ts`: `POST /api/command`, `POST /api/complete`, Schema, Rate-Limits,
  Helmet/CSP, Fehlerbehandlung, statische Auslieferung
- `packages/shared/src/parse.ts`, `commands.ts`, `api.ts`: Flag-Allowlist, Schemas
- Am Rand: `apps/web/src/shell/format.ts`, `apps/web/src/terminal/term.ts`, `apps/web/src/shell/shell.ts`

Zusätzliche Fixture-Einträge legt der Test im `beforeAll` an (Symlink auf die Wurzel,
Symlinks mit Rückweg nach außen, Zyklus, Kette über das ELOOP-Limit, Dateinamen mit OSC- und
Bidi-Zeichen, versteckter Ordner, Ordner mit 600 Dateien, Datei mit Escape-Inhalt).

## Geprüfte Angriffsklassen

| Klasse                                                                                    | Ergebnis                                                   | Test                                                                                                                    |
| ----------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Traversal mit `..` (alle Commands, `~/..`, `/..`)                                         | abgewehrt                                                  | `clamps .. at the root for every server command`                                                                        |
| Symlink auf Wurzel bzw. Symlink-Ordner, danach `..`                                       | abgewehrt (`..` wird lexikalisch vor `realpath` aufgelöst) | `resolves .. lexically before realpath (symlink to the root, then ..)`                                                  |
| Manipuliertes `cwd` über Symlinks                                                         | abgewehrt, `resetCwd`                                      | `re-validates a client cwd that walks through symlinks`                                                                 |
| Symlinks innen mit Rückweg nach außen, Symlinks nach außen, absolut                       | abgewehrt                                                  | `denies symlinks with a way back outside (inside dir, parent of root)`                                                  |
| Symlink-Ketten, Schleifen, Ketten > 40 Hops                                               | erlaubt nur innen, Schleifen/ELOOP = „nicht gefunden“      | `follows chains of inside symlinks but fails closed on overlong chains`                                                 |
| Symlink-Zyklen innen bei `tree`                                                           | terminiert, kein Ausbruch                                  | `terminates tree on symlink cycles and never leaves the content folder`                                                 |
| TOCTOU: Eintrag nach dem Start durch Symlink nach außen ersetzt                           | abgewehrt (Allowlist enthält echte Pfade)                  | `pins real paths: swapping entries for outside symlinks after start is denied`                                          |
| Absolute Hostpfade, `/proc`, `file://`                                                    | abgewehrt                                                  | `maps absolute paths onto the simulated root`                                                                           |
| URL-, Doppel-, Overlong-Encoding (als Text)                                               | abgewehrt, keine Dekodierung                               | `does not decode URL, double or overlong encodings`                                                                     |
| Overlong-UTF-8 als rohe Bytes im Body                                                     | abgewehrt (Ersatzzeichen)                                  | `treats raw overlong UTF-8 bytes in the body as replacement characters`                                                 |
| Null-Bytes, Backslashes                                                                   | abgewehrt, feste Meldung                                   | `rejects null bytes and backslashes with a fixed message`                                                               |
| Unicode: Fullwidth-Punkte, NFD, Zero-Width, Ein-Punkt-Führer, Divisionsstrich             | abgewehrt, keine Normalisierung                            | `does not normalize unicode lookalikes (fullwidth dots, NFD, zero-width)`                                               |
| RTL-Overrides, C0/C1, DEL in Pfaden                                                       | abgewehrt                                                  | `rejects bidi overrides and control characters in paths`                                                                |
| Überlange Pfade und Segmente                                                              | abgewehrt                                                  | `rejects overlong paths and segments without a host error`                                                              |
| Existenz-Orakel (fehlt vs. verboten vs. ELOOP vs. ENOTDIR)                                | identische Meldung bei `ls`, `cat`, `cd`, `tree`           | `answers missing and forbidden targets identically for every command`, `does not reveal the type of a forbidden target` |
| Orakel über `ls`/`tree`/`complete`                                                        | keine verbotenen oder unsicheren Namen                     | `never lists forbidden or unsafe names in ls, tree or complete`                                                         |
| Completion mit Steuerzeichen im `partial`                                                 | keine Steuerzeichen in Kandidaten                          | `completion never yields control characters, even for crafted partials`                                                 |
| Versteckte Dateien                                                                        | nur mit `-a` bzw. `.`-Präfix sichtbar                      | `hides dotfiles unless asked for (by design they are readable)`                                                         |
| Terminal-Injection über Dateiinhalt (OSC, OSC 8/52, DCS, C1, Modewechsel)                 | abgewehrt                                                  | `strips OSC, DCS, C1 and mode-switch sequences from file contents`                                                      |
| Terminal-Injection über Fehlermeldungen                                                   | **Fund, behoben**                                          | `[FINDING-1] error messages never echo control characters from arguments`                                               |
| Unerlaubte Flags (`--x`, `-`, `---`, `-l=1`, Flags nach Operanden, `-__proto__`)          | abgewehrt                                                  | `rejects unknown, long, bare and malformed flags`                                                                       |
| Zahlenwerte bei `-L` (0, 6, negativ, hex, Exponent, Fullwidth, arabische Ziffern, riesig) | abgewehrt                                                  | `accepts only small decimal integers in range for -L`                                                                   |
| `--` und Operandenzahl                                                                    | korrekt                                                    | `treats everything after -- as operands and enforces operand counts`                                                    |
| Prototype-Keys als Command, Pfad, `cwd`                                                   | abgewehrt                                                  | `treats prototype keys as plain names (command, path, operand)`                                                         |
| Clientseitige Commands am Server                                                          | 400                                                        | `refuses client-side commands and aliases on the server`                                                                |
| Schema: falsche Typen, Zusatz-Keys, zu viele Argumente                                    | 400, generisch                                             | `rejects wrong types, extra keys and too many arguments`                                                                |
| JSON-Prototype-Pollution (`__proto__`, `constructor`)                                     | 400                                                        | `rejects prototype pollution keys in JSON bodies`                                                                       |
| JSON-Duplikat-Keys                                                                        | letzter Wert gilt und wird validiert                       | `resolves duplicate JSON keys consistently (last wins, still validated)`                                                |
| Content-Type-Tricks, kaputtes JSON                                                        | 400, generisch                                             | `rejects other content types and malformed JSON generically`                                                            |
| Sehr große Bodies (1 MiB)                                                                 | 400                                                        | `rejects very large bodies before parsing`                                                                              |
| Andere HTTP-Methoden                                                                      | 404, generisch                                             | `does not expose the API via other methods`                                                                             |
| Ausgabe-Limits `ls`, `complete`, `cat`                                                    | eingehalten                                                | `caps ls, tree and completion output for large directories`, `enforces the cat size limit exactly`                      |
| Knotenlimit `tree`                                                                        | **Fund, behoben**                                          | `[FINDING-3] tree never returns more nodes than the node limit`                                                         |
| Rate-Limit-Umgehung über `X-Forwarded-For`, `X-Real-IP`, `Forwarded`                      | abgewehrt (`trustProxy: false`)                            | `ignores X-Forwarded-For and similar headers for the per-client limit`                                                  |
| Rate-Limit `/api/complete`                                                                | vorhanden                                                  | `also limits /api/complete`                                                                                             |
| Globales Rate-Limit                                                                       | **Fund, behoben**                                          | `[FINDING-2] a single client cannot use up the global budget with rejected requests`                                    |
| Statische Dateien: Traversal, Encoding, Dotfiles, Null-Byte                               | abgewehrt                                                  | `cannot read files outside the public folder or dotfiles`                                                               |
| Hostpfade, Stacktraces in Antworten                                                       | keine (Prüfung in jedem Test)                              | `assertNoLeak` in allen Requests                                                                                        |

## Funde

### FINDING-1: Steuerzeichen aus Argumenten werden in Fehlermeldungen zurückgegeben

- **Schweregrad:** niedrig
- **Beschreibung:** Das Schema erlaubt beliebige Zeichen in `args`. Ungültige Pfade, unbekannte
  Flags und ungültige `-L`-Werte werden in der Fehlermeldung unverändert zurückgespiegelt
  (`shown(target)` in `commands.ts`, `unbekannte Option: ...` und `keine gültige Zahl: ...` in
  `parse.ts`), inklusive ESC, BEL, NUL und C1 (z. B. `\u009b`). Der Client gibt
  `result.message` in `Shell.error` ohne `clean()` an xterm weiter (Code-Review
  `apps/web/src/shell/shell.ts`). Heute kann das nur ein Angreifer auslösen, der die API direkt
  aufruft (der Client-Tokenizer lehnt Steuerzeichen ab), daher reflektiert und nur gegen sich
  selbst. Es verletzt aber die Regel, dass Serverausgaben das Terminal nie steuern können, und
  wird gefährlich, sobald Eingaben aus anderer Quelle (Deep-Links, History-Import) kommen.
- **Reproduktion:** `POST /api/command {"cwd":"/","name":"cat","args":["\u001b]0;pwned\u0007"]}`
  liefert `cat: \u001b]0;pwned\u0007: Ungültiger Pfad.`; ebenso `ls -\u001b[2J`,
  `tree -L "\u001b[31m"`, `cd "\u009b2J"`.
- **Behebung:** Steuerzeichen schon im Schema ablehnen (`args`, `name`, `partial` mit
  `CONTROL_CHARS` prüfen) und Echos in Fehlermeldungen zusätzlich mit `sanitizeText` bzw. einer
  Escape-Darstellung ausgeben. Im Client `result.message` ebenfalls durch `clean()` schicken.
- **Test:** `terminal injection > [FINDING-1] error messages never echo control characters from arguments`
- **Status:** Behoben: `printable()` in `packages/shared/src/parse.ts` ersetzt Steuerzeichen in allen Fehlermeldungen, die Eingaben wiederholen (Parser und Server-Commands). Zusätzlich filtert `Shell.error` im Client jede Meldung mit `clean()`.

### FINDING-2: Abgelehnte Anfragen eines Clients verbrauchen das globale Budget

- **Schweregrad:** mittel
- **Beschreibung:** Der globale Zähler (`globalLimit` in `app.ts`) wird für jede Anfrage erhöht,
  auch wenn sie bereits am Pro-Client-Limit mit 429 scheitert. Ein einzelner Client mit eigener
  IP kann so mit schnellen Anfragen das globale Limit (Standard 1200/min) allein ausschöpfen und
  alle anderen Besucher aussperren, obwohl er selbst nur 120/min bedient bekommt. Hinter dem
  Tunnel ohne echte IPs ist das Verhalten gleich, sobald echte IPs durchgereicht werden, ist es
  ein billiger DoS.
- **Reproduktion:** `perClient: 2, global: 5`; Client 10.0.0.1 sendet 10 Anfragen (2 × 200,
  8 × 429). Danach erhält 10.0.0.2 bei seiner ersten Anfrage 429.
- **Behebung:** Den globalen Zähler erst nach bestandenem Pro-Client-Limit erhöhen (z. B. als
  `preHandler` statt `onRequest`, oder Reihenfolge der Hooks festlegen), oder per-Client-429 vom
  globalen Zähler wieder abziehen.
- **Test:** `rate limits > [FINDING-2] a single client cannot use up the global budget with rejected requests`
- **Status:** Behoben: Der globale Zähler läuft im `preHandler` statt im `onRequest`-Hook, also erst nach dem Pro-Client-Limit. Abgewiesene Anfragen zählen nicht mehr global.

### FINDING-3: `tree` überschreitet das Knotenlimit

- **Schweregrad:** niedrig
- **Beschreibung:** In `tree` wird das Budget (`treeNodes - nodes`) einmal pro Ordner vor dem
  Lesen berechnet. Rekursive Aufrufe verbrauchen danach Knoten, die restlichen Einträge des
  Elternordners werden trotzdem noch angehängt. Mit dem Zyklus `cyc/up -> ..` liefert
  `tree -L 5 cyc` 356 statt höchstens 300 Knoten. Im ungünstigsten Fall wächst die Ausgabe
  etwa auf Tiefe × 300 Knoten. Die Tiefe ist auf 5 begrenzt, daher kein unbegrenzter Verbrauch,
  aber das Ausgabe-Limit aus SPEC Abschnitt 5 wird nicht eingehalten.
- **Reproduktion:** Symlink `cyc/up -> ..` im Content-Ordner, dann `tree -L 5 cyc`.
- **Behebung:** Das Budget vor jedem angehängten Eintrag neu prüfen (`if (nodes >=
OUTPUT_LIMITS.treeNodes) { truncated = true; break; }`) statt nur beim Lesen des Ordners.
- **Test:** `traversal and symlinks > [FINDING-3] tree never returns more nodes than the node limit`
- **Status:** Behoben: `tree` prüft das Knotenbudget vor jedem einzelnen Knoten und markiert die Ausgabe als gekürzt.

## Nicht-Funde / bewusste Entscheidungen

- `..` endet an der simulierten Wurzel und wird **lexikalisch** vor `realpath` aufgelöst. Dadurch
  verhält sich `cd link-dir; cd ..` anders als in einer echten Shell mit physischer Auflösung,
  ist aber sicher: `rootlink/../secret` bleibt `/secret` im Content-Ordner.
- Absolute Pfade beziehen sich auf die simulierte Wurzel. Echte Hostpfade als Eingabe werden nur
  als eigene Eingabe in der Fehlermeldung gespiegelt (gekürzt auf 60 Zeichen), nie der echte
  Content-Ordner.
- Symlinks sind nur erlaubt, wenn ihr Ziel in der beim Start erzeugten Allowlist steht. Dateien,
  die nach dem Start entstehen oder ersetzt werden, sind nicht erreichbar.
- TOCTOU zwischen `realpath`, `stat` und `open` ist theoretisch möglich, setzt aber Schreibzugriff
  auf den Content-Ordner voraus. Dieser ist im Container read-only gemountet (Info).
- Versteckte Dateien sind lesbar, wenn man ihren Namen kennt, und mit `ls -a` sichtbar. Der
  Content-Ordner darf daher keine Geheimnisse enthalten (Info, Verantwortung des Besitzers).
- Zero-Width-Zeichen (`U+200B`, `U+FEFF`) in Dateinamen werden nicht gefiltert und könnten Namen
  optisch fälschen. Da nur der Besitzer Inhalte anlegt, ist das kein Angriffsweg (Info).
- Timing-Unterschiede zwischen „fehlt“ und „verboten“ (ein `realpath` mehr oder weniger) wurden
  nicht gemessen; sie verraten höchstens die Existenz von Symlinks im Content-Ordner (Info).
- `readdir` liest pro Ordner alle Namen, auch wenn nur ein Teil ausgegeben wird. Die Größe des
  Content-Ordners ist beim Start auf 10 000 Einträge begrenzt (Info).
- CSP erlaubt `style-src 'unsafe-inline'`, das braucht xterm.js. Skripte nur von `'self'` (Info).

## Status

Alle drei Funde sind behoben. Die `[FINDING]`-Tests waren zuerst rot und sind jetzt grün; sie bleiben als Regressionstests im Repo. Offene Funde: keine.
