# Development

The card is written in TypeScript with [Lit](https://lit.dev/). Debian's npm 9.2 fails to install the dependencies, so use npm 10 through npx:

```bash
npx npm@10 install
npm run dev        # test page with made-up entities at http://127.0.0.1:5173/
npm test           # unit tests, run in four time zones
npm run check      # headless Chromium: screenshots and scripted clicks (needs chromium)
npm run build      # type check, build the card and the editor to dist/, print file sizes
```

The test page takes query parameters: `theme=dark`, `width=390`, `delay=4000` (slow replies), `fail=1` (failed replies), `only=1` (one card), `perf=1` (load check with eight sensors), `editor=1` (the visual editor beside the first card, with simple stand-ins for Home Assistant's form fields).
