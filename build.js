// Build the single-file app: dist/truchet.html
// inlines src/style.css + engine.js + app.js + photo.js + fill.js into index.html.
const fs = require('fs');
const path = require('path');
const root = __dirname;
// Normalise on read. Windows checkouts carry CRLF (core.autocrlf=true here), and
// matching a block that is joined with \n then silently matches nothing: the
// script tags survive into the output and the guard below aborts the build.
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n?/g, '\n');

let html = read('index.html');
html = html.replace('<link rel="stylesheet" href="src/style.css">',
  () => '<style>\n' + read('src/style.css') + '\n</style>');
for (const f of ['engine.js', 'app.js', 'photo.js', 'fill.js']) {
  html = html.replace('<script src="src/' + f + '"></script>',
    () => '<script>\n' + read('src/' + f) + '\n</script>');
}

if (/<script src=|<link rel="stylesheet"/.test(html)) {
  console.error('build: external references remain — aborting');
  process.exit(1);
}
const out = path.join(root, 'dist');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'truchet.html'), html);
console.log('wrote dist/truchet.html', (html.length / 1024).toFixed(1) + ' KB');
