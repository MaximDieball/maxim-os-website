#!/bin/sh
# Prüft den Ticketbezug (siehe CLAUDE.md, Ticket-Regel). POSIX-sh, läuft auch mit macOS-bash 3.2.
#
#   check-ticket-ref.sh msg <datei>        Commit-Message muss #<nr> enthalten
#   check-ticket-ref.sh pr <datei>         PR-Body muss "Closes #<nr>" (bzw. Fixes/Resolves) enthalten
#   check-ticket-ref.sh range <von>..<bis> Jeder Commit im Bereich muss #<nr> enthalten
set -eu

TICKET_RE='#[0-9]+'
CLOSES_RE='(close[sd]?|fix(e[sd])?|resolve[sd]?)[[:space:]]+#[0-9]+'

# Von Git erzeugte Merge-Commits sind erlaubt, alles andere braucht eine Nummer.
check_message() {
  # Kommentarzeilen (vom Commit-Editor) ignorieren.
  body=$(printf '%s\n' "$1" | grep -Ev '^#( |$)' || true)
  first=$(printf '%s\n' "$body" | sed -n '1p')
  case "$first" in
    "Merge "*) return 0 ;;
  esac
  printf '%s\n' "$body" | grep -Eq "$TICKET_RE"
}

mode=${1:-}
case "$mode" in
  msg)
    if ! check_message "$(cat "$2")"; then
      echo "✗ Commit-Message ohne Ticketnummer. Bitte '#<issue-nr>' angeben (z. B. 'Add snake #12')." >&2
      exit 1
    fi
    ;;
  pr)
    if ! grep -Eiq "$CLOSES_RE" "$2"; then
      echo "✗ PR-Beschreibung ohne 'Closes #<issue-nr>'." >&2
      exit 1
    fi
    ;;
  range)
    bad=0
    for sha in $(git rev-list --no-merges "$2"); do
      if ! check_message "$(git log -1 --format=%B "$sha")"; then
        echo "✗ $(git log -1 --format='%h %s' "$sha"): keine Ticketnummer" >&2
        bad=1
      fi
    done
    exit $bad
    ;;
  *)
    echo "usage: $0 msg <datei> | pr <datei> | range <von>..<bis>" >&2
    exit 2
    ;;
esac
