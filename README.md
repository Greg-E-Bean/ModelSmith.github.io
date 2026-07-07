# ModelSmith — GitHub Pages deployment

This folder is a complete, installable PWA. Every file needs to sit together
at the same level in your repo (don't put them in subfolders) — the manifest,
service worker, and icons are all linked with relative paths.

## Files
- `index.html` — the app itself
- `manifest.json` — PWA metadata (name, icons, colors)
- `sw.js` — service worker (caches the app shell for offline use)
- `icon-192.png`, `icon-512.png` — home-screen / app icons
- `icon-512-maskable.png` — Android adaptive icon (has safe-zone padding)
- `icon-180.png` — Apple touch icon

## Deploy steps
1. Create a new GitHub repo (or use an existing one).
2. Upload all the files in this folder to the **root** of the repo (or to a
   `/docs` folder — just make sure Pages is set to serve wherever you put them).
3. In the repo, go to **Settings → Pages**.
4. Under "Build and deployment", set **Source** to "Deploy from a branch",
   pick your branch (usually `main`) and the folder (`/root` or `/docs`).
5. Save. GitHub will give you a URL like
   `https://yourusername.github.io/your-repo-name/`.
6. Open that URL — the app should load. On mobile, your browser should offer
   "Add to Home Screen"; on desktop Chrome/Edge you'll see an install icon
   in the address bar.

## Updating later
Whenever you upload a new `index.html`:
- Bump `CACHE_NAME` in `sw.js` (e.g. `modelsmith-v2` → `modelsmith-v3`).
  This is what forces the service worker to fetch the new version instead of
  serving the old cached one to returning visitors.

## Note on icons
The app icons were upscaled from a small embedded logo, so they're a little
soft at 512px. If you have a higher-resolution version of the ModelSmith
logo, send it over and I can regenerate crisp icons from it.
