const fs = require('node:fs');
const path = require('node:path');

// Check literal application asset paths in maintained source/config, not output
// folders. Dynamic/native resource generation still needs its own tests.
function checkAssets(root) {
  const failures = [], checked = new Set();
  function inspect(file) {
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(/["'`]((?:\.\.\/|\.\/)*assets\/[^"'`\r\n]+)["'`]/g)) {
      const request = match[1];
      if (request.includes('${')) continue;
      const target = path.resolve(request.startsWith('.') ? path.dirname(file) : root, request);
      checked.add(target);
      if (!fs.existsSync(target) || !fs.statSync(target).isFile()) failures.push(`${path.relative(root, file)}: missing ${request}`);
    }
  }
  function scan(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) scan(file);
      else if (/\.(?:tsx?|jsx?|cjs|mjs|json)$/.test(file)) inspect(file);
    }
  }
  for (const name of ['app.json', 'app.config.js']) if (fs.existsSync(path.join(root, name))) inspect(path.join(root, name));
  scan(path.join(root, 'src'));
  // Plugin paths may be project-root-relative, so do not interpret arbitrary
  // plugin strings as JS-relative require calls here.
  return {failures, checked: checked.size};
}
module.exports = {checkAssets};
if (require.main === module) {
  const result = checkAssets(path.resolve(__dirname, '..'));
  if (result.failures.length) { console.error(result.failures.join('\n')); process.exitCode = 1; }
  else console.log(`Asset references passed (${result.checked} literal asset paths).`);
}
