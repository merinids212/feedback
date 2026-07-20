#!/usr/bin/env bash
# feedback test suite — exercises the live Worker + local CLI end to end with a
# throwaway link, then cleans up. Needs ~/.claude/feedback/secret (a deployed Worker).
#   bash tests/run_tests.sh
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FB="python3 $ROOT/cli/fb.py"
PASS=0; FAIL=0
ok(){ PASS=$((PASS+1)); printf '  \033[38;5;42m✓\033[0m %s\n' "$1"; }
no(){ FAIL=$((FAIL+1)); printf '  \033[38;5;203m✗\033[0m %s  %s\n' "$1" "${2:-}"; }
chk(){ if [ "$2" = "$3" ]; then ok "$1"; else no "$1" "got:[$2] want:[$3]"; fi; }

OFFLINE=0; [ "${1:-}" = "--offline" ] && OFFLINE=1
if [ "$OFFLINE" = 0 ] && [ ! -s "$HOME/.claude/feedback/secret" ]; then
  echo "no secret — running --offline (hygiene only). deploy the Worker for full e2e."; OFFLINE=1
fi

if [ "$OFFLINE" = 0 ]; then
echo "== link lifecycle =="
TDIR="$(mktemp -d)"
URL="$($FB new "$(basename "$TDIR")" "$TDIR" 1 3)"
case "$URL" in https://*/f/*) ok "new mints a link URL" ;; *) no "new mints a link URL" "$URL" ;; esac
SLUG="${URL##*/}"

echo "== friend page + submit =="
CODE=$(curl -fsS -o /dev/null -w '%{http_code}' "$URL"); chk "friend page 200" "$CODE" "200"
curl -fsS "$URL" | grep -q 'class="tab' && ok "friend page has the editor tabs" || no "editor tabs"
MARK="fbtest-$$-$RANDOM"
post(){ curl -fsS -X POST "$URL" -H 'content-type: application/json' -d "$1"; }
R=$(post "{\"text\":\"typo $MARK: bahs should be bash\",\"from\":\"tester\"}")
echo "$R" | grep -q '"ok":true' || R=$(post "{\"text\":\"typo $MARK: bahs should be bash\",\"from\":\"tester\"}")
echo "$R" | grep -q '"ok":true' && ok "submit accepted" || no "submit accepted" "$R"

echo "== inbox / pull / next (KV is eventually consistent — poll) =="
# wait for our own marked note to appear in the inbox (up to ~30s)
found=""
for _ in $(seq 1 15); do
  if $FB pull 2>/dev/null | grep -q "$MARK"; then found=1; break; fi
  sleep 2
done
[ -n "$found" ] && ok "pull shows our submitted note" || no "pull shows note" "not visible after 30s"
# the note's cwd is $TDIR — pull run from there should mark it "act here" (resolves symlinks)
( cd "$TDIR" && $FB pull 2>/dev/null ) | grep -q "act here" && ok "pull marks current-project notes" || no "pull marks current-project"
$FB next | grep -q '"from"' && ok "next returns JSON" || no "next json"
# our note's id, from the inbox filtered to our marker (NOT ack-all — never touch real notes)
ID=$($FB inbox 2>/dev/null | grep "$MARK" | cut -f1)

echo "== flood cap =="
BIG="$MARK-$(python3 -c "print('x'*3000)")"
curl -fsS -X POST "$URL" -H 'content-type: application/json' -d "{\"text\":\"$BIG\"}" >/dev/null
found=""
for _ in $(seq 1 15); do
  if $FB pull 2>/dev/null | grep -q 'chars trimmed'; then found=1; break; fi
  sleep 2
done
[ -n "$found" ] && ok "pull trims long pastes" || no "pull trims"

echo "== statusline =="
$FB _refresh
S=$($FB statusline); echo "$S" | grep -q 'feedback' && ok "statusline shows indicator when notes wait" || no "statusline shows" "$S"
T0=$(date +%s%N); $FB statusline >/dev/null; T1=$(date +%s%N)
MS=$(( (T1-T0)/1000000 )); [ "$MS" -lt 400 ] && ok "statusline is fast (${MS}ms, cached)" || no "statusline fast" "${MS}ms"

echo "== ack (only our own notes) + kill (cleanup) =="
[ -n "$ID" ] && $FB ack $ID >/dev/null && ok "ack clears a specific note" || no "ack specific"
# clear only the notes WE created (matched by our unique marker) — never touch real notes
for id in $($FB inbox 2>/dev/null | grep "$MARK" | cut -f1); do $FB ack "$id" >/dev/null; done
$FB kill "$SLUG" >/dev/null
CODE=$(curl -fsS -o /dev/null -w '%{http_code}' -X POST "$URL" -H 'content-type: application/json' -d '{"text":"x"}')
chk "killed link rejects submissions (410)" "$CODE" "410"
rm -rf "$TDIR"

fi  # end network section

echo "== worker + cli hygiene =="
if command -v node >/dev/null; then node --check "$ROOT/worker/index.js" && ok "worker/index.js parses" || no "worker parses"; fi
# render the real pages and parse every inline <script> — catches the template-literal
# escaping trap (a regex mangled to a newline/dropped backslash breaks the friend page JS)
if command -v node >/dev/null; then node "$ROOT/tests/render_check.mjs" >/dev/null 2>&1 && ok "rendered page scripts all parse" || no "rendered page scripts parse" "run: node tests/render_check.mjs"; fi
python3 -c "import ast;ast.parse(open('$ROOT/cli/fb.py').read())" && ok "fb.py parses" || no "fb.py parses"
if command -v zsh >/dev/null; then zsh -n "$ROOT/cli/feedback.zsh" && ok "feedback.zsh syntax" || no "feedback.zsh"; fi
bash -n "$ROOT/site/install.sh" && ok "install.sh syntax" || no "install.sh"
# the Worker serves its own INSTALL_SH string; site/install.sh is the readable copy.
# They drifted once — whatever curl | bash actually runs must be what's in the repo.
if command -v node >/dev/null; then
  node -e '
    const fs=require("fs");
    const s=fs.readFileSync(process.argv[1],"utf8");
    const m=s.match(/const INSTALL_SH = ("[\s\S]*?");\n/);
    if(!m) { console.error("INSTALL_SH not found"); process.exit(1); }
    process.exit(JSON.parse(m[1]) === fs.readFileSync(process.argv[2],"utf8") ? 0 : 1);
  ' "$ROOT/worker/index.js" "$ROOT/site/install.sh" \
    && ok "served install.sh matches site/install.sh" \
    || no "served install.sh matches site/install.sh" "worker INSTALL_SH drifted"
fi
bash -n "$ROOT/statusline.sh" && ok "statusline.sh syntax" || no "statusline.sh"

echo ""
echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
