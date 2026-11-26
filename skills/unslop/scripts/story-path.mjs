import { existsSync, realpathSync } from "node:fs";
import { isAbsolute, join, normalize, relative, sep } from "node:path";

// Decode a story-server request URL to its path, or null when the
// URL holds an escape that does not decode, like the `%of` in an
// unescaped `50%off.png`. decodeURIComponent throws on those, and a
// throw inside the request handler takes the whole render down.
export function decodeStoryPath(url) {
  try {
    return decodeURIComponent(new URL(url, "http://local").pathname);
  } catch {
    return null;
  }
}

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
