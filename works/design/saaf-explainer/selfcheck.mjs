/* Minimal self-check: every id and in-page anchor referenced by the JS/HTML exists.
   Run: node selfcheck.mjs */
import { readFileSync } from 'node:fs';

const read = (f) => readFileSync(new URL(f, import.meta.url), 'utf8');
const html = read('./index.html');
const js = read('./main.js');

const fail = (msg, list) => { console.error(msg, list); process.exit(1); };

new Function(js); // syntax gate

const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));

const wanted = [...js.matchAll(/getElementById\('([^']+)'\)/g)].map((m) => m[1]);
const missing = [...new Set(wanted)].filter((id) => !ids.has(id));
if (missing.length) fail('main.js references missing ids:', missing);

const rootIds = [...js.matchAll(/querySelector(?:All)?\('#([\w-]+)/g)].map((m) => m[1]);
const badRoots = [...new Set(rootIds)].filter((id) => !ids.has(id));
if (badRoots.length) fail('main.js references missing selector roots:', badRoots);

const anchors = [...html.matchAll(/href="#([\w-]+)"/g)].map((m) => m[1]);
const badAnchors = [...new Set(anchors)].filter((a) => !ids.has(a));
if (badAnchors.length) fail('html links to missing anchors:', badAnchors);

if (!html.includes('main.js')) fail('index.html does not load main.js', []);
if (!html.includes('style.css')) fail('index.html does not load style.css', []);

console.log(`selfcheck ok: ${ids.size} ids, ${wanted.length} getElementById calls, ${anchors.length} in-page links`);
