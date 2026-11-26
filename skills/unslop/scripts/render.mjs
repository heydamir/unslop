#!/usr/bin/env node
/**
 * Unslop render helper — screenshot, snapshot and measure a page with the browser
 * already installed on this machine. No Playwright, no npm install, no download.
 *
 *   node render.mjs shot <file-or-url> <out.png> [--width 1440] [--height 900] [--wait 2000] [--dark] [--motion]
 *   node render.mjs snapshot <url> <out.html> [--width 1440] [--height 900] [--dark] [--wait 2000]
 *   node render.mjs probe <file-or-url> [--select "h1,.card"] [--width 1440] [--height 900] [--json out.json]
 *   node render.mjs browsers
 *
 * `shot` writes a PNG of the viewport.
 * `snapshot` saves the DOM after scripts run, rewrites relative URLs against the
 * source page so the copy stands alone, and also writes `<out>.png`.
 * `probe` prints measurements (element rects, computed type, padding, radius, and
 * document overflow) as JSON, so spacing checks stop being guesswork from a PNG.
 *
 * Animations and transitions are finished instantly by default, so an entrance
 * fade cannot photograph as an empty page. Pass `--motion` to keep them.
 *
 * Environment:
 *   UNSLOP_BROWSER      absolute path to a Chromium-based browser to use
 *   UNSLOP_NO_SANDBOX   set to 1 to add --no-sandbox (containers)
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const BROWSERS = [
  process.env.UNSLOP_BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  join(process.env.LOCALAPPDATA ?? '', 'Microsoft/Edge/Application/msedge.exe'),
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  join(process.env.LOCALAPPDATA ?? '', 'Google/Chrome/Application/chrome.exe'),
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/snap/bin/chromium',
]

const FREEZE = `<style id="unslop-freeze">*,*::before,*::after{animation-duration:1ms!important;animation-delay:0s!important;animation-iteration-count:1!important;transition-duration:0s!important;transition-delay:0s!important;caret-color:transparent!important}</style>`

const DEFAULT_SELECTORS =
  'body,h1,h2,h3,p,button,a,input,select,textarea,header,nav,aside,main,section,article,table,ul,img'

function findBrowser() {
  for (const candidate of BROWSERS) if (candidate && existsSync(candidate)) return candidate
  return undefined
}

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`)
  return index > -1 && process.argv[index + 1] ? process.argv[index + 1] : fallback
}

function has(name) {
  return process.argv.includes(`--${name}`)
}

function fail(message, code = 1) {
  const text = String(message)
  console.error(`render: ${text.length > 600 ? `${text.slice(0, 600)}…` : text}`)
  process.exit(code)
}

function toUrl(value) {
  if (/^(https?|file|data):/i.test(value)) return value
  const absolute = isAbsolute(value) ? value : resolve(value)
  if (!existsSync(absolute)) fail(`not found: ${value}`)
  return pathToFileURL(absolute).href
}

function run(browser, args) {
  const profile = mkdtempSync(join(tmpdir(), 'unslop-render-'))
  const flags = [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-background-networking',
    '--force-device-scale-factor=1',
    `--user-data-dir=${profile}`,
    ...args,
  ]
  if (process.env.UNSLOP_NO_SANDBOX === '1') flags.push('--no-sandbox')
  try {
    return spawnSync(browser, flags, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 180_000 })
  } finally {
    rmSync(profile, { recursive: true, force: true, maxRetries: 3 })
  }
}

/** Rewrite relative href/src/srcset so a saved copy renders on its own. */
function absolutize(html, baseUrl) {
  let base
  try {
    base = new URL(baseUrl)
  } catch {
    return html
  }
  if (!/<base\s/i.test(html)) html = html.replace(/<head(\s[^>]*)?>/i, (m) => `${m}\n<base href="${base.href}">`)
  return html.replace(/\s(href|src|poster|data-src)=("|')([^"']*)\2/gi, (whole, attr, quote, value) => {
    if (!value || /^(https?:|data:|mailto:|tel:|#|javascript:|\/\/)/i.test(value)) return whole
    try {
      return ` ${attr}=${quote}${new URL(value, base).href}${quote}`
    } catch {
      return whole
    }
  })
}

const PROBE_SCRIPT = (selectors) => `<script id="unslop-probe-script">(() => {
  const SELECTORS = ${JSON.stringify(selectors)};
  const px = (v) => Number.parseFloat(v) || 0;
  const measure = () => {
    const out = {
      url: location.href,
      viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
      document: {
        scrollWidth: document.documentElement.scrollWidth,
        scrollHeight: document.documentElement.scrollHeight,
        overflowX: Math.max(0, document.documentElement.scrollWidth - innerWidth),
        overflowY: Math.max(0, document.documentElement.scrollHeight - innerHeight),
        fonts: [...new Set([...document.querySelectorAll('body *')].slice(0, 400).map((el) => getComputedStyle(el).fontFamily))].slice(0, 6),
      },
      elements: [],
    };
    for (const selector of SELECTORS) {
      const list = [...document.querySelectorAll(selector)].slice(0, 6);
      if (list.length === 0) { out.elements.push({ selector, missing: true }); continue }
      for (const el of list) {
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        out.elements.push({
          selector,
          tag: el.tagName.toLowerCase(),
          text: (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 40),
          rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
          font: style.fontSize + '/' + style.lineHeight + ' ' + style.fontWeight,
          family: style.fontFamily.split(',')[0].replace(/["']/g, ''),
          padding: [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft].map(px).join(' '),
          margin: [style.marginTop, style.marginRight, style.marginBottom, style.marginLeft].map(px).join(' '),
          radius: style.borderRadius,
          color: style.color,
          background: style.backgroundColor === 'rgba(0, 0, 0, 0)' ? 'none' : style.backgroundColor,
          display: style.display,
        });
      }
    }
    const pre = document.createElement('pre');
    pre.id = 'unslop-probe';
    pre.textContent = JSON.stringify(out);
    document.documentElement.appendChild(pre);
  };
  if (document.readyState === 'complete') measure();
  else {
    measure();
    addEventListener('load', () => {
      if (!document.getElementById('unslop-probe')) measure();
    });
  }
})();</script>`

/** Build the local copy the browser actually loads: base, frozen styles, probe script. */
function prepare(html, { freeze, probe, base }) {
  let out = html
  if (base && !/<base\s/i.test(out)) out = out.replace(/<head(\s[^>]*)?>/i, (m) => `${m}\n<base href="${base}">`)
  if (freeze && !out.includes('unslop-freeze')) {
    out = /<\/head>/i.test(out) ? out.replace(/<\/head>/i, `${FREEZE}</head>`) : FREEZE + out
  }
  if (probe && !out.includes('unslop-probe-script')) {
    out = /<\/body>/i.test(out) ? out.replace(/<\/body>/i, `${PROBE_SCRIPT(probe)}</body>`) : out + PROBE_SCRIPT(probe)
  }
  return out
}

function dumpDom(browser, url, view) {
  const result = run(browser, [...view, '--dump-dom', url])
  const dom = result.stdout ?? ''
  if (dom.trim().length === 0) {
    fail(
      `the browser returned no DOM (exit ${result.status}). If a sandbox blocks piping, run the browser outside it.`,
    )
  }
  return dom
}

function materialize(browser, url, view, { freeze, probe }) {
  let html
  if (url.startsWith('file:')) {
    const path = decodeURIComponent(new URL(url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
    // The copy lives in a temp directory, so pin relative assets to the original folder.
    html = prepare(readFileSync(path, 'utf8'), { freeze, probe, base: url })
  } else {
    html = prepare(absolutize(dumpDom(browser, url, view), url), { freeze, probe })
  }
  const temp = join(mkdtempSync(join(tmpdir(), 'unslop-page-')), 'page.html')
  writeFileSync(temp, html, 'utf8')
  return pathToFileURL(temp).href
}

function decodeEntities(text) {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

const mode = process.argv[2]
const source = process.argv[3]
const output = process.argv[4]

if (mode === 'browsers') {
  const browser = findBrowser()
  console.log(browser ? `browser: ${browser}` : 'no Chromium-based browser found')
  console.log('searched:\n  ' + BROWSERS.filter(Boolean).join('\n  '))
  process.exit(browser ? 0 : 1)
}

if (!['shot', 'snapshot', 'probe'].includes(mode) || !source || (mode !== 'probe' && !output)) {
  const header = readFileSync(new URL(import.meta.url), 'utf8').split('*/')[0]
  console.error(header.replace(/^#!.*\n\/\*\*?/, '').split('\n').map((line) => line.replace(/^ \* ?/, '')).join('\n').trim())
  process.exit(2)
}

const browser = findBrowser()
if (!browser) {
  fail('no Chromium-based browser found; install Chrome or Edge, or set UNSLOP_BROWSER to its executable')
}

const url = toUrl(source)
const width = arg('width', '1440')
const height = arg('height', '900')
const wait = arg('wait', '2000')
const view = [`--window-size=${width},${height}`, `--virtual-time-budget=${wait}`]
if (has('dark')) view.push('--force-dark-mode')
const freeze = !has('motion')

if (mode === 'snapshot') {
  const absoluteHtml = isAbsolute(output) ? output : resolve(output)
  const dom = absolutize(dumpDom(browser, url, view), url)
  writeFileSync(absoluteHtml, dom, 'utf8')
  const shot = absoluteHtml.replace(/\.(html?|markdown)$/i, '') + '.png'
  run(browser, [...view, `--screenshot=${shot}`, url])
  console.log(`snapshot ${dom.length} bytes -> ${absoluteHtml}`)
  if (existsSync(shot)) console.log(`shot ${width}x${height} -> ${shot}`)
  process.exit(0)
}

if (mode === 'probe') {
  const selectors = (arg('select', DEFAULT_SELECTORS) || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
  const requestedWidth = Number(width)
  const requestedHeight = Number(height)

  // A windowed Chromium subtracts its OS frame from --window-size in dump-dom mode,
  // so the measured viewport can be smaller than the screenshot. Correct it once.
  const attempt = (windowSize) => {
    const flags = [`--window-size=${windowSize}`, `--virtual-time-budget=${wait}`]
    if (has('dark')) flags.push('--force-dark-mode')
    const target = materialize(browser, url, flags, { freeze, probe: selectors })
    const dom = dumpDom(browser, target, flags)
    const match = dom.match(/<pre id="unslop-probe">([\s\S]*?)<\/pre>/i)
    return match ? JSON.parse(decodeEntities(match[1])) : undefined
  }

  let measured = attempt(`${requestedWidth},${requestedHeight}`)
  if (!measured) fail('probe did not run: the page may block scripts, or no selector matched')
  if (measured.viewport.width !== requestedWidth || measured.viewport.height !== requestedHeight) {
    const corrected = attempt(
      `${requestedWidth * 2 - measured.viewport.width},${requestedHeight * 2 - measured.viewport.height}`,
    )
    if (corrected && corrected.viewport.width === requestedWidth && corrected.viewport.height === requestedHeight) {
      measured = corrected
    }
  }
  const json = JSON.stringify(measured, null, 2)
  const file = arg('json', '')
  if (file) writeFileSync(isAbsolute(file) ? file : resolve(file), json, 'utf8')
  console.log(json)
  process.exit(0)
}

const absolutePng = isAbsolute(output) ? output : resolve(output)
const target = freeze ? materialize(browser, url, view, { freeze, probe: [] }) : url
const result = run(browser, [...view, `--screenshot=${absolutePng}`, target])
if (!existsSync(absolutePng)) {
  fail(`screenshot failed (exit ${result.status}). ${(result.stderr ?? '').split('\n').slice(-3).join(' ')}`)
}
console.log(`browser: ${browser}`)
console.log(`shot ${width}x${height}${freeze ? ' (motion frozen)' : ''} -> ${absolutePng}`)
