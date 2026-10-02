// ModelSmith build step.
// The Paint studio and the 3D builder are each one big closure, so they can't
// be loaded as separate <script> files (their sections share private variables).
// Instead they are EDITED as numbered fragments under src/ and joined here into
// the single files index.html loads.
//
//   node build.js          rebuild both bundles
//
// Fragments are concatenated byte-for-byte in filename order, so line breaks
// inside a fragment matter — don't reformat the first/last lines of a file.
// Never edit js/08-builder-3d.js or js/10-paint-studio.js directly; the next
// build overwrites them.
const fs = require('fs');
const path = require('path');

const BUNDLES = {
  'js/08-builder-3d.js': 'src/builder-3d',
  'js/10-paint-studio.js': 'src/paint-studio'
};

for (const [out, dir] of Object.entries(BUNDLES)) {
  const files = fs.readdirSync(path.join(__dirname, dir))
    .filter((f) => f.endsWith('.js'))
    .sort();
  const text = files
    .map((f) => fs.readFileSync(path.join(__dirname, dir, f), 'utf8'))
    .join('');
  fs.writeFileSync(path.join(__dirname, out), text);
  console.log(out + ' <- ' + files.length + ' files (' + text.length + ' chars)');
}
