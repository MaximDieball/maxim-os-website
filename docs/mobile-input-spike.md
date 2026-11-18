# Eingabe-Spike: xterm.js vs. eigenes Eingabefeld (#15)

Frage aus SPEC 4a: Funktioniert die Texteingabe über xterm.js auf Android (Chrome) und iOS (Safari) zuverlässig, oder brauchen wir eine Alternative?

## Die zwei Varianten

Beide Varianten sind gebaut und lassen sich per URL-Parameter umschalten. Ausgabe, History, Tab-Completion und Quick-Key-Leiste sind identisch, nur die Eingabe ist verschieden.

| Variante              | URL                       | Wie getippt wird                                                                                                                                         |
| --------------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **native** (Standard) | `/` oder `/?input=native` | Sichtbares `<input>` direkt unter der xterm.js-Ausgabe. xterm.js zeigt nur die Ausgabe an, seine interne Textarea ist `readonly` und nicht fokussierbar. |
| **xterm**             | `/?input=xterm`           | Klassisch: xterm.js bekommt den Fokus, Zeichen kommen über `term.onData`, die Zeile wird im Terminal selbst bearbeitet.                                  |

Mit `?boot=skip` lässt sich die Matrix-Animation überspringen, z. B. `/?input=xterm&boot=skip`.

## Ergebnis der automatisierten Tests

Playwright-Tests mit dem Tag `@spike` (`e2e/tests/regression/spike.spec.ts`) laufen für beide Varianten auf Desktop-Chromium, mobilem Chromium (390 und 360 px) und mobilem WebKit (iPhone-14-Emulation): Tippen + Enter, History über die Quick-Keys, Steuerzeichen werden nicht übernommen. **Beide Varianten bestehen alle Tests.**

Das sagt aber wenig über echte Geräte. Playwright schickt fertige Key-Events, echte Bildschirmtastaturen tun das nicht:

- **Android (Gboard, Samsung):** Die Tastatur arbeitet mit Komposition (`compositionstart`/`compositionend`). Wörter werden als Ganzes ersetzt, Backspace kommt teils nicht als Key-Event an, sondern als Textänderung. xterm.js bildet das über seine versteckte Textarea nach, und genau dort entstehen die bekannten Fehler: doppelte Zeichen, verlorene Backspaces, Vorschläge, die die ganze Zeile neu schicken.
- **iOS (Safari):** Autokorrektur und Großschreibung lassen sich an einer versteckten Textarea nur bedingt abschalten, Diktat und Textersetzung schicken Text am Stück. Das Fokussieren einer unsichtbaren Textarea öffnet die Tastatur nicht immer zuverlässig.

Ein normales, sichtbares `<input>` hat diese Probleme nicht, weil der Browser selbst die Komposition verwaltet und wir den Wert erst beim Absenden lesen.

## Empfehlung

**Variante `native` beibehalten** (ist bereits Standard).

- Robust gegen Komposition, Autokorrektur, Diktat und Einfügen, weil der Browser die Bearbeitung macht.
- `autocapitalize`, `autocorrect`, `autocomplete`, `spellcheck`, `enterkeyhint="send"` und 16 px Schrift greifen sicher, weil sie an einem echten, sichtbaren Feld hängen.
- Cursor bewegen, markieren und einfügen funktionieren mobil wie gewohnt, ohne eigene Zeilenbearbeitung.
- Nachteil: Die Eingabezeile sitzt optisch unter der Ausgabe statt im Terminal-Fluss. Der Prompt wird beim Absenden in die Ausgabe geschrieben, sodass der Verlauf trotzdem wie ein Terminal aussieht.

Die Variante `xterm` bleibt bis zur Entscheidung als Vergleich drin und wird danach entfernt (eigenes Ticket).

## Testanleitung für echte Geräte

### Vorbereitung (Mac)

```bash
colima start
make dev
```

Der Dev-Server lauscht auf allen Interfaces (Colima leitet Port 5173 auf `*:5173` weiter, `colima start --network-address` ist nicht nötig). Die LAN-Adresse des Macs:

```bash
ipconfig getifaddr en0
```

Auf dem Handy (im selben WLAN) dann `http://<LAN-IP>:5173` öffnen, z. B. `http://192.168.178.102:5173`.

Falls das Handy die Seite nicht lädt: Die macOS-Firewall fragt beim ersten Zugriff eventuell nach eingehenden Verbindungen für `ssh` (darüber leitet Colima den Port weiter). Zulassen, oder in Systemeinstellungen → Netzwerk → Firewall prüfen.

### Checkliste

Jede Zeile einmal mit `?input=native&boot=skip` und einmal mit `?input=xterm&boot=skip` durchgehen, auf Android (Chrome) und iOS (Safari). Gerne mit der Standardtastatur **und** mit aktivierter Autokorrektur/Wortvorschlägen.

| #   | Prüfen                                                                  | Erwartung                                                                     |
| --- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 1   | Auf die Terminal-Fläche tippen                                          | Tastatur geht auf, Eingabezeile direkt über der Tastatur sichtbar             |
| 2   | `help` tippen, Enter (bzw. "Senden")                                    | Command läuft, Ausgabe scrollt bis ans Ende, Tastatur bleibt offen            |
| 3   | `HELP` bzw. `Help` tippen                                               | Kein automatischer Großbuchstabe am Anfang; `Help` ergibt "command not found" |
| 4   | `hepl` tippen und einen Wortvorschlag/Autokorrektur antippen            | Kein doppelter oder verlorener Text, Zeile zeigt genau den gewählten Text     |
| 5   | Ein paar Zeichen tippen, dann mehrfach Backspace (auch gedrückt halten) | Jedes Backspace löscht genau ein Zeichen                                      |
| 6   | Quick-Keys: `↑`, `↓`, `Tab` (nach `he`), `^C`, `/`, `~`, `-`            | Wirken sofort, Tastatur bleibt offen                                          |
| 7   | Text einfügen (lange tippen → Einfügen)                                 | Text landet vollständig in der Zeile                                          |
| 8   | Diktat (Mikrofon auf der Tastatur), z. B. "help"                        | Text landet in der Zeile, Enter führt aus                                     |
| 9   | 10 × Enter mit irgendeinem Text                                         | Letzte Zeile bleibt sichtbar, nichts rutscht unter die Tastatur               |
| 10  | Gerät drehen und zurück                                                 | Layout passt sich an, Eingabe bleibt sichtbar                                 |
| 11  | In der Ausgabe nach oben scrollen, dann wieder tippen                   | Fokus bleibt bzw. kommt zurück, Ausgabe springt beim Absenden nach unten      |
| 12  | iOS: Zoomt die Seite beim Fokussieren?                                  | Nein                                                                          |

Notiere pro Gerät, Browser und Variante die Nummern, die nicht passen. Das reicht mir als Rückmeldung.

## Entscheidung

- [ ] Vom Besitzer bestätigt: Variante `native` (oder: `xterm`, Begründung)
