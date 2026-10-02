# ModelSmith – project layout

| Path | What it is |
|---|---|
| `index.html` | Markup only; loads `css/styles.css` and the `js/` files in numbered order |
| `css/styles.css` | All styling |
| `js/NN-*.js` | Standalone scripts, loaded in number order (order matters) |
| `src/paint-studio/*.js` | Source fragments of the Paint studio (edit these) |
| `src/builder-3d/*.js` | Source fragments of the 3D builder (edit these) |
| `js/vendor/` | Local copies of three.js r128 + OrbitControls/TransformControls (no CDN needed) |
| `build.js` | Joins the fragments into `js/10-paint-studio.js` and `js/08-builder-3d.js` |
| `sw.js` | Service worker; bump `CACHE_NAME` and list any new files in `APP_SHELL` |

## Workflow

1. Edit a fragment under `src/`, or a standalone file under `js/` (except the two bundles).
2. Run `node build.js` (only needed for `src/` edits).
3. Reload the app. Bump `CACHE_NAME` in `sw.js` when you release.

Do **not** edit `js/08-builder-3d.js` or `js/10-paint-studio.js` directly — they are generated and the next build overwrites them.

Each bundle is one closure (`const Paint = (function(){...})()` / `const Builder = ...`), so fragments share variables and are only valid when joined in filename order. Errors in the browser console point at the bundle's line number; search that line's text in `src/` to find the fragment.

## Security notes

- `index.html` carries a Content-Security-Policy: scripts only from this origin, no inline scripts. Don't add inline `<script>` blocks or `onclick=` attributes; put code in a `js/` file.
- Never put user-supplied text (layer/object/version names, file names) into `innerHTML`; use `textContent`.
