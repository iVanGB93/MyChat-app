const fs = require('node:fs');
const path = require('node:path');

const servicesRoot = path.resolve(__dirname, '..', 'src', 'services');

function collectFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectFiles(absolute);
    return /\.(ts|tsx)$/.test(entry.name) ? [absolute] : [];
  });
}

const files = collectFiles(servicesRoot);
const fileSet = new Set(files.map((file) => path.normalize(file)));

function resolveImport(fromFile, request) {
  if (!request.startsWith('.')) return null;
  const base = path.resolve(path.dirname(fromFile), request);
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, 'index.ts'),
    path.join(base, 'index.tsx'),
  ];
  return candidates.map(path.normalize).find((candidate) => fileSet.has(candidate)) ?? null;
}

const importPattern = /(?:from\s*|import\s*(?:\(\s*)?|require\s*\(\s*)['"]([^'"]+)['"]/g;
const graph = new Map();
for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  const dependencies = new Set();
  for (const match of source.matchAll(importPattern)) {
    const resolved = resolveImport(file, match[1]);
    if (resolved) dependencies.add(resolved);
  }
  graph.set(path.normalize(file), [...dependencies]);
}

const visiting = new Set();
const visited = new Set();
const stack = [];
const cycles = [];

function visit(file) {
  if (visiting.has(file)) {
    const start = stack.indexOf(file);
    cycles.push([...stack.slice(start), file]);
    return;
  }
  if (visited.has(file)) return;
  visiting.add(file);
  stack.push(file);
  for (const dependency of graph.get(file) ?? []) visit(dependency);
  stack.pop();
  visiting.delete(file);
  visited.add(file);
}

for (const file of graph.keys()) visit(file);

if (cycles.length > 0) {
  console.error('Service dependency cycle(s) detected:');
  for (const cycle of cycles) {
    console.error(cycle.map((file) => path.relative(servicesRoot, file)).join(' -> '));
  }
  process.exit(1);
}

console.log(`Service dependency check passed (${files.length} modules).`);
