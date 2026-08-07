/*
 * Renders build/icon.png from the markup below.
 *
 * Run with:  npm run icon
 *
 * Electron is already a dependency and it bundles Chromium, so it doubles as
 * the rasteriser — no sharp, no canvas, no ImageMagick. electron-builder turns
 * the single 1024px PNG into .ico and .icns at package time.
 */
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs/promises')
const path = require('node:path')

const SIZE = 1024
const OUT = path.join(__dirname, '..', 'build', 'icon.png')

/*
 * A cleaved block of stone: a quarried hexagon split into three flat planes,
 * lit from the top left. Two references meet here. The faceting is Obsidian's —
 * a mineral cut rather than a picture of a rock. The treatment is Notion's:
 * completely flat, no gradient, no bevel, no glow, in the same warm greys the
 * interface is built from (tokens.css). The predecessor was an orange-to-purple
 * gradient behind a letter S and belonged to a different application.
 *
 * The three facets are deliberately unequal in area. Three similar facets
 * meeting at a point read as an isometric cube — a shape that means
 * "blockchain" to most people — and every even version of this drew that way.
 *
 * Geometry is shared with StoneMark in src/renderer/src/ui/icons.tsx, which
 * draws the same hull for the titlebar. Change one, change the other.
 */
const TILE = '#2E2C27' // warm basalt, a deeper sibling of the --text ink #37352F
const FACET_LIT = '#FBFBF9' // the fresh split, near --bg-page
const FACET_MID = '#A9A69C'
const FACET_DARK = '#63605A'

/** Hull 30,6 · 72,17 · 88,50 · 46,95 · 18,74 · 10,28, split at 50,40. */
const TOP = '30,6 72,17 50,40 10,28'
const LEFT = '10,28 50,40 46,95 18,74'
const RIGHT = '72,17 88,50 46,95 50,40'

/* iOS/macOS icon corners are ~22.5% of the tile. Windows crops its own. */
const RADIUS = 0.225

const HTML = `<!doctype html>
<html>
<head><meta charset="utf-8" /><style>
  /* Without overflow:hidden the 1024px svg overflows by a hair and Chromium
     paints scrollbars straight into the capture. */
  html,body{margin:0;overflow:hidden;background:transparent}
  svg{display:block}
</style></head>
<body>
  <svg width="${SIZE}" height="${SIZE}" viewBox="0 0 100 100">
    <rect width="100" height="100" rx="${RADIUS * 100}" fill="${TILE}" />
    <g transform="translate(50 50) scale(.84) translate(-50 -50)">
      <polygon points="${TOP}" fill="${FACET_LIT}" />
      <polygon points="${LEFT}" fill="${FACET_MID}" />
      <polygon points="${RIGHT}" fill="${FACET_DARK}" />
    </g>
  </svg>
</body>
</html>`

app.disableHardwareAcceleration()

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: SIZE,
    height: SIZE,
    useContentSize: true,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000'
  })

  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(HTML)}`)
  await new Promise((resolve) => setTimeout(resolve, 250))

  let image = await win.webContents.capturePage()
  // HiDPI screens capture at 2x; normalise so the file is exactly 1024 square.
  if (image.getSize().width !== SIZE) {
    image = image.resize({ width: SIZE, height: SIZE, quality: 'best' })
  }

  await fs.mkdir(path.dirname(OUT), { recursive: true })
  await fs.writeFile(OUT, image.toPNG())
  console.log(`wrote ${OUT} (${image.getSize().width}x${image.getSize().height})`)

  win.destroy()
  app.quit()
})
