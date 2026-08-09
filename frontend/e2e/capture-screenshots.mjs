// 截图采集脚本：README / 截图专页用（英文界面 + G电影 库，1600×900）
// 用法：node e2e/capture-screenshots.mjs   （需 dev 服务在 127.0.0.1:3460 运行）
import { chromium } from 'playwright-core'

const BASE = 'http://127.0.0.1:3460'
const LIB_ID = 'lib-df87b647' // G电影
const LIB_LABEL = 'G电影'
const OUT = 'doc/screenshots'
const VIEWPORT = { width: 1600, height: 900 }
const SAVE_DIR = 'F:/LocVid/doc/screenshots'

const shotList = []
const errors = []
function logShot(name, desc) {
  shotList.push(`${name} — ${desc}`)
  console.log('SHOT:', name)
}

async function shot(page, name, desc) {
  await page.screenshot({ path: `${SAVE_DIR}/${name}`, fullPage: false })
  logShot(name, desc)
}

async function api(path, opts = {}) {
  const url = `${BASE}${path}${path.includes('?') ? '&' : '?'}library_id=${LIB_ID}`
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 15000)
  try {
    const r = await fetch(url, {
      headers: { 'Content-Type': 'application/json' },
      signal: ctrl.signal,
      ...opts,
    })
    return await r.json().catch(() => ({}))
  } finally {
    clearTimeout(t)
  }
}

async function waitThumbs(page) {
  await page
    .waitForFunction(() => [...document.images].every((i) => i.complete), null, { timeout: 25000 })
    .catch(() => {})
  await page.waitForTimeout(600)
}

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: VIEWPORT, locale: 'en-US' })
const page = await context.newPage()
page.on('pageerror', (e) => errors.push('PAGE_ERROR: ' + String(e).slice(0, 150)))
page.on('console', (m) => m.type() === 'error' && errors.push('CONSOLE_ERR: ' + m.text().slice(0, 150)))

// ── 0. 英文界面 + 就绪 ──
await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await page.evaluate(() => localStorage.setItem('lg-locale', 'en'))
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForSelector('[data-testid="category-item"]', { timeout: 30000 })
await page.waitForTimeout(1200)

// ── 1. 切 G电影 库 ──
await page.locator('.app-header-library select').selectOption({ label: LIB_LABEL }).catch(async () => {
  await page.locator('.app-header-library select').selectOption({ index: 1 })
})
await page.waitForTimeout(2000)
await page.waitForSelector('[data-testid="video-card"]', { timeout: 20000 })
await waitThumbs(page)

// ── 2. Gallery（经典布局） ──
await shot(page, 'gallery.png', 'Gallery — classic layout, thumbnail grid + sidebar')

// ── 3. Gallery（影院布局） ──
await page.locator('[title="Theme"] button:has-text("Cinema")').click().catch(() => page.locator('button:has-text("Cinema")').first().click())
await page.waitForTimeout(1500)
await waitThumbs(page)
await shot(page, 'gallery-cinema.png', 'Gallery — cinema layout')
await page.locator('[title="Theme"] button:has-text("Classic")').click().catch(() => page.locator('button:has-text("Classic")').first().click())
await page.waitForTimeout(1200)

// ── 4. Hover preview ──
const card1 = page.locator('[data-testid="video-card"]').nth(1)
await card1.scrollIntoViewIfNeeded().catch(() => {})
await card1.hover()
await page.waitForTimeout(3000)
const tipVisible = await page.locator('.path-tip').isVisible().catch(() => false)
if (tipVisible) {
  await page.waitForTimeout(1500)
  await shot(page, 'hover-preview.png', 'Hover preview on a card')
} else {
  logShot('hover-preview.png', 'SKIPPED (path-tip not visible)')
}
await page.mouse.move(20, 400)
await page.waitForTimeout(600)

// ── 5. Search suggestions ──
const searchInput = page.locator('[data-testid="search-input"]').first()
await searchInput.click()
await searchInput.fill('the')
await page.waitForTimeout(1800)
const suggestVisible = await page.locator('.absolute.right-0.top-full.z-50').isVisible().catch(() => false)
if (suggestVisible) {
  await shot(page, 'search-suggest.png', 'Search suggestions dropdown')
} else {
  logShot('search-suggest.png', 'SKIPPED (suggest dropdown not visible)')
}
await searchInput.fill('')
await page.keyboard.press('Escape')
await page.waitForTimeout(500)

// ── 6. Player ──
await page.locator('[data-testid="video-card"]').first().click()
await page.waitForSelector('movi-player, .player-stage', { timeout: 20000 }).catch(() => {})
await page
  .waitForFunction(
    () => {
      const mp = document.querySelector('movi-player')
      if (!mp) return false
      const canvas = mp.querySelector?.('canvas') || mp.shadowRoot?.querySelector('canvas')
      const state = mp.player?.state || mp._state || ''
      return state === 'playing' || state === 'paused' || (canvas && canvas.width > 100)
    },
    null,
    { timeout: 12000 },
  )
  .catch(() => {})
await page.waitForTimeout(2000)
const playerOpen = await page.locator('.player-stage').isVisible().catch(() => false)
if (playerOpen) {
  await shot(page, 'player.png', 'Player — real video frame + playlist')
  const trackBtns = page.locator(
    'movi-player button[title*="ubtitle"], movi-player button[aria-label*="ubtitle"], movi-player button[title*="udio"], movi-player button[aria-label*="udio"]',
  )
  if ((await trackBtns.count()) > 0) {
    await trackBtns.first().click().catch(() => {})
    await page.waitForTimeout(1200)
    await shot(page, 'tracks-panel.png', 'Player — audio/subtitle track panel')
  }
} else {
  logShot('player.png', 'SKIPPED (player not open)')
}
await page.keyboard.press('Escape')
await page.waitForTimeout(1000)

// ── 7. Batch selection ──
await page.waitForSelector('[data-testid="video-card"]', { timeout: 15000 })
const checks = page.locator('input.card-check')
const cnt = Math.min(3, await checks.count())
for (let i = 0; i < cnt; i++) await checks.nth(i).check({ force: true }).catch(() => {})
await page.waitForTimeout(800)
await shot(page, 'batch.png', 'Batch selection bar')
await page.locator('.batch-bar button:has-text("Cancel"), button:has-text("取消")').first().click().catch(() => {})
await page.waitForTimeout(600)

// ── 8. Favorites（独立 try-catch） ──
try {
  const favIds = await api('/videos?page=1&page_size=2').then((d) => (d.items || []).map((v) => v.id))
  for (const id of favIds.slice(0, 2)) await api('/favorites/toggle', { method: 'POST', body: JSON.stringify({ id }) })
  await page.waitForTimeout(800)
  await page.goto(`${BASE}/favorites`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-testid="video-card"]', { timeout: 15000 })
  await waitThumbs(page)
  await shot(page, 'favorites.png', 'Favorites page')
  for (const id of favIds.slice(0, 2)) await api('/favorites/toggle', { method: 'POST', body: JSON.stringify({ id }) })
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-testid="video-card"]', { timeout: 15000 })
  await page.waitForTimeout(800)
} catch (e) { logShot('favorites.png', 'SKIPPED (' + (e.message || 'err') + ')') }

// ── 9. Albums（独立 try-catch） ──
try {
  const albumRes = await api('/albums', { method: 'POST', body: JSON.stringify({ name: 'Action Night', description: 'Sample album for screenshots' }) })
  const albumId = albumRes?.album?.id
  if (albumId) {
    const ids = await api('/videos?page=1&page_size=3').then((d) => (d.items || []).map((v) => v.id))
    await api(`/albums/${albumId}/videos`, { method: 'POST', body: JSON.stringify({ ids: ids.slice(0, 3) }) })
    await page.goto(`${BASE}/albums`, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('text=Action Night', { timeout: 15000 }).catch(() => {})
    await page.waitForTimeout(1200)
    await shot(page, 'albums.png', 'Albums page')
    await api(`/albums/${albumId}`, { method: 'DELETE' })
  } else {
    logShot('albums.png', 'SKIPPED (album create failed)')
  }
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-testid="video-card"]', { timeout: 15000 })
  await page.waitForTimeout(800)
} catch (e) { logShot('albums.png', 'SKIPPED (' + (e.message || 'err') + ')') }

// ── 10. Thumbnail picker（独立 try-catch） ──
try {
  const cardForCtx = page.locator('[data-testid="video-card"]').nth(0)
  const box = await cardForCtx.boundingBox()
  if (box) {
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' })
    await page.waitForSelector('.context-menu', { timeout: 5000 }).catch(() => {})
    await page.locator('.context-menu button', { hasText: 'Change Thumbnail' }).click().catch(() => {})
    await page.waitForSelector('.thumb-picker-panel', { timeout: 20000 }).catch(() => {})
    await page.waitForTimeout(2500)
    if (await page.locator('.thumb-picker-panel').isVisible().catch(() => false)) {
      await shot(page, 'thumb-picker.png', 'Thumbnail picker — candidate frames')
      await page.keyboard.press('Escape')
    } else {
      logShot('thumb-picker.png', 'SKIPPED (picker not opened)')
    }
  }
} catch (e) { logShot('thumb-picker.png', 'SKIPPED (' + (e.message || 'err') + ')') }

// ── 11. Video properties（独立 try-catch） ──
try {
  const cardForCtx2 = page.locator('[data-testid="video-card"]').nth(0)
  const box2 = await cardForCtx2.boundingBox()
  if (box2) {
    await page.mouse.click(box2.x + box2.width / 2, box2.y + box2.height / 2, { button: 'right' })
    await page.waitForSelector('.context-menu', { timeout: 5000 }).catch(() => {})
    await page.locator('.context-menu button', { hasText: 'Properties' }).click().catch(() => {})
    await page.waitForTimeout(2000)
    if (await page.locator('.lg-modal-overlay:visible').count()) {
      await shot(page, 'video-props.png', 'Video properties dialog')
      await page.keyboard.press('Escape')
    } else {
      logShot('video-props.png', 'SKIPPED (props dialog not found)')
    }
  }
} catch (e) { logShot('video-props.png', 'SKIPPED (' + (e.message || 'err') + ')') }

// ── 12. Settings dialog（独立 try-catch） ──
try {
  await page.locator('.app-header button:has-text("Settings")').click().catch(() => {})
  await page.waitForTimeout(1500)
  if (await page.locator('.lg-modal-overlay:visible').count()) {
    await shot(page, 'settings.png', 'Settings dialog')
    await page.locator('nav button:has-text("Thumbnail"), .settings-sidebar button:has-text("Thumbnail")').click().catch(() => {})
    await page.waitForTimeout(1000)
    await shot(page, 'settings-thumb.png', 'Settings — thumbnail tab')
    await page.keyboard.press('Escape')
  } else {
    logShot('settings.png', 'SKIPPED (settings not open)')
  }
} catch (e) { logShot('settings.png', 'SKIPPED (' + (e.message || 'err') + ')'); logShot('settings-thumb.png', 'SKIPPED') }

// ── 13. Light theme（独立 try-catch） ──
try {
  await page.locator('button[title*="light"], button[title*="dark"]').first().click().catch(() => {})
  await page.waitForTimeout(1200)
  await waitThumbs(page)
  await shot(page, 'light-theme.png', 'Same gallery in light theme')
  await page.locator('button[title*="light"], button[title*="dark"]').first().click().catch(() => {})
} catch (e) { logShot('light-theme.png', 'SKIPPED (' + (e.message || 'err') + ')') }

// ── 14. Sidebar filter（独立 try-catch） ──
try {
  await page.locator('.category-sidebar input[type="text"], input[placeholder*="Filter"]').first().fill('A').catch(() => {})
  await page.waitForTimeout(1000)
  await shot(page, 'sidebar-filter.png', 'Sidebar category filter')
  await page.locator('.category-sidebar input[type="text"], input[placeholder*="Filter"]').first().fill('').catch(() => {})
} catch (e) { logShot('sidebar-filter.png', 'SKIPPED (' + (e.message || 'err') + ')') }

await browser.close()

console.log('\n=== 截图清单 ===')
shotList.forEach((s) => console.log(' ', s))
console.log('\n=== 页面错误 ===', errors.length ? '' : '(0)')
errors.slice(0, 8).forEach((e) => console.log(' ', e))