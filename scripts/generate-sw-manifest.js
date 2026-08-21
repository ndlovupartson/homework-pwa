#!/usr/bin/env node
// Generates public/asset-manifest.json — every file the service worker
// should precache on install, so a first-time visit is fully cached even
// before a second navigation lets clients.claim() take over. Run this
// after adding/removing any src/ file. (A real Vite build would normally
// do this via a PWA plugin; this project stays dependency-free, so it's a
// small script instead.)

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC_DIR = path.join(ROOT, 'src');
const PUBLIC_DIR = path.join(ROOT, 'public');

function walk(dir, exts) {
  let results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results = results.concat(walk(full, exts));
    } else if (exts.some((ext) => entry.name.endsWith(ext))) {
      results.push(full);
    }
  }
  return results;
}

const srcFiles = walk(SRC_DIR, ['.js', '.css']).map((f) => '/' + path.relative(ROOT, f).replace(/\\/g, '/'));

const rootAssets = [
  '/',
  '/index.html',
  '/manifest.json',
  '/offline.html',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

const manifest = [...new Set([...rootAssets, ...srcFiles])].sort();

fs.writeFileSync(path.join(PUBLIC_DIR, 'asset-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`Wrote ${manifest.length} entries to public/asset-manifest.json`);
