import { createRequire } from "node:module";
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { resolveStoryFile } from "./story-path.mjs";

const usage = "usage: node snapshot.mjs <url or local file> <out.html> [pass label] [--dark | --light] [--width 1440] [--height 810]";
const args = process.argv.slice(2);
const positionals = [];
let width = 1440;
let height = 810;
const size = (name, value) => {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    console.error(`--${name} must be a whole number above 0, got "${value}"`);
    process.exit(1);
  }
  return n;
};
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  const match = /^--(width|height)(?:=(.*))?$/.exec(arg);
  if (match) {
    const value = match[2] ?? args[++i];
    if (value === undefined || value.startsWith("--")) {
      console.error(`--${match[1]} needs a value, like --${match[1]} 1440`);
      process.exit(1);
    }
    if (match[1] === "width") width = size("width", value);
    else height = size("height", value);
  } else if (!arg.startsWith("--")) {
    positionals.push(arg);
  }
}
const [url, out, label] = positionals;
const scheme = args.includes("--dark") ? "dark" : args.includes("--light") ? "light" : "no-preference";
if (!url || !out) {
  console.error(usage);
  process.exit(1);
}
// A path on disk is a page too: a bare file path is not a URL, and
// Playwright rejects it with a protocol error, so a local page is served
// over loopback instead (see below) and only real URLs are used as is.
const local = statSync(url, { throwIfNoEntry: false })?.isFile() ? resolve(url) : null;

// Chromium gives a file:// page an opaque origin, so reading its
// stylesheets fails twice: fetch() is blocked and cssRules throws a
// SecurityError. The old code swallowed both and still removed the
// <link>, so the snapshot lost every external stylesheet and the page
// came out unstyled. Serve the file's folder over loopback instead, the
// way story.mjs already does, so the sheets are same origin and readable.
const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".avif": "image/avif", ".svg": "image/svg+xml", ".gif": "image/gif", ".ico": "image/x-icon", ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".otf": "font/otf", ".mp4": "video/mp4", ".webm": "video/webm", ".json": "application/json" };
let server;
if (local) {
  const root = dirname(local);
  server = createServer((request, response) => {
    const path = decodeURIComponent(new URL(request.url, "http://local").pathname);
    const file = resolveStoryFile(root, path);
    if (file === null) {
      response.writeHead(404);
      return response.end();
    }
    response.writeHead(200, { "content-type": types[extname(file).toLowerCase()] ?? "application/octet-stream" });
    response.end(readFileSync(file));
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
}
const target = local ? `http://127.0.0.1:${server.address().port}/${encodeURIComponent(basename(local))}` : url;

async function browserKit() {
  for (const name of ["playwright", "playwright-core"]) {
    try {
      return await import(name);
    } catch {}
    try {
      return createRequire(join(process.cwd(), "package.json"))(name);
    } catch {}
  }
  console.error("Playwright is not installed. In your project, run `npm install -D playwright` followed by `npx playwright install chromium`.");
  process.exit(1);
}

const chrome = [process.env.CHROME_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].find((path) => path && existsSync(path));
const { chromium } = await browserKit();
const browser = await chromium.launch(chrome ? { executablePath: chrome } : {});
try {
  const page = await browser.newPage({ viewport: { width: Number(width), height: Number(height) }, colorScheme: scheme });
  await page.goto(target, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(600);
  await page.evaluate(async () => {
    const pause = (ms) => new Promise((done) => setTimeout(done, ms));
    const root = document.scrollingElement || document.documentElement;
    let last = root.scrollHeight;
    for (let step = 0; step < 30 && root.scrollTop < 20_000; step++) {
      window.scrollBy(0, window.innerHeight);
      await pause(150);
      const grown = root.scrollHeight;
      if (grown <= last && root.scrollTop + window.innerHeight >= grown) break;
      last = grown;
    }
    window.scrollTo(0, 0);
    const loaded = (image) =>
      new Promise((done) => {
        image.addEventListener("load", done, { once: true });
        image.addEventListener("error", done, { once: true });
      });
    const pending = [...document.images].filter((image) => !image.complete);
    await Promise.race([Promise.all(pending.map(loaded)), pause(5000)]);
  });
  const html = await page.evaluate(async ([label, scheme]) => {
    const LIMIT = 3_000_000;
    const absolute = (value, base = location.href) => {
      try {
        return new URL(value, base).href;
      } catch {
        return value;
      }
    };
    const inlined = new Map();
    const inline = async (href) => {
      if (!href || href.startsWith("data:")) return href;
      if (!inlined.has(href)) {
        inlined.set(
          href,
          fetch(href)
            .then((response) => (response.ok ? response.blob() : null))
            .then((blob) =>
              blob && blob.size < LIMIT
                ? new Promise((done) => {
                    const reader = new FileReader();
                    reader.onload = () => done(reader.result);
                    reader.readAsDataURL(blob);
                  })
                : href,
            )
            .catch(() => href),
        );
      }
      return inlined.get(href);
    };
    const urls = async (css, base) => {
      const found = [...css.matchAll(/url\((['"]?)(?!data:)([^)'"]+)\1\)/g)];
      let result = css;
      for (const [whole, , value] of found) {
        if (/^(#|%23)/.test(value.trim())) continue;
        const data = await inline(absolute(value.trim(), base));
        result = result.split(whole).join(`url("${data}")`);
      }
      return result;
    };
    // An @import left as a relative path breaks as soon as the snapshot is
    // read from another folder, so pull the imported sheet in by its text.
    const imports = async (css, base, depth = 0) => {
      const found = [...css.matchAll(/@import\s+(?:url\(\s*)?(['"]?)([^'")\s]+)\1\s*\)?\s*([^;]*);/g)];
      let result = css;
      for (const [whole, , href, tail] of found) {
        if (depth > 5) continue;
        const target = absolute(href.trim(), base);
        const text = await fetch(target).then((response) => (response.ok ? response.text() : "")).catch(() => "");
        if (!text) continue;
        const inner = await imports(await urls(text, target), target, depth + 1);
        const media = tail.replace(/\b(media|layer|supports)\b/g, "").replace(/\s+/g, " ").trim();
        const body = media ? `@media ${media} {\n${inner}\n}` : inner;
        result = result.split(whole).join(body);
      }
      return result;
    };

    const css = [];
    // Sheets whose text could not be read. Their <link> stays in the copy,
    // so a page never silently loses its styles; the run warns instead.
    const unreadable = [];
    for (const sheet of document.styleSheets) {
      const owner = sheet.ownerNode;
      let text = "";
      let base = location.href;
      if (sheet.href) {
        base = sheet.href;
        text = await fetch(sheet.href).then((response) => (response.ok ? response.text() : "")).catch(() => "");
      } else if (owner && owner.textContent.trim()) {
        text = owner.textContent;
      }
      if (!text) {
        try {
          text = [...sheet.cssRules].map((rule) => rule.cssText).join("\n");
        } catch {}
      }
      if (!text && sheet.href) {
        unreadable.push(sheet.href);
        // Mark the node so the clone keeps its <link> instead of dropping it.
        if (owner && owner.setAttribute) owner.setAttribute("data-unslop-keep", "");
        continue;
      }
      const media = sheet.media && sheet.media.mediaText;
      const resolved = await imports(await urls(text, base), base);
      css.push(media && media !== "all" ? `@media ${media} {\n${resolved}\n}` : resolved);
    }

    const copy = document.documentElement.cloneNode(true);
    // Freeze the browser's selected image before removing responsive markup.
    const images = document.querySelectorAll("img");
    copy.querySelectorAll("img").forEach((node, index) => {
      const selected = images[index].currentSrc;
      if (selected) node.setAttribute("src", selected);
    });
    copy.querySelectorAll("script, noscript, link[rel='preload'], link[rel='modulepreload'], style").forEach((node) => node.remove());
    copy.querySelectorAll("link[rel='stylesheet']").forEach((node) => {
      if (!node.hasAttribute("data-unslop-keep")) node.remove();
      else node.removeAttribute("data-unslop-keep");
    });
    copy.querySelectorAll("[srcset]").forEach((node) => node.removeAttribute("srcset"));
    copy.querySelectorAll("source").forEach((node) => node.remove());
    copy.querySelectorAll("[loading]").forEach((node) => node.removeAttribute("loading"));
    for (const node of copy.querySelectorAll("img[src], video[poster], image")) {
      const attr = node.tagName === "VIDEO" ? "poster" : node.tagName.toLowerCase() === "image" ? "href" : "src";
      const value = node.getAttribute(attr);
      if (value) node.setAttribute(attr, await inline(absolute(value)));
    }
    copy.querySelectorAll("a[href]").forEach((node) => node.setAttribute("href", absolute(node.getAttribute("href"))));
    for (const node of copy.querySelectorAll("[style*='url(']")) {
      node.setAttribute("style", await urls(node.getAttribute("style"), location.href));
    }
    const style = document.createElement("style");
    let text = css.join("\n");
    if (scheme === "dark" || scheme === "light") {
      const other = scheme === "dark" ? "light" : "dark";
      text = text
        .replace(new RegExp(`prefers-color-scheme\\s*:\\s*${scheme}`, "g"), "min-width: 0px")
        .replace(new RegExp(`prefers-color-scheme\\s*:\\s*${other}`, "g"), "max-width: 0px");
      const meta = document.createElement("meta");
      meta.name = "color-scheme";
      meta.content = scheme;
      copy.querySelector("head").prepend(meta);
    }
    style.textContent = text;
    copy.querySelector("head").appendChild(style);
    if (label) {
      const meta = document.createElement("meta");
      meta.name = "unslop-pass";
      meta.content = label;
      copy.querySelector("head").prepend(meta);
    }
    return { html: "<!doctype html>\n" + copy.outerHTML, unreadable };
  }, [label ?? "", scheme]);
  mkdirSync(dirname(resolve(out)), { recursive: true });
  writeFileSync(resolve(out), html.html);
  for (const href of html.unreadable) {
    console.warn(`warning: could not read the stylesheet at ${href}, so its <link> was kept as is; the copy may look different from the live page`);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: resolve(out).replace(/\.html?$/, "") + ".live.png" });
  console.log(`saved ${resolve(out)}${label ? ` as ${label}` : ""}`);
} finally {
  await browser.close();
  if (server) server.close();
}
