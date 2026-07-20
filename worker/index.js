// feedback — a link that tunnels a friend's note into whichever coding agent you run.
// Routes:
//   POST /api/new    (Bearer SECRET)  {project, cwd, days?, max?} -> {slug, url}
//   GET  /api/inbox  (Bearer SECRET)  -> {items:[{id,slug,project,cwd,text,from,ts}]}
//   POST /api/ack    (Bearer SECRET)  {ids:[...]} -> {ok}
//   GET  /api/links  (Bearer SECRET)  -> {links:[...]}
//   POST /api/kill   (Bearer SECRET)  {slug} -> {ok}
//   GET  /f/:slug    friend page
//   POST /f/:slug    {text, from?} -> {ok}

const MAX_TEXT = 4000;
const MAX_BODY = 16 * 1024;   // hard ceiling on an unauthenticated request body
// brand favicon: white tile + black diamond (the ◈ feedback mark). inline, no extra request.
const FAVICON = '<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,' +
  encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#f1ebe0"/><path d="M16 7L25 16L16 25L7 16Z" fill="#0f0e0e"/></svg>') +
  '">';

// ── feedback tokens ── monochrome, dark only. The single chromatic value is CLAUDE:
// each agent's own mark, spent only where that agent is named.
const TOKENS = `:root{--bg:#0f0e0e;--panel:#191614;--ink:#f1ebe0;--dim:#a79e92;--faint:#837a6e;
--line:#282320;--border:#3a342f;--hi:#fff9f0;--prose:#d6cec2;--claude:#d97757}`;

// inline code renders as a chip on both products' docs — a command inside a sentence
// should be scannable, and never mistaken for emphasis.
const CODE_CHIP = `code{color:var(--hi);background:rgba(255,244,228,.07);border:1px solid var(--line);
border-radius:3px;padding:.5px 5px;font-size:.92em;white-space:nowrap}
pre code{background:none;border:0;padding:0;font-size:inherit}`;
// agent marks — Claude's sunburst in its own coral, Codex's blossom in mono (that IS its color).
// Shown wherever the page names the agents, so "any agent" is visible, not just claimed.
const CLAUDE_MARK = '<svg class="lg lgc" viewBox="0 0 100 100" aria-label="Claude Code"><g stroke="currentColor" stroke-width="8" stroke-linecap="round"><line x1="50" y1="50" x2="50" y2="8"/><line x1="50" y1="50" x2="71" y2="14"/><line x1="50" y1="50" x2="86" y2="29"/><line x1="50" y1="50" x2="92" y2="50"/><line x1="50" y1="50" x2="86" y2="71"/><line x1="50" y1="50" x2="71" y2="86"/><line x1="50" y1="50" x2="50" y2="92"/><line x1="50" y1="50" x2="29" y2="86"/><line x1="50" y1="50" x2="14" y2="71"/><line x1="50" y1="50" x2="8" y2="50"/><line x1="50" y1="50" x2="14" y2="29"/><line x1="50" y1="50" x2="29" y2="14"/></g></svg>';
const CODEX_MARK = '<svg class="lg lgx" viewBox="0 0 100 100" aria-label="Codex"><g fill="none" stroke="currentColor" stroke-width="7"><g transform="translate(50 50)"><ellipse rx="36" ry="15"/><ellipse rx="36" ry="15" transform="rotate(60)"/><ellipse rx="36" ry="15" transform="rotate(120)"/></g></g></svg>';
const AGENT_MARKS = `<span class="agents">${CLAUDE_MARK}${CODEX_MARK}</span>`;
const MARK_CSS = `.lg{width:17px;height:17px;flex:none;vertical-align:-3px}
.lgc{color:var(--claude)}.lgx{color:var(--ink)}
.agents{display:inline-flex;gap:7px;align-items:center;vertical-align:-3px;margin-left:5px}`;
const INSTALL_SH = "#!/usr/bin/env bash\n# feedback \u2014 install the local watcher.  Usage:\n#   curl -fsSL https://feedback.cybercorpresearch.com/install.sh | bash\nset -euo pipefail\nRAW=\"https://raw.githubusercontent.com/merinids212/feedback/main/cli\"\nDEST=\"$HOME/.claude/feedback\"\n\ngld(){ printf '\\033[38;5;230m%s\\033[0m\\n' \"$1\"; }\ndim(){ printf '\\033[38;5;187m%s\\033[0m\\n' \"$1\"; }\nerr(){ printf '\\033[38;5;203m%s\\033[0m\\n' \"$1\" >&2; }\n\ngld \"\u25c7 installing feedback (local watcher)\"\ncommand -v python3 >/dev/null || { err \"python3 required\"; exit 1; }\ncommand -v zsh     >/dev/null || { err \"zsh required (feedback is a zsh function)\"; exit 1; }\n\nmkdir -p \"$DEST\"\nfor f in fb.py feedback.zsh; do curl -fsSL \"$RAW/$f\" -o \"$DEST/$f\"; done\n\nLINE=\"source $DEST/feedback.zsh\"\nRC=\"$HOME/.zshrc\"\nif [ -f \"$RC\" ] && grep -qF \"$LINE\" \"$RC\"; then\n  dim \"  ~/.zshrc already sources feedback\"\nelse\n  printf '\\n# feedback \u2014 notes from friends tunnel into your coding agent\\n%s\\n' \"$LINE\" >> \"$RC\"\n  dim \"  wired into ~/.zshrc\"\nfi\n\ngld \"\u25c7 watcher installed\"\nif [ -s \"$DEST/secret\" ]; then\n  dim \"  secret present \u2014 you're ready. open a new terminal, then:\"\n  dim \"    feedback link                  # from your project dir — copies the URL\"\n  dim \"    feedback watch                 # notes land here\"\nelse\n  dim \"  one-time setup left \u2014 you host your own tiny Cloudflare Worker so the\"\n  dim \"  secret (which lets a friend's note run on YOUR machine) is yours alone:\"\n  dim \"    https://github.com/merinids212/feedback#setup\"\nfi\n";

// The slug in the URL *is* the credential. Without an explicit policy the browser sends
// it as the Referer to any third-party host a friend clicks through to, handing the link
// to a stranger. no-referrer stops that; the rest is standard hardening for a page an
// outsider loads: no framing (clickjack a friend into submitting), no MIME sniffing, and
// a CSP that allows only this page's own inline style/script and nothing off-host.
const HTML_HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "content-security-policy":
    "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; " +
    "img-src data:; form-action 'none'; frame-ancestors 'none'; base-uri 'none'; " +
    "connect-src 'self'",
};

function j(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { "content-type": "application/json" },
  });
}

// Constant-time compare: a plain === leaks how many leading bytes matched through
// response timing, which is enough to walk a secret one byte at a time over many tries.
function safeEqual(a, b) {
  const ea = new TextEncoder().encode(a), eb = new TextEncoder().encode(b);
  if (ea.length !== eb.length) return false;
  let diff = 0;
  for (let i = 0; i < ea.length; i++) diff |= ea[i] ^ eb[i];
  return diff === 0;
}

function authed(req, env) {
  const h = req.headers.get("authorization") || "";
  if (!env.SECRET) return false;            // never authorize against an unset secret
  return safeEqual(h, `Bearer ${env.SECRET}`);
}

// 9 chars from a 31-symbol alphabet ~= 44 bits — unguessable at any realistic rate,
// and rejection-sampled so the modulo doesn't quietly favour the first 8 letters.
function slugify(n = 9) {
  const A = "abcdefghjkmnpqrstuvwxyz23456789";      // no look-alikes (i/l/o/0/1)
  const limit = 256 - (256 % A.length);
  let out = "";
  while (out.length < n) {
    const buf = new Uint8Array(n * 2);
    crypto.getRandomValues(buf);
    for (const b of buf) {
      if (b >= limit) continue;
      out += A[b % A.length];
      if (out.length === n) break;
    }
  }
  return out;
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const p = url.pathname;

    if (p === "/api/new" && req.method === "POST") {
      if (!authed(req, env)) return j({ error: "unauthorized" }, 401);
      const b = await req.json();
      if (!b.project || !b.cwd) return j({ error: "project and cwd required" }, 400);
      const slug = slugify();
      const link = {
        slug, project: String(b.project).slice(0, 60), cwd: String(b.cwd).slice(0, 300),
        created: Date.now(),
        expires: Date.now() + Math.min(Math.max(Number(b.days) || 7, 1), 90) * 86400e3,
        max: Math.min(Number(b.max) || 50, 500), count: 0, dead: false,
      };
      await env.FEEDBACK.put(`link:${slug}`, JSON.stringify(link));
      return j({ slug, url: `https://feedback.cybercorpresearch.com/f/${slug}` });
    }

    if (p === "/api/inbox" && req.method === "GET") {
      if (!authed(req, env)) return j({ error: "unauthorized" }, 401);
      const list = await env.FEEDBACK.list({ prefix: "item:" });
      const items = [];
      for (const k of list.keys) {
        const v = await env.FEEDBACK.get(k.name, "json");
        if (v) items.push(v);
      }
      items.sort((a, b) => a.ts - b.ts);
      return j({ items });
    }

    if (p === "/api/ack" && req.method === "POST") {
      if (!authed(req, env)) return j({ error: "unauthorized" }, 401);
      const b = await req.json();
      for (const id of b.ids || []) await env.FEEDBACK.delete(`item:${id}`);
      return j({ ok: true });
    }

    if (p === "/api/links" && req.method === "GET") {
      if (!authed(req, env)) return j({ error: "unauthorized" }, 401);
      const list = await env.FEEDBACK.list({ prefix: "link:" });
      const links = [];
      for (const k of list.keys) {
        const v = await env.FEEDBACK.get(k.name, "json");
        if (v) links.push(v);
      }
      return j({ links });
    }

    if (p === "/api/kill" && req.method === "POST") {
      if (!authed(req, env)) return j({ error: "unauthorized" }, 401);
      const b = await req.json();
      const link = await env.FEEDBACK.get(`link:${b.slug}`, "json");
      if (link) { link.dead = true; await env.FEEDBACK.put(`link:${b.slug}`, JSON.stringify(link)); }
      return j({ ok: true });
    }

    const m = p.match(/^\/f\/([a-z0-9]{6,20})$/);
    if (m) {
      const link = await env.FEEDBACK.get(`link:${m[1]}`, "json");
      const alive = link && !link.dead && Date.now() < link.expires && link.count < link.max;

      if (req.method === "POST") {
        // Size first, liveness second: a dead or bogus slug shouldn't be a free way to
        // make the Worker buffer megabytes. MAX_TEXT applies after parsing — too late.
        const len = Number(req.headers.get("content-length") || 0);
        if (len > MAX_BODY) return j({ error: "too long" }, 413);
        if (!alive) return j({ error: "this link is no longer active" }, 410);
        const raw = await req.text();
        if (raw.length > MAX_BODY) return j({ error: "too long" }, 413);
        let b = {};
        try { b = JSON.parse(raw); } catch { b = {}; }
        const text = String(b.text || "").slice(0, MAX_TEXT).trim();
        if (!text) return j({ error: "empty" }, 400);
        const id = `${Date.now()}-${slugify().slice(0, 5)}`;
        await env.FEEDBACK.put(`item:${id}`, JSON.stringify({
          id, slug: link.slug, project: link.project, cwd: link.cwd,
          text, from: String(b.from || "").slice(0, 60), ts: Date.now(),
        }), { expirationTtl: 30 * 86400 });
        link.count++;
        await env.FEEDBACK.put(`link:${link.slug}`, JSON.stringify(link));
        return j({ ok: true });
      }

      return new Response(page(link, alive), {
        // a friend page is per-link and short-lived: never let an intermediary keep a copy
        headers: { ...HTML_HEADERS, "cache-control": "no-store" },
      });
    }

    if (p === "/install.sh") return new Response(INSTALL_SH, {
      headers: { "content-type": "text/x-shellscript; charset=utf-8" },
    });
    if (p === "/docs") return new Response(docs(), { headers: HTML_HEADERS });
    if (p === "/") return new Response(home(), { headers: HTML_HEADERS });
    return new Response("not found", { status: 404 });
  },
};

function page(link, alive) {
  const project = link ? esc(link.project) : "?";
  const body = !alive
    ? `<p class="dim">this feedback link is no longer active.</p>`
    : `
  <p class="dim">your note lands straight in <b>${project}</b>'s dev session — only they see it. plain words are perfect; <span class="mono">markdown</span> works too.</p>
  <form id="f">
    <div class="ed">
      <div class="tabs"><span class="tab on" id="tw" role="button" tabindex="0" onclick="mode(0)" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();mode(0)}">write</span><span class="tab" id="tp" role="button" tabindex="0" onclick="mode(1)" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();mode(1)}">preview</span><span class="cc" id="cc">0</span></div>
      <textarea id="t" maxlength="${MAX_TEXT}" placeholder="what's working · what's broken · what you wish it did&#10;&#10;- lists, **bold**, \`code\`, and links all render" autofocus></textarea>
      <div id="pv" class="pv" hidden></div>
    </div>
    <div class="row">
      <input id="n" maxlength="60" placeholder="your name (optional)">
      <button type="submit" id="send" disabled>send ↵</button>
    </div>
    <p class="hint"><b>Cmd/Ctrl + Enter</b> to send · nothing else required</p>
  </form>
  <p id="err" class="err" hidden></p>
  <p id="done" class="ok" hidden>◇ sent — thank you, it's already in the terminal. <a href="#" id="again">send another →</a></p>`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>feedback → ${project}</title><meta name="robots" content="noindex">${FAVICON}
<meta name="description" content="Drop a quick note — it lands straight in ${project}'s coding session.">
<meta property="og:title" content="feedback → ${project}">
<meta property="og:description" content="Drop a quick note — it lands straight in ${project}'s coding session.">
<meta property="og:type" content="website">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="feedback → ${project}">
<meta name="twitter:description" content="Drop a note — it lands in ${project}'s dev session, as a prompt for their coding agent.">
<meta name="theme-color" content="#0f0e0e">
<style>
${TOKENS}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.6 ui-monospace,"SF Mono",Menlo,Consolas,monospace;
display:flex;min-height:100svh;align-items:center;justify-content:center;padding:28px 20px}
.card{position:relative;z-index:1;width:100%;max-width:560px}
pre.wm{margin:0 0 7px;display:block;width:-moz-fit-content;width:fit-content;text-align:left;white-space:pre;
line-height:1.04;font-size:clamp(5px,1.7vw,10.5px);font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace;
background:linear-gradient(180deg,#fff9f0,#6b6259);
-webkit-background-clip:text;background-clip:text;color:transparent}
.arw{color:var(--dim);font-size:13.5px;letter-spacing:.02em;margin:0 0 14px}.arw b{color:var(--hi);font-weight:400}
.dim{color:var(--dim);font-size:13.5px} .dim b{color:var(--ink);font-weight:400}
textarea{width:100%;min-height:150px;margin-top:14px;background:transparent;border:1px solid var(--border);
color:var(--ink);font:inherit;padding:12px;resize:vertical;outline:none}
textarea:focus{border-color:var(--dim)}
.row{display:flex;gap:10px;margin-top:12px}
input{flex:1;background:transparent;border:1px solid var(--border);color:var(--ink);font:inherit;padding:9px 12px;outline:none}
input:focus{border-color:var(--dim)}
button{background:transparent;border:1px solid var(--border);color:var(--hi);font:inherit;padding:9px 18px;cursor:pointer;
transition:opacity .15s,border-color .15s}
button:hover:not(:disabled){border-color:var(--hi)}
button:disabled{opacity:.4;cursor:not-allowed;border-color:var(--line);color:var(--dim)}
.ok{color:var(--hi)}
.ok a{color:var(--dim);border-bottom:1px solid var(--border)}.ok a:hover{border-color:var(--hi)}
.err{color:var(--hi);font-size:13px;margin:14px 0 0;border-left:2px solid var(--hi);padding-left:9px}
.mono{color:var(--ink)}
.hint{color:var(--faint);font-size:11px;margin:8px 2px 0}.hint b{color:var(--dim);font-weight:400}
.ed{border:1px solid var(--border);margin-top:14px}
.tabs{display:flex;align-items:center;gap:2px;border-bottom:1px solid var(--line);padding:0 4px}
.tab{padding:8px 12px;color:var(--dim);cursor:pointer;font-size:12.5px;border-bottom:1px solid transparent;margin-bottom:-1px}
.tab.on{color:var(--hi);border-bottom-color:var(--hi)}
:focus-visible{outline:2px solid var(--hi);outline-offset:2px}
textarea:focus-visible,input:focus-visible{outline:none}
.cc{margin-left:auto;color:var(--faint);font-size:11px;padding-right:8px}
.ed textarea{border:0;margin:0;min-height:170px;line-height:1.6;background:transparent}
.pv{min-height:170px;padding:12px;font-size:14px;line-height:1.6;color:var(--ink);overflow-y:auto}
.pv h1,.pv h2,.pv h3{color:var(--hi);font-size:15px;margin:.6em 0 .3em}
.pv code{background:rgba(255,244,228,.08);padding:1px 5px;color:var(--ink)}
.pv a{color:var(--hi)}.pv ul{margin:.4em 0;padding-left:1.2em}.pv strong{color:var(--ink)}
.pv .empty{color:var(--faint)}
.foot{margin-top:26px;color:var(--faint);font-size:11.5px;text-align:center}
.foot a{color:var(--faint)}
</style></head><body>
<div class="card">
  <pre class="wm">███████╗███████╗███████╗██████╗ ██████╗  █████╗  ██████╗██╗  ██╗
██╔════╝██╔════╝██╔════╝██╔══██╗██╔══██╗██╔══██╗██╔════╝██║ ██╔╝
█████╗  █████╗  █████╗  ██║  ██║██████╔╝███████║██║     █████╔╝
██╔══╝  ██╔══╝  ██╔══╝  ██║  ██║██╔══██╗██╔══██║██║     ██╔═██╗
██║     ███████╗███████╗██████╔╝██████╔╝██║  ██║╚██████╗██║  ██╗
╚═╝     ╚══════╝╚══════╝╚═════╝ ╚═════╝ ╚═╝  ╚═╝ ╚═════╝╚═╝  ╚═╝</pre>
  <p class="arw">→ <b>${project}</b></p>
  ${body}
  <p class="foot">a <a href="https://portal.cybercorpresearch.com">cybercorpresearch</a> production</p>
</div>
<script>
const T=document.getElementById("t"),CC=document.getElementById("cc"),PV=document.getElementById("pv");
function esc(s){return s.replace(/[&<>]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[c]));}
function md(x){
  if(!x.trim())return '<span class="empty">nothing to preview yet</span>';
  var lines=x.split(/\\r?\\n/),out=[],ul=false;
  for(var ln of lines){
    var m;
    if(m=ln.match(/^(#{1,3})\\s+(.*)/)){ if(ul){out.push("</ul>");ul=false} out.push("<h"+m[1].length+">"+inl(m[2])+"</h"+m[1].length+">"); }
    else if(m=ln.match(/^\\s*[-*]\\s+(.*)/)){ if(!ul){out.push("<ul>");ul=true} out.push("<li>"+inl(m[1])+"</li>"); }
    else if(!ln.trim()){ if(ul){out.push("</ul>");ul=false} }
    else { if(ul){out.push("</ul>");ul=false} out.push("<div>"+inl(ln)+"</div>"); }
  }
  if(ul)out.push("</ul>");
  return out.join("");
}
function inl(s){ s=esc(s);
  s=s.replace(/\`([^\`]+)\`/g,"<code>$1</code>");
  s=s.replace(/\\*\\*([^*]+)\\*\\*/g,"<strong>$1</strong>");
  s=s.replace(/(https?:\\/\\/[^\\s]+)/g,'<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
  return s;
}
const SEND=document.getElementById("send"),SEND_LABEL=SEND?SEND.textContent:"send ↵";
function sync(){CC.textContent=T.value.length;if(SEND)SEND.disabled=!T.value.trim();}
if(T){T.addEventListener("input",sync);sync();
  T.addEventListener("keydown",e=>{if((e.metaKey||e.ctrlKey)&&e.key==="Enter"){e.preventDefault();document.getElementById("f").requestSubmit();}});}
function mode(pv){
  document.getElementById("tw").classList.toggle("on",!pv);
  document.getElementById("tp").classList.toggle("on",pv);
  if(pv){PV.innerHTML=md(T.value);PV.hidden=false;T.hidden=true;}
  else{T.hidden=false;PV.hidden=true;}
}
const f=document.getElementById("f"),ERR=document.getElementById("err"),DONE=document.getElementById("done");
if(f)f.addEventListener("submit",async e=>{
  e.preventDefault();
  const t=T.value.trim(); if(!t)return;
  ERR.hidden=true; SEND.disabled=true; SEND.textContent="sending…";
  try{
    const r=await fetch(location.pathname,{method:"POST",headers:{"content-type":"application/json"},
      body:JSON.stringify({text:t,from:document.getElementById("n").value})});
    if(r.ok){f.hidden=true;DONE.hidden=false;}
    else{throw new Error(r.status===410?"this link has expired — ask them for a fresh one":"couldn't send — please try again in a moment");}
  }catch(ex){
    ERR.textContent="⚠ "+(ex.message||"couldn't send — check your connection and retry");
    ERR.hidden=false; SEND.disabled=false; SEND.textContent=SEND_LABEL;
  }
});
const AG=document.getElementById("again");
if(AG)AG.addEventListener("click",e=>{
  e.preventDefault();
  DONE.hidden=true; f.hidden=false; mode(0); T.value=""; document.getElementById("n").value="";
  SEND.textContent=SEND_LABEL; sync(); T.focus();
});
</script></body></html>`;
}

function home() {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>feedback — a link into your coding agent</title>${FAVICON}
<meta name="description" content="A link you hand a friend. They type a note. It tunnels into a coding-agent session on your machine — Claude Code, Codex, whatever you run — and lands as a prompt.">
<meta property="og:title" content="feedback">
<meta property="og:description" content="A link you hand a friend — their note tunnels straight into your coding agent.">
<meta name="theme-color" content="#0f0e0e">
<style>
${TOKENS}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);
font:15px/1.65 ui-monospace,"SF Mono",Menlo,Consolas,monospace;-webkit-font-smoothing:antialiased;
display:flex;align-items:flex-start;justify-content:center;padding:24px}
.wrap{position:relative;z-index:1;width:100%;max-width:600px;padding:40px 0}
a{color:var(--hi);text-decoration:none}a:hover{text-decoration:underline}
pre.wm{margin:0 auto;display:block;width:-moz-fit-content;width:fit-content;text-align:left;white-space:pre;line-height:1.04;
font-size:clamp(5.5px,1.9vw,13px);font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace;
background:linear-gradient(180deg,#fff9f0,#6b6259);
-webkit-background-clip:text;background-clip:text;color:transparent}
.tag{color:var(--dim);margin:16px auto 0;max-width:520px;text-align:center}.tag b{color:var(--ink);font-weight:400}
/* agent marks — the one place this page spends color, each in its own real color */
.cl{color:var(--claude)}
${MARK_CSS}
.sub2{font-size:12.5px;color:var(--faint);margin-top:6px}
/* the demo is the explanation; these two lines are the caption under it */
.flow{margin:18px 0 0;color:var(--dim);font-size:12.5px;text-align:center;line-height:1.7}
.flow b{color:var(--ink);font-weight:400}
.agentline{margin:6px 0 0;color:var(--faint);font-size:12px;text-align:center}
.agentline a{color:var(--faint);text-decoration:underline;text-underline-offset:2px}
.agentline a:hover{color:var(--hi)}
.cmd{display:flex;align-items:center;gap:10px;border:1px solid var(--border);background:var(--panel);margin:26px 0 4px;padding:12px 14px}
.cmd code{flex:1;color:var(--ink);overflow-x:auto;white-space:nowrap;font-size:13.5px}
.cmd code b{color:var(--hi)}
.cp{background:transparent;border:1px solid var(--border);color:var(--dim);padding:5px 11px;cursor:pointer;font:inherit;font-size:12px}
.cp:hover{color:var(--hi);border-color:var(--dim)}.cp.ok{color:var(--hi);border-color:var(--hi)}
.req{color:var(--faint);font-size:12px;margin:6px 0 0;text-align:center}
h2{font-size:12px;font-weight:400;color:var(--dim);letter-spacing:.09em;margin:40px 0 8px}
h2::before{content:"── "}h2::after{content:" ──"}
.dl{color:var(--faint);font-size:12.5px;margin:30px 0 0;letter-spacing:.02em;text-align:center}.dl a{color:var(--hi)}
.term{border:1px solid var(--border);background:var(--panel);margin:34px 0 0}
.tbar{padding:7px 12px;border-bottom:1px solid var(--line);color:var(--dim);font-size:12px}
.tbar .dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--faint);margin-right:6px}
.term{display:flex;flex-direction:column}
.convo{padding:14px 14px 6px;height:264px;overflow-y:auto;display:flex;flex-direction:column;justify-content:flex-end;scrollbar-gutter:stable;white-space:pre-wrap;font-size:12.5px;line-height:1.65;color:var(--ink)}
.cbox{margin:6px 14px 14px;border:1px solid var(--border);padding:9px 12px;
  display:flex;align-items:baseline;gap:8px;font-size:12.5px}
.cpr{color:var(--hi)}
.cbox .cur{color:var(--hi)}
.term .p{color:var(--claude)}.term .dim{color:var(--dim)}.term .ok{color:var(--hi)}.convo .pk{color:var(--ink);text-decoration:underline;text-underline-offset:2px}.term .cur{color:var(--hi);animation:bl 1.1s steps(1) infinite}
@media(prefers-reduced-motion:reduce){.term .cur{animation:none}}
@keyframes bl{50%{opacity:0}}
.foot{margin-top:36px;color:var(--faint);font-size:12px}
.foot a{color:var(--dim)}
</style></head><body>
<div class="wrap">
  <pre class="wm">███████╗███████╗███████╗██████╗ ██████╗  █████╗  ██████╗██╗  ██╗
██╔════╝██╔════╝██╔════╝██╔══██╗██╔══██╗██╔══██╗██╔════╝██║ ██╔╝
█████╗  █████╗  █████╗  ██║  ██║██████╔╝███████║██║     █████╔╝ 
██╔══╝  ██╔══╝  ██╔══╝  ██║  ██║██╔══██╗██╔══██║██║     ██╔═██╗ 
██║     ███████╗███████╗██████╔╝██████╔╝██║  ██║╚██████╗██║  ██╗
╚═╝     ╚══════╝╚══════╝╚═════╝ ╚═════╝ ╚═╝  ╚═╝ ╚═════╝╚═╝  ╚═╝</pre>
  <p class="tag">a link you hand a friend — their note lands in your coding agent, as a prompt.</p>

  <div class="cmd"><span style="color:var(--hi)">❯</span>
    <code id="cmd">curl -fsSL <b>https://feedback.cybercorpresearch.com/install.sh</b> | bash</code>
    <button class="cp" id="cp" onclick="cp()">copy</button></div>
  <p class="req">macOS / Linux · zsh + python3 · one-time <a href="/docs#setup">Worker deploy</a>, hosted by you</p>

  <div class="term"><div class="tbar"><span class="dot"></span> <span class="cl">✳</span> claude code · ~/code/myapp</div><div class="convo" id="cv"></div><div class="cbox"><span class="cpr">›</span> <span id="ci"></span><span class="cur" id="ccur">█</span></div></div>

  <p class="flow"><b>you post a link</b> → <b>a friend jots a note</b> → <b>your agent picks it up</b>,
  as data to triage — never as instructions.</p>
  <p class="agentline">runs in Claude Code<span class="agents">${CLAUDE_MARK}</span> · Codex<span class="agents">${CODEX_MARK}</span> · <a href="/docs#agent">anything you can launch from a shell</a></p>

  <p class="dl"><a href="/docs">docs →</a>&nbsp;&nbsp;setup · commands · agent · safety</p>

  <p class="foot"><a href="/docs">docs</a> · <a href="https://github.com/merinids212/feedback">github</a>
  · a <a href="https://portal.cybercorpresearch.com">cybercorpresearch</a> production
  · <a href="https://hicham.io">hicham.io</a></p>
</div>
<script>
function cp(){var t="curl -fsSL https://feedback.cybercorpresearch.com/install.sh | bash";
navigator.clipboard.writeText(t).then(function(){var b=document.getElementById('cp');b.textContent='copied ✓';b.classList.add('ok');
setTimeout(function(){b.textContent='copy';b.classList.remove('ok')},1600)})}
(function(){
 var cv=document.getElementById('cv'), ci=document.getElementById('ci'), ccur=document.getElementById('ccur');
 if(!cv) return;
 function D(x){return '<span class="dim">'+x+'</span>';}
 function OK(x){return '<span class="ok">'+x+'</span>';}
 function PK(x){return '<span class="pk">'+x+'</span>';}
 var reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
 // two acts: (1) you mint + share a link, (2) later the friend's note lands and Claude fixes it.
 var acts=[
  { q:'feedback link', r:[
    '<span class="p">\u25cf</span> Bash('+D('feedback link')+')',
    '  '+D('\u23bf ')+PK('https://feedback\u2026/f/x7k2m9p'),
    D('     myapp \u00b7 7d \u00b7 this folder, auto-detected'),
    D('     copied to clipboard \u2014 text it to a friend')
  ]},
  { q:'any feedback come in?', r:[
    '<span class="p">\u25cf</span> Bash('+D('feedback pull')+')',
    D('  \u23bf 1 note \u00b7 myapp \u00b7 from alex'),
    D('     \u201cthe export button does nothing on mobile safari\u201d'),
    '',
    '<span class="p">\u25cf</span> Read('+D('src/export.ts')+')',
    D('  \u23bf onExport binds \u201cclick\u201d only \u2014 iOS Safari needs a touch event'),
    '',
    '<span class="p">\u25cf</span> Update('+D('src/export.ts')+')',
    '  '+D('\u23bf ')+OK('+')+D(' el.addEventListener(\u201ctouchend\u201d, onExport)'),
    '',
    '<span class="p">\u25cf</span> '+OK('Fixed on a branch, note cleared')+D(' \u2014 alex\u2019s note never left your session')
  ]}
 ];
 function reset(){ cv.innerHTML=''; ci.textContent=''; ccur.style.display=''; }
 function push(h){ cv.innerHTML+=h; cv.scrollTop=cv.scrollHeight; }
 if(reduce){
   cv.innerHTML=acts.map(function(a){return '<div>'+D('you \u203a ')+a.q+'</div>'+a.r.map(function(l){return '<div>'+l+'</div>';}).join('');}).join('<div>\u00a0</div>');
   ci.textContent=''; ccur.style.display='none'; return;
 }
 function run(){
  reset();
  var ai=0;
  function act(){
   var a=acts[ai], Q=a.q, k=0;
   (function type(){
     ci.textContent=Q.slice(0,k);
     if(k++<Q.length){ setTimeout(type, 42+Math.random()*58); }
     else { setTimeout(submit, 480); }
   })();
   function submit(){
     push('<div>'+D('you \u203a ')+Q+'</div>');
     ci.textContent='';
     var r=0;
     (function line(){
       if(r>=a.r.length){
         ai++;
         if(ai<acts.length){ push('<div>\u00a0</div>'); setTimeout(act, 900); }
         else { setTimeout(run, 3000); }
         return;
       }
       push('<div>'+a.r[r++]+'</div>');
       setTimeout(line, 280+Math.random()*240);
     })();
   }
  }
  act();
 }
 run();
})();
</script></body></html>`;
}

function docs() {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>feedback docs</title>${FAVICON}
<meta name="description" content="feedback — setup, commands, how it works, and safety.">
<meta name="theme-color" content="#0f0e0e">
<style>
${TOKENS}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.65 ui-monospace,"SF Mono",Menlo,Consolas,monospace;-webkit-font-smoothing:antialiased;display:flex;justify-content:center;padding:22px}
.wrap{width:100%;max-width:640px;padding:0 0 40px}
a{color:var(--hi);text-decoration:none}a:hover{text-decoration:underline}
nav{display:flex;align-items:baseline;gap:11px;padding:6px 0 10px;border-bottom:1px solid var(--line)}
nav .lg{font-size:19px;font-weight:700;letter-spacing:-.01em;color:var(--hi)}
nav .crumb{color:var(--faint);font-size:13px}
nav .sp{margin-left:auto;display:flex;gap:15px}
nav a.q{color:var(--dim);font-size:12.5px}nav a.q:hover{color:var(--hi)}
h2{font-size:12px;font-weight:400;color:var(--dim);letter-spacing:.09em;
margin:42px 0 11px;padding-top:14px;border-top:1px solid var(--line)}
h2::before{content:"── "}h2::after{content:" ──"}
p{color:var(--prose);font-size:13.5px;margin:11px 0;max-width:64ch}p b{color:var(--hi);font-weight:400}
${CODE_CHIP}
.cl{color:var(--claude)}   /* agent marks — the only color this page spends */
${MARK_CSS}
pre{border:1px solid var(--border);background:var(--panel);padding:12px 14px;overflow-x:auto;font-size:12.5px;line-height:1.75;color:var(--dim);white-space:pre;margin:12px 0}
pre .c{color:var(--faint)}pre .p{color:var(--hi)}
/* fixed layout so a long command in column one can't shove the description off-page */
table{width:100%;border-collapse:collapse;font-size:13px;margin:10px 0;table-layout:fixed}
td{border-top:1px solid var(--line);padding:9px 0;vertical-align:top;color:var(--prose)}
td:first-child{color:var(--dim);padding-right:18px;width:38%}  /* chip = command, dim = its args */
td code{white-space:nowrap}
ul li{margin:6px 0}
@media(max-width:560px){
  table,tbody,tr,td{display:block;width:auto}
  tr{border-top:1px solid var(--line);padding:8px 0}
  td{border-top:none;padding:2px 0;white-space:normal}
  td:first-child{padding:0 0 3px;color:var(--ink)}
}
ul{color:var(--prose);font-size:13px;padding-left:1.15em;margin:10px 0;max-width:64ch}li b{color:var(--hi);font-weight:400}
.foot{margin-top:42px;padding-top:16px;border-top:1px solid var(--line);color:var(--faint);font-size:12px}
.foot a{color:var(--dim)}
</style></head><body>
<div class="wrap">
  <nav><span class="lg">feedback</span><span class="crumb">/ docs</span>
    <span class="sp"><a class="q" href="/">home</a><a class="q" href="#agent">agent</a><a class="q" href="#safety">safety</a><a class="q" href="https://github.com/merinids212/feedback">github</a></span></nav>

  <h2>install</h2>
  <pre>❯ curl -fsSL <span class="p">https://feedback.cybercorpresearch.com/install.sh</span> | bash</pre>
  <p>macOS / Linux · needs <b>zsh</b> + <b>python3</b>. Drops a tiny local watcher into <code>~/.claude/feedback/</code> and sources it from your <code>~/.zshrc</code>. Open a new terminal after.</p>

  <h2 id="setup">setup — you host the Worker</h2>
  <p>A friend's note runs as a prompt on <b>your</b> machine, so <b>you</b> own the inbox and the secret — nobody else, not even us. One-time, needs a Cloudflare account + the repo:</p>
  <pre><span class="c"># from a clone of the repo</span>
cd worker
wrangler kv namespace create FEEDBACK      <span class="c"># put the id in wrangler.jsonc</span>
python3 -c "import secrets;print(secrets.token_urlsafe(32))" > ~/.claude/feedback/secret
chmod 600 ~/.claude/feedback/secret
wrangler secret put SECRET < ~/.claude/feedback/secret
wrangler deploy</pre>
  <p>The secret lives only in <code>~/.claude/feedback/secret</code> (chmod 600) and the Worker's env — never in the repo.</p>

  <h2>commands</h2>
  <table>
    <tr><td><code>feedback link</code> [dir] [--days N] [--max N]</td><td>mint a link for the current folder (or [dir]) — copies the URL to your clipboard</td></tr>
    <tr><td><code>feedback watch</code> [--auto]</td><td>wait for notes; Enter fires each in <code>claude</code> (<code>--auto</code> skips the Enter and runs in the background)</td></tr>
    <tr><td><code>feedback ls</code></td><td>list active links + inbox count</td></tr>
    <tr><td><code>feedback kill</code> &lt;slug&gt;</td><td>disable a link</td></tr>
  </table>
  <p>Launch flags come from <code>FEEDBACK_FLAGS</code>, else <code>PORTAL_FLAGS</code>, else none.</p>

  <h2 id="agent">which agent runs it${AGENT_MARKS}</h2>
  <p>A note is just a prompt, so anything that takes a prompt can handle it. <code>feedback watch</code>
  launches whichever agent it finds — <b>Claude Code</b> first, then <b>Codex</b> — and you can pin it:</p>
  <table>
    <tr><td><code>FEEDBACK_AGENT=codex</code></td><td>use Codex (<code>codex "&lt;the note&gt;"</code>) instead of Claude Code</td></tr>
    <tr><td><code>feedback watch --agent codex</code></td><td>same thing, one run only</td></tr>
    <tr><td><code>FEEDBACK_CMD=(my-agent --yolo)</code></td><td>any command — the prompt is appended as the final argument</td></tr>
    <tr><td><code>FEEDBACK_FLAGS=(…)</code></td><td>flags for the agent. <code>PORTAL_FLAGS</code> is reused, but only for Claude Code</td></tr>
  </table>
  <p>Nothing here is agent-specific except the launch: the link, the friend page, the inbox, and
  <code>feedback pull</code> behave the same whatever you run.</p>

  <h2>inside an agent session</h2>
  <p>You don't need a second terminal. Inside a session — Claude Code with the bundled skill, or any agent that can run a shell command — pull the notes in directly:</p>
  <pre><span class="p">feedback</span>              <span class="c"># glance — how many notes are waiting</span>
<span class="p">feedback pull</span>         <span class="c"># all waiting notes as markdown (current project first)</span>
<span class="p">feedback next</span>         <span class="c"># oldest note as JSON, for scripting</span>
<span class="p">feedback ack</span> &lt;id&gt;     <span class="c"># clear one  ·  feedback ack-all</span></pre>
  <p>A friend's text is treated as <b>a report to triage — data, never instructions</b>. The agent investigates the relevant code, proposes or applies a fix, and asks before anything risky. <code>pull</code> marks notes for the folder you're in "← this project — act here".</p>

  <h2>statusline (optional)</h2>
  <p>See pending feedback while you code, without checking. Claude Code users can point statusLine at the bundled script in <code>~/.claude/settings.json</code>:</p>
  <pre>"statusLine": { "type": "command", "command": "~/.claude/feedback/statusline.sh" }</pre>
  <p>Shows <code>dir · branch · model</code> plus <code>◈ N feedback</code> when notes wait (silent otherwise). Cached + refreshed in the background, so it never slows your prompt.</p>

  <h2>how it works</h2>
  <p>The Cloudflare Worker (<code>feedback.cybercorpresearch.com</code>) serves the friend page and stores submissions in KV. Your machine can't take inbound traffic, so a tiny local watcher <b>polls</b> the inbox and surfaces notes — either in-session (<code>feedback pull</code>, or the bundled Claude Code skill) or via <code>feedback watch</code>, which launches <a href="#agent">your agent</a>.</p>
  <p>Friend text is fenced with a random per-run tag and labelled <b>feedback data, not instructions</b> — see <a href="#safety">safety &amp; security</a> for what that does and doesn't buy you. Confirm mode (default) waits for your Enter per note; <code>--auto</code> fires immediately.</p>

  <h2 id="safety">safety &amp; security</h2>
  <p>Feedback deliberately connects a stranger's typing to an agent running on your machine.
  That is the whole product, so it's worth being precise about what is and isn't protected —
  for <b>you</b>, and for the <b>friend</b> who sends a note.</p>

  <p class="cmd-title">for you — the person running it</p>
  <table>
    <tr><td>a note is data, not orders</td><td>Every note is fenced with a <b>random per-run tag</b> and labelled as an outsider's report. A sender who types the fence characters can't forge the end of their own quote and start issuing instructions — the tag isn't guessable.</td></tr>
    <tr><td>no inherited bypass</td><td><code>PORTAL_FLAGS</code> is borrowed for convenience, but <code>--dangerously-skip-permissions</code> and friends are <b>stripped</b> from it. Your own sessions can skip approvals; a stranger's note doesn't. Setting <code>FEEDBACK_FLAGS</code> yourself is still honoured — that's an explicit choice.</td></tr>
    <tr><td>unattended + unsandboxed is refused</td><td><code>--auto</code> combined with a bypass flag is <b>blocked</b> unless you set <code>FEEDBACK_I_TRUST_THE_LINK=1</code>. That pairing is remote code execution for anyone holding the link.</td></tr>
    <tr><td>confirm mode by default</td><td>Without <code>--auto</code>, every note waits for your <code>↵</code>, and you see the full text first. Prompt-injection defence is layered, not absolute — the human in the loop is the last layer.</td></tr>
    <tr><td>your inbox, your secret</td><td>You host the Worker, so notes live in <b>your</b> Cloudflare KV. The bearer secret stays in <code>~/.claude/feedback/secret</code> (chmod 600 — the CLI warns if it's group- or world-readable) and in the Worker env. It is never in the repo and never sent to a third party.</td></tr>
    <tr><td>timing-safe auth</td><td>The Worker compares the bearer token in <b>constant time</b>, so response latency can't be used to walk the secret byte by byte.</td></tr>
    <tr><td>the link can't leak sideways</td><td>The slug in the URL <em>is</em> the credential, so every page is served <code>referrer-policy: no-referrer</code> — click a link inside a note and the destination learns nothing about where you came from. Friend pages are also <code>no-store</code>, <code>DENY</code>-framed, <code>nosniff</code>, and under a CSP that permits only this page's own inline assets.</td></tr>
    <tr><td>bodies are capped before parsing</td><td>The public endpoint rejects anything over 16 KB with a 413 rather than buffering it — the 4,000-character limit applies after parsing, which is too late to matter.</td></tr>
    <tr><td>bounded blast radius</td><td>Notes are capped at 4,000 characters, trimmed further before an agent sees them, and expire from KV after 30 days. Links expire (7d default) and cap submissions (50 default). <code>feedback kill &lt;slug&gt;</code> ends one immediately.</td></tr>
  </table>

  <p class="cmd-title">for your friend — the person sending</p>
  <table>
    <tr><td>no account, no tracking</td><td>The page asks for a note and an optional name. No sign-in, no cookies, no analytics, no IP logging beyond what Cloudflare does to serve the request.</td></tr>
    <tr><td>their words go one place</td><td>Straight to your inbox. Not to us, not to a model provider — until you choose to hand the note to your agent.</td></tr>
    <tr><td>the page can't be turned on them</td><td>Everything rendered is escaped; the markdown preview only ever links <code>http(s)</code> URLs, so a note can't inject script into the page — theirs or anyone's.</td></tr>
    <tr><td>links are unguessable</td><td>9 characters from a 31-symbol alphabet (~44 bits), rejection-sampled so the randomness isn't skewed, and pages are <code>noindex</code>. Nobody stumbles onto your link.</td></tr>
  </table>

  <p class="cmd-title">what this does <em>not</em> protect against</p>
  <ul>
    <li><b>A hostile note is still a prompt.</b> Fencing and labelling raise the bar; they are not a proof. Agents can be talked into things. Keep confirm mode on for links you've shared beyond people you trust.</li>
    <li><b>Anyone with the link can write to your inbox</b> until it expires or hits its cap. The link <em>is</em> the credential — treat it like one, and <code>feedback kill</code> it when the round of feedback is done.</li>
    <li><b>The project's folder path is stored with each note</b> (that's how notes route to the right repo). It sits in your own KV, but it is a path off your machine.</li>
    <li><b>No per-IP rate limit.</b> Someone with the link can burn through the submission cap. The cap, not throttling, is what bounds it.</li>
  </ul>

  <p class="foot"><a href="/">home</a> · <a href="https://github.com/merinids212/feedback">github</a> · a <a href="https://portal.cybercorpresearch.com">cybercorpresearch</a> production · <a href="https://hicham.io">hicham.io</a> · <a href="https://x.com/merinids">@merinids</a></p>
</div>
</body></html>`;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
