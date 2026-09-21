// scripts/vendor-emoji.js
'use strict';
const fs = require('fs');
const path = require('path');
const { EMOJI } = require('../public/emoji-manifest.js');
const OUT = path.join(__dirname, '..', 'public', 'emoji');
const URL = 'https://fonts.gstatic.com/s/e/notoemoji/latest/{cp}/lottie.json';
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  for (const [key, e] of Object.entries(EMOJI)) {
    const res = await fetch(URL.replace('{cp}', e.cp));
    if (!res.ok) throw new Error(`${res.status} ${key}`);
    fs.writeFileSync(path.join(OUT, `${e.cp}.json`), Buffer.from(await res.arrayBuffer()));
  }
})().catch((err) => { console.error(err); process.exit(1); });
