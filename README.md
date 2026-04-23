# SnapWeave

SnapWeave is a Chrome Manifest V3 extension for WeChat-style page capture. It supports visible-area screenshots, region selection, full-page stitching, inline annotation, clipboard copy, and PNG download without leaving the current page.

## Features

- Visible viewport capture
- Region-first capture with inline selection
- Full-page stitched capture
- Annotation tools: rectangle, arrow, brush, text, mosaic
- Undo / redo
- Copy to clipboard
- PNG download
- Trigger from extension popup or keyboard shortcut

## Tech Stack

- Manifest V3
- TypeScript
- Vite
- Offscreen document for canvas composition and clipboard writes

## Project Structure

```text
src/
  background/   service worker orchestration
  content/      injected overlay, selection, and editor UI
  editor/       annotation rendering helpers
  offscreen/    crop, stitch, compose, and clipboard routines
  popup/        launcher UI
  shared/       type-only contracts
scripts/        packaging utilities
public/         manifest and static assets
.github/        CI, packaging, issue and PR templates
```

## Local Development

1. Install dependencies:

   ```bash
   npm install
   ```

2. Start a watch build:

   ```bash
   npm run dev
   ```

3. Open `chrome://extensions`.
4. Enable Developer mode.
5. Click `Load unpacked` and select the `dist/` directory.

## Available Commands

- `npm run dev` - build in watch mode
- `npm run build` - production build into `dist/`
- `npm run lint` - lint TypeScript sources
- `npm run typecheck` - strict type checking
- `npm run package` - build and create `dist/extension.zip`

## Keyboard Shortcut

The extension registers `Command+Shift+S` on macOS and `Ctrl+Shift+S` on Windows/Linux as the default shortcut for region capture. Chrome users can customize the shortcut in `chrome://extensions/shortcuts`.

## Permissions

- `activeTab`: temporary permission to interact with the currently invoked tab.
- `scripting`: inject the content overlay only when capture is requested.
- `tabs`: call `chrome.tabs.captureVisibleTab()` and query active tab context.
- `storage`: persist lightweight preferences such as the default capture mode.
- `offscreen`: run hidden canvas composition and clipboard flows outside page CSP.
- `clipboardWrite`: copy exported PNG data to the system clipboard.

## Known Limitations

- Full-page capture scrolls the page during stitching, which can be noticeable on long pages.
- Sites with aggressive virtualization or canvas-only rendering may not stitch perfectly.
- `file://` URLs require users to enable file access manually in the extension details page.
- Clipboard image writes require Chromium-based browsers with Async Clipboard PNG support.

## GitHub Workflow

- `ci.yml`: lint, typecheck, build
- `pr-check.yml`: fast validation on pull requests
- `package.yml`: build, zip, and upload release artifacts on tags or manual runs

## Roadmap

- Better selection resizing and keyboard nudging
- Optional numbered markers and blur intensity controls
- Release automation for Chrome Web Store
- Demo GIFs and richer documentation

## Contributing

Use short-lived branches from `main`:

- `feat/*`
- `fix/*`
- `chore/*`

Prefer Conventional Commits, such as:

```text
feat(capture): add full-page stitch flow
```
