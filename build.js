// Build the single-file app: dist/truchet.html
// inlines src/style.css + src/engine.js + src/app.js + src/photo.js into index.html.
const fs = require('fs');
const path = require('path');
const root = __dirname;
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

let html = read('index.html');
html = html.replace('<link rel="stylesheet" href="src/style.css">',
  () => '<style>\n' + read('src/style.css') + '\n</style>');
html = html.replace(
  '<script src="src/engine.js"></script>\n<script src="src/app.js"></script>\n<script src="src/photo.js"></script>',
  () => ['engine.js', 'app.js', 'photo.js']
    .map((f) => '<script>\n' + read('src/' + f) + '\n</script>')
    .join('\n'));

if (/<script src=|<link rel="stylesheet"/.test(html)) {
  console.error('build: external references remain — aborting');
  process.exit(1);
}
const out = path.join(root, 'dist');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'truchet.html'), html);
console.log('wrote dist/truchet.html', (html.length / 1024).toFixed(1) + ' KB');
