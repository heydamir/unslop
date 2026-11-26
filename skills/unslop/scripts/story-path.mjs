import { existsSync, realpathSync } from "node:fs";
import { extname, isAbsolute, join, normalize, relative, sep } from "node:path";

// Resolve a story-server request path to a file inside root, or null
// when the path does not name a file under it. The request path has
// already had its query string stripped and its escapes decoded.
//
// A bare `target.startsWith(root)` is not enough: a sibling directory
// whose name starts with the root's (`/a/site` vs `/a/site-private`)
// passes it, and so does a symlink inside root that points outside.
// Both sides are resolved to their real paths first, and the root
// itself is rejected too — it is a directory, not a file to serve.
export function resolveStoryFile(root, requestPath) {
  const target = normalize(join(root, requestPath.replace(/^\/__story\//, "/")));
  if (!existsSync(target)) return null;
  let realRoot;
  let realTarget;
  try {
    realRoot = realpathSync(root);
    realTarget = realpathSync(target);
  } catch {
    return null;
  }
  const rel = relative(realRoot, realTarget);
  if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return null;
  return realTarget;
}

// Chrome refuses to run a module script, or import a JSON module, that
// comes back as application/octet-stream, so .mjs and .json need their
// real types. Images, fonts and video load whatever the type says.
const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".avif": "image/avif", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".woff": "font/woff", ".mp4": "video/mp4" };

export function contentType(file) {
  return types[extname(file).toLowerCase()] ?? "application/octet-stream";
}
