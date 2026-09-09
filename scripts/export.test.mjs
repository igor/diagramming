// diagramming export pipeline — runtime tests (node:test).
// Covers CLI parsing, input validation, overwrite refusal, offline font
// embedding (including rejection of invalid font files and undecodable faces),
// preview behavior in normal, no-JS and reduced-motion browser contexts,
// PNG + frozen-SVG fidelity at mid-transit and end (pixel comparisons plus a
// transformed-position assertion on the moving chip), true-motion MP4
// uniqueness, ffprobe checks, and prompt rejection of unsupported transform
// combinations and missing animation targets. Fast cases use 320px / 10fps /
// short durations; one full 8s clip at 320px is the acceptance case; the release
// checklist additionally verifies a 1280px / 30fps export.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, computeOutputSize, screenSourceText, loadPlaywright, resolveBrowser, runExport, fontFaceCss, verifyFontsLoaded, loadFonts, resolveFontList } from './export.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXPORT = path.join(HERE, 'export.mjs');
const ARRIVAL = path.join(HERE, '..', 'assets', 'arrival.svg');
const CONVERGENCE = path.join(HERE, '..', 'assets', 'convergence.svg');
const BRANCHING = path.join(HERE, '..', 'assets', 'branching.svg');
const sha256 = (b) => createHash('sha256').update(b).digest('hex');

async function mkTmp() {
  return fsp.mkdtemp(path.join(os.tmpdir(), 'diagram-export-test-'));
}

let outSeq = 0;
function nextOut(tmp) {
  return path.join(tmp, 'out-' + String(++outSeq));
}

async function exportTo(tmp, args) {
  return runExport(parseArgs(args));
}

async function writeInput(tmp, name, text) {
  const p = path.join(tmp, name);
  await fsp.writeFile(p, text);
  return p;
}

function stageLeftovers(tmp) {
  return fs.readdirSync(tmp).filter((f) => f.includes('.stage-'));
}

function pngSize(buf) {
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

function ffprobeJson(file) {
  return JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-count_frames',
    '-show_entries', 'stream=codec_name,pix_fmt,width,height,nb_read_frames:format=duration', file], { encoding: 'utf8' }));
}

function scenePageHtml(svgText) {
  return '<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;overflow:hidden}svg{display:block}</style></head><body>'
    + svgText + '</body></html>';
}

// Bounds a promise so a hung pipeline step fails the test instead of stalling.
function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error((label || 'operation') + ' did not settle within ' + ms + 'ms')), ms)),
  ]);
}

let sharedBrowser = null;
async function pixelPage() {
  if (!sharedBrowser) {
    const pw = await loadPlaywright();
    sharedBrowser = await pw.chromium.launch({ executablePath: resolveBrowser(pw, null) });
  }
  return pixelContext();
}

// A 320x160 page like pixelPage(), with extra browser context options
// (javaScriptEnabled, reducedMotion, ...) for behavior-level preview tests.
async function pixelContext(opts = {}) {
  if (!sharedBrowser) {
    const pw = await loadPlaywright();
    sharedBrowser = await pw.chromium.launch({ executablePath: resolveBrowser(pw, null) });
  }
  const ctx = await sharedBrowser.newContext({ viewport: { width: 320, height: 160 }, ...opts });
  const page = await ctx.newPage();
  return { page, done: () => ctx.close() };
}

async function rasterAt(page, svgText, t) {
  await page.setContent(scenePageHtml(svgText));
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate((t) => {
    const svg = document.querySelector('svg');
    svg.pauseAnimations();
    svg.setCurrentTime(t);
    return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  }, t);
  return page.screenshot();
}

// Whole-image difference ratio; when rect is given, only pixels inside the
// rectangle are compared and the ratio is computed over the rectangle.
async function diffRatio(page, bufA, bufB, rect) {
  return page.evaluate(async ([a, b, rect]) => {
    const load = (u) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('image decode failed')); i.src = u; });
    const ia = await load(a), ib = await load(b);
    const c = document.createElement('canvas');
    c.width = Math.max(ia.width, ib.width);
    c.height = Math.max(ia.height, ib.height);
    const ctx = c.getContext('2d', { willReadFrequently: true });
    const grab = (img) => { ctx.clearRect(0, 0, c.width, c.height); ctx.drawImage(img, 0, 0); return ctx.getImageData(0, 0, c.width, c.height).data; };
    const da = grab(ia), db = grab(ib);
    const x0 = rect ? Math.max(0, Math.floor(rect.x)) : 0;
    const y0 = rect ? Math.max(0, Math.floor(rect.y)) : 0;
    const x1 = rect ? Math.min(c.width, Math.ceil(rect.x + rect.w)) : c.width;
    const y1 = rect ? Math.min(c.height, Math.ceil(rect.y + rect.h)) : c.height;
    let n = 0, total = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = (y * c.width + x) * 4;
        total++;
        if (Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]) > 30) n++;
      }
    }
    return n / Math.max(1, total);
  }, ['data:image/png;base64,' + bufA.toString('base64'), 'data:image/png;base64,' + bufB.toString('base64'), rect || null]);
}

// Counts emphasis (#DBEAFE) pixels inside rect — proves the moving chip is
// actually painted there, not merely present in the DOM with correct geometry.
async function emphasisCountIn(page, buf, rect) {
  return page.evaluate(async ([a, rect]) => {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('image decode failed')); i.src = a; });
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    const x0 = Math.max(0, Math.floor(rect.x)), y0 = Math.max(0, Math.floor(rect.y));
    const x1 = Math.min(c.width, Math.ceil(rect.x + rect.w)), y1 = Math.min(c.height, Math.ceil(rect.y + rect.h));
    let n = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = (y * c.width + x) * 4;
        if (Math.abs(219 - d[i]) + Math.abs(234 - d[i + 1]) + Math.abs(254 - d[i + 2]) < 24) n++;
      }
    }
    return n;
  }, ['data:image/png;base64,' + buf.toString('base64'), rect]);
}

after(async () => {
  if (sharedBrowser) await sharedBrowser.close().catch(() => {});
  if (fullTmp) await fsp.rm(fullTmp, { recursive: true, force: true }).catch(() => {});
});

// ---------- argument parsing and geometry (no browser) ----------

test('parseArgs applies documented defaults', () => {
  const a = parseArgs(['scene.svg', '--out', 'o']);
  assert.equal(a.input, 'scene.svg');
  assert.equal(a.out, 'o');
  assert.equal(a.duration, 8);
  assert.equal(a.width, 1280);
  assert.equal(a.fps, 30);
  assert.equal(a.time, 8);
  assert.deepEqual(a.formats, ['svg', 'png', 'mp4']);
  assert.equal(a.fonts, null);
});

test('parseArgs rejects unknown flags', () => {
  assert.throws(() => parseArgs(['s.svg', '--out', 'o', '--zoom', '2']), /unknown flag: --zoom/);
  assert.throws(() => parseArgs(['s.svg', '--out', 'o', '--out']), /requires a value/);
});

test('parseArgs rejects missing input, missing out, extra arguments', () => {
  assert.throws(() => parseArgs(['--out', 'o']), /missing INPUT\.svg/);
  assert.throws(() => parseArgs(['s.svg']), /missing --out/);
  assert.throws(() => parseArgs(['a.svg', 'b.svg', '--out', 'o']), /unexpected extra argument/);
});

test('parseArgs rejects nonfinite and out-of-range values', () => {
  assert.throws(() => parseArgs(['s.svg', '--out', 'o', '--duration', 'abc']), /finite/);
  assert.throws(() => parseArgs(['s.svg', '--out', 'o', '--duration', 'Infinity']), /finite/);
  assert.throws(() => parseArgs(['s.svg', '--out', 'o', '--duration', '121']), /<= 120/);
  assert.throws(() => parseArgs(['s.svg', '--out', 'o', '--fps', '0']), />= 1/);
  assert.throws(() => parseArgs(['s.svg', '--out', 'o', '--fps', '61']), /<= 60/);
  assert.throws(() => parseArgs(['s.svg', '--out', 'o', '--fps', '2.5']), /whole number/);
  assert.throws(() => parseArgs(['s.svg', '--out', 'o', '--width', '4097']), /<= 4096/);
  assert.throws(() => parseArgs(['s.svg', '--out', 'o', '--width', '-2']), />= 2/);
  assert.throws(() => parseArgs(['s.svg', '--out', 'o', '--time', '-1']), />= 0/);
  assert.throws(() => parseArgs(['s.svg', '--out', 'o', '--time', '9']), /within \[0, 8\]/);
});

test('parseArgs rejects odd video width', () => {
  assert.throws(() => parseArgs(['s.svg', '--out', 'o', '--width', '1281']), /--width must be even/);
});

test('parseArgs validates the formats list', () => {
  assert.throws(() => parseArgs(['s.svg', '--out', 'o', '--formats', 'gif']), /unknown format "gif"/);
  assert.throws(() => parseArgs(['s.svg', '--out', 'o', '--formats', ',']), /at least one/);
  assert.deepEqual(parseArgs(['s.svg', '--out', 'o', '--formats', 'png,svg,svg']).formats, ['png', 'svg']);
  assert.deepEqual(parseArgs(['s.svg', '--out', 'o', '--formats', 'PNG']).formats, ['png']);
});

test('parseArgs accepts --help without an input', () => {
  assert.deepEqual(parseArgs(['--help']), { help: true });
});

test('computeOutputSize keeps aspect and rounds height up to even', () => {
  assert.deepEqual(computeOutputSize({ x: 0, y: 0, w: 720, h: 360 }, 1280), { w: 1280, h: 640 });
  assert.deepEqual(computeOutputSize({ x: 0, y: 0, w: 720, h: 360 }, 320), { w: 320, h: 160 });
  assert.deepEqual(computeOutputSize({ x: 0, y: 0, w: 720, h: 361 }, 720), { w: 720, h: 362 });
  assert.throws(() => computeOutputSize({ x: 0, y: 0, w: 0, h: 10 }, 320), /viewBox/);
});

test('screenSourceText rejects blank, DOCTYPE, script, foreignObject, entity', () => {
  assert.throws(() => screenSourceText(''), /blank/);
  assert.throws(() => screenSourceText('<?xml version="1.0"?><!DOCTYPE svg><svg/>'), /DOCTYPE/);
  assert.throws(() => screenSourceText('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'), /script/);
  assert.throws(() => screenSourceText('<svg xmlns="http://www.w3.org/2000/svg"><foreignObject/></svg>'), /foreignObject/);
  assert.throws(() => screenSourceText('<!ENTITY x "y"><svg/>'), /entity/);
});

// ---------- CLI process behavior (no browser) ----------

test('CLI --help succeeds without an input and shows examples', () => {
  const r = spawnSync(process.execPath, [EXPORT, '--help'], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /Examples:/);
  assert.match(r.stdout, /default svg,png,mp4/);
  assert.match(r.stdout, /parent must exist/);
});

test('CLI usage errors exit 1 with a message', () => {
  const r = spawnSync(process.execPath, [EXPORT, '--out', 'o'], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /missing INPUT\.svg/);
  const r2 = spawnSync(process.execPath, [EXPORT, 'a.svg', '--out', 'o', '--bogus'], { encoding: 'utf8' });
  assert.equal(r2.status, 1);
  assert.match(r2.stderr, /unknown flag/);
  const r3 = spawnSync(process.execPath, [EXPORT, path.join(HERE, 'nope.svg'), '--out', 'o'], { encoding: 'utf8' });
  assert.equal(r3.status, 1);
  assert.match(r3.stderr, /input not found/);
});

// ---------- input validation through the pipeline ----------

test('runExport rejects blank and script inputs, leaving no output or staging', async () => {
  const tmp = await mkTmp();
  try {
    const blank = await writeInput(tmp, 'blank.svg', '');
    await assert.rejects(() => exportTo(tmp, [blank, '--out', nextOut(tmp)]), /blank/);
    const scripted = await writeInput(tmp, 'scripted.svg',
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><script>alert(1)</script></svg>');
    await assert.rejects(() => exportTo(tmp, [scripted, '--out', nextOut(tmp)]), /script/);
    assert.deepEqual(stageLeftovers(tmp), []);
  } finally { await fsp.rm(tmp, { recursive: true, force: true }); }
});

test('runExport rejects malformed XML', async () => {
  const tmp = await mkTmp();
  try {
    const bad = await writeInput(tmp, 'bad.svg', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect');
    await assert.rejects(() => exportTo(tmp, [bad, '--out', nextOut(tmp)]), /not well-formed/);
    assert.deepEqual(stageLeftovers(tmp), []);
  } finally { await fsp.rm(tmp, { recursive: true, force: true }); }
});

test('runExport rejects non-local references', async () => {
  const tmp = await mkTmp();
  try {
    const ext = await writeInput(tmp, 'ext.svg',
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect x="0" y="0" width="64" height="64" fill="#FFFFFF"/>'
      + '<image href="https://example.com/x.png" x="8" y="8" width="16" height="16"/></svg>');
    await assert.rejects(() => exportTo(tmp, [ext, '--out', nextOut(tmp)]), /non-local href/);
    assert.deepEqual(stageLeftovers(tmp), []);
  } finally { await fsp.rm(tmp, { recursive: true, force: true }); }
});

test('runExport rejects event handler attributes', async () => {
  const tmp = await mkTmp();
  try {
    const eh = await writeInput(tmp, 'eh.svg',
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect x="0" y="0" width="64" height="64" fill="#FFFFFF" onclick="alert(1)"/></svg>');
    await assert.rejects(() => exportTo(tmp, [eh, '--out', nextOut(tmp)]), /event handler/);
    assert.deepEqual(stageLeftovers(tmp), []);
  } finally { await fsp.rm(tmp, { recursive: true, force: true }); }
});

test('runExport rejects CSS animations and transitions', async () => {
  const tmp = await mkTmp();
  try {
    const css = await writeInput(tmp, 'css.svg',
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><style>@keyframes k{from{opacity:0}}</style>'
      + '<rect x="0" y="0" width="64" height="64" fill="#FFFFFF"/></svg>');
    await assert.rejects(() => exportTo(tmp, [css, '--out', nextOut(tmp)]), /CSS animation/);
    const tr = await writeInput(tmp, 'tr.svg',
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><style>rect{transition:opacity 1s}</style>'
      + '<rect x="0" y="0" width="64" height="64" fill="#FFFFFF"/></svg>');
    await assert.rejects(() => exportTo(tmp, [tr, '--out', nextOut(tmp)]), /CSS animation\/transition/);
    assert.deepEqual(stageLeftovers(tmp), []);
  } finally { await fsp.rm(tmp, { recursive: true, force: true }); }
});

test('runExport rejects animated attributes it cannot freeze', async () => {
  const tmp = await mkTmp();
  try {
    const r = await writeInput(tmp, 'r.svg',
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect x="0" y="0" width="64" height="64" fill="#FFFFFF"/>'
      + '<circle cx="32" cy="32" r="8" fill="#17212B"><animate attributeName="r" values="8;16" dur="2s"/></circle></svg>');
    await assert.rejects(() => exportTo(tmp, [r, '--out', nextOut(tmp)]), /cannot freeze/);
    assert.deepEqual(stageLeftovers(tmp), []);
  } finally { await fsp.rm(tmp, { recursive: true, force: true }); }
});

test('runExport rejects a scene without an opaque covering background rect', async () => {
  const tmp = await mkTmp();
  try {
    const small = await writeInput(tmp, 'small.svg',
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">'
      + '<rect x="8" y="8" width="8" height="8" fill="#17212B"/><text x="8" y="48" font-size="10">hi</text></svg>');
    await assert.rejects(() => exportTo(tmp, [small, '--out', nextOut(tmp), '--formats', 'svg']), /does not cover the viewBox/);
  } finally { await fsp.rm(tmp, { recursive: true, force: true }); }
});

test('runExport refuses to overwrite an existing output directory or the input directory', async () => {
  const tmp = await mkTmp();
  try {
    const input = await writeInput(tmp, 'in.svg',
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect x="0" y="0" width="64" height="64" fill="#FFFFFF"/></svg>');
    const exists = path.join(tmp, 'exists');
    fs.mkdirSync(exists);
    await assert.rejects(() => exportTo(tmp, [input, '--out', exists]), /already exists/);
    await assert.rejects(() => exportTo(tmp, [input, '--out', tmp]), /already exists|input directory/);
    assert.deepEqual(stageLeftovers(tmp), []);
  } finally { await fsp.rm(tmp, { recursive: true, force: true }); }
});

// ---------- full pipeline: acceptance export (320px, 10fps, full 8s) ----------

let fullOut = null; // shared by the end-state fidelity tests below
let fullTmp = null; // kept alive until the after() hook

test('full 8s export writes every output with a correct manifest and MP4', async () => {
  fullTmp = await mkTmp();
  const tmp = fullTmp;
  try {
    const out = path.join(tmp, 'arrival');
    fullOut = out;
    const manifest = await exportTo(tmp, [ARRIVAL, '--out', out, '--width', '320', '--fps', '10']);
    for (const name of ['scene.svg', 'preview.html', 'scene.static.svg', 'scene.png', 'scene.mp4', 'manifest.json',
      'fonts/plex-sans-OFL.txt', 'fonts/plex-mono-OFL.txt']) {
      assert.ok(fs.existsSync(path.join(out, name)), name + ' exists');
    }
    assert.equal(manifest.input.file, 'arrival.svg');
    assert.ok(!('path' in manifest.input), 'manifest must not record absolute input paths');
    assert.equal(manifest.input.sha256, sha256(fs.readFileSync(ARRIVAL)));
    assert.deepEqual(manifest.input.viewBox, { x: 0, y: 0, w: 720, h: 360 });
    assert.deepEqual(manifest.output, { width: 320, height: 160, duration: 8, fps: 10, time: 8,
      frameCount: 80, uniqueFrameCount: manifest.output.uniqueFrameCount, formats: ['svg', 'png', 'mp4'] });
    assert.ok(manifest.output.uniqueFrameCount >= 2, 'true-motion MP4 must have multiple distinct frames');
    assert.ok(typeof manifest.browser === 'string' && manifest.browser.length > 0);
    assert.equal(manifest.motion, true);
    for (const [name, hash] of Object.entries(manifest.files)) {
      assert.equal(sha256(fs.readFileSync(path.join(out, name))), hash, 'hash for ' + name);
    }
    const probe = ffprobeJson(path.join(out, 'scene.mp4'));
    const v = probe.streams[0];
    assert.equal(v.codec_name, 'h264');
    assert.equal(v.pix_fmt, 'yuv420p');
    assert.equal(v.width, 320);
    assert.equal(v.height, 160);
    assert.ok(Math.abs(Number(v.nb_read_frames) - 80) <= 1, 'frame count ~80, got ' + v.nb_read_frames);
    assert.ok(Math.abs(Number(probe.format.duration) - 8) <= 0.15, 'duration ~8s, got ' + probe.format.duration);
    assert.deepEqual(pngSize(fs.readFileSync(path.join(out, 'scene.png'))), { w: 320, h: 160 });
    assert.ok(!fs.existsSync(path.join(out, 'frames')), 'frame scratch is not part of the output');
    assert.deepEqual(stageLeftovers(tmp), []);
  } catch (e) {
    fullOut = null;
    throw e;
  }
});

test('scene.svg is offline, animated, and embeds the two font faces', async () => {
  const scene = fs.readFileSync(path.join(fullOut, 'scene.svg'), 'utf8');
  const faces = scene.match(/data:font\/woff2;base64,/g) || [];
  assert.equal(faces.length, 2);
  assert.match(scene, /"IBM Plex Sans"/);
  assert.match(scene, /"IBM Plex Mono"/);
  assert.match(scene, /Open Font License 1\.1/);
  assert.match(scene, /<animateMotion/);
  assert.match(scene, /viewBox="0 0 720 360"/);
  assert.match(scene, /width="320"/);
  assert.match(scene, /height="160"/);
  assert.doesNotMatch(scene, /src=["']https?:/);
  assert.doesNotMatch(scene, /href=["']https?:/);
});

test('preview.html is offline, still-first, controllable, reduced-motion aware', async () => {
  const html = fs.readFileSync(path.join(fullOut, 'preview.html'), 'utf8');
  assert.match(html, /<svg/);
  for (const id of ['play', 'replay', 'slow', 'scrub', 'time']) assert.match(html, new RegExp('id="' + id + '"'));
  assert.match(html, /prefers-reduced-motion: reduce/);
  assert.match(html, /0\.1/);
  assert.doesNotMatch(html, /src=["']https?:/);
  assert.doesNotMatch(html, /href=["']https?:/);
  const { page, done } = await pixelPage();
  try {
    await page.setContent(html);
    await page.evaluate(() => document.fonts.ready);
    const start = await page.evaluate(() => {
      const svg = document.querySelector('svg');
      return { t: svg.getCurrentTime(), paused: svg.animationsPaused(), svgs: document.querySelectorAll('body svg').length, stageGone: !document.getElementById('stage') };
    });
    assert.ok(Math.abs(start.t - 8) < 0.01, 'still-first: opens on the final state');
    assert.equal(start.paused, true, 'animation is paused synchronously');
    assert.equal(start.svgs, 1, 'the player swaps the frozen still for exactly one live scene');
    assert.equal(start.stageGone, true, 'the frozen still placeholder is consumed');
    await page.click('#play');
    await page.waitForTimeout(400);
    const mid = await page.evaluate(() => document.querySelector('svg').getCurrentTime());
    assert.ok(mid > 0.05 && mid < 2, 'playing advances the clock, got ' + mid);
    await page.evaluate(() => {
      const s = document.getElementById('scrub');
      s.value = '1.6';
      s.dispatchEvent(new Event('input'));
    });
    const scrubbed = await page.evaluate(() => ({
      t: document.querySelector('svg').getCurrentTime(),
      label: document.getElementById('time').textContent,
    }));
    assert.ok(Math.abs(scrubbed.t - 1.6) < 0.01, 'scrub seeks exactly');
    assert.equal(scrubbed.label, '1.60s');
  } finally { await done(); }
});

test('frozen scene.static.svg and scene.png match the live end state', async () => {
  const { page, done } = await pixelPage();
  try {
    const sceneText = fs.readFileSync(path.join(fullOut, 'scene.svg'), 'utf8');
    const staticText = fs.readFileSync(path.join(fullOut, 'scene.static.svg'), 'utf8');
    assert.doesNotMatch(staticText, /<(animate|animateMotion|animateTransform|set)[\s>]/, 'SMIL removed');
    assert.match(staticText, /data:font\/woff2;base64,/, 'embedded fonts retained');
    const liveEnd = await rasterAt(page, sceneText, 8);
    const frozenEnd = await rasterAt(page, staticText, 0);
    let r = await diffRatio(page, liveEnd, frozenEnd);
    assert.ok(r < 0.002, 'frozen end state matches live end state, ratio ' + r);
    const pngEnd = fs.readFileSync(path.join(fullOut, 'scene.png'));
    r = await diffRatio(page, liveEnd, pngEnd);
    assert.ok(r < 0.002, 'scene.png matches live end state, ratio ' + r);
  } finally { await done(); }
});

test('mid-transit freeze and PNG (t=1.6) match the live frame and differ from the end', async () => {
  const tmp = await mkTmp();
  const { page, done } = await pixelPage();
  try {
    const out = path.join(tmp, 'mid');
    const manifest = await exportTo(tmp, [ARRIVAL, '--out', out, '--width', '320', '--formats', 'svg,png', '--time', '1.6']);
    assert.equal(manifest.output.time, 1.6);
    const sceneText = fs.readFileSync(path.join(out, 'scene.svg'), 'utf8');
    const staticText = fs.readFileSync(path.join(out, 'scene.static.svg'), 'utf8');
    assert.match(staticText, /transform="matrix\(/, 'animateMotion is baked into a CTM matrix');
    const liveMid = await rasterAt(page, sceneText, 1.6);
    const liveChip = await page.evaluate(() => {
      const chip = document.getElementById('chip');
      if (!chip) throw new Error('live scene lost the #chip element');
      const b = chip.getBoundingClientRect();
      return { x: b.x, y: b.y, w: b.width, h: b.height };
    });
    const cx = liveChip.x + liveChip.w / 2;
    assert.ok(cx > 100 && cx < 170, 'chip is genuinely mid-corridor at t=1.6, center x ' + cx);
    const frozenMid = await rasterAt(page, staticText, 0);
    const frozenChip = await page.evaluate(() => {
      const chip = document.getElementById('chip');
      if (!chip) throw new Error('frozen scene lost the #chip element');
      const b = chip.getBoundingClientRect();
      return { x: b.x, y: b.y, w: b.width, h: b.height };
    });
    // Transformed-position assertion: the frozen chip must sit exactly where the
    // live chip sits at t=1.6. The whole-image ratio alone stays under 0.002 even
    // with the moving chip missing entirely, so the chip is checked directly.
    for (const k of ['x', 'y', 'w', 'h']) {
      assert.ok(Math.abs(liveChip[k] - frozenChip[k]) <= 1.5,
        'frozen chip ' + k + ' matches the live chip at t=1.6 (' + liveChip[k] + ' vs ' + frozenChip[k] + ')');
    }
    // Chip-region comparison: the chip must actually be painted, not just positioned.
    const region = { x: liveChip.x - 3, y: liveChip.y - 3, w: liveChip.w + 6, h: liveChip.h + 6 };
    const rChip = await diffRatio(page, liveMid, frozenMid, region);
    assert.ok(rChip < 0.5, 'chip region matches at t=1.6, ratio ' + rChip);
    const liveEmph = await emphasisCountIn(page, liveMid, region);
    const frozenEmph = await emphasisCountIn(page, frozenMid, region);
    assert.ok(liveEmph >= 10, 'live chip paints emphasis pixels at t=1.6, got ' + liveEmph);
    assert.ok(frozenEmph >= 0.6 * liveEmph, 'frozen chip paints the chip like the live frame (' + frozenEmph + ' vs ' + liveEmph + ' emphasis px)');
    const r = await diffRatio(page, liveMid, frozenMid);
    assert.ok(r < 0.002, 'frozen mid-transit matches live mid-transit (animateMotion), ratio ' + r);
    const pngMid = fs.readFileSync(path.join(out, 'scene.png'));
    assert.deepEqual(pngSize(pngMid), { w: 320, h: 160 });
    const r2 = await diffRatio(page, liveMid, pngMid);
    assert.ok(r2 < 0.002, 'scene.png at t=1.6 matches the live frame, ratio ' + r2);
    const pngEnd = fs.readFileSync(path.join(fullOut, 'scene.png'));
    assert.ok(!pngMid.equals(pngEnd), 'mid-transit PNG differs from the end-state PNG');
  } finally {
    await done();
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

// ---------- preview behavior in real no-JS and reduced-motion contexts ----------

test('no-JS preview shows only the frozen final still and hides controls', async () => {
  const html = fs.readFileSync(path.join(fullOut, 'preview.html'), 'utf8');
  const { page, done } = await pixelContext({ javaScriptEnabled: false });
  try {
    await page.setContent(html);
    await page.waitForTimeout(300);
    const s = await page.evaluate(() => {
      const filled = [...document.querySelectorAll('rect')].find((r) => r.getAttribute('fill') === '#DBEAFE' && Number(r.getAttribute('y')) === 176);
      return {
        lightAnims: document.querySelectorAll('animate,animateMotion,animateTransform,set').length,
        tplAnims: document.getElementById('animated').content.querySelectorAll('animate,animateMotion,animateTransform,set').length,
        controlsHidden: document.getElementById('controls').hidden,
        controlsDisplay: getComputedStyle(document.getElementById('controls')).display,
        stageStill: !!document.querySelector('#stage svg'),
        contextOpacity: filled ? getComputedStyle(filled).opacity : null,
      };
    });
    assert.equal(s.lightAnims, 0, 'no SMIL reaches the rendered document without JS');
    assert.ok(s.tplAnims >= 4, 'the animated markup is present but inert inside the template');
    assert.equal(s.controlsHidden, true, 'controls are hidden without JS');
    assert.equal(s.controlsDisplay, 'none', 'hidden controls do not render');
    assert.ok(s.stageStill, 'the frozen still is what renders');
    assert.equal(s.contextOpacity, '1', 'the still is the final state (Context slot filled)');
    const a = await page.screenshot();
    await page.waitForTimeout(700);
    const b = await page.screenshot();
    assert.ok(a.equals(b), 'nothing moves without JavaScript');
  } finally { await done(); }
});

test('reduced-motion preview replaces playback with static before/after and scrub', async () => {
  const html = fs.readFileSync(path.join(fullOut, 'preview.html'), 'utf8');
  const { page, done } = await pixelContext({ reducedMotion: 'reduce' });
  const clock = () => page.evaluate(() => document.querySelector('svg').getCurrentTime());
  try {
    await page.setContent(html);
    await page.evaluate(() => document.fonts.ready);
    const init = await page.evaluate(() => ({
      t: document.querySelector('svg').getCurrentTime(),
      paused: document.querySelector('svg').animationsPaused(),
      play: document.getElementById('play').hidden,
      replay: document.getElementById('replay').hidden,
      slow: document.getElementById('slow').parentElement.hidden,
      before: document.getElementById('before').hidden,
      after: document.getElementById('after').hidden,
      controls: document.getElementById('controls').hidden,
    }));
    assert.ok(Math.abs(init.t - 8) < 0.01, 'opens on the final state');
    assert.equal(init.paused, true, 'nothing plays by itself');
    assert.equal(init.play, true, 'no continuous playback control under reduced motion');
    assert.equal(init.replay, true, 'no replay control under reduced motion');
    assert.equal(init.slow, true, 'no slow-play control under reduced motion');
    assert.equal(init.before, false, 'a static Before control is offered');
    assert.equal(init.after, false, 'a static After control is offered');
    assert.equal(init.controls, false, 'the static/scrub controls are usable');
    await page.click('#before');
    assert.ok(Math.abs(await clock()) < 0.01, 'Before shows the initial state');
    await page.waitForTimeout(300);
    assert.ok(Math.abs(await clock()) < 0.05, 'no continuous playback under reduced motion');
    await page.evaluate(() => { const s = document.getElementById('scrub'); s.value = '1.6'; s.dispatchEvent(new Event('input')); });
    assert.ok(Math.abs(await clock() - 1.6) < 0.01, 'scrubbing still seeks');
    await page.click('#after');
    assert.ok(Math.abs(await clock() - 8) < 0.01, 'After shows the final state');
  } finally { await done(); }
});

// ---------- unsupported transforms and missing targets reject promptly ----------

test('runExport rejects stylesheet and inline CSS transforms on animation targets', async () => {
  const tmp = await mkTmp();
  try {
    const head = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">'
      + '<rect x="0" y="0" width="64" height="64" fill="#FFFFFF"/>';
    const mover = '<rect x="24" y="24" width="16" height="16" fill="#17212B"/>'
      + '<animateMotion path="M 0 0 L 16 0" dur="2s" begin="0s" fill="freeze"/></g></svg>';
    const sheet = await writeInput(tmp, 'sheet.svg', head + '<style>g.mover{transform:translate(8px,0px)}</style><g class="mover">' + mover);
    await assert.rejects(
      () => withTimeout(exportTo(tmp, [sheet, '--out', nextOut(tmp), '--formats', 'svg']), 25000, 'stylesheet-transform rejection'),
      /CSS transforms on animation targets are not supported/);
    const inline = await writeInput(tmp, 'inline.svg', head + '<g style="transform:translate(8px,0px)">' + mover);
    await assert.rejects(
      () => withTimeout(exportTo(tmp, [inline, '--out', nextOut(tmp), '--formats', 'svg']), 25000, 'inline-transform rejection'),
      /CSS transform on an animated element is not supported/);
    assert.deepEqual(stageLeftovers(tmp), []);
  } finally { await fsp.rm(tmp, { recursive: true, force: true }); }
});

test('runExport rejects an animation targeting a missing element promptly', async () => {
  const tmp = await mkTmp();
  try {
    const input = await writeInput(tmp, 'missing.svg',
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">'
      + '<rect x="0" y="0" width="64" height="64" fill="#FFFFFF"/>'
      + '<rect x="24" y="24" width="16" height="16" fill="#17212B">'
      + '<animateMotion href="#gone" path="M 0 0 L 16 0" dur="2s" begin="0s" fill="freeze"/></rect></svg>');
    await assert.rejects(
      () => withTimeout(exportTo(tmp, [input, '--out', nextOut(tmp), '--formats', 'svg']), 25000, 'missing-target rejection'),
      /animation target not found/);
    assert.deepEqual(stageLeftovers(tmp), []);
  } finally { await fsp.rm(tmp, { recursive: true, force: true }); }
});

// ---------- focused source-validation rejections ----------

test('runExport rejects inline and longhand CSS animation/transition declarations', async () => {
  const tmp = await mkTmp();
  const head = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">'
    + '<rect x="0" y="0" width="64" height="64" fill="#FFFFFF"/>';
  try {
    const a = await writeInput(tmp, 'a.svg', head + '<rect x="8" y="8" width="16" height="16" fill="#17212B" style="animation:spin 1s"/></svg>');
    await assert.rejects(() => exportTo(tmp, [a, '--out', nextOut(tmp)]), /style attribute \(property "animation"\)/);
    const b = await writeInput(tmp, 'b.svg', head + '<rect x="8" y="8" width="16" height="16" fill="#17212B" style="transition-property:opacity"/></svg>');
    await assert.rejects(() => exportTo(tmp, [b, '--out', nextOut(tmp)]), /style attribute \(property "transition-property"\)/);
    const c = await writeInput(tmp, 'c.svg', head + '<style>rect{animation-name:spin}</style><rect x="8" y="8" width="16" height="16" fill="#17212B"/></svg>');
    await assert.rejects(() => exportTo(tmp, [c, '--out', nextOut(tmp)]), /<style> \(property "animation-name"\)/);
    assert.deepEqual(stageLeftovers(tmp), []);
  } finally { await fsp.rm(tmp, { recursive: true, force: true }); }
});

test('runExport rejects non-local URLs in presentation attributes but preserves internal fragments', async () => {
  const tmp = await mkTmp();
  try {
    const bad = await writeInput(tmp, 'bad.svg',
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">'
      + '<rect x="0" y="0" width="64" height="64" fill="#FFFFFF"/>'
      + '<rect x="8" y="8" width="16" height="16" fill="url(https://example.com/p.png)"/></svg>');
    await assert.rejects(() => exportTo(tmp, [bad, '--out', nextOut(tmp)]), /non-local url\("https:\/\/example.com\/p.png"\) in the fill attribute/);
    const grad = await writeInput(tmp, 'grad.svg',
      '<?xml version="1.0" encoding="UTF-8"?>\n'
      + '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">\n'
      + '  <title>Gradient fill test</title>\n'
      + '  <defs><linearGradient id="g"><stop offset="0" stop-color="#17212B"/><stop offset="1" stop-color="#6B7280"/></linearGradient></defs>\n'
      + '  <rect x="0" y="0" width="64" height="64" fill="#FFFFFF"/>\n'
      + '  <rect x="16" y="16" width="32" height="32" fill="url(#g)"/>\n'
      + '</svg>\n');
    const out = path.join(tmp, 'grad-out');
    await exportTo(tmp, [grad, '--out', out, '--width', '320', '--formats', 'svg']);
    const scene = fs.readFileSync(path.join(out, 'scene.svg'), 'utf8');
    const stat = fs.readFileSync(path.join(out, 'scene.static.svg'), 'utf8');
    assert.match(scene, /fill="url\(#g\)"/, 'internal fragment reference preserved in the scene');
    assert.match(stat, /fill="url\(#g\)"/, 'internal fragment reference preserved in the frozen still');
  } finally { await fsp.rm(tmp, { recursive: true, force: true }); }
});

test('runExport requires the root element to be in the SVG namespace', async () => {
  const tmp = await mkTmp();
  const rect = '<rect x="0" y="0" width="64" height="64" fill="#FFFFFF"/>';
  try {
    const xhtml = await writeInput(tmp, 'xhtml.svg', '<svg xmlns="http://www.w3.org/1999/xhtml" viewBox="0 0 64 64">' + rect + '</svg>');
    await assert.rejects(() => exportTo(tmp, [xhtml, '--out', nextOut(tmp)]), /SVG namespace/);
    const nons = await writeInput(tmp, 'nons.svg', '<svg viewBox="0 0 64 64">' + rect + '</svg>');
    await assert.rejects(() => exportTo(tmp, [nons, '--out', nextOut(tmp)]), /SVG namespace/);
    assert.deepEqual(stageLeftovers(tmp), []);
  } finally { await fsp.rm(tmp, { recursive: true, force: true }); }
});

// ---------- bundled fonts fail loudly ----------

test('fontFaceCss rejects missing or invalid font files', async () => {
  const tmp = await mkTmp();
  try {
    const font = { family: 'IBM Plex Sans', weight: '400', file: path.join(tmp, 'plex-sans.woff2'),
      license: path.join(tmp, 'plex-sans-OFL.txt'), licenseOut: 'plex-sans-OFL.txt' };
    await assert.rejects(async () => fontFaceCss([font]), /font file missing/);
    await fsp.writeFile(path.join(tmp, 'plex-sans.woff2'), 'this is not a font');
    await assert.rejects(async () => fontFaceCss([font]), /not a valid woff2/);
  } finally { await fsp.rm(tmp, { recursive: true, force: true }); }
});

test('verifyFontsLoaded fails when an embedded face cannot decode', async () => {
  const { page, done } = await pixelPage();
  try {
    await page.setContent('<!doctype html><html><head><meta charset="utf-8"><style>'
      + '@font-face{font-family:"Broken";src:url(data:font/woff2;base64,AAAAAAAA) format("woff2");font-weight:400;font-style:normal}'
      + '</style></head><body></body></html>');
    await page.evaluate(() => document.fonts.ready);
    await assert.rejects(
      () => withTimeout(verifyFontsLoaded(page, [{ family: 'Broken', weight: '400' }]), 20000, 'font verification'),
      /embedded fonts failed to load/);
  } finally { await done(); }
});

test('a genuinely static scene exports an MP4 with a single unique frame', async () => {
  const tmp = await mkTmp();
  try {
    const input = await writeInput(tmp, 'static.svg',
      '<?xml version="1.0" encoding="UTF-8"?>\n'
      + '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="160" viewBox="0 0 320 160">\n'
      + '  <title>Static test scene</title>\n'
      + '  <rect x="0" y="0" width="320" height="160" fill="#FFFFFF"/>\n'
      + '  <text x="16" y="88" font-family="IBM Plex Sans" font-size="20" fill="#17212B">Static</text>\n'
      + '</svg>\n');
    const out = path.join(tmp, 'static-out');
    const manifest = await exportTo(tmp, [input, '--out', out, '--width', '320', '--fps', '10', '--duration', '2']);
    assert.equal(manifest.motion, false);
    assert.equal(manifest.output.frameCount, 20);
    assert.equal(manifest.output.uniqueFrameCount, 1);
    const probe = ffprobeJson(path.join(out, 'scene.mp4'));
    assert.equal(probe.streams[0].codec_name, 'h264');
    assert.equal(probe.streams[0].pix_fmt, 'yuv420p');
    assert.ok(Math.abs(Number(probe.streams[0].nb_read_frames) - 20) <= 1);
  } finally { await fsp.rm(tmp, { recursive: true, force: true }); }
});

// ---------- font manifests (--fonts) ----------

test('parseArgs accepts --fonts and requires a value', () => {
  const a = parseArgs(['scene.svg', '--out', 'o', '--fonts', '/tmp/fonts.json']);
  assert.equal(a.fonts, '/tmp/fonts.json');
  assert.throws(() => parseArgs(['scene.svg', '--out', 'o', '--fonts']), /requires a value/);
});

test('loadFonts defaults to the two bundled faces with license files', () => {
  const fonts = loadFonts(null);
  assert.equal(fonts.length, 2);
  assert.deepEqual(fonts.map((f) => f.family), ['IBM Plex Sans', 'IBM Plex Mono']);
  for (const f of fonts) {
    assert.match(f.weight, /^[1-9][0-9]{2}$/);
    assert.ok(fs.existsSync(f.file) && fs.statSync(f.file).size > 0, f.file);
    assert.ok(fs.existsSync(f.license) && fs.statSync(f.license).size > 0, f.license);
    assert.equal(f.licenseOut, path.basename(f.license));
  }
});

test('resolveFontList rejects invalid manifests and unsafe strings', async () => {
  const tmp = await mkTmp();
  try {
    const good = { family: 'Test Sans', weight: '400', file: 'test.woff2', license: 'test-OFL.txt' };
    fs.copyFileSync(path.join(HERE, '..', 'assets', 'fonts', 'plex-sans.woff2'), path.join(tmp, 'test.woff2'));
    fs.copyFileSync(path.join(HERE, '..', 'assets', 'fonts', 'plex-sans-OFL.txt'), path.join(tmp, 'test-OFL.txt'));
    assert.doesNotThrow(() => resolveFontList([good], tmp));
    assert.throws(() => resolveFontList('nope', tmp), /non-empty array/);
    assert.throws(() => resolveFontList([], tmp), /non-empty array/);
    assert.throws(() => resolveFontList([{ ...good, family: 'x"y' }], tmp), /family must be/);
    assert.throws(() => resolveFontList([{ ...good, family: 'a;b' }], tmp), /family must be/);
    assert.throws(() => resolveFontList([{ ...good, weight: 'bold' }], tmp), /weight must be/);
    assert.throws(() => resolveFontList([good, { ...good }], tmp), /duplicate family\/weight/);
    assert.throws(() => resolveFontList([{ ...good, file: 'missing.woff2' }], tmp), /missing or empty/);
    await fsp.writeFile(path.join(tmp, 'bad.woff2'), 'not a font');
    assert.throws(() => resolveFontList([{ ...good, file: 'bad.woff2' }], tmp), /not a valid woff2/);
    await fsp.writeFile(path.join(tmp, 'empty-OFL.txt'), '');
    assert.throws(() => resolveFontList([{ ...good, license: 'empty-OFL.txt' }], tmp), /missing or empty/);
    assert.throws(() => resolveFontList([{ family: 'Test Sans', weight: '400', file: 'test.woff2' }], tmp), /needs a non-empty string/);
  } finally { await fsp.rm(tmp, { recursive: true, force: true }); }
});

test('license filename collisions get deterministic unique output names', async () => {
  const tmp = await mkTmp();
  try {
    fs.copyFileSync(path.join(HERE, '..', 'assets', 'fonts', 'plex-sans.woff2'), path.join(tmp, 'test.woff2'));
    fs.copyFileSync(path.join(HERE, '..', 'assets', 'fonts', 'plex-sans-OFL.txt'), path.join(tmp, 'test-OFL.txt'));
    const fonts = resolveFontList([
      { family: 'First Sans', weight: '400', file: 'test.woff2', license: 'test-OFL.txt' },
      { family: 'Second Sans', weight: '400', file: 'test.woff2', license: 'test-OFL.txt' },
    ], tmp);
    assert.equal(fonts[0].licenseOut, 'test-OFL.txt');
    assert.equal(fonts[1].licenseOut, 'second-sans-test-OFL.txt');
  } finally { await fsp.rm(tmp, { recursive: true, force: true }); }
});

test('a custom --fonts manifest exports with those faces and license files', async () => {
  const tmp = await mkTmp();
  try {
    const fdir = path.join(tmp, 'fonts');
    await fsp.mkdir(fdir);
    await fsp.copyFile(path.join(HERE, '..', 'assets', 'fonts', 'plex-sans.woff2'), path.join(fdir, 'sans.woff2'));
    await fsp.copyFile(path.join(HERE, '..', 'assets', 'fonts', 'plex-sans-OFL.txt'), path.join(fdir, 'sans-OFL.txt'));
    await fsp.writeFile(path.join(tmp, 'fonts.json'), JSON.stringify([
      { family: 'IBM Plex Sans', weight: '400', file: 'fonts/sans.woff2', license: 'fonts/sans-OFL.txt' },
    ]));
    const out = path.join(tmp, 'custom');
    const m = await exportTo(tmp, [ARRIVAL, '--out', out, '--width', '320', '--formats', 'svg,png',
      '--fonts', path.join(tmp, 'fonts.json')]);
    const scene = fs.readFileSync(path.join(out, 'scene.svg'), 'utf8');
    assert.equal((scene.match(/data:font\/woff2;base64,/g) || []).length, 1);
    assert.match(scene, /"IBM Plex Sans"/);
    assert.ok(fs.existsSync(path.join(out, 'fonts', 'sans-OFL.txt')));
    assert.deepEqual(m.fonts, [{ family: 'IBM Plex Sans', weight: '400', file: 'sans.woff2', license: 'sans-OFL.txt' }]);
  } finally { await fsp.rm(tmp, { recursive: true, force: true }); }
});

test('the export manifest never discloses absolute local paths', async () => {
  const tmp = await mkTmp();
  try {
    const out = path.join(tmp, 'priv');
    await exportTo(tmp, [ARRIVAL, '--out', out, '--width', '320', '--formats', 'svg']);
    const m = JSON.parse(fs.readFileSync(path.join(out, 'manifest.json'), 'utf8'));
    assert.equal(m.input.file, 'arrival.svg');
    assert.ok(!('path' in m.input), 'no absolute input path');
    const flat = JSON.stringify(m);
    assert.ok(!flat.includes(tmp), 'manifest must not embed local output paths');
    assert.ok(!flat.includes(os.homedir()), 'manifest must not embed the home directory');
    assert.ok(!flat.includes(process.cwd()), 'manifest must not embed the working directory');
  } finally { await fsp.rm(tmp, { recursive: true, force: true }); }
});

// ---------- packaged examples ----------

test('convergence example exports still and frozen SVG', async () => {
  const tmp = await mkTmp();
  try {
    const out = path.join(tmp, 'conv');
    const m = await exportTo(tmp, [CONVERGENCE, '--out', out, '--width', '320', '--formats', 'svg,png']);
    assert.equal(m.motion, true);
    assert.ok(!fs.existsSync(path.join(out, 'scene.mp4')), 'no MP4 requested');
    for (const name of ['scene.svg', 'preview.html', 'scene.static.svg', 'scene.png', 'manifest.json',
      'fonts/plex-sans-OFL.txt', 'fonts/plex-mono-OFL.txt']) {
      assert.ok(fs.existsSync(path.join(out, name)), name + ' exists');
    }
    const stat = fs.readFileSync(path.join(out, 'scene.static.svg'), 'utf8');
    assert.match(stat, /transform="matrix\(/, 'animateMotion is baked into CTM matrices');
    assert.doesNotMatch(stat, /<(animate|animateMotion|animateTransform|set)[\s>]/, 'SMIL removed');
  } finally { await fsp.rm(tmp, { recursive: true, force: true }); }
});

test('branching example exports as a static scene', async () => {
  const tmp = await mkTmp();
  try {
    const out = path.join(tmp, 'branch');
    const m = await exportTo(tmp, [BRANCHING, '--out', out, '--width', '320', '--formats', 'svg,png']);
    assert.equal(m.motion, false);
    assert.ok(fs.existsSync(path.join(out, 'scene.png')));
    assert.deepEqual(pngSize(fs.readFileSync(path.join(out, 'scene.png'))), { w: 320, h: 160 });
  } finally { await fsp.rm(tmp, { recursive: true, force: true }); }
});

// ---------- packaging ----------

test('SKILL.md frontmatter is valid and its referenced resources exist', async () => {
  const skill = fs.readFileSync(path.join(HERE, '..', 'SKILL.md'), 'utf8');
  const m = /^---\n([\s\S]*?)\n---\n/.exec(skill);
  assert.ok(m, 'SKILL.md starts with a frontmatter block');
  assert.match(m[1], /^name: diagramming$/m);
  assert.match(m[1], /^description: \S.*$/m);
  assert.match(m[1], /short-description: \S.*$/m);
  for (const ref of ['references/authoring.md', 'references/export.md', 'assets/arrival.svg',
    'assets/convergence.svg', 'assets/branching.svg', 'scripts/export.mjs']) {
    assert.ok(fs.existsSync(path.join(HERE, '..', ref)), ref + ' exists');
  }
});
