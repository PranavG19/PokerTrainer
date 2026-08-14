#!/usr/bin/env node
// Splice workflow screen output into the Nocturne Lab.
// Usage: node splice-screens.cjs screens.json
// screens.json is an array of { id, screenTag, css, html }.
const fs = require('fs');
const path = require('path');

const LAB = path.join(__dirname, 'index.html');
const jsonPath = process.argv[2];
if (!jsonPath) { console.error('usage: node splice-screens.cjs screens.json'); process.exit(1); }

const screens = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
let html = fs.readFileSync(LAB, 'utf8');

const CSS_MARK = '/* SCREENS-CSS-MARKER */';
const HTML_MARK = '<!-- SCREENS-HTML-MARKER -->';
if (!html.includes(CSS_MARK) || !html.includes(HTML_MARK)) {
  console.error('markers missing — abort'); process.exit(1);
}

const cssBlocks = [];
const htmlBlocks = [];
for (const s of screens) {
  if (!s || !s.html) { console.error('skip empty screen', s && s.id); continue; }
  // idempotency: don't double-insert an id
  if (html.includes('data-screen-id="' + s.id + '"')) {
    console.error('already present, skipping', s.id); continue;
  }
  if (s.css && s.css.trim()) cssBlocks.push('\n  /* ---- ' + s.id + ' ---- */\n' + s.css.trim());
  // tag the section so re-runs are idempotent
  const frag = s.html.replace(/<section class="screen"/, '<section class="screen" data-screen-id="' + s.id + '"');
  htmlBlocks.push('\n      <!-- ' + (s.screenTag || s.id).toUpperCase() + ' -->\n      ' + frag.trim());
}

html = html.replace(CSS_MARK, cssBlocks.join('\n') + '\n  ' + CSS_MARK);
html = html.replace(HTML_MARK, htmlBlocks.join('\n') + '\n      ' + HTML_MARK);

fs.writeFileSync(LAB, html);
console.error('spliced ' + htmlBlocks.length + ' screens (' + cssBlocks.length + ' css blocks)');
