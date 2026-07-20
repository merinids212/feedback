// Renders the actual home + friend pages the Worker serves and parse-checks every
// inline <script>. Guards the template-literal escaping trap: a regex like /\n/ or
// /\s+/ written inside the page() backtick template silently becomes a real newline /
// a dropped backslash in the emitted JS, breaking the whole <script> at browser runtime.
// node --check on the Worker file can't catch this (the OUTER template is valid); only
// evaluating the emitted script does. Run: node tests/render_check.mjs
import { readFileSync } from "node:fs";
import vm from "node:vm";

const src = readFileSync(new URL("../worker/index.js", import.meta.url), "utf8");
// import the Worker as ESM without a package.json — a data: URL is treated as a module,
// so `export default` is preserved and Node's global Request/Response/URL/crypto suffice.
const worker = (await import("data:text/javascript," + encodeURIComponent(src))).default;

const link = { slug: "abcdefgh", project: "demoapp", cwd: "/tmp/demoapp",
  created: 0, expires: 2e12, max: 9, count: 0, dead: false };
// put/delete are no-ops: the submission path writes, and we only care about the response
const env = { FEEDBACK: { get: async () => link, put: async () => {}, delete: async () => {} }, SECRET: "test" };

const render = async (path) =>
  (await worker.fetch(new Request("https://feedback.example" + path), env)).text();

const scripts = (html) => {
  const out = []; const re = /<script>([\s\S]*?)<\/script>/g; let m;
  while ((m = re.exec(html))) out.push(m[1]);
  return out;
};

let fail = 0;
// docs is intentionally script-free (nothing interactive on it), so it isn't required
// to carry one — the other two are, and every block that exists must parse.
for (const [name, path, needsScript] of
     [["home", "/", true], ["friend", "/f/abcdefgh", true], ["docs", "/docs", false]]) {
  const html = await render(path);
  const blocks = scripts(html);
  if (blocks.length === 0) {
    if (needsScript) { console.error(`  ✗ ${name}: no <script> found`); fail++; }
    else console.log(`  ✓ ${name}: no inline script (nothing interactive)`);
    continue;
  }
  blocks.forEach((s, i) => {
    try { new vm.Script(s); console.log(`  ✓ ${name} script[${i}] parses (${s.length}b)`); }
    catch (e) { console.error(`  ✗ ${name} script[${i}] FAILS: ${e.message}`); fail++; }
  });
}

// spot-check that the emitted markdown regexes are intact (not mangled to /s/ etc.)
const friend = await render("/f/abcdefgh");
for (const needle of ["/\\r?\\n/", "/^(#{1,3})\\s+", "https?:\\/\\/"]) {
  if (friend.includes(needle)) console.log(`  ✓ friend regex intact: ${needle}`);
  else { console.error(`  ✗ friend regex mangled — missing: ${needle}`); fail++; }
}

// branding is monochrome: the only chromatic value any page may emit is Claude's own
// coral (#d97757), worn by the Claude mark. Anything else is a regression.
for (const [name, path] of [["home", "/"], ["friend", "/f/abcdefgh"], ["docs", "/docs"]]) {
  const html = await render(path);
  const chromatic = [...new Set([...html.matchAll(/#([0-9a-fA-F]{6})\b/g)].map(m => m[1].toLowerCase()))]
    .filter(h => {
      const [r, g, b] = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
      const spread = Math.max(r, g, b) - Math.min(r, g, b);
      // warm neutrals are the brand; the absolute floor keeps dark tints (where a small
      // spread is a large ratio) from tripping the check. Claude's coral is the exception.
      return spread > Math.max(18, 0.18 * Math.max(r, g, b)) && h !== "d97757";
    });
  if (chromatic.length) { console.error(`  ✗ ${name} has off-brand color: #${chromatic.join(", #")}`); fail++; }
  else console.log(`  ✓ ${name} is warm-neutral (Claude coral aside)`);
}

// the friend page is loaded by someone who isn't us: the slug in its URL is a credential,
// so it must not leak as a Referer, be framed, be sniffed, or be cached by an intermediary
{
  const r = await worker.fetch(new Request("https://feedback.example/f/abcdefgh"), env);
  const want = {
    "referrer-policy": "no-referrer",
    "x-frame-options": "DENY",
    "x-content-type-options": "nosniff",
    "cache-control": "no-store",
  };
  for (const [h, v] of Object.entries(want)) {
    if (r.headers.get(h) === v) console.log(`  ✓ friend page sets ${h}: ${v}`);
    else { console.error(`  ✗ friend page ${h} = ${r.headers.get(h)} (want ${v})`); fail++; }
  }
  const csp = r.headers.get("content-security-policy") || "";
  if (csp.includes("default-src 'none'") && csp.includes("frame-ancestors 'none'"))
    console.log("  ✓ friend page CSP locks the page to its own inline assets");
  else { console.error("  ✗ friend page CSP too permissive: " + csp); fail++; }

  // MAX_TEXT is applied after parsing, so the body itself needs a ceiling
  const big = await worker.fetch(new Request("https://feedback.example/f/abcdefgh", {
    method: "POST", headers: { "content-length": "2000000" },
    body: JSON.stringify({ text: "x".repeat(30000) }),
  }), env);
  if (big.status === 413) console.log("  ✓ oversized submission rejected before parsing (413)");
  else { console.error(`  ✗ oversized submission returned ${big.status}`); fail++; }

  const ok = await worker.fetch(new Request("https://feedback.example/f/abcdefgh", {
    method: "POST", body: JSON.stringify({ text: "the export button does nothing" }),
  }), env);
  if (ok.status === 200) console.log("  ✓ a normal submission still goes through");
  else { console.error(`  ✗ normal submission returned ${ok.status}`); fail++; }
}

console.log(fail ? `\nrender_check: ${fail} FAILED` : "\nrender_check: all inline scripts parse");
process.exit(fail ? 1 : 0);
