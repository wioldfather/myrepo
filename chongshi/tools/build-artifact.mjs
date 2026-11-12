// Packages the app as a claude.ai Artifact page: one HTML fragment with the stylesheet inlined, next to the
// same js/ modules. Usage: node tools/build-artifact.mjs <out-dir>
import { readFileSync, writeFileSync, mkdirSync, cpSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = process.argv[2];
if (!out) throw new Error('usage: node tools/build-artifact.mjs <out-dir>');
const html = readFileSync(join(root, 'index.html'), 'utf8');
const body = html.slice(html.indexOf('<!-- app:start -->') + 18, html.indexOf('<!-- app:end -->')).trim();
const css = readFileSync(join(root, 'app.css'), 'utf8');
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'chongshi.html'), `<title>重拾 Chóngshí</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow:wght@500;600;700&display=swap">
<style>
${css}</style>
${body}
`);
cpSync(join(root, 'js'), join(out, 'js'), { recursive: true });
console.log('artifact page written to ' + join(out, 'chongshi.html'));
