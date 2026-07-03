# Integrated Chromium Host (experimental)

Windows-only proof of concept that replaces the page surface of VS Code's
integrated browser with a real Chrome/Edge window.

The browser keeps its native extension runtime and a dedicated profile. A
small Win32 helper reparents the browser window into the bounds managed by
VS Code's built-in `BrowserView`.

## Safety model

- The extension never patches VS Code automatically.
- `Create Isolated Test Copy` patches only a copied `main.js` fixture.
- A real installation patch requires a modal confirmation.
- The original `main.js` is backed up and protected by SHA-256 checksums.
- Restore refuses to overwrite files changed by a VS Code update.
- Browser data uses a dedicated profile by default.

## Build

```powershell
npm install
npm test
npm run build
npm run package
```

Building produces the extension and the native helper. Packaging does not
install either component.

## Known limitations

- Supports the exact minified anchors used by VS Code 1.113.0. Unknown builds
  fail closed instead of attempting a fuzzy patch.
- Only one native Chromium window can be hosted at a time.
- Moving the browser between multiple VS Code windows is experimental.
- VS Code screenshots, element picking, integrated DevTools, browser zoom,
  and some agent browser tools still target the hidden Electron page.
- Chrome popups and new browser windows remain native top-level windows.
- VS Code updates replace the patch and require a compatible patch build.

