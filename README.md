# feedback

A link you hand a friend. They type a note. It tunnels straight into the coding agent on
your machine and lands as a prompt — Claude Code, Codex, or anything you can launch from a
shell.

```
you:     feedback link                       →  https://feedback…/f/x7k2m9p   (this folder, auto)
friend:  (opens link, types "the export button does nothing on mobile")
you:     feedback watch
         ◈ feedback on myapp from alex
           │ the export button does nothing on mobile
         ↵ run in claude · s skip · q quit     →  ↵
         ▸ launching claude in ~/code/myapp        (FEEDBACK_AGENT=codex to switch)
```

A [cybercorpresearch](https://portal.cybercorpresearch.com) production.

## How it works

- A Cloudflare Worker (`feedback.cybercorpresearch.com`) serves the friend-facing page
  and stores submissions in KV. Your machine can't take inbound traffic, so a tiny local
  watcher **polls** the inbox and fires your agent when notes arrive.
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
| `feedback watch [--auto] [--agent NAME]` | wait for notes; Enter fires each in your agent (`--auto` skips the Enter) |
| `feedback ls` | list active links + inbox count |
| `feedback kill <slug>` | disable a link |
| `feedback pull` · `next` · `ack <id>` | read notes from inside an agent session, as markdown or JSON |

## Which agent runs it

A note is just a prompt, so anything that takes one can handle it. `feedback watch` uses
whichever agent it finds — Claude Code first, then Codex — and you can pin it:

```bash
FEEDBACK_AGENT=codex            # or any command on PATH
feedback watch --agent codex    # one run only
FEEDBACK_CMD=(my-agent --yolo)  # full control; the prompt is appended as the last argument
FEEDBACK_FLAGS=(--flag)         # flags for the agent (PORTAL_FLAGS is reused, Claude Code only)
```

Only the launch is agent-specific. The link, the friend page, the inbox, and `feedback pull`
work the same whatever you run — inside a Codex session, `feedback pull` prints the waiting
notes as markdown and you carry on.

## Statusline (optional, Claude Code)

See pending feedback while you code, without checking. Add to `~/.claude/settings.json`:

```json
"statusLine": { "type": "command", "command": "~/.claude/feedback/statusline.sh" }
```

Shows `dir · branch · model` plus `◈ N feedback` when notes are waiting (silent otherwise).
Cached + refreshed in the background, so it never slows your prompt.

## Safety & security

Feedback connects a stranger's typing to an agent on your machine — that's the product, so
here is exactly what is and isn't protected.

**For you, running it**

- **A note is data, not orders.** Each one is fenced with a random per-run tag and labelled as
  an outsider's report, so a sender who types the fence characters can't close the quote early
  and start giving instructions.
- **Bypass flags are never inherited.** `PORTAL_FLAGS` is borrowed for convenience with
  `--dangerously-skip-permissions` (and `--yolo`, `--full-auto`) stripped out. Your own sessions
  may skip approvals; a stranger's note does not. An explicit `FEEDBACK_FLAGS` is still honoured.
- **`--auto` + a bypass flag is refused** unless you set `FEEDBACK_I_TRUST_THE_LINK=1`. Unattended
  and unsandboxed is remote code execution for whoever holds the link.
- **Confirm mode is the default** — you read every note and press `↵` before anything runs.
  Injection defence is layered, not absolute; you are the last layer.
- **Your inbox, your secret.** You host the Worker, so notes live in your Cloudflare KV. The
  bearer secret stays in `~/.claude/feedback/secret` (chmod 600 — the CLI warns if it's readable
  by others) and the Worker env. The Worker compares it in constant time.
- **The link can't leak sideways.** The slug is the credential, so pages ship
  `referrer-policy: no-referrer` (a link inside a note can't tell its destination where the
  visitor came from), plus `no-store`, `x-frame-options: DENY`, `nosniff`, and a CSP that
  allows only the page's own inline assets.
- **Bodies are capped before parsing** — over 16 KB gets a 413 instead of being buffered.
- **Nothing outlives its link.** Notes expire from KV after 30 days; the link record (project
  name + the folder path it routes to) expires a week after the link, rather than never.
- **The installer validates before it wires.** Both files are staged, parsed, and only then
  moved into place, so a truncated download can't break the shell that sources them; `~/.zshrc`
  is backed up first.
- **Bounded.** Notes cap at 4,000 chars, trim before an agent sees them, and expire from KV after
  30 days. Links expire (7d) and cap submissions (50). `feedback kill <slug>` ends one instantly.

**For your friend, sending**

- No account, no cookies, no analytics. A note and an optional name, nothing else.
- Their words go to your inbox — not to us, not to a model provider until you hand it over.
- Everything rendered is escaped and the preview only links `http(s)` URLs, so the page can't be
  turned into an attack on them.
- Links are ~44 bits of rejection-sampled randomness and the pages are `noindex`.

**What it does not protect against**

- A hostile note is still a prompt. Fencing raises the bar; it isn't a proof.
- Anyone with the link can write to your inbox until it expires or caps out — the link *is* the
  credential.
- Each note carries the project's folder path (that's how routing works). It's in your own KV,
  but it is a path off your machine.
- No per-IP rate limiting; the submission cap is what bounds abuse.

## Development

```bash
bash tests/run_tests.sh            # full e2e (needs the Worker secret) — uses a throwaway link, cleans up
bash tests/run_tests.sh --offline  # syntax/parse only (CI, no secret)
```

The e2e suite is isolated: it only touches notes it creates (unique marker) and never `ack-all`s
your real inbox. CI runs the offline checks on every push.

## License

MIT
