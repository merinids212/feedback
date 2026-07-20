#!/bin/bash
# Claude Code statusLine — dir · branch · model, plus a feedback indicator when notes wait.
# Enable:  "statusLine": {"type":"command","command":"~/.claude/feedback/statusline.sh"}
in=$(cat)

# Read the full path and the display name. The path is needed whole: `git -C <basename>`
# only resolved when you happened to be one level above the repo, so the branch was
# usually missing. Tab-separated because a path can contain spaces.
IFS=$'\t' read -r cwd model < <(printf '%s' "$in" | python3 -c "
import json, sys
d = json.load(sys.stdin)
w = d.get('workspace', {})
print('\t'.join([(w.get('current_dir') or ''), d.get('model', {}).get('display_name', '')]))
" 2>/dev/null)

dir=${cwd##*/}
br=$(git -C "${cwd:-.}" branch --show-current 2>/dev/null)
fb=$(python3 "$HOME/.claude/feedback/fb.py" statusline 2>/dev/null)

# Build with real escapes held in variables and print with %s, never %b: a folder or
# branch name is untrusted text, and %b turns a literal \033[ inside one into a live
# escape sequence — enough to repaint or blank the status line.
E=$'\033'; RESET="${E}[0m"; INK="${E}[38;5;230m"; DIM="${E}[38;5;187m"
out="${INK}${dir}${RESET}"
[ -n "$br" ] && out="$out ${DIM}${br}${RESET}"
[ -n "$model" ] && out="$out ${DIM}${model}${RESET}"
[ -n "$fb" ] && out="$out  $fb"
printf '%s' "$out"
