#!/bin/sh
# kanban-move.sh — move a feature card on an Obsidian Kanban board without
# loading the board into an agent's context (SCHEMA.md §Kanban "Move a card").
#
#   kanban-move.sh <board.md> <feature-id> <target-column> [--pr <num>] [--title <title>]
#
# Behavior (mirrors the documented manual op):
#   - finds the list item tagged #<feature-id> (plus its indented sub-notes),
#     removes it from its current column, appends it under `## <target-column>`
#   - no card yet ⇒ creates `- [ ] <title|id>  #<id>` in the target column
#   - duplicates ⇒ keeps the first, drops the rest
#   - --pr N ⇒ ensures the card line ends with ` — PR #N`
#   - never touches the front-matter or the trailing `%% kanban:settings %%` block
# Exit codes: 0 ok · 2 usage · 3 board/column not found.
set -eu

[ $# -ge 3 ] || { echo "usage: kanban-move.sh <board.md> <feature-id> <column> [--pr <num>] [--title <title>]" >&2; exit 2; }
board="$1"; id="$2"; col="$3"; shift 3
pr=""; title=""
while [ $# -gt 0 ]; do
  case "$1" in
    --pr)    pr="$2"; shift 2 ;;
    --title) title="$2"; shift 2 ;;
    *) echo "error: unknown flag $1" >&2; exit 2 ;;
  esac
done
[ -f "$board" ] || { echo "error: board not found: $board" >&2; exit 3; }

tmp="${board}.kanban-move.$$"
ID="$id" COL="$col" PR="$pr" TITLE="${title:-$id}" awk '
  # Emit one line, collapsing runs of blank lines to a single one. Without this
  # every move netted +1 blank line in the target column (the card is inserted
  # with its own separator, right after the blank that already preceded the next
  # heading) — ten moves of one card padded a board with fifteen blank lines.
  function emit(s) {
    if (s == "") { if (lastblank) return; lastblank = 1 } else lastblank = 0
    print s
  }
  function put_card(   k) {
    emit(card)
    for (k = 1; k <= sn; k++) emit(snote[k])
  }
  BEGIN {
    id = ENVIRON["ID"]; col = tolower(ENVIRON["COL"])
    pr = ENVIRON["PR"]; title = ENVIRON["TITLE"]
    n = 0; card = ""; found = 0; colseen = 0; sn = 0; lastblank = 0
  }
  { lines[++n] = $0 }
  END {
    # pass 1: extract the FIRST card block tagged #id; mark every block for removal
    for (i = 1; i <= n; i++) {
      l = lines[i]
      if (l !~ /^- \[.\] /) continue
      p = index(l, "#" id)
      if (p == 0) continue
      # word-boundary check: char after the tag must not extend the id
      rest = substr(l, p + length(id) + 1, 1)
      if (rest != "" && rest ~ /[A-Za-z0-9_-]/) continue
      # Capture the sub-notes of the FIRST match only. Testing `card == lines[i]`
      # instead also captured a later duplicate whose text happened to match.
      isfirst = 0
      if (!found) { found = 1; card = l; isfirst = 1 }
      del[i] = 1
      for (j = i + 1; j <= n && lines[j] ~ /^[ \t]/; j++) {
        del[j] = 1
        if (isfirst) snote[++sn] = lines[j]
      }
      i = j - 1
    }
    if (!found) card = "- [ ] " title "  #" id
    if (pr != "" && index(card, "PR #") == 0) card = card " — PR #" pr

    # pass 2: emit, skipping removed blocks; append the card at the end of the
    # target column (before the next ## heading / settings block / EOF)
    intarget = 0; placed = 0
    for (i = 1; i <= n; i++) {
      if (del[i]) continue
      l = lines[i]
      atheading = (l ~ /^## /)
      atsettings = (l ~ /^%% kanban:settings/)
      if (intarget && (atheading || atsettings)) {
        # can not back up over already-printed lines; place the card just before
        # this boundary instead
        put_card()
        emit("")
        intarget = 0; placed = 1
      }
      if (atheading) {
        h = tolower(l); sub(/^## +/, "", h); gsub(/ +$/, "", h)
        if (h == col) { intarget = 1; colseen = 1 }
      }
      emit(l)
    }
    if (intarget && !placed) {
      put_card()
      placed = 1
    }
    if (!colseen) exit 3
  }
' "$board" > "$tmp" || { rc=$?; rm -f "$tmp"; [ "$rc" = 3 ] && echo "error: column \"$col\" not found in $board" >&2; exit "$rc"; }
mv "$tmp" "$board"
echo "moved #$id -> $col${pr:+ (PR #$pr)}"
