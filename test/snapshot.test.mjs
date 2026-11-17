import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const script = join(dirname(fileURLToPath(import.meta.url)), "..", "skills", "unslop", "scripts", "snapshot.mjs");
const USAGE = /usage: node snapshot\.mjs/;
const NO_BROWSER = /Playwright is not installed|Executable doesn't exist/;

const page = `<!doctype html><html><head><meta charset="utf-8">` + `<style>body{margin:0;background:#141415;color:#ededed}.card{padding:24px}</style>` + `</head><body><div class="card"><h1>Hello</h1></div></body></html>`;

const fixture = () => {
  const dir = mkdtempSync(join(tmpdir(), "unslop-snapshot-"));
  const file = join(dir, "page.html");
  writeFileSync(file, page);
  return { dir, file };
};

const run = (args) => spawnSync(process.execPath, [script, ...args], { encoding: "utf8", timeout: 60_000 });

// A run that needs a real browser: skip instead of failing when this
// machine has no Playwright or Chromium to launch. Returns true when it
// skipped, so the test must return right after calling it — t.skip() marks
// the test skipped but does not stop the test function.
const skipIfNoBrowser = (t, result) => {
  if (NO_BROWSER.test(result.stderr ?? "")) {
    t.skip("Playwright or Chromium is not installed here");
    return true;
  }
  return false;
};

const pngSize = (file) => {
  const bytes = readFileSync(file);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
};

test("no arguments prints the usage and exits 1", () => {
  const result = run([]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, USAGE);
});

const badSizes = [
  ["--width=abc", "a non-number width"],
  ["--width=0", "a zero width"],
  ["--width=-5", "a negative width"],
  ["--width=1.5", "a fractional width"],
  ["--height=abc", "a non-number height"],
  ["--height=0", "a zero height"],
];

for (const [flag, label] of badSizes) {
  test(`${label} (${flag}) fails with a clear error, not a stack trace`, () => {
    const { file } = fixture();
    const result = run([`file://${file}`, "out.html", flag]);
    assert.equal(result.status, 1, `expected a fast failure, got status ${result.status}`);
    assert.match(result.stderr, /must be a whole number above 0/);
    assert.doesNotMatch(result.stderr, /browser\.newPage/);
  });
}

test("--width with no value fails with a clear error", () => {
  const { file } = fixture();
  const result = run([`file://${file}`, "out.html", "--width"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /--width needs a value/);
});

test("a local file path is snapshotted, not rejected as an invalid URL", (t) => {
  const { dir, file } = fixture();
  const out = join(dir, "out.html");
  const result = run([file, out]);
  if (skipIfNoBrowser(t, result)) return;
  assert.equal(result.status, 0, result.stderr);
  assert.ok(existsSync(out), "saved html is missing");
  assert.ok(existsSync(join(dir, "out.live.png")), "live screenshot is missing");
  assert.deepEqual(pngSize(join(dir, "out.live.png")), { width: 1440, height: 810 });
});

test("--width 800 in space form sets the viewport to 800 wide", (t) => {
  const { dir, file } = fixture();
  const out = join(dir, "out.html");
  const result = run([`file://${file}`, out, "--width", "800"]);
  if (skipIfNoBrowser(t, result)) return;
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /saved .*out\.html\n?$/);
  assert.doesNotMatch(result.stdout, /as 800/, "800 leaked into the pass label instead of the width");
  assert.deepEqual(pngSize(join(dir, "out.live.png")), { width: 800, height: 810 });
});

test("--width=800 in equals form still sets the viewport to 800 wide", (t) => {
  const { dir, file } = fixture();
  const out = join(dir, "out.html");
  const result = run([`file://${file}`, out, "--width=800"]);
  if (skipIfNoBrowser(t, result)) return;
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(pngSize(join(dir, "out.live.png")), { width: 800, height: 810 });
});

test("--height 600 in space form sets the viewport height", (t) => {
  const { dir, file } = fixture();
  const out = join(dir, "out.html");
  const result = run([`file://${file}`, out, "--height", "600"]);
  if (skipIfNoBrowser(t, result)) return;
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(pngSize(join(dir, "out.live.png")), { width: 1440, height: 600 });
});

test("local stylesheets are inlined into the snapshot", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "unslop-snapshot-"));
  const cssFile = join(dir, "style.css");
  writeFileSync(cssFile, ".hero { color: #ff4d6a; font-weight: bold; }");
  const file = join(dir, "page.html");
  writeFileSync(file, '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="style.css"></head><body><h1 class="hero">Hello</h1></body></html>');
  const out = join(dir, "out.html");
  const result = run([file, out]);
  if (skipIfNoBrowser(t, result)) return;
  assert.equal(result.status, 0, result.stderr);
  const html = readFileSync(out, "utf8");
  assert.match(html, /\.hero\s*\{\s*color:\s*#ff4d6a;\s*font-weight:\s*bold;\s*\}/);
  assert.doesNotMatch(html, /<link[^>]*rel=["']stylesheet["']/i);
});

test("multiple linked local stylesheets preserve order and cascade", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "unslop-snapshot-"));
  writeFileSync(join(dir, "first.css"), "h1 { color: red; }");
  writeFileSync(join(dir, "second.css"), "h1 { color: blue; }");
  const file = join(dir, "page.html");
  writeFileSync(
    file,
    '<!doctype html><html><head><meta charset="utf-8">' +
      '<link rel="stylesheet" href="first.css">' +
      "<style>h1 { font-weight: bold; }</style>" +
      '<link rel="stylesheet" href="second.css">' +
      "</head><body><h1>Order</h1></body></html>",
  );
  const out = join(dir, "out.html");
  const result = run([file, out]);
  if (skipIfNoBrowser(t, result)) return;
  assert.equal(result.status, 0, result.stderr);
  const html = readFileSync(out, "utf8");
  const firstIndex = html.indexOf("color: red");
  const inlineIndex = html.indexOf("font-weight: bold");
  const secondIndex = html.indexOf("color: blue");
  assert.ok(firstIndex !== -1, "first stylesheet missing");
  assert.ok(inlineIndex !== -1, "inline style missing");
  assert.ok(secondIndex !== -1, "second stylesheet missing");
  assert.ok(firstIndex < inlineIndex, "first stylesheet must appear before inline styles");
  assert.ok(inlineIndex < secondIndex, "inline styles must appear before second stylesheet");
  assert.doesNotMatch(html, /<link[^>]*rel=["']stylesheet["']/i);
});

test("relative resource URLs in local CSS are resolved and inlined", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "unslop-snapshot-"));
  const subDir = join(dir, "styles");
  mkdirSync(subDir, { recursive: true });
  // 1x1 transparent PNG
  const pngBytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");
  writeFileSync(join(subDir, "dot.png"), pngBytes);
  writeFileSync(join(subDir, "style.css"), "body { background-image: url('dot.png'); }");
  const file = join(dir, "page.html");
  writeFileSync(
    file,
    '<!doctype html><html><head><meta charset="utf-8">' +
      '<link rel="stylesheet" href="styles/style.css">' +
      "</head><body><div>Background</div></body></html>",
  );
  const out = join(dir, "out.html");
  const result = run([file, out]);
  if (skipIfNoBrowser(t, result)) return;
  assert.equal(result.status, 0, result.stderr);
  const html = readFileSync(out, "utf8");
  assert.match(html, /url\(["']?data:image\/png;base64,/);
  assert.doesNotMatch(html, /url\(["']?dot\.png["']?\)/);
});

test("missing local stylesheet does not crash snapshot", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "unslop-snapshot-"));
  const file = join(dir, "page.html");
  writeFileSync(
    file,
    '<!doctype html><html><head><meta charset="utf-8">' +
      '<link rel="stylesheet" href="nonexistent.css">' +
      "</head><body><p>Missing CSS</p></body></html>",
  );
  const out = join(dir, "out.html");
  const result = run([file, out]);
  if (skipIfNoBrowser(t, result)) return;
  assert.equal(result.status, 0, result.stderr);
  assert.ok(existsSync(out), "snapshot out.html was not created");
});

test("local @import stylesheets are resolved and inlined", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "unslop-snapshot-"));
  writeFileSync(join(dir, "imported.css"), ".imported { color: orange; }");
  writeFileSync(join(dir, "main.css"), '@import "imported.css";\n.main { font-size: 18px; }');
  const file = join(dir, "page.html");
  writeFileSync(
    file,
    '<!doctype html><html><head><meta charset="utf-8">' +
      '<link rel="stylesheet" href="main.css">' +
      "</head><body><div class=\"main imported\">Import Test</div></body></html>",
  );
  const out = join(dir, "out.html");
  const result = run([file, out]);
  if (skipIfNoBrowser(t, result)) return;
  assert.equal(result.status, 0, result.stderr);
  const html = readFileSync(out, "utf8");
  assert.match(html, /\.imported\s*\{\s*color:\s*orange;\s*\}/);
  assert.match(html, /\.main\s*\{\s*font-size:\s*18px;\s*\}/);
  assert.doesNotMatch(html, /@import/);
});

test("browser security policy is preserved and blocks local file exfiltration by page scripts", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "unslop-snapshot-"));
  const secretDir = mkdtempSync(join(tmpdir(), "unslop-secret-"));
  const secretFile = join(secretDir, "secret.txt");
  writeFileSync(secretFile, "HIGHLY_CONFIDENTIAL_TOKEN_XYZ");

  const secretUrl = pathToFileURL(secretFile).href;
  const file = join(dir, "page.html");
  // Page tries to steal secret.txt using browser fetch
  writeFileSync(
    file,
    `<!doctype html><html><head><meta charset="utf-8"></head><body>` +
      `<div id="status">pending</div>` +
      `<script>` +
      `  fetch(${JSON.stringify(secretUrl)})` +
      `    .then(r => r.text())` +
      `    .then(text => { document.getElementById("status").textContent = text; })` +
      `    .catch(err => { document.getElementById("status").textContent = "BLOCKED"; });` +
      `</script></body></html>`,
  );
  const out = join(dir, "out.html");
  const result = run([file, out]);
  if (skipIfNoBrowser(t, result)) return;
  assert.equal(result.status, 0, result.stderr);
  const html = readFileSync(out, "utf8");
  assert.doesNotMatch(html, /HIGHLY_CONFIDENTIAL_TOKEN_XYZ/);
  assert.match(html, /BLOCKED/);
});

test("remote stylesheets are fetched and inlined into snapshot", async (t) => {
  const serverScript =
    'const http = require("node:http");' +
    "const server = http.createServer((req, res) => {" +
    '  if (req.url === "/style.css") {' +
    '    res.writeHead(200, { "Content-Type": "text/css" });' +
    '    res.end(".remote { color: green; }");' +
    "  } else {" +
    '    res.writeHead(200, { "Content-Type": "text/html" });' +
    '    res.end(\'<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/style.css"></head><body><div class="remote">Remote</div></body></html>\');' +
    "  }" +
    "});" +
    'server.listen(0, "127.0.0.1", () => {' +
    '  console.log("PORT:" + server.address().port);' +
    "});";

  const child = spawn(process.execPath, ["-e", serverScript], { stdio: ["ignore", "pipe", "inherit"] });
  let port;
  try {
    port = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error("Timeout waiting for mock HTTP server to start"));
      }, 10_000);
      child.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
      child.on("exit", (code) => {
        clearTimeout(timer);
        reject(new Error(`Mock HTTP server exited prematurely with code ${code}`));
      });
      child.stdout.on("data", (chunk) => {
        const match = /PORT:(\d+)/.exec(chunk.toString());
        if (match) {
          clearTimeout(timer);
          resolve(Number(match[1]));
        }
      });
    });
  } catch (err) {
    child.kill("SIGTERM");
    throw err;
  }

  const dir = mkdtempSync(join(tmpdir(), "unslop-snapshot-"));
  const out = join(dir, "out.html");
  try {
    const result = run([`http://127.0.0.1:${port}/`, out]);
    if (skipIfNoBrowser(t, result)) return;
    assert.equal(result.status, 0, result.stderr);
    const html = readFileSync(out, "utf8");
    assert.match(html, /\.remote\s*\{\s*color:\s*green;\s*\}/);
    assert.doesNotMatch(html, /<link[^>]*rel=["']stylesheet["']/i);
  } finally {
    child.kill("SIGTERM");
  }
});

test("parent-directory stylesheet traversal is rejected", (t) => {
  const tempDir = mkdtempSync(join(tmpdir(), "unslop-traversal-"));
  const outsideCss = join(tempDir, "outside.css");
  writeFileSync(outsideCss, ".outside { color: #secret-outside-color; }");

  const projectDir = join(tempDir, "project");
  mkdirSync(projectDir, { recursive: true });
  const file = join(projectDir, "page.html");
  writeFileSync(
    file,
    '<!doctype html><html><head><meta charset="utf-8">' +
      '<link rel="stylesheet" href="../outside.css">' +
      "</head><body><p>Traversal</p></body></html>",
  );
  const out = join(projectDir, "out.html");
  const result = run([file, out]);
  if (skipIfNoBrowser(t, result)) return;
  assert.equal(result.status, 0, result.stderr);
  const html = readFileSync(out, "utf8");
  assert.doesNotMatch(html, /secret-outside-color/);
});

test("CSS @import traversal outside allowed root is rejected", (t) => {
  const tempDir = mkdtempSync(join(tmpdir(), "unslop-import-traversal-"));
  const outsideCss = join(tempDir, "outside-import.css");
  writeFileSync(outsideCss, ".outside-import { color: #secret-import-color; }");

  const projectDir = join(tempDir, "project");
  mkdirSync(projectDir, { recursive: true });
  const styleCss = join(projectDir, "style.css");
  writeFileSync(styleCss, '@import "../outside-import.css";\n.valid { color: green; }');
  const file = join(projectDir, "page.html");
  writeFileSync(
    file,
    '<!doctype html><html><head><meta charset="utf-8">' +
      '<link rel="stylesheet" href="style.css">' +
      "</head><body><p>Import Traversal</p></body></html>",
  );
  const out = join(projectDir, "out.html");
  const result = run([file, out]);
  if (skipIfNoBrowser(t, result)) return;
  assert.equal(result.status, 0, result.stderr);
  const html = readFileSync(out, "utf8");
  assert.doesNotMatch(html, /secret-import-color/);
  assert.match(html, /\.valid\s*\{\s*color:\s*green;\s*\}/);
});

test("CSS asset traversal outside allowed root is rejected", (t) => {
  const tempDir = mkdtempSync(join(tmpdir(), "unslop-asset-traversal-"));
  const outsideAsset = join(tempDir, "outside-asset.png");
  const pngBytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");
  writeFileSync(outsideAsset, pngBytes);

  const projectDir = join(tempDir, "project");
  mkdirSync(projectDir, { recursive: true });
  const styleCss = join(projectDir, "style.css");
  writeFileSync(styleCss, "body { background-image: url('../outside-asset.png'); }");
  const file = join(projectDir, "page.html");
  writeFileSync(
    file,
    '<!doctype html><html><head><meta charset="utf-8">' +
      '<link rel="stylesheet" href="style.css">' +
      "</head><body><p>Asset Traversal</p></body></html>",
  );
  const out = join(projectDir, "out.html");
  const result = run([file, out]);
  if (skipIfNoBrowser(t, result)) return;
  assert.equal(result.status, 0, result.stderr);
  const html = readFileSync(out, "utf8");
  assert.doesNotMatch(html, /url\(["']?data:image\/png;base64,/);
});

test("symlink escape pointing outside allowed root is rejected", (t) => {
  const tempDir = mkdtempSync(join(tmpdir(), "unslop-symlink-"));
  const outsideCss = join(tempDir, "outside-secret.css");
  writeFileSync(outsideCss, ".sym-secret { color: #secret-symlink-color; }");

  const projectDir = join(tempDir, "project");
  mkdirSync(projectDir, { recursive: true });
  const linkFile = join(projectDir, "symlink.css");

  try {
    symlinkSync(outsideCss, linkFile);
  } catch (err) {
    if (err.code === "EPERM" || err.code === "EACCES" || err.code === "ENOSYS") {
      t.skip(`Symlink creation not permitted in this environment: ${err.message}`);
      return;
    }
    throw err;
  }

  const file = join(projectDir, "page.html");
  writeFileSync(
    file,
    '<!doctype html><html><head><meta charset="utf-8">' +
      '<link rel="stylesheet" href="symlink.css">' +
      "</head><body><p>Symlink</p></body></html>",
  );
  const out = join(projectDir, "out.html");
  const result = run([file, out]);
  if (skipIfNoBrowser(t, result)) return;
  assert.equal(result.status, 0, result.stderr);
  const html = readFileSync(out, "utf8");
  assert.doesNotMatch(html, /secret-symlink-color/);
});

test("relative asset URLs inside nested imported CSS are resolved correctly", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "unslop-nested-assets-"));
  const stylesDir = join(dir, "styles");
  const nestedDir = join(stylesDir, "nested");
  const assetsDir = join(dir, "assets");
  mkdirSync(nestedDir, { recursive: true });
  mkdirSync(assetsDir, { recursive: true });

  const pngBytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");
  writeFileSync(join(assetsDir, "background.png"), pngBytes);

  // theme.css has relative path to ../../assets/background.png from styles/nested/
  writeFileSync(join(nestedDir, "theme.css"), '.hero { background-image: url("../../assets/background.png"); }');
  writeFileSync(join(stylesDir, "main.css"), '@import "nested/theme.css";\nbody { color: #111; }');

  const file = join(dir, "page.html");
  writeFileSync(
    file,
    '<!doctype html><html><head><meta charset="utf-8">' +
      '<link rel="stylesheet" href="styles/main.css">' +
      '</head><body><div class="hero">Nested Asset</div></body></html>',
  );
  const out = join(dir, "out.html");
  const result = run([file, out]);
  if (skipIfNoBrowser(t, result)) return;
  assert.equal(result.status, 0, result.stderr);
  const html = readFileSync(out, "utf8");
  assert.match(html, /\.hero\s*\{\s*background-image:\s*url\(["']?data:image\/png;base64,/);
  assert.doesNotMatch(html, /\.\.\/\.\.\/assets\/background\.png/);
});

test("duplicate imports with different media conditions are preserved", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "unslop-dup-import-"));
  writeFileSync(join(dir, "theme.css"), "h1 { color: purple; }");
  writeFileSync(
    join(dir, "main.css"),
    '@import "theme.css" screen;\n@import "theme.css" print;\nbody { margin: 0; }',
  );
  const file = join(dir, "page.html");
  writeFileSync(
    file,
    '<!doctype html><html><head><meta charset="utf-8">' +
      '<link rel="stylesheet" href="main.css">' +
      "</head><body><h1>Media Import</h1></body></html>",
  );
  const out = join(dir, "out.html");
  const result = run([file, out]);
  if (skipIfNoBrowser(t, result)) return;
  assert.equal(result.status, 0, result.stderr);
  const html = readFileSync(out, "utf8");
  assert.match(html, /@media\s+screen\s*\{\s*h1\s*\{\s*color:\s*purple;\s*\}\s*\}/);
  assert.match(html, /@media\s+print\s*\{\s*h1\s*\{\s*color:\s*purple;\s*\}\s*\}/);
});

test("circular import chains terminate safely and retain non-circular rules", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "unslop-circ-"));
  writeFileSync(join(dir, "a.css"), '@import "b.css";\n.rule-a { color: red; }');
  writeFileSync(join(dir, "b.css"), '@import "a.css";\n.rule-b { color: blue; }');
  const file = join(dir, "page.html");
  writeFileSync(
    file,
    '<!doctype html><html><head><meta charset="utf-8">' +
      '<link rel="stylesheet" href="a.css">' +
      "</head><body><div>Cycle</div></body></html>",
  );
  const out = join(dir, "out.html");
  const result = run([file, out]);
  if (skipIfNoBrowser(t, result)) return;
  assert.equal(result.status, 0, result.stderr);
  const html = readFileSync(out, "utf8");
  assert.match(html, /\.rule-a\s*\{\s*color:\s*red;\s*\}/);
  assert.match(html, /\.rule-b\s*\{\s*color:\s*blue;\s*\}/);
});

test("comments and strings are preserved without rewriting faux imports or URLs", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "unslop-comments-strings-"));
  const pngBytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");
  writeFileSync(join(dir, "real.png"), pngBytes);

  writeFileSync(
    join(dir, "style.css"),
    '/* @import "nonexistent-comment.css"; */\n' +
      '/* url("nonexistent-comment.png") */\n' +
      '.card::before { content: "url(fake-string.png)"; }\n' +
      '.card::after { content: "@import \'fake-string.css\';"; }\n' +
      '.real { background-image: url("real.png"); }',
  );
  const file = join(dir, "page.html");
  writeFileSync(
    file,
    '<!doctype html><html><head><meta charset="utf-8">' +
      '<link rel="stylesheet" href="style.css">' +
      '</head><body><div class="card real">Scanner</div></body></html>',
  );
  const out = join(dir, "out.html");
  const result = run([file, out]);
  if (skipIfNoBrowser(t, result)) return;
  assert.equal(result.status, 0, result.stderr);
  const html = readFileSync(out, "utf8");
  assert.match(html, /\/\*\s*@import "nonexistent-comment\.css";\s*\*\//);
  assert.match(html, /\/\*\s*url\("nonexistent-comment\.png"\)\s*\*\//);
  assert.match(html, /content:\s*"url\(fake-string\.png\)"/);
  assert.match(html, /content:\s*"@import 'fake-string\.css';"/);
  assert.match(html, /\.real\s*\{\s*background-image:\s*url\(["']?data:image\/png;base64,/);
});

test("a local stylesheet whose filename contains an encoded space is resolved and inlined", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "unslop-encoded-sheet-"));
  writeFileSync(join(dir, "theme dark.css"), ".theme-dark { color: #abcdef; }");

  const file = join(dir, "page.html");
  writeFileSync(
    file,
    '<!doctype html><html><head><meta charset="utf-8">' +
      '<link rel="stylesheet" href="theme%20dark.css?v=1#frag">' +
      '</head><body><div class="theme-dark">Encoded Local Stylesheet</div></body></html>',
  );
  const out = join(dir, "out.html");
  const result = run([file, out]);
  if (skipIfNoBrowser(t, result)) return;
  assert.equal(result.status, 0, result.stderr);
  const html = readFileSync(out, "utf8");
  assert.match(html, /\.theme-dark\s*\{\s*color:\s*#abcdef;\s*\}/);
});

test("an imported stylesheet whose filename contains an encoded space is resolved and inlined", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "unslop-encoded-import-"));
  writeFileSync(join(dir, "sub theme.css"), ".sub-theme { color: #fedcba; }");
  writeFileSync(join(dir, "main.css"), '@import "sub%20theme.css?v=2#sec";\nbody { margin: 0; }');

  const file = join(dir, "page.html");
  writeFileSync(
    file,
    '<!doctype html><html><head><meta charset="utf-8">' +
      '<link rel="stylesheet" href="main.css">' +
      '</head><body><div class="sub-theme">Encoded Import</div></body></html>',
  );
  const out = join(dir, "out.html");
  const result = run([file, out]);
  if (skipIfNoBrowser(t, result)) return;
  assert.equal(result.status, 0, result.stderr);
  const html = readFileSync(out, "utf8");
  assert.match(html, /\.sub-theme\s*\{\s*color:\s*#fedcba;\s*\}/);
});

test("a CSS image asset whose filename contains an encoded space is resolved and inlined", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "unslop-encoded-asset-"));
  const imgDir = join(dir, "images");
  mkdirSync(imgDir, { recursive: true });
  const pngBytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");
  writeFileSync(join(imgDir, "background dark.png"), pngBytes);

  writeFileSync(
    join(dir, "style.css"),
    '.hero { background-image: url("images/background%20dark.png?v=1#hash"); }',
  );
  const file = join(dir, "page.html");
  writeFileSync(
    file,
    '<!doctype html><html><head><meta charset="utf-8">' +
      '<link rel="stylesheet" href="style.css">' +
      '</head><body><div class="hero">Encoded Asset</div></body></html>',
  );
  const out = join(dir, "out.html");
  const result = run([file, out]);
  if (skipIfNoBrowser(t, result)) return;
  assert.equal(result.status, 0, result.stderr);
  const html = readFileSync(out, "utf8");
  assert.match(html, /\.hero\s*\{\s*background-image:\s*url\(["']?data:image\/png;base64,/);
  assert.doesNotMatch(html, /images\/background%20dark\.png/);
});

test("encoded traversal URLs are rejected from filesystem reads", (t) => {
  const tempDir = mkdtempSync(join(tmpdir(), "unslop-encoded-traversal-"));
  const outsideSecret = join(tempDir, "outside-secret.txt");
  writeFileSync(outsideSecret, "TOP-SECRET-ENCODED-DATA");

  const projectDir = join(tempDir, "project");
  mkdirSync(projectDir, { recursive: true });

  writeFileSync(
    join(projectDir, "style.css"),
    '.traversal-dot { background-image: url("%2e%2e/outside-secret.txt"); }\n' +
      '.traversal-slash { background-image: url("..%2foutside-secret.txt"); }\n' +
      '@import "%2e%2e/outside-secret.txt";\n' +
      '@import "..%2foutside-secret.txt";\n' +
      '.safe-rule { color: green; }',
  );

  const file = join(projectDir, "page.html");
  writeFileSync(
    file,
    '<!doctype html><html><head><meta charset="utf-8">' +
      '<link rel="stylesheet" href="style.css">' +
      '</head><body><div class="traversal-dot">Encoded Traversal</div></body></html>',
  );
  const out = join(projectDir, "out.html");
  const result = run([file, out]);
  if (skipIfNoBrowser(t, result)) return;
  assert.equal(result.status, 0, result.stderr);
  const html = readFileSync(out, "utf8");
  assert.match(html, /\.safe-rule\s*\{\s*color:\s*green;\s*\}/);
  assert.doesNotMatch(html, /TOP-SECRET-ENCODED-DATA/);
});

test("named layers, anonymous layers, supports conditions, and media queries in @import are wrapped correctly", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "unslop-import-conditions-"));
  writeFileSync(join(dir, "named-layer.css"), ".named { color: blue; }");
  writeFileSync(join(dir, "anon-layer.css"), ".anon { color: cyan; }");
  writeFileSync(join(dir, "supports.css"), ".supp { color: magenta; }");
  writeFileSync(join(dir, "combo.css"), ".combo { color: yellow; }");

  writeFileSync(
    join(dir, "main.css"),
    '@import "named-layer.css" layer(components);\n' +
      '@import "anon-layer.css" layer;\n' +
      '@import "supports.css" supports(display: grid);\n' +
      '@import "combo.css" layer(components) supports(display: grid) screen;\n' +
      'body { margin: 0; }',
  );

  const file = join(dir, "page.html");
  writeFileSync(
    file,
    '<!doctype html><html><head><meta charset="utf-8">' +
      '<link rel="stylesheet" href="main.css">' +
      '</head><body><div class="named">Modifiers</div></body></html>',
  );
  const out = join(dir, "out.html");
  const result = run([file, out]);
  if (skipIfNoBrowser(t, result)) return;
  assert.equal(result.status, 0, result.stderr);
  const html = readFileSync(out, "utf8");

  assert.match(html, /@layer\s+components\s*\{\s*\.named\s*\{\s*color:\s*blue;\s*\}\s*\}/);
  assert.match(html, /@layer\s*\{\s*\.anon\s*\{\s*color:\s*cyan;\s*\}\s*\}/);
  assert.match(html, /@supports\s*\(display:\s*grid\)\s*\{\s*\.supp\s*\{\s*color:\s*magenta;\s*\}\s*\}/);
  assert.match(
    html,
    /@layer\s+components\s*\{\s*@supports\s*\(display:\s*grid\)\s*\{\s*@media\s+screen\s*\{\s*\.combo\s*\{\s*color:\s*yellow;\s*\}\s*\}\s*\}\s*\}/,
  );
});

test("comments acting as whitespace between @import tokens and modifiers are handled", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "unslop-import-comments-"));
  writeFileSync(join(dir, "theme1.css"), ".t1 { color: #111; }");
  writeFileSync(join(dir, "theme2.css"), ".t2 { color: #222; }");

  writeFileSync(
    join(dir, "main.css"),
    '@import/**/"theme1.css";\n' +
      '@import /* comment1 */ url(/* comment2 */ "theme2.css" /* comment3 */) /* comment4 */ layer(components) /* comment5 */ screen;\n' +
      'body { margin: 0; }',
  );

  const file = join(dir, "page.html");
  writeFileSync(
    file,
    '<!doctype html><html><head><meta charset="utf-8">' +
      '<link rel="stylesheet" href="main.css">' +
      '</head><body><div class="t1">Comments</div></body></html>',
  );
  const out = join(dir, "out.html");
  const result = run([file, out]);
  if (skipIfNoBrowser(t, result)) return;
  assert.equal(result.status, 0, result.stderr);
  const html = readFileSync(out, "utf8");
  assert.match(html, /\.t1\s*\{\s*color:\s*#111;\s*\}/);
  assert.match(
    html,
    /@layer\s+components\s*\{\s*@media\s+screen\s*\{\s*\.t2\s*\{\s*color:\s*#222;\s*\}\s*\}\s*\}/,
  );
});

test("strict Content Security Policy does not block stylesheet inlining and snapshot succeeds", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "unslop-strict-csp-"));
  writeFileSync(join(dir, "style.css"), ".csp-card { color: #ff0077; background: #000; }");

  const file = join(dir, "page.html");
  writeFileSync(
    file,
    '<!doctype html><html><head><meta charset="utf-8">' +
      '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'self\' \'unsafe-inline\'; img-src \'self\' data:; script-src \'none\'">' +
      '<link rel="stylesheet" href="style.css">' +
      '</head><body><div class="csp-card">Strict CSP Target</div></body></html>',
  );
  const out = join(dir, "out.html");
  const result = run([file, out]);
  if (skipIfNoBrowser(t, result)) return;
  assert.equal(result.status, 0, result.stderr);
  const html = readFileSync(out, "utf8");
  assert.match(html, /\.csp-card\s*\{\s*color:\s*#ff0077;\s*background:\s*#000;\s*\}/);
  assert.match(html, /Strict CSP Target/);
});

test("CSS supports() functions such as font-tech and font-format are preserved without extra parentheses", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "unslop-supports-fns-"));
  writeFileSync(join(dir, "tech.css"), ".font-colr { font-family: 'ColorFont'; }");
  writeFileSync(join(dir, "format.css"), ".font-woff2 { font-family: 'Woff2Font'; }");
  writeFileSync(join(dir, "grid.css"), ".layout-grid { display: grid; }");

  writeFileSync(
    join(dir, "main.css"),
    '@import "tech.css" supports(font-tech(color-COLRv1));\n' +
      '@import "format.css" supports(font-format(woff2));\n' +
      '@import "grid.css" supports(display: grid);\n' +
      'body { margin: 0; }',
  );

  const file = join(dir, "page.html");
  writeFileSync(
    file,
    '<!doctype html><html><head><meta charset="utf-8">' +
      '<link rel="stylesheet" href="main.css">' +
      '</head><body><div class="font-colr">Supports Functions</div></body></html>',
  );
  const out = join(dir, "out.html");
  const result = run([file, out]);
  if (skipIfNoBrowser(t, result)) return;
  assert.equal(result.status, 0, result.stderr);
  const html = readFileSync(out, "utf8");

  assert.match(
    html,
    /@supports\s+font-tech\(color-COLRv1\)\s*\{\s*\.font-colr\s*\{\s*font-family:\s*['"]ColorFont['"];\s*\}\s*\}/,
  );
  assert.match(
    html,
    /@supports\s+font-format\(woff2\)\s*\{\s*\.font-woff2\s*\{\s*font-family:\s*['"]Woff2Font['"];\s*\}\s*\}/,
  );
  assert.match(
    html,
    /@supports\s*\(display:\s*grid\)\s*\{\s*\.layout-grid\s*\{\s*display:\s*grid;\s*\}\s*\}/,
  );
});

test("SVG fragment identifiers in local CSS url() references are preserved on inlined data URIs", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "unslop-svg-fragment-"));
  const svgContent = '<svg xmlns="http://www.w3.org/2000/svg"><g id="arrow"><path d="M0 0h10v10H0z"/></g></svg>';
  writeFileSync(join(dir, "icons.svg"), svgContent);

  writeFileSync(
    join(dir, "style.css"),
    '.icon-arrow { background-image: url("icons.svg#arrow"); }\n' +
      '.icon-with-query { background-image: url("icons.svg?v=1#arrow-right"); }',
  );

  const file = join(dir, "page.html");
  writeFileSync(
    file,
    '<!doctype html><html><head><meta charset="utf-8">' +
      '<link rel="stylesheet" href="style.css">' +
      '</head><body><div class="icon-arrow">SVG Fragment</div></body></html>',
  );
  const out = join(dir, "out.html");
  const result = run([file, out]);
  if (skipIfNoBrowser(t, result)) return;
  assert.equal(result.status, 0, result.stderr);
  const html = readFileSync(out, "utf8");

  assert.match(
    html,
    /\.icon-arrow\s*\{\s*background-image:\s*url\(["']?data:image\/svg\+xml;base64,[A-Za-z0-9+/=]+#arrow["']?\);?\s*\}/,
  );
  assert.match(
    html,
    /\.icon-with-query\s*\{\s*background-image:\s*url\(["']?data:image\/svg\+xml;base64,[A-Za-z0-9+/=]+#arrow-right["']?\);?\s*\}/,
  );
  assert.doesNotMatch(html, /icons\.svg#arrow/);
});
