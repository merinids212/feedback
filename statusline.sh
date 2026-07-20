#!/bin/bash
# Claude Code statusLine — dir · branch · model, plus a feedback indicator when notes wait.
# Enable:  "statusLine": {"type":"command","command":"~/.claude/feedback/statusline.sh"}
in=$(cat)
read dir model < <(printf '%s' "$in" | python3 -c "import json,sys;d=json.load(sys.stdin);w=d.get('workspace',{});print((w.get('current_dir') or '').split('/')[-1], d.get('model',{}).get('display_name',''))" 2>/dev/null)
out="\033[38;5;252m${dir}\033[0m"
br=$(git -C "${dir:-.}" branch --show-current 2>/dev/null)
[ -n "$br" ] && out="$out \033[38;5;245m${br}\033[0m"
[ -n "$model" ] && out="$out \033[38;5;245m${model}\033[0m"
fb=$(python3 "$HOME/.claude/feedback/fb.py" statusline 2>/dev/null)
[ -n "$fb" ] && out="$out  $fb"
printf '%b' "$out"
