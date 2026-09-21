// scripts/copy-vendor.js
//
// The only thing `npm run build` does: put the lottie-web SVG player where
// public/index.html can load it by relative path. No network, no compiler.
'use strict';
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'node_modules', 'lottie-web', 'build', 'player', 'lottie_svg.min.js');
const OUT = path.join(__dirname, '..', 'public', 'vendor');

if (!fs.existsSync(SRC)) {
  // The player is committed under public/vendor/ as well, so a build without
  // node_modules (or on an engine that skips this script) still serves it.
  console.warn('copy-vendor: lottie-web not installed, keeping committed copy');
  process.exit(0);
}
fs.mkdirSync(OUT, { recursive: true });
fs.copyFileSync(SRC, path.join(OUT, 'lottie_svg.min.js'));
console.log('copy-vendor: public/vendor/lottie_svg.min.js');
