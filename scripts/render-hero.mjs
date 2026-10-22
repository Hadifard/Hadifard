#!/usr/bin/env node
/**
 * Renders the animated README banner (assets/hero.webp) from the live 3D page.
 *
 *   node scripts/render-hero.mjs <path-to-site-folder> [out.webp]
 *
 * The page is opened with ?capture=1, which switches it to a deterministic,
 * perfectly looping camera + "tour" through the pinned-repo neurons. Needs:
 *   npm i playwright && npx playwright install chromium     and     ffmpeg (with libwebp)
 */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { chromium } from 'playwright';

const siteDir = path.resolve(process.argv[2] || '../site');
const outFile = path.resolve(process.argv[3] || 'assets/hero.webp');
const FPS = +(process.env.HERO_FPS || 12);
const WIDTH = +(process.env.HERO_W || 1200);
const HEIGHT = +(process.env.HERO_H || 540);
const QUALITY = process.env.HERO_Q || '62';

const mime = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.woff2': 'font/woff2', '.png': 'image/png', '.webp': 'image/webp' };
const server = http.createServer((req, res) => {
  let p = path.join(siteDir, decodeURIComponent(req.url.split('?')[0]));
  if (p.endsWith(path.sep)) p += 'index.html';
  if (!p.startsWith(siteDir)) { res.writeHead(403); return res.end(); }
  fs.readFile(p, (e, b) => { if (e) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': mime[path.extname(p)] || 'application/octet-stream' }); res.end(b); });
}).listen(0);
const port = server.address().port;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hero-'));
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 });
page.on('pageerror', e => console.error('page error:', e.message));
await page.goto(`http://localhost:${port}/index.html?capture=1`);
await page.waitForFunction('window.__ready === true', null, { timeout: 120000 });
const loop = await page.evaluate('window.__loopSeconds');
const frames = Math.round(loop * FPS);
console.log(`rendering ${frames} frames (${loop}s @ ${FPS}fps, ${WIDTH}x${HEIGHT})`);
for (let i = 0; i < frames; i++) {
  await page.evaluate(t => window.__frame(t), i / FPS);
  await page.screenshot({ path: path.join(tmp, `f${String(i).padStart(4, '0')}.png`) });
  if (i % 20 === 0) console.log(`  frame ${i}/${frames}`);
}
await browser.close(); server.close();

fs.mkdirSync(path.dirname(outFile), { recursive: true });
const ff = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(tmp, 'f%04d.png'),
  '-c:v', 'libwebp_anim', '-lossless', '0', '-q:v', QUALITY, '-compression_level', '6', '-loop', '0', outFile], { stdio: 'inherit' });
if (ff.status !== 0) { console.error('ffmpeg failed'); process.exit(1); }
// poster (first frame) used as a static fallback
fs.copyFileSync(path.join(tmp, 'f0000.png'), outFile.replace(/\.webp$/, '-poster.png'));
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`wrote ${outFile} (${(fs.statSync(outFile).size / 1048576).toFixed(2)} MB)`);
