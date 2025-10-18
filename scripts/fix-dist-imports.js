#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full);
    else if (e.isFile() && full.endsWith('.js')) fixFile(full);
  }
}

function fixFile(file) {
  let s = fs.readFileSync(file, 'utf8');
  // Replace import from './something' or './something/whatever' to './something.js' when needed
  s = s.replace(/(from\s+['"])(\.\/[^'";]+?)(['"])/g, (m, p1, p2, p3) => {
    // if already has an extension or is a package import, leave
    if (/\.[a-z0-9]+$/i.test(p2)) return m;
    // ignore JSON imports
    if (p2.endsWith('.json')) return m;
    return p1 + p2 + '.js' + p3;
  });
  fs.writeFileSync(file, s, 'utf8');
}

const dist = path.join(process.cwd(), 'dist');
if (!fs.existsSync(dist)) {
  console.warn('dist/ not found, skipping fix-dist-imports');
  process.exit(0);
}
walk(dist);
console.log('fix-dist-imports: done');
