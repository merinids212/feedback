#!/usr/bin/env bash
# feedback — install the local watcher.  Usage:
#   curl -fsSL https://feedback.cybercorpresearch.com/install.sh | bash
set -euo pipefail
RAW="https://raw.githubusercontent.com/merinids212/feedback/main/cli"
DEST="$HOME/.claude/feedback"

gld(){ printf '\033[38;5;255m%s\033[0m\n' "$1"; }
dim(){ printf '\033[38;5;245m%s\033[0m\n' "$1"; }
err(){ printf '\033[38;5;203m%s\033[0m\n' "$1" >&2; }

gld "◇ installing feedback (local watcher)"
command -v python3 >/dev/null || { err "python3 required"; exit 1; }
command -v zsh     >/dev/null || { err "zsh required (feedback is a zsh function)"; exit 1; }

mkdir -p "$DEST"
for f in fb.py feedback.zsh; do curl -fsSL "$RAW/$f" -o "$DEST/$f"; done

LINE="source $DEST/feedback.zsh"
RC="$HOME/.zshrc"
if [ -f "$RC" ] && grep -qF "$LINE" "$RC"; then
  dim "  ~/.zshrc already sources feedback"
else
  printf '\n# feedback — notes from friends tunnel into your coding agent\n%s\n' "$LINE" >> "$RC"
  dim "  wired into ~/.zshrc"
fi

gld "◇ watcher installed"
if [ -s "$DEST/secret" ]; then
  dim "  secret present — you're ready. open a new terminal, then:"
  dim "    feedback link                  # from your project dir — copies the URL"
  dim "    feedback watch                 # notes land here"
else
  dim "  one-time setup left — you host your own tiny Cloudflare Worker so the"
  dim "  secret (which lets a friend's note run on YOUR machine) is yours alone:"
  dim "    https://github.com/merinids212/feedback#setup"
fi
