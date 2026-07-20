# feedback

A link you hand a friend. They type a note. It tunnels straight into a Claude Code
session on your machine and runs as a prompt.

```
you:     feedback link                       →  https://feedback…/f/x7k2m9p   (this folder, auto)
friend:  (opens link, types "the export button does nothing on mobile")
you:     feedback watch
         ◈ feedback on myapp from alex
           │ the export button does nothing on mobile
         ↵ run in claude · s skip · q quit     →  ↵
         ▸ launching claude in ~/code/myapp
```

A [cybercorpresearch](https://portal.cybercorpresearch.com) production.

## How it works

- A Cloudflare Worker (`feedback.cybercorpresearch.com`) serves the friend-facing page
  and stores submissions in KV. Your machine can't take inbound traffic, so a tiny local
  watcher **polls** the inbox and fires `claude` when notes arrive.
- Friend text is wrapped in a fixed prompt template that labels it **feedback data, not
  instructions** — so a note can't hijack your session. Risky/destructive actions still
  ask you first.
- Confirm mode (default) waits for your Enter per note; `--auto` fires immediately.

## Setup

```bash
# 1. deploy the worker (once) — needs a Cloudflare account + the domain
cd worker && wrangler kv namespace create FEEDBACK   # put the id in wrangler.jsonc
python3 -c "import secrets;print(secrets.token_urlsafe(32))" > ~/.claude/feedback/secret
chmod 600 ~/.claude/feedback/secret
wrangler secret put SECRET < ~/.claude/feedback/secret
wrangler deploy

# 2. install the CLI
mkdir -p ~/.claude/feedback && cp cli/fb.py cli/feedback.zsh ~/.claude/feedback/
echo 'source ~/.claude/feedback/feedback.zsh' >> ~/.zshrc
```

## Use

| | |
|---|---|
| `feedback link [dir] [--days N] [--max N]` | mint a link for the current folder (or `[dir]`) — copies to clipboard |
| `feedback watch [--auto]` | wait for notes; Enter fires each in `claude` (`--auto` skips the Enter) |
| `feedback ls` | list active links + inbox count |
| `feedback kill <slug>` | disable a link |

Launch flags come from `FEEDBACK_FLAGS`, else `PORTAL_FLAGS`, else none.

## Auto-watch in your statusline (optional)

See pending feedback while you code, without checking. Add to `~/.claude/settings.json`:

```json
"statusLine": { "type": "command", "command": "~/.claude/feedback/statusline.sh" }
```

Shows `dir · branch · model` plus `◈ N feedback` when notes are waiting (silent otherwise).
Cached + refreshed in the background, so it never slows your prompt.

## Safety

The friend page is `noindex` and links are unguessable, expiring (7d default), and
submission-capped. The secret lives only in `~/.claude/feedback/secret` (chmod 600) and
the Worker's env — never in the repo. Still: this executes remote-authored prompts on
your machine. Keep confirm mode on unless you fully trust who has the link.

## Development

```bash
bash tests/run_tests.sh            # full e2e (needs the Worker secret) — uses a throwaway link, cleans up
bash tests/run_tests.sh --offline  # syntax/parse only (CI, no secret)
```

The e2e suite is isolated: it only touches notes it creates (unique marker) and never `ack-all`s
your real inbox. CI runs the offline checks on every push.

## License

MIT
