import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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
// Playwright rejects it with a protocol error, so turn it into one.
const target = statSync(url, { throwIfNoEntry: false })?.isFile() ? pathToFileURL(resolve(url)).href : url;

async function browserKit() {
  for (const name of ["playwright", "playwright-core"]) {
    try {
      return await import(name);
    } catch { }
    try {
      return createRequire(join(process.cwd(), "package.json"))(name);
    } catch { }
  }
  console.error("Playwright is not installed. In your project, run `npm install -D playwright` followed by `npx playwright install chromium`.");
  process.exit(1);
}

const LIMIT = 3_000_000;
const localMimes = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
};

function scanCss(css) {
  const tokens = [];
  let i = 0;
  const len = css.length;

  while (i < len) {
    if (css[i] === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      const close = end === -1 ? len : end + 2;
      tokens.push({ type: "comment", raw: css.slice(i, close) });
      i = close;
      continue;
    }

    if (css[i] === "\"" || css[i] === "'") {
      const quote = css[i];
      let j = i + 1;
      while (j < len) {
        if (css[j] === "\\") {
          j += 2;
        } else if (css[j] === quote) {
          j++;
          break;
        } else if (css[j] === "\n" || css[j] === "\r") {
          break;
        } else {
          j++;
        }
      }
      tokens.push({ type: "string", raw: css.slice(i, j) });
      i = j;
      continue;
    }

    if (
      (i === 0 || !/[a-zA-Z0-9_-]/.test(css[i - 1])) &&
      css.slice(i, i + 7).toLowerCase() === "@import" &&
      (i + 7 >= len || /[\s;]/.test(css[i + 7]) || css.slice(i + 7, i + 9) === "/*" || css[i + 7] === "\"" || css[i + 7] === "'")
    ) {
      let j = i + 7;
      let url = null;
      let urlEnd = -1;

      while (j < len && css[j] !== ";") {
        if (css[j] === "/" && css[j + 1] === "*") {
          const end = css.indexOf("*/", j + 2);
          j = end === -1 ? len : end + 2;
          continue;
        }
        if (url === null) {
          if (/\s/.test(css[j])) {
            j++;
            continue;
          }
          if (css[j] === "\"" || css[j] === "'") {
            const q = css[j];
            let k = j + 1;
            while (k < len && css[k] !== q) {
              if (css[k] === "\\") k += 2;
              else k++;
            }
            url = css.slice(j + 1, k);
            if (k < len) k++;
            urlEnd = k;
            j = k;
            continue;
          }
          if (css.slice(j, j + 4).toLowerCase() === "url(") {
            let k = j + 4;
            while (k < len && /\s/.test(css[k])) k++;
            while (k < len && css[k] === "/" && css[k + 1] === "*") {
              const end = css.indexOf("*/", k + 2);
              k = end === -1 ? len : end + 2;
              while (k < len && /\s/.test(css[k])) k++;
            }
            let u = "";
            if (css[k] === "\"" || css[k] === "'") {
              const q = css[k];
              k++;
              const start = k;
              while (k < len && css[k] !== q) {
                if (css[k] === "\\") k += 2;
                else k++;
              }
              u = css.slice(start, k);
              if (k < len) k++;
              while (k < len && /\s/.test(css[k])) k++;
              while (k < len && css[k] === "/" && css[k + 1] === "*") {
                const end = css.indexOf("*/", k + 2);
                k = end === -1 ? len : end + 2;
                while (k < len && /\s/.test(css[k])) k++;
              }
              if (k < len && css[k] === ")") k++;
            } else {
              const start = k;
              while (k < len && css[k] !== ")" && !/\s/.test(css[k])) {
                if (css[k] === "\\") k += 2;
                else k++;
              }
              u = css.slice(start, k);
              while (k < len && css[k] !== ")") k++;
              if (k < len) k++;
            }
            url = u;
            urlEnd = k;
            j = k;
            continue;
          }
        }
        j++;
      }

      const endSemi = j < len && css[j] === ";" ? j + 1 : j;
      const statement = css.slice(i, endSemi);
      let rawModifiers = "";
      if (url !== null && urlEnd !== -1 && urlEnd <= j) {
        rawModifiers = css.slice(urlEnd, j).trim();
      }
      tokens.push({ type: "import", raw: statement, url: url || "", rawModifiers });
      i = endSemi;
      continue;
    }

    if (
      (i === 0 || !/[a-zA-Z0-9_-]/.test(css[i - 1])) &&
      css.slice(i, i + 4).toLowerCase() === "url("
    ) {
      let j = i + 4;
      while (j < len && /\s/.test(css[j])) j++;
      let url = "";
      let quote = "";
      if (css[j] === "\"" || css[j] === "'") {
        quote = css[j];
        j++;
        const start = j;
        while (j < len && css[j] !== quote) {
          if (css[j] === "\\") j += 2;
          else j++;
        }
        url = css.slice(start, j);
        if (j < len) j++;
        while (j < len && /\s/.test(css[j])) j++;
        if (j < len && css[j] === ")") j++;
      } else {
        const start = j;
        while (j < len && css[j] !== ")" && !/\s/.test(css[j])) {
          if (css[j] === "\\") j += 2;
          else j++;
        }
        url = css.slice(start, j);
        while (j < len && css[j] !== ")") j++;
        if (j < len && css[j] === ")") j++;
      }
      tokens.push({ type: "url", raw: css.slice(i, j), url, quote });
      i = j;
      continue;
    }

    tokens.push({ type: "text", raw: css[i] });
    i++;
  }
  return tokens;
}

function parseImportModifiers(rawModifiers) {
  let text = "";
  let i = 0;
  const len = rawModifiers.length;
  while (i < len) {
    if (rawModifiers[i] === "/" && rawModifiers[i + 1] === "*") {
      const end = rawModifiers.indexOf("*/", i + 2);
      i = end === -1 ? len : end + 2;
      text += " ";
      continue;
    }
    if (rawModifiers[i] === "\"" || rawModifiers[i] === "'") {
      const q = rawModifiers[i];
      let j = i + 1;
      while (j < len && rawModifiers[j] !== q) {
        if (rawModifiers[j] === "\\") j += 2;
        else j++;
      }
      if (j < len) j++;
      text += rawModifiers.slice(i, j);
      i = j;
      continue;
    }
    text += rawModifiers[i];
    i++;
  }

  text = text.trim();
  if (!text) {
    return { layer: null, supports: null, media: null, valid: true };
  }

  let layer = null;
  let supports = null;
  let media = null;

  let pos = 0;
  const tLen = text.length;

  const skipWs = () => {
    while (pos < tLen && /\s/.test(text[pos])) pos++;
  };

  skipWs();

  // layer or layer(name)
  if (text.slice(pos).toLowerCase().startsWith("layer")) {
    const after = text.slice(pos + 5);
    if (after.startsWith("(")) {
      let pCount = 1;
      let j = pos + 6;
      while (j < tLen && pCount > 0) {
        if (text[j] === "(") pCount++;
        else if (text[j] === ")") pCount--;
        j++;
      }
      if (pCount === 0) {
        const name = text.slice(pos + 6, j - 1).trim();
        if (!name) return { valid: false };
        layer = name;
        pos = j;
      } else {
        return { valid: false };
      }
    } else if (after === "" || /[\s;]/.test(after[0])) {
      layer = "";
      pos += 5;
    }
    skipWs();
  }

  // supports(...)
  if (text.slice(pos).toLowerCase().startsWith("supports(")) {
    let pCount = 1;
    let j = pos + 9;
    while (j < tLen && pCount > 0) {
      if (text[j] === "(") pCount++;
      else if (text[j] === ")") pCount--;
      j++;
    }
    if (pCount === 0) {
      const cond = text.slice(pos + 9, j - 1).trim();
      if (!cond) return { valid: false };
      supports = cond;
      pos = j;
    } else {
      return { valid: false };
    }
    skipWs();
  }

  // media query list
  if (pos < tLen) {
    const remaining = text.slice(pos).trim();
    if (remaining) {
      if (/\b(?:layer|supports)\s*\(/i.test(remaining) || /\blayer\b/i.test(remaining)) {
        return { valid: false };
      }
      media = remaining;
    }
  }

  return { layer, supports, media, valid: true };
}

function wrapImportedCss(css, { layer, supports, media }) {
  let res = css;
  if (media) {
    res = `@media ${media} {\n${res}\n}`;
  }
  if (supports) {
    let cond = supports.trim();
    const directSupports = /^(?:not\s|\(|(?:selector|font-tech|font-format|at-rule|named-feature|env)\s*\()/i;
    if (!directSupports.test(cond)) {
      cond = `(${cond})`;
    }
    res = `@supports ${cond} {\n${res}\n}`;
  }
  if (layer !== null) {
    if (layer === "") {
      res = `@layer {\n${res}\n}`;
    } else {
      res = `@layer ${layer} {\n${res}\n}`;
    }
  }
  return res;
}

function resolveLocalUrlToPath(rawUrl, baseFilePath) {
  if (!rawUrl || typeof rawUrl !== "string") return null;
  const val = rawUrl.trim();
  if (/^(#|%23)/.test(val) || /^(?:https?:|\/\/|data:)/i.test(val)) return null;

  if (isAbsolute(val)) {
    return val;
  }

  try {
    const baseUrl = pathToFileURL(baseFilePath);
    const resolvedUrl = new URL(val, baseUrl);
    if (resolvedUrl.protocol !== "file:") return null;
    return fileURLToPath(resolvedUrl);
  } catch {
    return null;
  }
}

function resolveSafeLocalPath(root, targetPath) {
  if (!root || !targetPath) return null;
  let realRoot;
  let realTarget;
  try {
    realRoot = realpathSync(root);
    realTarget = realpathSync(targetPath);
  } catch {
    return null;
  }
  const rel = relative(realRoot, realTarget);
  if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    return null;
  }
  try {
    if (!statSync(realTarget).isFile()) return null;
  } catch {
    return null;
  }
  return realTarget;
}

function inlineLocalUrls(css, baseFilePath, root) {
  const tokens = scanCss(css);
  let result = "";
  for (const token of tokens) {
    if (token.type === "url") {
      const val = token.url.trim();
      if (/^(#|%23)/.test(val) || /^(?:https?:|\/\/|data:)/i.test(val)) {
        result += token.raw;
        continue;
      }
      const assetPath = resolveLocalUrlToPath(val, baseFilePath);
      if (!assetPath) {
        result += token.raw;
        continue;
      }
      const safeAsset = resolveSafeLocalPath(root, assetPath);
      if (!safeAsset) {
        result += token.raw;
        continue;
      }
      try {
        const stat = statSync(safeAsset, { throwIfNoEntry: false });
        if (stat && stat.isFile() && stat.size < LIMIT) {
          const ext = extname(safeAsset).toLowerCase();
          const mime = localMimes[ext] || "application/octet-stream";
          const b64 = readFileSync(safeAsset).toString("base64");
          const hashIdx = val.indexOf("#");
          const fragment = hashIdx !== -1 ? val.slice(hashIdx) : "";
          result += `url("data:${mime};base64,${b64}${fragment}")`;
          continue;
        }
      } catch { }
      result += token.raw;
    } else {
      result += token.raw;
    }
  }
  return result;
}

function readCssWithImports(filePath, root, stack = new Set()) {
  const safeFile = resolveSafeLocalPath(root, filePath);
  if (!safeFile || stack.has(safeFile)) return "";
  stack.add(safeFile);
  try {
    let content = readFileSync(safeFile, "utf8");
    content = inlineLocalUrls(content, safeFile, root);

    const tokens = scanCss(content);
    let result = "";
    for (const token of tokens) {
      if (token.type === "import") {
        const importUrl = token.url.trim();
        if (!importUrl || /^(?:https?:|\/\/|data:|#|%23)/i.test(importUrl)) {
          result += token.raw;
          continue;
        }
        const nextFile = resolveLocalUrlToPath(importUrl, safeFile);
        if (!nextFile) {
          result += token.raw;
          continue;
        }
        const importedCss = readCssWithImports(nextFile, root, stack);
        if (!importedCss) continue;
        const mod = parseImportModifiers(token.rawModifiers || "");
        if (!mod.valid) continue;
        result += wrapImportedCss(importedCss, mod);
      } else {
        result += token.raw;
      }
    }
    return result;
  } finally {
    stack.delete(safeFile);
  }
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
  let root = null;
  let targetFile = null;
  if (target.startsWith("file:")) {
    try {
      targetFile = fileURLToPath(target);
      root = realpathSync(dirname(targetFile));
    } catch {
      root = null;
      targetFile = null;
    }
  }

  const localStylesheets = {};
  if (root) {
    const hrefs = await page.evaluate(() =>
      Array.from(document.styleSheets)
        .map((sheet) => sheet.href)
        .filter((href) => href && href.startsWith("file:")),
    );
    for (const href of hrefs) {
      if (href in localStylesheets) continue;
      try {
        const filePath = (targetFile && resolveLocalUrlToPath(href, targetFile)) || fileURLToPath(href);
        const safePath = resolveSafeLocalPath(root, filePath);
        if (!safePath) {
          localStylesheets[href] = "";
          continue;
        }
        localStylesheets[href] = readCssWithImports(safePath, root);
      } catch {
        localStylesheets[href] = "";
      }
    }
  }
  const html = await page.evaluate(async ([label, scheme, localStylesheets]) => {
    function scanCss(css) {
      const tokens = [];
      let i = 0;
      const len = css.length;
      while (i < len) {
        if (css[i] === "/" && css[i + 1] === "*") {
          const end = css.indexOf("*/", i + 2);
          const close = end === -1 ? len : end + 2;
          tokens.push({ type: "comment", raw: css.slice(i, close) });
          i = close;
          continue;
        }
        if (css[i] === "\"" || css[i] === "'") {
          const quote = css[i];
          let j = i + 1;
          while (j < len) {
            if (css[j] === "\\") {
              j += 2;
            } else if (css[j] === quote) {
              j++;
              break;
            } else if (css[j] === "\n" || css[j] === "\r") {
              break;
            } else {
              j++;
            }
          }
          tokens.push({ type: "string", raw: css.slice(i, j) });
          i = j;
          continue;
        }
        if (
          (i === 0 || !/[a-zA-Z0-9_-]/.test(css[i - 1])) &&
          css.slice(i, i + 4).toLowerCase() === "url("
        ) {
          let j = i + 4;
          while (j < len && /\s/.test(css[j])) j++;
          let url = "";
          let quote = "";
          if (css[j] === "\"" || css[j] === "'") {
            quote = css[j];
            j++;
            const start = j;
            while (j < len && css[j] !== quote) {
              if (css[j] === "\\") j += 2;
              else j++;
            }
            url = css.slice(start, j);
            if (j < len) j++;
            while (j < len && /\s/.test(css[j])) j++;
            if (j < len && css[j] === ")") j++;
          } else {
            const start = j;
            while (j < len && css[j] !== ")" && !/\s/.test(css[j])) {
              if (css[j] === "\\") j += 2;
              else j++;
            }
            url = css.slice(start, j);
            while (j < len && css[j] !== ")") j++;
            if (j < len && css[j] === ")") j++;
          }
          tokens.push({ type: "url", raw: css.slice(i, j), url, quote });
          i = j;
          continue;
        }
        tokens.push({ type: "text", raw: css[i] });
        i++;
      }
      return tokens;
    }
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
      const tokens = scanCss(css);
      let result = "";
      for (const token of tokens) {
        if (token.type === "url") {
          const val = token.url.trim();
          if (/^(#|%23)/.test(val) || val.startsWith("data:")) {
            result += token.raw;
            continue;
          }
          const hashIdx = val.indexOf("#");
          const fragment = hashIdx !== -1 ? val.slice(hashIdx) : "";
          const data = await inline(absolute(val, base));
          result += `url("${data}${data.startsWith("data:") ? fragment : ""}")`;
        } else {
          result += token.raw;
        }
      }
      return result;
    };

    const css = [];
    for (const sheet of document.styleSheets) {
      const owner = sheet.ownerNode;
      let text = "";
      let base = location.href;
      if (sheet.href) {
        base = sheet.href;
        if (localStylesheets && sheet.href in localStylesheets) {
          text = localStylesheets[sheet.href];
        } else {
          text = await fetch(sheet.href).then((response) => (response.ok ? response.text() : "")).catch(() => "");
        }
      } else if (owner && owner.textContent.trim()) {
        text = owner.textContent;
      }
      if (!text) {
        try {
          text = [...sheet.cssRules].map((rule) => rule.cssText).join("\n");
        } catch { }
      }
      const media = sheet.media && sheet.media.mediaText;
      css.push(media && media !== "all" ? `@media ${media} {\n${text}\n}` : text);
      css[css.length - 1] = await urls(css[css.length - 1], base);
    }

    const copy = document.documentElement.cloneNode(true);
    // Freeze the browser's selected image before removing responsive markup.
    const images = document.querySelectorAll("img");
    copy.querySelectorAll("img").forEach((node, index) => {
      const selected = images[index].currentSrc;
      if (selected) node.setAttribute("src", selected);
    });
    copy.querySelectorAll("script, noscript, link[rel='stylesheet'], link[rel='preload'], link[rel='modulepreload'], style").forEach((node) => node.remove());
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
    return "<!doctype html>\n" + copy.outerHTML;
  }, [label ?? "", scheme, localStylesheets]);
  mkdirSync(dirname(resolve(out)), { recursive: true });
  writeFileSync(resolve(out), html);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: resolve(out).replace(/\.html?$/, "") + ".live.png" });
  console.log(`saved ${resolve(out)}${label ? ` as ${label}` : ""}`);
} finally {
  await browser.close();
}
