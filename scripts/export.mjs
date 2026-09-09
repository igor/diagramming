#!/usr/bin/env node
// diagram-authoring — standalone SVG scene export pipeline.
//
//   node scripts/export.mjs INPUT.svg --out NEW_DIRECTORY [--duration 8] [--width 1280]
//        [--fps 30] [--time 8] [--formats svg,png,mp4] [--fonts /path/to/fonts.json]
//        [--browser /path/to/chrome] [--playwright /path/to/playwright]
//
// Always writes scene.svg (normalized animated source with embedded offline fonts),
// preview.html (still-first inline player) and manifest.json, plus the license
// texts of the embedded fonts. Requested formats add scene.static.svg (frozen at
// --time), scene.png (still at --time) and scene.mp4 (H.264, one frame per exact
// timestamp n/fps). One browser process and one page serve the whole invocation.

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FONT_DIR = path.join(HERE, '..', 'assets', 'fonts');
const DEFAULT_FONTS = [
  { family: 'IBM Plex Sans', weight: '400', file: 'plex-sans.woff2', license: 'plex-sans-OFL.txt' },
  { family: 'IBM Plex Mono', weight: '400', file: 'plex-mono.woff2', license: 'plex-mono-OFL.txt' },
];
const MAX_DURATION = 120;
const MAX_WIDTH = 4096;
const MAX_FPS = 60;
// Presentation properties flattened into the frozen SVG for animated elements.
const FROZEN_PROPS = [
  'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-opacity', 'stroke-width',
  'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'stroke-dashoffset',
  'opacity', 'display', 'visibility', 'color', 'font-family', 'font-size',
  'font-weight', 'font-style', 'letter-spacing', 'text-anchor', 'dominant-baseline',
];
// Animated attributes this pipeline can freeze correctly; anything else is
// rejected up front rather than silently producing wrong art.
const ANIMATABLE = ['opacity', 'fill-opacity', 'stroke-opacity', 'fill', 'stroke', 'stroke-width', 'display', 'visibility'];
// Browser console errors are fatal; font loading is also verified explicitly.

// Presentation attributes whose values may carry url(...) references; internal
// fragment references (url(#id)) are preserved, anything non-local is rejected.
const URL_ATTRS = ['fill', 'stroke', 'clip-path', 'mask', 'filter', 'marker', 'marker-start', 'marker-mid', 'marker-end'];

export class UserError extends Error {}

const HELP = `Usage: node scripts/export.mjs INPUT.svg --out NEW_DIRECTORY [options]

Options:
  --out DIR        (required) output directory; must not already exist; parent must exist
  --duration S     animated timeline length in seconds (default 8, max 120)
  --width PX       output width in pixels, even, max 4096 (default 1280)
  --fps N          video frames per second, 1..60 (default 30)
  --time S         still capture time within [0, duration] (default duration)
  --formats LIST   comma-separated subset of svg,png,mp4 (default svg,png,mp4)
  --fonts PATH     font manifest JSON: an array of {family,weight,file,license},
                   resolved relative to that JSON file (default: the bundled
                   IBM Plex Sans 400 and IBM Plex Mono 400)
  --browser PATH   absolute path to a Chrome/Chromium executable
  --playwright P   absolute path to the playwright module (dir or index.js)
  --help           show this help

Examples:
  node scripts/export.mjs assets/arrival.svg --out out/arrival
  node scripts/export.mjs scene.svg --out out/stills --formats svg,png --time 1.6 --width 320
  node scripts/export.mjs scene.svg --out out/clip --duration 8 --width 1280 --fps 30`;

function num(value, flag, { min, max, integer = false } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new UserError(`${flag} must be a finite number (got "${value}")`);
  if (integer && !Number.isInteger(n)) throw new UserError(`${flag} must be a whole number (got "${value}")`);
  if (min !== undefined && n < min) throw new UserError(`${flag} must be >= ${min} (got "${value}")`);
  if (max !== undefined && n > max) throw new UserError(`${flag} must be <= ${max} (got "${value}")`);
  return n;
}

export function parseArgs(argv) {
  const a = { input: undefined, out: undefined, duration: 8, width: 1280, fps: 30, time: null,
    formats: ['svg', 'png', 'mp4'], fonts: null, browser: null, playwright: null };
  const VALUED = ['--out', '--duration', '--width', '--fps', '--time', '--formats', '--fonts', '--browser', '--playwright'];
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (tok === '--help') return { help: true };
    if (tok.startsWith('--')) {
      if (!VALUED.includes(tok)) throw new UserError(`unknown flag: ${tok}`);
      if (i + 1 >= argv.length) throw new UserError(`${tok} requires a value`);
      const v = argv[++i];
      if (tok === '--out') {
        if (!v) throw new UserError('--out requires a non-empty directory path');
        a.out = v;
      } else if (tok === '--duration') a.duration = num(v, '--duration', { min: 0.001, max: MAX_DURATION });
      else if (tok === '--width') a.width = num(v, '--width', { min: 2, max: MAX_WIDTH, integer: true });
      else if (tok === '--fps') a.fps = num(v, '--fps', { min: 1, max: MAX_FPS, integer: true });
      else if (tok === '--time') a.time = num(v, '--time', { min: 0 });
      else if (tok === '--fonts') a.fonts = v;
      else if (tok === '--browser') a.browser = v;
      else if (tok === '--playwright') a.playwright = v;
      else if (tok === '--formats') {
        const list = v.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
        if (!list.length) throw new UserError('--formats needs at least one of svg,png,mp4');
        for (const f of list) if (!['svg', 'png', 'mp4'].includes(f)) throw new UserError(`unknown format "${f}" (use svg,png,mp4)`);
        a.formats = [...new Set(list)];
      }
    } else {
      if (a.input !== undefined) throw new UserError(`unexpected extra argument: ${tok}`);
      a.input = tok;
    }
  }
  if (a.input === undefined) throw new UserError('missing INPUT.svg (see --help)');
  if (a.out === undefined) throw new UserError('missing --out DIRECTORY (see --help)');
  if (a.width % 2 === 1) throw new UserError(`--width must be even (including SVG/PNG-only exports) (got ${a.width}; only the height is rounded up)`);
  if (a.time === null) a.time = a.duration;
  if (a.time > a.duration) throw new UserError(`--time must be within [0, ${a.duration}] (got ${a.time})`);
  return a;
}

export function computeOutputSize(vb, width) {
  if (!vb || !(vb.w > 0) || !(vb.h > 0)) throw new UserError('scene needs a viewBox (or numeric width/height) with positive size');
  let h = Math.ceil((width * vb.h) / vb.w);
  if (h % 2 === 1) h += 1; // pad up at most 1px rather than crop
  return { w: width, h };
}

export function screenSourceText(text) {
  if (!text || !text.trim().length) throw new UserError('input SVG is blank');
  if (/<!doctype/i.test(text)) throw new UserError('DOCTYPE declarations are not allowed');
  if (/<!entity/i.test(text)) throw new UserError('entity declarations are not allowed');
  if (/<\s*script[\s/>]/i.test(text)) throw new UserError('<script> elements are not allowed');
  if (/<\s*\/?\s*foreignobject[\s/>]/i.test(text)) throw new UserError('<foreignObject> elements are not allowed');
  return true;
}

// ---- font selection: bundled defaults or a --fonts manifest ----

const FAMILY_RE = /^[A-Za-z0-9][A-Za-z0-9 .,'-]{0,63}$/;
const WEIGHT_RE = /^[1-9][0-9]{2}$/;

function slugify(s) { return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); }

// Resolve a list of {family,weight,file,license} entries against baseDir. Paths
// are relative to the manifest (or the bundled assets/fonts directory); the font
// must exist, be non-empty and carry a wOF2 header, and so must the license text.
// family/weight are interpolated into CSS, so they must match strict character
// rules; duplicate family/weight pairs are rejected; colliding license output
// filenames are disambiguated deterministically. No fonts are fetched remotely.
export function resolveFontList(entries, baseDir) {
  if (!Array.isArray(entries) || !entries.length) throw new UserError('font manifest must be a non-empty array of font entries');
  const seen = new Set();
  const licenseNames = new Set();
  return entries.map((e, i) => {
    const where = 'font entry ' + i;
    if (!e || typeof e !== 'object') throw new UserError(where + ' must be an object');
    for (const k of ['family', 'weight', 'file', 'license']) {
      if (typeof e[k] !== 'string' || !e[k].trim()) throw new UserError(where + ' needs a non-empty string "' + k + '"');
    }
    if (!FAMILY_RE.test(e.family)) throw new UserError(`${where}: family must be 1-64 characters of letters, digits, spaces, . , ' or - (got "${e.family}")`);
    if (!WEIGHT_RE.test(e.weight)) throw new UserError(`${where}: weight must be a numeric CSS weight such as "400" (got "${e.weight}")`);
    const key = e.family + ' ' + e.weight;
    if (seen.has(key)) throw new UserError('duplicate family/weight in the font manifest: ' + key);
    seen.add(key);
    const file = path.resolve(baseDir, e.file);
    const license = path.resolve(baseDir, e.license);
    if (!fs.existsSync(file) || fs.statSync(file).size === 0) throw new UserError('font file missing or empty: ' + file);
    if (!fs.existsSync(license) || fs.statSync(license).size === 0) throw new UserError('font license file missing or empty: ' + license);
    const head = fs.readFileSync(file).subarray(0, 4);
    if (head.length < 4 || head[0] !== 0x77 || head[1] !== 0x4f || head[2] !== 0x46 || head[3] !== 0x32) {
      throw new UserError('font file is not a valid woff2 (missing "wOF2" signature): ' + file);
    }
    let licenseOut = path.basename(license).replace(/[^A-Za-z0-9._-]/g, '_');
    if (!licenseOut) licenseOut = 'LICENSE.txt';
    if (licenseNames.has(licenseOut)) {
      licenseOut = slugify(e.family) + '-' + licenseOut;
      if (!licenseOut || licenseNames.has(licenseOut)) throw new UserError('cannot derive a unique license output filename for ' + key);
    }
    licenseNames.add(licenseOut);
    return { family: e.family, weight: e.weight, file, license, licenseOut };
  });
}

// Load the font set: the bundled defaults, or the JSON manifest at manifestPath.
export function loadFonts(manifestPath) {
  if (!manifestPath) return resolveFontList(DEFAULT_FONTS, FONT_DIR);
  const p = path.resolve(manifestPath);
  let raw;
  try { raw = fs.readFileSync(p, 'utf8'); } catch { throw new UserError('--fonts manifest not found: ' + manifestPath); }
  let parsed;
  try { parsed = JSON.parse(raw); } catch (e) { throw new UserError('--fonts manifest is not valid JSON: ' + e.message); }
  if (!Array.isArray(parsed) || !parsed.length) throw new UserError('--fonts manifest must be a non-empty JSON array of font entries');
  return resolveFontList(parsed, path.dirname(p));
}

// Embedded font faces for the normalized scene, with attribution comments.
export function fontFaceCss(fonts) {
  const names = fonts.map((f) => f.family + ' ' + f.weight).join(', ');
  const parts = ['/* Embedded fonts: ' + names + ' — license texts ship as fonts/* in the export bundle (bundled defaults are SIL Open Font License 1.1). */'];
  for (const f of fonts) {
    let buf;
    try { buf = fs.readFileSync(f.file); } catch { throw new UserError('font file missing: ' + f.file); }
    if (buf.length < 4 || buf[0] !== 0x77 || buf[1] !== 0x4f || buf[2] !== 0x46 || buf[3] !== 0x32) {
      throw new UserError('font file is not a valid woff2 (missing "wOF2" signature): ' + f.file);
    }
    const b64 = buf.toString('base64');
    parts.push(`/* ${path.basename(f.file)} (${f.family} ${f.weight}) — see fonts/${f.licenseOut} in the export bundle for this font's license. */`);
    parts.push(`@font-face{font-family:"${f.family}";src:url(data:font/woff2;base64,${b64}) format("woff2");font-weight:${f.weight};font-style:normal}`);
  }
  return parts.join('\n');
}

function findOnPath(name) {
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    const f = path.join(dir, name);
    try {
      fs.accessSync(f, fs.constants.X_OK);
      return fs.realpathSync(f);
    } catch { /* keep scanning */ }
  }
  return null;
}

async function importModulePath(spec) {
  let abs = path.resolve(spec);
  let st = null;
  try { st = fs.statSync(abs); } catch { throw new UserError(`--playwright path not found: ${spec}`); }
  if (st.isDirectory()) abs = path.join(abs, 'index.js');
  try {
    const mod = await import(pathToFileURL(abs).href);
    return mod.chromium ? mod : mod.default;
  } catch (e) {
    throw new UserError(`failed to import playwright from ${spec}: ${e.message}`);
  }
}

export async function loadPlaywright(explicit) {
  if (explicit) return importModulePath(explicit);
  try { return await import('playwright'); } catch { /* no local resolution */ }
  const cli = findOnPath('playwright-cli');
  if (cli) {
    try {
      const pw = createRequire(cli)('playwright');
      if (pw && pw.chromium) return pw;
    } catch { /* fall through */ }
  }
  throw new UserError('could not resolve the playwright module — run "npm install" in the skill directory, or pass --playwright /absolute/path/to/playwright (module dir or index.js)');
}

export function resolveBrowser(pw, explicit) {
  if (explicit) {
    if (!fs.existsSync(explicit)) throw new UserError(`--browser not found: ${explicit}`);
    return explicit;
  }
  // Prefer the managed Playwright browser, then an existing Chrome, then fail
  // with an actionable message. An explicit --browser always wins (above).
  try {
    const p = pw.chromium.executablePath();
    if (p && fs.existsSync(p)) return p;
  } catch { /* fall through */ }
  const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  if (fs.existsSync(chrome)) return chrome;
  throw new UserError('no browser found — run "npm run browser:install" for a managed Chromium, install Google Chrome, or pass --browser /absolute/path/to/chrome');
}

function runCmd(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => {
      reject(e.code === 'ENOENT' ? new UserError(`${cmd} not found on PATH — install it or add it to PATH`) : e);
    });
    child.on('close', (code) => {
      if (code === 0) resolve(out);
      else reject(new UserError(`${cmd} exited ${code}: ${err.slice(-400)}`));
    });
  });
}

const sha256 = (data) => createHash('sha256').update(data).digest('hex');

// ---- page-side steps (each runs as one evaluate; no closure over module scope) ----

async function validateInPage(page, text) {
  return page.evaluate(({ text, animatable, urlAttrs }) => {
    const bad = (m) => { throw new Error(m); };
    const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
    const perr = doc.querySelector('parsererror');
    if (perr) bad('input is not well-formed XML: ' + perr.textContent.replace(/\s+/g, ' ').trim().slice(0, 160));
    const svg = doc.documentElement;
    if (!svg || svg.localName.toLowerCase() !== 'svg') bad('root element is not <svg>');
    if (svg.namespaceURI !== 'http://www.w3.org/2000/svg') bad('root <svg> must be in the SVG namespace (got ' + (svg.namespaceURI === null ? 'none' : svg.namespaceURI) + ')');
    for (const el of doc.getElementsByTagName('*')) {
      const ln = el.localName.toLowerCase();
      if (ln === 'script' || ln === 'foreignobject') bad('<' + ln + '> is not allowed');
      for (const attr of el.attributes) {
        const an = attr.name.toLowerCase();
        if (an.startsWith('on')) bad('event handler attribute "' + attr.name + '" is not allowed');
        if (an === 'href' || an === 'xlink:href') {
          const v = attr.value.trim();
          if (!v.startsWith('#') && !v.startsWith('data:')) bad('non-local href "' + v + '" is not allowed');
        }
        if (an === 'style') {
          for (const decl of attr.value.split(';')) {
            const c = decl.indexOf(':');
            if (c < 0) continue;
            const prop = decl.slice(0, c).trim().toLowerCase();
            if (/^(-\w+-)?(animation|transition)(-\w+)?$/.test(prop)) bad('CSS animation/transition declarations are not allowed in a style attribute (property "' + prop + '")');
          }
          for (const m of attr.value.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/g)) {
            const v = m[2].trim();
            if (!v.startsWith('#') && !v.startsWith('data:')) bad('non-local CSS url("' + v + '") is not allowed');
          }
        }
        if (urlAttrs.includes(an)) {
          for (const m of attr.value.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/g)) {
            const v = m[2].trim();
            if (!v.startsWith('#') && !v.startsWith('data:')) bad('non-local url("' + v + '") in the ' + an + ' attribute is not allowed (internal url(#id) references are preserved)');
          }
        }
      }
      if (ln === 'style') {
        const css = el.textContent;
        if (/@import|@charset|@keyframes/i.test(css)) bad('CSS animation/transition/import is not allowed');
        for (const decl of css.split(/[;{}]/)) {
          const c = decl.indexOf(':');
          if (c < 0) continue;
          const prop = decl.slice(0, c).trim().toLowerCase();
          if (/^(-\w+-)?(animation|transition)(-\w+)?$/.test(prop)) bad('CSS animation/transition declarations are not allowed in <style> (property "' + prop + '")');
        }
        for (const m of css.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/g)) {
          const v = m[2].trim();
          if (!v.startsWith('#') && !v.startsWith('data:')) bad('non-local CSS url("' + v + '") is not allowed');
        }
      }
    }
    const anims = svg.querySelectorAll('animate,animateMotion,animateTransform,set');
    for (const an of anims) {
      const ln = an.localName.toLowerCase();
      if (ln === 'animatemotion' || ln === 'animatetransform') continue; // frozen via resolved CTM
      const attr = (an.getAttribute('attributeName') || '').toLowerCase();
      if (!animatable.includes(attr)) bad('cannot freeze <' + ln + ' attributeName="' + attr + '">: only ' + animatable.join(', ') + ' and transform motion are supported');
    }
    let vb = null;
    const vba = svg.getAttribute('viewBox');
    if (vba) {
      const parts = vba.trim().split(/[\s,]+/).map(Number);
      if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n)) || parts[2] <= 0 || parts[3] <= 0) bad('invalid viewBox: "' + vba + '"');
      vb = { x: parts[0], y: parts[1], w: parts[2], h: parts[3] };
    } else {
      const w = Number(svg.getAttribute('width')), h = Number(svg.getAttribute('height'));
      if (!(w > 0) || !(h > 0)) bad('scene needs a viewBox or numeric width/height');
      vb = { x: 0, y: 0, w, h };
    }
    return { vb, hasMotion: anims.length > 0 };
  }, { text, animatable: ANIMATABLE, urlAttrs: URL_ATTRS });
}

async function normalizeInPage(page, text, fontCss, w, h, vb) {
  return page.evaluate(({ text, fontCss, w, h, vb }) => {
    const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
    const svg = doc.documentElement;
    const style = doc.createElementNS('http://www.w3.org/2000/svg', 'style');
    style.textContent = fontCss;
    svg.appendChild(style);
    if (!svg.getAttribute('viewBox')) svg.setAttribute('viewBox', vb.x + ' ' + vb.y + ' ' + vb.w + ' ' + vb.h);
    svg.setAttribute('width', String(w));
    svg.setAttribute('height', String(h));
    return new XMLSerializer().serializeToString(svg);
  }, { text, fontCss, w, h, vb });
}

function renderPageHtml(svgText) {
  return '<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;overflow:hidden}svg{display:block}</style></head><body>'
    + svgText + '</body></html>';
}

async function inspectGround(page) {
  return page.evaluate(() => {
    const bad = (m) => { throw new Error(m); };
    const svg = document.querySelector('svg');
    const PAINTED = ['rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'path', 'text', 'image', 'use'];
    let first = null;
    for (const el of svg.querySelectorAll('*')) {
      const cs = getComputedStyle(el);
      const painted = PAINTED.includes(el.localName) && cs.display !== 'none' && cs.visibility !== 'hidden'
        && parseFloat(cs.opacity || '1') > 0
        && ((cs.fill !== 'none' && parseFloat(cs.fillOpacity || '1') > 0)
          || (cs.stroke !== 'none' && parseFloat(cs.strokeWidth || '0') > 0 && parseFloat(cs.strokeOpacity || '1') > 0));
      if (painted) { first = { el, cs }; break; }
    }
    if (!first) bad('scene has no painted content');
    if (first.el.localName !== 'rect') bad('first painted element must be a rect that covers the viewBox (transparent ground is not allowed)');
    const vb = svg.viewBox.baseVal;
    const b = first.el.getBBox();
    if (b.x > vb.x + 0.5 || b.y > vb.y + 0.5 || b.x + b.width < vb.x + vb.width - 0.5 || b.y + b.height < vb.y + vb.height - 0.5) {
      bad('background rect does not cover the viewBox (transparent ground is not allowed)');
    }
    const m = /rgba?\(([^)]*)\)/.exec(first.cs.fill);
    if (!m) bad('background rect must use an opaque solid color');
    const parts = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    if (parts.length > 3 && parts[3] < 1) bad('background rect must be opaque (alpha ' + parts[3] + ')');
    if (parseFloat(first.cs.fillOpacity) < 1 || parseFloat(first.cs.opacity) < 1) bad('background rect must be fully opaque');
    document.body.style.background = first.cs.fill;
    return { bg: first.cs.fill };
  });
}

async function seek(page, t) {
  await page.evaluate((t) => {
    const svg = document.querySelector('svg');
    svg.pauseAnimations();
    svg.setCurrentTime(t);
    return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  }, t);
}

// Freeze the scene at time t: sample resolved presentation values and CTMs from
// the live (paused, seeked) DOM, inline them into a clone, and drop the SMIL.
async function freezeAt(page, t) {
  return page.evaluate(({ t, props }) => {
    const svg = document.querySelector('svg');
    svg.pauseAnimations();
    svg.setCurrentTime(t);
    return new Promise((resolve, reject) => requestAnimationFrame(() => requestAnimationFrame(() => {
      try {
      const bad = (m) => { throw new Error(m); };
      const animEls = [...svg.querySelectorAll('animate,animateMotion,animateTransform,set')];
      if (animEls.length === 0) { resolve(new XMLSerializer().serializeToString(svg)); return; }
      const liveAll = [svg, ...svg.querySelectorAll('*')];
      const idx = new Map(liveAll.map((el, i) => [el, i]));
      const frozen = svg.cloneNode(true);
      const frozenAll = [frozen, ...frozen.querySelectorAll('*')];
      const styleTargets = new Set();
      const transformTargets = new Set();
      for (const a of animEls) {
        let target = a.parentElement;
        const href = a.getAttribute('href') || a.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
        if (href && href.startsWith('#')) target = svg.querySelector('#' + CSS.escape(href.slice(1)));
        if (!target || !idx.has(target)) bad('animation target not found');
        styleTargets.add(idx.get(target));
        if (a.localName === 'animateMotion' || a.localName === 'animateTransform') transformTargets.add(idx.get(target));
      }
      // Parent user-space CTM (a temp <g> reveals it; parent.getScreenCTM alone is
      // wrong for children of the root svg, whose viewBox transform it omits).
      const baseCTM = (parent) => {
        const g = parent.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'g');
        parent.appendChild(g);
        const m = g.getScreenCTM();
        parent.removeChild(g);
        return m;
      };
      for (const i of styleTargets) {
        const cs = getComputedStyle(liveAll[i]);
        for (const p of props) frozenAll[i].style.setProperty(p, cs.getPropertyValue(p));
      }
      for (const i of transformTargets) {
        const live = liveAll[i];
        // Chrome mirrors SMIL motion into computed transform, so only an inline
        // style declaration (which would out-rank the baked attribute) is a conflict.
        if (/transform\s*:/.test(live.getAttribute('style') || '')) bad('CSS transform on an animated element is not supported');
        const base = live.parentElement ? baseCTM(live.parentElement) : null;
        const scr = live.getScreenCTM();
        if (!scr || !base) continue; // not rendered (e.g. inside <defs>)
        const rel = base.inverse().multiply(scr);
        frozenAll[i].setAttribute('transform', 'matrix(' + [rel.a, rel.b, rel.c, rel.d, rel.e, rel.f].join(' ') + ')');
      }
      for (const a of animEls) frozenAll[idx.get(a)].remove();
      resolve(new XMLSerializer().serializeToString(frozen));
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e && e.message ? e.message : e)));
      }
    })));
  }, { t, props: FROZEN_PROPS });
}

// Verify that every expected bundled face actually loaded on the page; a font
// that fails to decode (OTS errors are console noise, not failures by themselves)
// must fail the export loudly instead of silently rendering a fallback face.
export async function verifyFontsLoaded(page, fonts = DEFAULT_FONTS.map((f) => ({ family: f.family, weight: f.weight }))) {
  return page.evaluate(async (fonts) => {
    const failed = [];
    for (const f of fonts) {
      const spec = f.weight + ' 24px "' + f.family + '"';
      let loaded = [];
      try { loaded = await document.fonts.load(spec, 'Ag'); } catch (e) { loaded = []; }
      if (!loaded.length || !document.fonts.check(spec, 'Ag')) failed.push(f.family + ' ' + f.weight);
    }
    if (failed.length) throw new Error('embedded fonts failed to load: ' + failed.join(', '));
  }, fonts);
}

// A stylesheet transform declaration on an animation target would out-rank the
// transform attribute the freezer bakes; reject that combination before any
// capture rather than silently producing wrong art.
async function assertTransformSafety(page) {
  return page.evaluate(() => {
    const bad = (m) => { throw new Error(m); };
    const svg = document.querySelector('svg');
    const targets = new Set();
    for (const a of svg.querySelectorAll('animate,animateMotion,animateTransform,set')) {
      let t = a.parentElement;
      const href = a.getAttribute('href') || a.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
      if (href && href.startsWith('#')) t = svg.querySelector('#' + CSS.escape(href.slice(1)));
      if (t) targets.add(t);
    }
    if (!targets.size) return;
    const PROPS = ['transform', 'translate', 'rotate', 'scale'];
    const check = (rules) => {
      for (const rule of rules) {
        const st = rule.style;
        if (st) {
          const hit = PROPS.find((prop) => st.getPropertyValue(prop));
          if (hit) {
            let matches = [];
            try { matches = [...document.querySelectorAll(rule.selectorText)]; } catch (e) { matches = []; }
            for (const el of matches) {
              if (targets.has(el)) bad('a stylesheet ' + hit + ' declaration (rule "' + rule.selectorText + '") applies to an animated element; CSS transforms on animation targets are not supported');
            }
          }
        }
        // Grouping rules (@media, @container) and nested rules inside style rules
        // (CSS Nesting) — note CSSStyleRule also exposes cssRules, so the rule's
        // own declarations above must be checked before recursing.
        if (rule.cssRules) check(rule.cssRules);
      }
    };
    for (const sheet of document.styleSheets) {
      let rules;
      try { rules = sheet.cssRules; } catch (e) { continue; } // unreadable sheet
      check(rules);
    }
  });
}

function buildPreviewHtml(sceneSvgText, stillText, duration) {
  // No-JS contract: the rendered document contains ONLY the frozen final still
  // (no SMIL anywhere in the light DOM), and the controls start hidden; the
  // animated markup lives inside an inert <template> that only the player
  // script activates, so without JavaScript nothing can autoplay.
  const playerJs = `(function () {
  var DUR = ${JSON.stringify(duration)};
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var svg = null, t = DUR, playing = false, rate = 1, raf = 0, last = 0;
  var stage = document.getElementById('stage');
  var scrub = document.getElementById('scrub'), time = document.getElementById('time');
  var play = document.getElementById('play'), slow = document.getElementById('slow');
  var tpl = document.getElementById('animated');
  if (!stage || !tpl) return;
  svg = tpl.content.querySelector('svg');
  if (!svg) return;
  stage.replaceWith(svg); // swap the frozen still for the live scene
  svg.pauseAnimations();
  svg.setCurrentTime(DUR); // still-first: open on the authored final state
  scrub.max = DUR;
  function fmt(x) { return x.toFixed(2) + 's'; }
  function render() { time.textContent = fmt(t); scrub.value = t; svg.setCurrentTime(t); }
  function stop() { playing = false; play.textContent = 'Play'; if (raf) cancelAnimationFrame(raf); raf = 0; }
  function seekTo(x) { stop(); t = Math.min(DUR, Math.max(0, x)); render(); }
  function frame(now) {
    if (!playing) return;
    var dt = (now - last) / 1000; last = now;
    t = Math.min(DUR, t + dt * rate);
    render(); // end holds: authored freeze holds the final state
    if (t >= DUR) stop(); else raf = requestAnimationFrame(frame);
  }
  if (reduced) {
    // Reduced motion: no continuous playback; offer explicit static before/after
    // plus scrubbing instead.
    play.hidden = true;
    document.getElementById('replay').hidden = true;
    slow.parentElement.hidden = true;
    var before = document.getElementById('before'), after = document.getElementById('after');
    before.hidden = false; after.hidden = false;
    before.onclick = function () { seekTo(0); };
    after.onclick = function () { seekTo(DUR); };
  } else {
    play.onclick = function () {
      if (playing) { stop(); return; }
      if (t >= DUR) t = 0;
      playing = true; play.textContent = 'Pause'; last = performance.now(); raf = requestAnimationFrame(frame);
    };
    document.getElementById('replay').onclick = function () {
      stop(); t = 0; playing = true; play.textContent = 'Pause'; last = performance.now(); raf = requestAnimationFrame(frame);
    };
    slow.onchange = function () { rate = slow.checked ? 0.1 : 1; };
  }
  scrub.addEventListener('input', function () {
    var requested = parseFloat(scrub.value); // capture before stop() re-renders
    seekTo(requested);
  });
  document.getElementById('controls').hidden = false;
  render();
})();`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Scene preview</title>
<!-- Fonts embedded inline; license texts ship as fonts/* in the export bundle. -->
<style>
  html,body{margin:0;padding:0;background:#FFFFFF;color:#17212B;font-family:system-ui,sans-serif}
  main{max-width:960px;margin:0 auto;padding:16px}
  svg{display:block;width:100%;height:auto;margin:0 auto}
  [hidden]{display:none !important}
  .controls{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:12px}
  button{font:600 14px system-ui;padding:8px 14px;border:1px solid #17212B;background:#17212B;color:#FFFFFF;border-radius:4px;cursor:pointer}
  button:hover{background:#2A3742}
  input[type=range]{flex:1;min-width:160px}
  .t{font:400 14px ui-monospace,monospace;min-width:5.5em;text-align:right}
  .hint{margin-top:8px;font:400 13px system-ui;color:#4B5563}
  @media (prefers-reduced-motion: reduce){.hint::after{content:" Reduced motion is on: playback is replaced by static before/after and scrubbing."}}
</style>
</head>
<body>
<main>
<div id="stage">
${stillText}
</div>
<template id="animated">
${sceneSvgText}
</template>
<div class="controls" id="controls" hidden>
  <button id="play" aria-label="Play or pause">Play</button>
  <button id="replay" aria-label="Replay from start">Replay</button>
  <label><input type="checkbox" id="slow"> 0.1×</label>
  <button id="before" hidden aria-label="Show the state before arrival">Before</button>
  <button id="after" hidden aria-label="Show the final state">After</button>
  <input id="scrub" type="range" min="0" max="${duration}" step="0.01" value="${duration}" aria-label="Scrub timeline">
  <output id="time" class="t">${duration.toFixed(2)}s</output>
</div>
<p class="hint">Still-first preview: the scene opens on its final state; no autoplay.</p>
</main>
<script>
${playerJs}
</script>
</body>
</html>`;
}
// ---- pipeline ----

export async function runExport(a) {
  const inputPath = path.resolve(a.input);
  let st = null;
  try { st = fs.statSync(inputPath); } catch { throw new UserError('input not found: ' + inputPath); }
  if (!st.isFile()) throw new UserError('input is not a file: ' + inputPath);
  const rawBuf = fs.readFileSync(inputPath);
  const rawText = rawBuf.toString('utf8');
  screenSourceText(rawText);
  const outPath = path.resolve(a.out);
  if (fs.existsSync(outPath)) throw new UserError('output directory already exists: ' + outPath + ' (refusing to overwrite)');
  const parent = path.dirname(outPath);
  let pst = null;
  try { pst = fs.statSync(parent); } catch { throw new UserError('parent of --out does not exist: ' + parent); }
  if (!pst.isDirectory()) throw new UserError('parent of --out is not a directory: ' + parent);
  const inputDir = path.dirname(inputPath);
  const rel = path.relative(outPath, inputDir);
  if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) {
    throw new UserError('output directory must not be equal to (or contain) the input directory: ' + outPath);
  }
  const stage = await fsp.mkdtemp(path.join(parent, '.' + path.basename(outPath) + '.stage-'));
  let browser = null;
  try {
    const fonts = loadFonts(a.fonts);
    const fontCss = fontFaceCss(fonts);
    const pw = await loadPlaywright(a.playwright);
    const exe = resolveBrowser(pw, a.browser);
    browser = await pw.chromium.launch({ executablePath: exe });
    const context = await browser.newContext();
    const page = await context.newPage();
    const consoleErrors = [];
    const netAttempts = [];
    page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    page.on('pageerror', (e) => consoleErrors.push(String(e)));
    const block = (route) => { netAttempts.push(route.request().url()); return route.abort(); };
    await context.route('http://**/*', block);
    await context.route('https://**/*', block);

    const { vb, hasMotion } = await validateInPage(page, rawText);
    const { w, h } = computeOutputSize(vb, a.width);
    await page.setViewportSize({ width: w, height: h });
    const normText = await normalizeInPage(page, rawText, fontCss, w, h, vb);
    await page.setContent(renderPageHtml(normText));
    await page.evaluate(() => document.fonts.ready);
    await verifyFontsLoaded(page, fonts);
    await inspectGround(page);
    await assertTransformSafety(page);

    const outputs = new Map(); // name -> Buffer
    outputs.set('scene.svg', Buffer.from('<?xml version="1.0" encoding="UTF-8"?>\n' + normText, 'utf8'));
    // The preview's no-JS default view is the true frozen final state, so it is
    // always frozen at the full duration, independent of --time.
    const frozenEnd = await freezeAt(page, a.duration);
    outputs.set('preview.html', Buffer.from(buildPreviewHtml(normText, frozenEnd, a.duration), 'utf8'));

    let frameCount = 0;
    let uniqueFrameCount = 0;
    if (a.formats.includes('png')) {
      await seek(page, a.time);
      outputs.set('scene.png', await page.screenshot());
    }
    if (a.formats.includes('svg')) {
      const frozen = a.time === a.duration ? frozenEnd : await freezeAt(page, a.time);
      outputs.set('scene.static.svg', Buffer.from('<?xml version="1.0" encoding="UTF-8"?>\n' + frozen, 'utf8'));
    }
    if (a.formats.includes('mp4')) {
      const framesDir = path.join(stage, 'frames');
      await fsp.mkdir(framesDir);
      const N = Math.ceil(a.duration * a.fps - 1e-9);
      const seen = new Set();
      for (let n = 0; n < N; n++) {
        await seek(page, n / a.fps);
        const buf = await page.screenshot();
        seen.add(sha256(buf));
        await fsp.writeFile(path.join(framesDir, 'f' + String(n).padStart(5, '0') + '.png'), buf);
      }
      frameCount = N;
      uniqueFrameCount = seen.size;
      if (hasMotion && uniqueFrameCount < 2) {
        throw new UserError('animated scene produced only one unique frame — refusing to encode an MP4 that claims motion but shows none');
      }
      await runCmd('ffmpeg', ['-framerate', String(a.fps), '-i', path.join(framesDir, 'f%05d.png'),
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', path.join(stage, 'scene.mp4')]);
      const probe = JSON.parse(await runCmd('ffprobe', ['-v', 'error', '-print_format', 'json', '-count_frames',
        '-show_entries', 'stream=codec_name,pix_fmt,width,height,nb_read_frames:format=duration', path.join(stage, 'scene.mp4')]));
      const v = probe.streams[0];
      if (!v || v.codec_name !== 'h264' || v.pix_fmt !== 'yuv420p') throw new UserError('ffprobe: unexpected codec ' + (v ? v.codec_name + '/' + v.pix_fmt : 'none'));
      if (v.width !== w || v.height !== h) throw new UserError(`ffprobe: dimensions ${v.width}x${v.height} != ${w}x${h}`);
      const framesRead = Number(v.nb_read_frames);
      const durSec = Number(probe.format.duration);
      if (Math.abs(framesRead - N) > 1) throw new UserError(`ffprobe: frame count ${framesRead} != ${N} (tolerance 1)`);
      if (Math.abs(durSec - N / a.fps) > 1 / a.fps + 0.05) throw new UserError(`ffprobe: duration ${durSec}s outside tolerance of ${N / a.fps}s`);
      outputs.set('scene.mp4', await fsp.readFile(path.join(stage, 'scene.mp4')));
      await fsp.rm(framesDir, { recursive: true, force: true });
    }
    if (netAttempts.length) throw new UserError('scene attempted network access: ' + netAttempts[0]);
    if (consoleErrors.length) throw new UserError('browser console errors during export: ' + consoleErrors.slice(0, 3).join(' | '));

    const files = {};
    for (const [name, buf] of outputs) {
      files[name] = sha256(buf);
      await fsp.writeFile(path.join(stage, name), buf);
    }
    for (const f of fonts) {
      if (!fs.existsSync(f.license)) throw new UserError(`font license file missing: ${f.license}`);
      const buf = fs.readFileSync(f.license);
      await fsp.mkdir(path.join(stage, 'fonts'), { recursive: true });
      await fsp.writeFile(path.join(stage, 'fonts', f.licenseOut), buf);
      files['fonts/' + f.licenseOut] = sha256(buf);
    }
    const manifest = {
      generator: 'diagram-authoring export.mjs',
      input: { file: path.basename(inputPath), sha256: sha256(rawBuf), viewBox: vb },
      output: { width: w, height: h, duration: a.duration, fps: a.fps, time: a.time,
        frameCount, uniqueFrameCount, formats: a.formats },
      motion: hasMotion,
      fonts: fonts.map((f) => ({ family: f.family, weight: f.weight, file: path.basename(f.file), license: f.licenseOut })),
      browser: browser.version(),
      files,
    };
    await fsp.writeFile(path.join(stage, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    await fsp.rename(stage, outPath);
    return manifest;
  } finally {
    if (browser) await browser.close().catch(() => {});
    await fsp.rm(stage, { recursive: true, force: true }).catch(() => {});
  }
}

async function main() {
  let a;
  try {
    a = parseArgs(process.argv.slice(2));
    if (a.help) { console.log(HELP); return; }
  } catch (e) {
    console.error('export.mjs: error: ' + e.message);
    process.exitCode = 1;
    return;
  }
  try {
    await runExport(a);
    console.log('export.mjs: wrote ' + path.resolve(a.out));
  } catch (e) {
    console.error('export.mjs: error: ' + (e.message || e));
    process.exitCode = 1;
  }
}

// CLI guard (realpath on both sides: argv[1] may carry a symlinked prefix such as /tmp)
function invokedAsMain() {
  if (!process.argv[1]) return false;
  try {
    return fs.realpathSync(path.resolve(process.argv[1])) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}
if (invokedAsMain()) main();
