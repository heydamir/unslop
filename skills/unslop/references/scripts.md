# Scripts

The two scripts the skill runs, their flags, and the attributes a story file uses. This page is the single place they are described, so a flag and its documentation cannot drift apart. Every value here is what the code does, not what it was meant to do.

Both scripts need Playwright or `playwright-core` installed where you run them, and they look for a Chromium binary in `CHROME_PATH`, then the macOS Chrome path, then `/usr/bin/google-chrome` and `/usr/bin/chromium`. To install them once in the project:

```bash
npm install -D playwright
npx playwright install chromium
```

## snapshot.mjs

Captures a page into one self-contained HTML file: styles inlined, images and fonts turned into data URLs, scripts stripped. Use it when you have a link or a file and no source.

```bash
node <skill folder>/scripts/snapshot.mjs <url or local file> <out.html> [pass label] [--dark | --light] [--width 1440] [--height 810]
```

| Argument | Meaning |
| --- | --- |
| `<url or local file>` | A live URL, or a path to an HTML file on disk. A local file is served over loopback for the run, so its own stylesheets and assets load. |
| `<out.html>` | Where to write the capture. Parent folders are created. |
| `[pass label]` | Written into the page as `<meta name="unslop-pass">`, so each pass can keep its own copy. |
| `--dark`, `--light` | Forces the colour scheme and rewrites `prefers-color-scheme` rules so the chosen one always applies. Without either, the page keeps its own scheme. |
| `--width`, `--height` | Viewport in whole pixels, default 1440 by 810. Both accept `--width 800` and `--width=800`. |

It also writes `<out>.live.png`, a screenshot of the page as it looked, so you can compare the capture against the live page.

Notes:

- Animated backgrounds drawn by scripts do not survive, because scripts are stripped. Describe them from the live page instead.
- A stylesheet that cannot be read keeps its `<link>` and the run warns, rather than dropping the styles silently.
- `@import` is resolved and inlined too, so a capture does not depend on the folder it is opened from.

## story.mjs

Renders the story file into a video, or plays it live.

```bash
node <skill folder>/scripts/story.mjs <story.html> <out.mp4> [--wide]
node <skill folder>/scripts/story.mjs <story.html> --play
node <skill folder>/scripts/story.mjs <story.html> --check
```

| Argument | Meaning |
| --- | --- |
| `<story.html>` | The story file. Its meta tags are checked before anything renders. |
| `<out.mp4>` | The video to write. |
| `--wide` | 16:9 instead of the default square. |
| `--play` | No video. Loops the story in a browser window until you close it. Needs no ffmpeg. |
| `--check` | No video, no browser. Validates the story and prints its steps, frame and mark counts, then exits 0, or exits 1 with the reason. Use it while building the story and in CI. |

Requires `ffmpeg` on the PATH for a video. The story file must carry `<meta name="unslop-steps">`, and may carry `<meta name="unslop-frame">`. Both are validated before ffmpeg is checked, so a broken story file reports itself rather than a missing ffmpeg.

## Attributes a story file uses

| Attribute | Goes on | Effect |
| --- | --- | --- |
| `.s1`, `.s2`, `.s3` in your CSS | Not on an element | The script puts `s1`, `s2`… on `<html>` as it reaches each step, so write `.s1 .card { padding: 24px }`. Rules stack, so step 3 keeps the rules of 1 and 2. |
| `data-slop="Gradient text"` | Up to five elements | Marks slop for the first beat with a short red tag. Optional. |
| `data-gap`, `data-gap="main"` | Five to seven blocks of one vertical stack, so four to six gaps | Measures the gaps between them. Give each stack its own name. |
| `data-radius` | Two to four buttons and cards | Outlines the corner and counts its radius. |
| `class="swap" data-at="3"` | A pair of `.from` and `.to` spans | Blurs the old text out and rolls the new one in at that step. At most eight per story. |
| `data-out="2"` | Anything | Collapses it at that step. |
| `data-in="4"` | Anything | Fades it in at that step. Reserve its space. |
