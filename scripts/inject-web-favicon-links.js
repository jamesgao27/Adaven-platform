#!/usr/bin/env node
/**
 * Ensure exported Expo web index.html points at the product favicon assets
 * we copy into dist/ (public/favicon.ico + favicon-32.png).
 */
const fs = require('fs');
const path = require('path');

const distDir = path.resolve(process.cwd(), process.argv[2] || 'dist');
const indexPath = path.join(distDir, 'index.html');
if (!fs.existsSync(indexPath)) {
  console.error(`inject-web-favicon-links: missing ${indexPath}`);
  process.exit(1);
}

const links = [
  '<link rel="icon" href="/favicon.ico" />',
  '<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png" />',
].join('');

let html = fs.readFileSync(indexPath, 'utf8');
html = html
  .replace(/<link[^>]*rel=["'](?:shortcut )?icon["'][^>]*>/gi, '')
  .replace(/<\/head>/i, `  ${links}</head>`);
fs.writeFileSync(indexPath, html);
console.log(`inject-web-favicon-links: updated ${indexPath}`);
