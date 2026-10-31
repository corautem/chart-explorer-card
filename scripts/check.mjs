// Headless Chromium checks of the test page: screenshots plus scripted clicks.
// Usage: npm run check            (all checks)
//        npm run check -- --perf  (also the load check)
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { mkdirSync, readFileSync } from 'node:fs';

const OUT = 'dev-output/screens';
mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

const server = await createServer({ configFile: 'vite.config.ts', logLevel: 'error' });
await server.listen();
const base = 'http://127.0.0.1:5173/';
const browser = await chromium.launch({
  executablePath: '/usr/bin/chromium',
  args: ['--no-sandbox', '--enable-precise-memory-info', '--js-flags=--expose-gc'],
});

async function open(query = '', viewport = { width: 820, height: 1000 }, extra = {}) {
  const context = await browser.newContext({ viewport, acceptDownloads: true, deviceScaleFactor: 1, locale: 'en-GB', ...extra });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  await page.goto(base + query);
  return { page, context, errors };
}

const card = (n = 1) => `.slot:nth-of-type(${n}) chart-explorer-card`;
const label = async (page, n = 1) => (await page.locator(`${card(n)} .label`).innerText()).replace(/\s*\n\s*/g, ' ');
// Picks a quick range from the top of the Presets menu.
async function quick(page, id, n = 1) {
  await page.locator(`${card(n)} .with-icon`).click();
  await page.locator(`${card(n)} .menu .chips button`, { hasText: id }).first().click();
}
// The quick range marked as picked at the top of the Presets menu.
async function activeQuick(page, n = 1) {
  await page.locator(`${card(n)} .with-icon`).click();
  const active = page.locator(`${card(n)} .menu .chips button.active`);
  const text = (await active.count()) ? (await active.textContent()).trim() : '';
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);
  return text;
}
try {
  // ---- Screenshots ----
  for (const theme of ['light', 'dark']) {
    const { page, context, errors } = await open(`?theme=${theme}&live=0`);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}/desktop-${theme}.png`, fullPage: true });
    check(`page loads without errors (${theme})`, errors.length === 0, errors.join(' | '));
    await context.close();
  }
  {
    const { page, context } = await open('?width=390&live=0', { width: 420, height: 1100 }, { hasTouch: true, isMobile: true });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}/phone-light.png`, fullPage: true });
    check('narrow card: no quick ranges in the toolbar', (await page.locator(`${card(1)} .toolbar .quick`).count()) === 0);
    const short = (await page.locator(`${card(1)} .with-icon`).innerText()).trim();
    check('narrow card: the menu button names the window briefly', short === '24h', short);
    check('narrow card: the dates are not cut short', (await page.locator(`${card(1)} .toolbar.shrink`).count()) === 0);
    await page.locator(`${card(1)} .with-icon`).click();
    const quickInMenu = await page.locator(`${card(1)} .menu .chips button`, { hasText: '24h' }).count();
    check('narrow card: menu lists the quick ranges', quickInMenu === 1);
    await page.screenshot({ path: `${OUT}/phone-menu.png`, fullPage: true });
    await context.close();
  }

  // ---- Interaction ----
  {
    const { page, context, errors } = await open('?only=1&live=0&delay=150');
    await page.waitForTimeout(1200);
    const first = await label(page);
    check('label shows the range', /\d{2}:\d{2} - /.test(first), first);
    const values = await page.locator(`${card()} .item`).count();
    check('values row has one item per entity', values === 4, String(values));

    await quick(page, '7d');
    await page.waitForTimeout(900);
    const ws = await page.evaluate(() => window.__wsLog.map((m) => `${m.type}:${m.period ?? ''}`));
    check('7d loads 5-minute statistics', ws.includes('recorder/statistics_during_period:5minute'), ws.slice(-3).join(', '));
    const sevenDays = await label(page);

    await page.locator(`${card()} .icon-button[aria-label="Previous period"]`).click();
    await page.waitForTimeout(900);
    const previous = await label(page);
    check('previous arrow moves the window back', previous !== sevenDays, previous);

    await page.locator(`${card()} .toolbar button`, { hasText: 'Now' }).click();
    await page.waitForTimeout(900);
    const active = await activeQuick(page);
    check('Now returns to the live 7d window', active === '7d', active);

    await page.locator(`${card()} .with-icon`).click();
    await page.locator(`${card()} .menu button`, { hasText: 'Last week' }).click();
    await page.waitForTimeout(900);
    const lastWeek = await label(page);
    check('Last week runs Monday 00:00 to Sunday 23:59 (en-GB)', /^Mon .* 00:00 - Sun .* 23:59$/.test(lastWeek), lastWeek);
    await page.screenshot({ path: `${OUT}/last-week.png` });

    await quick(page, '24h');
    await page.waitForTimeout(900);
    const box = await page.locator(`${card()} .chart-wrap`).boundingBox();
    const before = await label(page);
    await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.4);
    await page.waitForTimeout(150);
    const hoverValues = await page.locator(`${card()} .values`).innerText();
    await page.mouse.move(box.x + box.width * 0.9, box.y + box.height * 0.4);
    await page.waitForTimeout(150);
    const hoverValues2 = await page.locator(`${card()} .values`).innerText();
    check('values follow the cursor', hoverValues !== hoverValues2);
    await page.screenshot({ path: `${OUT}/hover.png` });

    const span = (text) => {
      const [a, b] = text.split(' - ');
      return { a, b };
    };
    const windowLength = () => page.evaluate((sel) => {
      const el = document.querySelector(sel);
      return el._window.end - el._window.start;
    }, card());
    const lengthBefore = await windowLength();

    // Drag right: the window moves back in time and keeps its length; data for
    // the newly shown part is requested while the drag is still going.
    const requestsBefore = await page.evaluate(() => window.__wsLog.length);
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5, { steps: 5 });
    await page.mouse.move(box.x + box.width * 0.75, box.y + box.height * 0.5, { steps: 5 });
    await page.waitForTimeout(400);
    const requestedDuring = (await page.evaluate(() => window.__wsLog.length)) > requestsBefore;
    const drawnDuring = await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      return el._data.window.start < el._preview.start;
    }, card());
    check('data loads while dragging, not only after letting go', requestedDuring && drawnDuring);
    const during = await label(page);
    await page.screenshot({ path: `${OUT}/drag-pan.png` });
    await page.mouse.up();
    await page.waitForTimeout(900);
    const panned = await label(page);
    check('the label follows a drag while it happens', during !== before, during);
    check('dragging moves the window back in time', panned !== before && span(panned).a !== span(before).a, panned);
    check('dragging keeps the window length', Math.abs((await windowLength()) - lengthBefore) < 1000);

    // Shift + drag selects a part to zoom into.
    await page.keyboard.down('Shift');
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.5, { steps: 6 });
    await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5, { steps: 6 });
    await page.screenshot({ path: `${OUT}/drag-selection.png` });
    await page.mouse.up();
    await page.keyboard.up('Shift');
    await page.waitForTimeout(900);
    check('Shift + drag zooms into the selection', (await windowLength()) < lengthBefore * 0.5, `${Math.round((await windowLength()) / 60000)} min`);

    // Ctrl + wheel zooms out around the pointer.
    const beforeWheel = await windowLength();
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, 300);
    await page.keyboard.up('Control');
    await page.waitForTimeout(900);
    check('Ctrl + wheel zooms', (await windowLength()) > beforeWheel * 1.5, `${Math.round(beforeWheel / 60000)} to ${Math.round((await windowLength()) / 60000)} min`);

    await page.mouse.dblclick(box.x + box.width * 0.5, box.y + box.height * 0.5);
    await page.waitForTimeout(900);
    const back = await activeQuick(page);
    check('double-click goes back to the window picked in the toolbar', back === '24h', back);

    await page.mouse.move(0, 0);
    await page.locator(`${card()} .item .name`).nth(3).click();
    const faded = await page.locator(`${card()} .item.faded`).count();
    check('clicking a name fades it', faded === 1);
    await page.screenshot({ path: `${OUT}/faded.png` });

    await page.locator(`${card()} .item .value`).first().click();
    const info = await page.locator('#log').innerText();
    check('clicking a value opens more-info', info === 'more-info: sensor.demo_flow_temperature', info);

    await page.locator(`${card()} .icon-button[aria-label="Download"]`).click();
    const [csvDownload] = await Promise.all([
      page.waitForEvent('download'),
      page.locator(`${card()} .menu button`, { hasText: 'CSV' }).click(),
    ]);
    const csvPath = await csvDownload.path();
    const csv = readFileSync(csvPath, 'utf8');
    const lines = csv.split('\r\n').filter(Boolean);
    check('CSV starts with a BOM', csv.charCodeAt(0) === 0xfeff);
    check('CSV header has time and the bright entities', lines[0] === '\uFEFFtime,Flow (°C),Return (°C),Outdoor (°C)', lines[0]);
    check('CSV has rows', lines.length > 100, `${lines.length - 1} rows`);
    check('CSV file name has title and dates', /^Heating_\d{4}-\d{2}-\d{2}_\d{4}_\d{4}-\d{2}-\d{2}_\d{4}\.csv$/.test(csvDownload.suggestedFilename()), csvDownload.suggestedFilename());
    const timeOk = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2},/.test(lines[1]);
    check('CSV time column is YYYY-MM-DD HH:mm:ss', timeOk, lines[1]);
    check('CSV first row carries every value into the window', lines[1].split(',').every((cell) => cell !== ''), lines[1]);

    await page.locator(`${card()} .icon-button[aria-label="Download"]`).click();
    const [pngDownload] = await Promise.all([
      page.waitForEvent('download'),
      page.locator(`${card()} .menu button`, { hasText: 'PNG' }).click(),
    ]);
    const png = readFileSync(await pngDownload.path());
    check('PNG export is a PNG image', png.subarray(1, 4).toString() === 'PNG', `${png.length} bytes`);

    await page.locator(`${card()} .label`).click();
    await page.locator(`${card()} #from`).fill('2026-10-01T06:00');
    await page.locator(`${card()} #to`).fill('2026-10-02T18:30');
    await page.locator(`${card()} .popover button`, { hasText: 'Apply' }).click();
    await page.waitForTimeout(900);
    const custom = await label(page);
    check('custom range applies', custom === 'Thu 1 Oct 06:00 - Fri 2 Oct 18:30', custom);
    check('no page errors during interaction', errors.length === 0, errors.join(' | '));
    await context.close();
  }

  // ---- Loading indicator and errors ----
  {
    const { page, context } = await open('?only=1&live=0&delay=4500');
    await page.waitForTimeout(400);
    const bar = await page.locator(`${card()} .loading-bar`).count();
    check('loading bar shows while data loads', bar === 1);
    await page.waitForTimeout(3200);
    const slow = await page.locator(`${card()} .message`).innerText();
    check('"Loading…" appears after 3 seconds', slow.includes('Loading'), slow);
    await page.screenshot({ path: `${OUT}/loading.png` });
    await context.close();
  }
  {
    const { page, context } = await open('?only=1&live=0&fail=1&delay=50');
    await page.waitForTimeout(800);
    const message = await page.locator(`${card()} .message`).innerText();
    check('failed load shows a message with Retry', message.includes('Could not load') && message.includes('Retry'), message.replace(/\n/g, ' / '));
    await page.screenshot({ path: `${OUT}/error.png` });
    await context.close();
  }
  {
    const { page, context } = await open('?only=2&live=0');
    await page.waitForTimeout(1200);
    await page.locator(`${card()} .with-icon`).click();
    const menu = await page.locator(`${card()} .menu`).boundingBox();
    const bar = await page.locator(`${card()} .toolbar`).boundingBox();
    check('bottom toolbar: menu opens upwards', menu && bar && menu.y + menu.height <= bar.y + 2);
    await context.close();
  }
  {
    // A narrow card with the toolbar at the bottom: the menu must stay inside
    // the card, keep the quick ranges in view and scroll the rest.
    const { page, context } = await open('?only=2&live=0&width=390', { width: 420, height: 900 });
    await page.waitForTimeout(1200);
    await page.locator(`${card()} .with-icon`).click();
    await page.waitForTimeout(200);
    const cardBox = await page.locator(`${card()} ha-card`).boundingBox();
    const menuBox = await page.locator(`${card()} .menu`).boundingBox();
    const chips = await page.locator(`${card()} .menu-top .chips`).boundingBox();
    const scrolls = await page.locator(`${card()} .menu-list`).evaluate((el) => el.scrollHeight > el.clientHeight);
    check('narrow card: the menu stays inside the card', menuBox.y >= cardBox.y - 1, `menu top ${Math.round(menuBox.y)}, card top ${Math.round(cardBox.y)}`);
    check('narrow card: quick ranges stay at the top of the menu', chips && chips.y >= menuBox.y);
    check('narrow card: the entry list scrolls', scrolls);
    await page.screenshot({ path: `${OUT}/narrow-bottom-menu.png` });
    await page.screenshot({ path: `${OUT}/bottom-toolbar-menu.png` });
    await context.close();
  }
  // ---- Visual editor (with stand-ins for Home Assistant's form elements) ----
  {
    const { page, context, errors } = await open('?editor=1&only=1&live=0&delay=50', { width: 1400, height: 1400 });
    await page.waitForTimeout(1200);
    const ed = 'chart-explorer-card-editor';
    const saved = async () => JSON.parse((await page.locator('#saved-config').textContent()) || '{}');
    const names = async () => (await saved()).entities.map((e) => (typeof e === 'string' ? e : e.name ?? e.entity));
    const change = async (selector, value) => {
      const field = page.locator(selector).first();
      await field.fill(String(value));
      await field.dispatchEvent('change');
      await page.waitForTimeout(250);
    };
    const tab = (label) => page.locator(`${ed} .tabs button`, { hasText: label }).click();
    const group = async (id) => {
      await page.locator(`${ed} .group[data-group="${id}"] .group-head`).click();
      await page.waitForTimeout(150);
    };
    const option = (key) => page.evaluate(([sel, k]) => document.querySelector(sel)._chart.getOption()[k], [card(), key]);

    check('editor shows four tabs', (await page.locator(`${ed} .tabs button`).count()) === 4);
    const addFirst = await page.evaluate((sel) => {
      const root = document.querySelector(sel).shadowRoot;
      const add = root.querySelector('.add');
      const list = root.querySelector('.entities');
      return Boolean(add && list && add.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING);
    }, ed);
    check('the add-entity search box sits above the list', addFirst);
    check('editor lists the entities', (await page.locator(`${ed} .row`).count()) === 4);
    await page.screenshot({ path: `${OUT}/editor-entities.png` });

    await change(`${ed} .add [data-field="entity"]`, 'sensor.demo_no_statistics');
    check('adding an entity from the search box', (await page.locator(`${ed} .row`).count()) === 5 && (await saved()).entities?.length === 5);
    await page.waitForTimeout(600);
    check('the preview shows the added entity', (await page.locator(`${card()} .item`).count()) === 5);

    const handle = page.locator(`${ed} .row .handle`).first();
    const hb = await handle.boundingBox();
    const rowHeight = (await page.locator(`${ed} .row`).first().boundingBox()).height;
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
    await page.mouse.down();
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2 + rowHeight * 1.2, { steps: 6 });
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2 + rowHeight * 2.2, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    const afterDrag = await names();
    check('dragging moves an entity', afterDrag[2] === 'Flow' && afterDrag[0] === 'Return', afterDrag.join(', '));
    await page.locator(`${ed} .row .handle`).nth(2).focus();
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    await page.waitForTimeout(300);
    check('arrow keys on the handle move an entity', (await names())[0] === 'Flow');

    await page.locator(`${ed} .row`).first().locator('button[title="Edit"]').click();
    check('the entity page is one scroll: scale and long-window value show straight away',
      (await page.locator(`${ed} [data-field="y_axis"]`).count()) === 1 && (await page.locator(`${ed} [data-field="statistic"]`).count()) === 1);
    await change(`${ed} [data-field="name"]`, 'Flow temp');
    await change(`${ed} [data-field="color"]`, '#ff0000');
    await change(`${ed} [data-field="width"]`, 3);
    await page.locator(`${ed} [data-field="line_style"]`).selectOption('dotted');
    await page.waitForTimeout(250);
    await page.locator(`${ed} [data-field="show_unit"]`).click();
    await page.waitForTimeout(400);
    const first = (await saved()).entities[0];
    check('editing name, colour, width, line type and unit switch',
      first.name === 'Flow temp' && first.color === '#ff0000' && first.width === 3 && first.line_style === 'dotted' && first.show_unit === false,
      JSON.stringify(first));
    check('the unit disappears from the value', (await page.locator(`${card()} .item`).first().locator('.unit').count()) === 0);
    await page.screenshot({ path: `${OUT}/editor-entity.png`, fullPage: true });
    await page.locator(`${ed} .back`).click();
    await page.locator(`${ed} .row`).last().locator('button[title="Remove"]').click();
    await page.waitForTimeout(250);
    check('removing an entity', (await saved()).entities.length === 4);

    await tab('General');
    check('groups start folded', (await page.locator(`${ed} .group-body`).count()) === 0);
    await group('toolbar-buttons');
    await group('menu-entries');
    const toolbarList = `${ed} .range-list[data-list="quick_ranges"]`;
    const menuList = `${ed} .range-list[data-list="presets"]`;
    check('the presets row is gone from the toolbar buttons', (await page.locator(`${toolbarList} .toggle`, { hasText: 'Today' }).count()) === 0);
    check('the add row starts with "Past"', (await page.locator(`${toolbarList} .add-range .past`).textContent()) === 'Past');
    await page.locator(`${toolbarList} .toggle-main`, { hasText: 'Past 6 hours' }).click();
    await page.waitForTimeout(250);
    check('tapping a standard button hides it', !(await saved()).quick_ranges.includes('6h'));
    await page.locator(`${toolbarList} .amount`).fill('45');
    await page.locator(`${toolbarList} .unit`).selectOption('m');
    await page.locator(`${toolbarList} .add-length`).click();
    await page.waitForTimeout(300);
    check('a custom length is added and switched on', (await saved()).quick_ranges[0] === '45m');
    check('custom lengths come after the standard ones, in their own shade',
      (await page.locator(`${toolbarList} .toggle`).last().getAttribute('class')).includes('custom'));
    await page.locator(`${card()} .with-icon`).click();
    const buttons = (await page.locator(`${card()} .menu .chips button`).allTextContents()).map((b) => b.trim());
    await page.keyboard.press('Escape');
    check('the menu shows 45m and not 6h', buttons.includes('45m') && !buttons.includes('6h'), buttons.join(' '));
    await page.locator(`${toolbarList} .toggle.custom .toggle-main`).click();
    await page.waitForTimeout(250);
    let cfg = await saved();
    check('switching a custom length off keeps it for later', !(cfg.quick_ranges ?? []).includes('45m') && cfg.unused_quick_ranges?.includes('45m'));
    await page.locator(`${toolbarList} .toggle.custom .chip-remove`).click();
    await page.locator(`${toolbarList} .toggle-main`, { hasText: 'Past 6 hours' }).click();
    await page.waitForTimeout(250);
    cfg = await saved();
    check('deleting a custom length removes it', !('unused_quick_ranges' in cfg) && !('quick_ranges' in cfg), JSON.stringify(cfg.quick_ranges));
    const menuOrder = await page.evaluate((sel) => {
      const list = document.querySelector(sel).shadowRoot.querySelector('.range-list[data-list="presets"]');
      const chips = list.querySelector('.chips');
      const add = list.querySelector('.add-range');
      return Boolean(chips.compareDocumentPosition(add) & Node.DOCUMENT_POSITION_FOLLOWING);
    }, ed);
    check('in the menu list the add row sits below the presets', menuOrder);
    await page.locator(`${menuList} .amount`).fill('6');
    await page.locator(`${menuList} .unit`).selectOption('d');
    await page.locator(`${menuList} .add-length`).click();
    await page.waitForTimeout(300);
    const menu = (await saved()).presets;
    check('custom menu lengths go behind the presets', menu?.[menu.length - 1] === '6d', JSON.stringify(menu));
    await page.locator(`${menuList} .direction`).selectOption('next');
    await page.locator(`${menuList} .amount`).fill('1');
    await page.locator(`${menuList} .unit`).selectOption('d');
    await page.locator(`${menuList} .add-length`).click();
    await page.waitForTimeout(300);
    const withNext = (await saved()).presets;
    check('a Next length can be added to the menu', withNext?.[withNext.length - 1] === '+1d', JSON.stringify(withNext));
    await page.locator(`${card()} .with-icon`).click();
    await page.locator(`${card()} .menu button`, { hasText: 'Next day' }).click();
    await page.waitForTimeout(500);
    const nextWindow = await page.evaluate((sel) => {
      const w = document.querySelector(sel)._window;
      return { startsNow: Math.abs(w.start - Date.now()) < 120000, hours: (w.end - w.start) / 3600000 };
    }, card());
    check('Next day runs from now into the future', nextWindow.startsNow && nextWindow.hours === 24, JSON.stringify(nextWindow));
    await quick(page, '24h');
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT}/editor-general.png`, fullPage: true });
    check('dragging the chart sits under the starting window, outside the groups',
      (await page.locator(`${ed} [data-field="drag_action"]`).count()) === 1 &&
        (await page.locator(`${ed} .group [data-field="drag_action"]`).count()) === 0);
    const labelWidth = await page.evaluate((sel) => Math.round(document.querySelector(sel).shadowRoot.querySelector('.toolbar .label').getBoundingClientRect().width), card());
    await group('toolbar');
    await page.locator(`${ed} [data-field="show_range_label"]`).click();
    await page.waitForTimeout(400);
    check('the dates and times can be hidden', (await page.locator(`${card()} .toolbar .label:not(.placeholder)`).count()) === 0);
    const gap = await page.evaluate((sel) => {
      const root = document.querySelector(sel).shadowRoot;
      const placeholder = root.querySelector('.toolbar .label.placeholder');
      return placeholder ? { width: Math.round(placeholder.getBoundingClientRect().width), hidden: getComputedStyle(placeholder).visibility } : null;
    }, card());
    // The quick ranges go into the menu too, so the empty space is at least as wide as the dates were.
    check('without them their space stays, empty', gap && gap.hidden === 'hidden' && gap.width >= labelWidth, JSON.stringify(gap) + ` label was ${labelWidth}`);
    await page.screenshot({ path: `${OUT}/no-label-toolbar.png` });
    await page.locator(`${ed} [data-field="show_range_label"]`).click();
    await page.waitForTimeout(300);
    for (const field of ['show_arrows', 'show_now_button', 'show_download']) {
      await page.locator(`${ed} [data-field="${field}"]`).click();
      await page.waitForTimeout(200);
    }
    const controls = await page.evaluate((sel) => {
      const bar = document.querySelector(sel).shadowRoot.querySelector('.toolbar');
      return {
        arrows: bar.querySelectorAll('[aria-label="Previous period"], [aria-label="Next period"]').length,
        now: bar.querySelectorAll('.now').length,
        download: bar.querySelectorAll('[aria-label="Download"]').length,
      };
    }, card());
    check('arrows, Now and download can each be hidden', controls.arrows === 0 && controls.now === 0 && controls.download === 0, JSON.stringify(controls));
    for (const field of ['show_range_label', 'show_quick_ranges', 'show_presets_menu']) {
      await page.locator(`${ed} [data-field="${field}"]`).click();
      await page.waitForTimeout(200);
    }
    check('with every control off the toolbar row goes', (await page.locator(`${card()} .toolbar-wrap`).count()) === 0);
    await page.screenshot({ path: `${OUT}/no-toolbar.png` });
    for (const field of ['show_arrows', 'show_now_button', 'show_download', 'show_range_label', 'show_quick_ranges', 'show_presets_menu']) {
      await page.locator(`${ed} [data-field="${field}"]`).click();
      await page.waitForTimeout(150);
    }
    check('and comes back', (await page.locator(`${card()} .toolbar .now`).count()) === 1);
    await page.locator(`${ed} [data-field="toolbar_position"]`).selectOption('off');
    await page.waitForTimeout(300);
    check('toolbar position Off removes the toolbar', (await page.locator(`${card()} .toolbar-wrap`).count()) === 0);
    await page.locator(`${ed} [data-field="toolbar_position"]`).selectOption('top');
    await page.waitForTimeout(300);

    await tab('Visual');
    await group('values');
    await change(`${ed} [data-field="name_size"]`, 15);
    const nameSize = await page.evaluate((sel) => getComputedStyle(document.querySelector(sel).shadowRoot.querySelector('.item .name')).fontSize, card());
    check('name text size reaches the card', nameSize === '15px', nameSize);
    await page.locator(`${ed} [data-field="values_placement"]`).selectOption('below');
    await page.waitForTimeout(300);
    const below = await page.evaluate((sel) => {
      const root = document.querySelector(sel).shadowRoot;
      return Boolean(root.querySelector('.chart-wrap').compareDocumentPosition(root.querySelector('.values')) & Node.DOCUMENT_POSITION_FOLLOWING);
    }, card());
    check('the values row can sit below the chart', below);
    await page.screenshot({ path: `${OUT}/values-below.png` });
    await page.locator(`${ed} [data-field="values_placement"]`).selectOption('above');
    await page.locator(`${ed} [data-field="name_align"]`).selectOption('center');
    await page.waitForTimeout(300);
    const nameAlign = await page.evaluate((sel) => getComputedStyle(document.querySelector(sel).shadowRoot.querySelector('.item')).alignItems, card());
    check('names can be centred on their values', nameAlign === 'center', nameAlign);
    await page.locator(`${ed} [data-field="values_align"]`).selectOption('spread');
    await change(`${ed} [data-field="values_gap"]`, 30);
    const layout = await page.evaluate((sel) => {
      const style = getComputedStyle(document.querySelector(sel).shadowRoot.querySelector('.values'));
      return `${style.justifyContent} ${style.columnGap}`;
    }, card());
    check('values spread to both edges with the chosen gap', layout === 'space-between 30px', layout);
    await group('chart');
    await page.locator(`${ed} [data-field="tooltip"]`).click();
    await page.waitForTimeout(400);
    const chartBox = await page.locator(`${card()} .chart-wrap`).boundingBox();
    const live = await page.locator(`${card()} .values`).innerText();
    await page.mouse.move(chartBox.x + chartBox.width * 0.3, chartBox.y + chartBox.height * 0.5);
    await page.waitForTimeout(200);
    const hovered = await page.locator(`${card()} .values`).innerText();
    const tip = await page.locator(`${card()} .tooltip`).count();
    check('with the tooltip on, the values row keeps the current values', tip === 1 && hovered === live);
    await page.mouse.move(0, 0);
    await page.locator(`${ed} [data-field="tooltip"]`).click();
    await page.waitForTimeout(300);
    await group('space');
    check('chart height sits with the space settings', (await page.locator(`${ed} .group[data-group="space"] [data-field="height"]`).count()) === 1);
    await change(`${ed} [data-field="x_padding_right"]`, 10);
    const xAxis = (await option('xAxis'))[0];
    check('space after the end puts the now line inside the chart', xAxis.max > Date.now());
    check('the now line is drawn on a rolling window', (await option('series')).some((s) => s.id === '__now'));
    await change(`${ed} [data-field="y_padding_top"]`, 0);
    const top = await page.evaluate((sel) => document.querySelector(sel)._chart.getOption().yAxis[0].max({ min: 20, max: 40 }), card());
    check('0 space above puts the highest value on the edge', top === 40, String(top));
    await group('x-axis');
    await page.locator(`${ed} [data-field="x_axis_grid"]`).selectOption('solid');
    await page.waitForTimeout(400);
    check('vertical grid lines for the time axis', (await option('xAxis'))[0].splitLine.show === true);
    await group('y-axis');
    await page.locator(`${ed} [data-field="y_axis_units"]`).click();
    await page.waitForTimeout(500);
    const units = await page.evaluate((sel) => {
      const root = document.querySelector(sel).shadowRoot;
      const wrap = root.querySelector('.chart-wrap').getBoundingClientRect();
      const chart = document.querySelector(sel)._chart;
      const left = chart.convertToPixel({ xAxisIndex: 0 }, chart.getOption().xAxis[0].min);
      return [...root.querySelectorAll('.axis-unit')].map((el) => {
        const r = el.getBoundingClientRect();
        return { text: el.textContent, centre: r.left + r.width / 2 - wrap.left, plotLeft: left };
      });
    }, card());
    const leftUnit = units.find((u) => u.text === '°C');
    check('units sit above the scales', units.length === 2, units.map((u) => u.text).join(' '));
    check('the left unit is centred over its numbers', leftUnit && Math.abs(leftUnit.centre - (4 + leftUnit.plotLeft - 8) / 2) < 2,
      leftUnit ? `centre ${leftUnit.centre.toFixed(1)}, column ${(4).toFixed(0)}-${(leftUnit.plotLeft - 8).toFixed(0)}` : 'none');
    await page.screenshot({ path: `${OUT}/editor-visual.png`, fullPage: true });

    await tab('Advanced');
    for (const id of ['performance', 'data', 'csv']) await group(id);
    const helpers = await page.locator(`${ed} [data-helper]`).count();
    check('every Advanced setting has an explanation', helpers === 10, `${helpers} of 10`);
    await page.locator(`${ed} [data-field="lightweight"]`).click();
    await page.waitForTimeout(250);
    const advanced = await saved();
    check('lightweight off without writing animation', advanced.lightweight === false && !('animation' in advanced));
    await page.screenshot({ path: `${OUT}/editor-advanced.png`, fullPage: true });
    check('no page errors in the editor', errors.length === 0, errors.join(' | '));
    await context.close();
  }

  // ---- Pinch to zoom (touch) ----
  {
    const { page, context } = await open('?only=1&live=0&delay=50', { width: 820, height: 700 }, { hasTouch: true });
    await page.waitForTimeout(1200);
    const box = await page.locator(`${card()} .chart-wrap`).boundingBox();
    const length = () => page.evaluate((sel) => {
      const el = document.querySelector(sel);
      return el._window.end - el._window.start;
    }, card());
    const before = await length();
    const cdp = await context.newCDPSession(page);
    const y = box.y + box.height * 0.5;
    const cx = box.x + box.width * 0.5;
    const touch = (type, d) =>
      cdp.send('Input.dispatchTouchEvent', {
        type,
        touchPoints: type === 'touchEnd' ? [] : [
          { x: cx - d, y, id: 1 },
          { x: cx + d, y, id: 2 },
        ],
      });
    await touch('touchStart', 40);
    for (const d of [60, 90, 120, 160]) await touch('touchMove', d);
    await touch('touchEnd', 0);
    await page.waitForTimeout(900);
    const after = await length();
    check('pinching apart zooms in', after < before * 0.5, `${Math.round(before / 60000)} to ${Math.round(after / 60000)} min`);
    await context.close();
  }

  // ---- Values without names ----
  {
    const { page, context, errors } = await open('?editor=1&only=5&live=0&delay=50', { width: 1400, height: 1000 });
    await page.waitForTimeout(1200);
    const ed = 'chart-explorer-card-editor';
    await page.locator(`${ed} .tabs button`, { hasText: 'Visual' }).click();
    await page.locator(`${ed} .group[data-group="values"] .group-head`).click();
    await page.waitForTimeout(200);
    await page.locator(`${ed} [data-field="show_names"]`).first().click();
    await page.waitForTimeout(400);
    const names = await page.locator(`${card()} .item .name`).count();
    const values = await page.locator(`${card()} .item .value`).count();
    check('names can be hidden, keeping the values', names === 0 && values === 2, `${names} names, ${values} values`);
    const title = await page.locator(`${card()} .item .value`).first().getAttribute('title');
    check('a value without its name says whose it is on hover', /^Status: /.test(title ?? ''), title ?? '');
    check('hidden names page loads without errors', errors.length === 0, errors.join(' | '));
    await context.close();
  }

  // ---- Chart types and entities with states ----
  const download = async (page, n, kind) => {
    await page.locator(`${card(n)} .icon-button[aria-label="Download"]`).click();
    const [file] = await Promise.all([
      page.waitForEvent('download'),
      page.locator(`${card(n)} .menu button`, { hasText: kind }).click(),
    ]);
    return kind === 'CSV' ? readFileSync(await file.path(), 'utf8').split('\r\n').filter(Boolean) : file;
  };
  const seriesTypes = (page, n = 1) =>
    page.evaluate((sel) => document.querySelector(sel)._chart.getOption().series.map((s) => `${s.type}:${s.id}`), card(n));
  {
    const { page, context, errors } = await open('?only=4&live=0&delay=50');
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}/states-with-lines.png` });
    const types = await seriesTypes(page);
    check('a status sensor draws as a timeline strip under the lines', types.includes('custom:2:sensor.demo_heat_pump_status'), types.join(' '));
    check('an entity set to band shades behind the lines', types.includes('custom:1:binary_sensor.demo_heating'));
    const grids = await page.evaluate((sel) => document.querySelector(sel)._chart.getOption().grid.length, card());
    check('the strips get their own area under the plot', grids === 2, String(grids));
    const aligned = await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      const option = el._chart.getOption();
      const x0 = el._chart.convertToPixel({ xAxisIndex: 0 }, option.xAxis[0].min);
      const x1 = el._chart.convertToPixel({ xAxisIndex: 1 }, option.xAxis[1].min);
      return Math.abs(x0 - x1) < 1;
    }, card());
    check('the strips line up with the plot above', aligned);
    const status = await page.locator(`${card()} .item .value`).nth(2).innerText();
    check('the values row shows the state as text', /^[A-Z][a-z]/.test(status), status);
    const box = await page.locator(`${card()} .chart`).boundingBox();
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.84);
    await page.waitForTimeout(300);
    const cursor = await page.evaluate((sel) => document.querySelector(sel)._cursor, card());
    check('hovering a strip moves the cursor', typeof cursor === 'number');
    await page.mouse.move(box.x + box.width * 0.5, box.y - 80);
    const lines = await download(page, 1, 'CSV');
    check('CSV writes the states as text', lines[0].endsWith(',Heating,Status') && lines.slice(1).some((line) => /,[a-z_]+$/.test(line)), `${lines[0]} | ${lines[2]}`);
    // A status with no unit that is unknown right now: its history decides that it is a strip.
    await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      const id = 'sensor.demo_heat_pump_status';
      const hass = el._hass;
      el.hass = { ...hass, states: { ...hass.states, [id]: { ...hass.states[id], state: 'unknown' } } };
      el.setConfig({ type: 'custom:chart-explorer-card', entities: ['sensor.demo_flow_temperature', id] });
    }, card());
    await page.waitForTimeout(1500);
    const unknownTypes = await seriesTypes(page);
    check('a status that is unknown right now still draws as a strip', unknownTypes.includes('custom:1:sensor.demo_heat_pump_status'), unknownTypes.join(' '));
    check('timeline page loads without errors', errors.length === 0, errors.join(' | '));
    await context.close();
  }
  {
    const { page, context, errors } = await open('?only=5&live=0&delay=50');
    await page.waitForTimeout(1500);
    const height = (await page.locator(`${card()} .chart`).boundingBox()).height;
    check('a card of states only is as tall as its strips', height < 130, `${Math.round(height)} px`);
    check('states-only page loads without errors', errors.length === 0, errors.join(' | '));
    await context.close();
  }
  {
    const { page, context, errors } = await open('?only=6&live=0&delay=50');
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}/bars.png` });
    const types = await seriesTypes(page);
    check('a bar chart draws a bar series per entity', types.filter((t) => t.startsWith('custom:')).length === 2, types.join(' '));
    const ws = await page.evaluate(() => window.__wsLog.filter((m) => m.type === 'recorder/statistics_during_period').map((m) => `${m.period}:${m.types}`));
    check('bars ask for daily changes', ws.some((m) => m.startsWith('day:') && m.includes('change')), ws.join(' | '));
    const value = await page.locator(`${card()} .item .value`).first().innerText();
    check('a meter in a bar chart shows the total of its bars', /kWh/.test(value), value);
    const lines = await download(page, 1, 'CSV');
    check('bar CSV has one row per day', lines.length >= 7 && lines.length <= 9 && lines[1].includes(' 00:00:00'), `${lines.length - 1} rows, ${lines[1]}`);
    check('bar page loads without errors', errors.length === 0, errors.join(' | '));
    await context.close();
  }
  {
    // A US English profile: 12-hour times without a leading zero, weekday before the day on the axis.
    const { page, context, errors } = await open('?only=1&live=0&delay=50&lang=en-US&width=900');
    await page.waitForTimeout(1500);
    const text = await label(page);
    check('US English: the toolbar writes 12-hour times without a leading zero', /\b([1-9]|1[0-2]):[0-5]\d\s(AM|PM)\b/.test(text) && !/\b0\d:\d\d\s(AM|PM)/.test(text), text);
    const ticks = await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      const option = el._chart.getOption();
      const formatter = option.xAxis[0].axisLabel.formatter;
      const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
      return formatter(midnight.getTime());
    }, card());
    check('US English: day labels on the axis put the weekday first', /^[A-Z][a-z]{2} \d{1,2}$/.test(ticks), ticks);
    check('US English page loads without errors', errors.length === 0, errors.join(' | '));
    await context.close();
  }
  {
    // A forecast read from an attribute: a line into the future, a shaded range, no history request.
    const { page, context, errors } = await open('?only=11&live=0&delay=50');
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}/solar-forecast.png` });
    const info = await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      const series = el._chart.getOption().series;
      const forecast = series.find((s) => s.name === 'Forecast');
      const last = forecast.data[forecast.data.length - 1];
      return {
        range: series.some((s) => s.type === 'custom' && String(s.id).endsWith(':range')),
        points: forecast.data.length,
        future: last[0] > Date.now(),
        historyFor: window.__wsLog
          .filter((m) => m.type === 'history/history_during_period' || m.type === 'recorder/statistics_during_period')
          .flatMap((m) => m.entity_ids ?? m.statistic_ids ?? []),
      };
    }, card());
    check('a list from an attribute draws as a line', info.points >= 40, String(info.points));
    check('the list runs past the present', info.future);
    check('a low and a high value draw a shaded range', info.range);
    check('the forecast needs no history request', !info.historyFor.includes('sensor.demo_pv_forecast'), info.historyFor.join(' '));
    const unit = await page.locator(`${card()} .item .value`).nth(1).innerText();
    check('the forecast value shows the unit set on the row', /kW$/.test(unit.trim()) && !/kWh/.test(unit), unit);
    await page.locator(`${card()} .with-icon`).click();
    await page.locator(`${card()} .menu .menu-list button`, { hasText: 'Tomorrow' }).click();
    await page.waitForTimeout(800);
    const box = await page.locator(`${card()} .chart`).boundingBox();
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.6);
    await page.waitForTimeout(300);
    const values = (await page.locator(`${card()} .item .value`).allInnerTexts()).map((v) => v.trim());
    check('hovering tomorrow shows the forecast, and no measurement', values[0].startsWith('-') && Number.parseFloat(values[1]) > 0, values.join(' | '));
    await page.mouse.move(box.x + box.width * 0.5, box.y - 120);
    const lines = await download(page, 1, 'CSV');
    check('CSV lists the forecast with its low and high values', /Forecast \(kW\),Forecast low \(kW\),Forecast high \(kW\)/.test(lines[0]), lines[0]);
    check('forecast page loads without errors', errors.length === 0, errors.join(' | '));
    await context.close();
  }
  {
    // Your style: the forecast as see-through areas, without lines.
    const { page, context, errors } = await open('?only=12&live=0&delay=50');
    await page.waitForTimeout(1500);
    const looks = await page.evaluate((sel) => {
      const series = document.querySelector(sel)._chart.getOption().series.filter((s) => String(s.name).startsWith('Forecast'));
      return series.map((s) => ({ width: s.lineStyle.width, fill: typeof s.areaStyle?.color === 'string' ? s.areaStyle.color : 'gradient' }));
    }, card());
    check('line type none hides the line and keeps the fill', looks.length === 2 && looks.every((l) => l.width === 0), JSON.stringify(looks));
    check('a fill opacity gives an even fill', looks.every((l) => /rgba\(.*0\.35\)/.test(l.fill)), JSON.stringify(looks));
    check('forecast areas page loads without errors', errors.length === 0, errors.join(' | '));
    await context.close();
  }
  {
    // The editor: draw from an attribute, with key pickers filled from the list's items.
    const { page, context, errors } = await open('?editor=1&only=11&live=0&delay=50', { width: 1400, height: 1400 });
    await page.waitForTimeout(1200);
    const ed = 'chart-explorer-card-editor';
    await page.locator(`${ed} .row .row-text`).nth(1).click();
    await page.waitForTimeout(400);
    const fields = await page.evaluate((sel) => {
      const root = document.querySelector(sel).shadowRoot;
      const has = (name) => Boolean(root.querySelector(`[data-field="${name}"]`));
      return { source: has('attribute_name'), value: has('attribute_value'), low: has('attribute_low'), type: has('type'), statistic: has('statistic'), opacity: has('fill_opacity') };
    }, ed);
    check('the editor offers drawing from an attribute, with its keys', fields.source && fields.value && fields.low, JSON.stringify(fields));
    check('settings that do not apply to a list are hidden', !fields.type && !fields.statistic, JSON.stringify(fields));
    check('editor forecast page loads without errors', errors.length === 0, errors.join(' | '));
    await context.close();
  }
  for (const width of [470, 900]) {
    // The quick ranges live in the Presets menu at any width, with the dates on or off.
    const { page, context, errors } = await open(`?only=1&live=0&delay=50&width=${width}`);
    await page.waitForTimeout(1000);
    const toolbarAt = async (extra) => {
      await page.evaluate(([sel, more]) => {
        document.querySelector(sel).setConfig({
          type: 'custom:chart-explorer-card',
          entities: ['sensor.demo_outdoor_temperature'],
          show_arrows: false,
          ...more,
        });
      }, [card(), extra]);
      await page.waitForTimeout(800);
      const inToolbar = await page.locator(`${card()} .toolbar .quick`).count();
      await page.locator(`${card()} .with-icon`).click();
      await page.waitForTimeout(200);
      const menu = await page.locator(`${card()} .menu .chips button`).count();
      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);
      return { inToolbar, menu };
    };
    const shown = await toolbarAt({ show_range_label: true });
    const hidden = await toolbarAt({ show_range_label: false });
    const off = await toolbarAt({ show_quick_ranges: false });
    check(`at ${width} px with the dates on, the quick ranges are in the menu only`, shown.inToolbar === 0 && shown.menu === 7, JSON.stringify(shown));
    check(`at ${width} px with the dates off, the quick ranges are in the menu only`, hidden.inToolbar === 0 && hidden.menu === 7, JSON.stringify(hidden));
    check(`at ${width} px quick ranges switched off leave the menu too`, off.menu === 0, JSON.stringify(off));
    await toolbarAt({});
    await quick(page, '24h');
    await page.waitForTimeout(300);
    const named = (await page.locator(`${card()} .with-icon`).innerText()).trim();
    check(`at ${width} px the menu button names the quick range picked`, /Past 24 hours/.test(named), named);
    check(`toolbar at ${width} px loads without errors`, errors.length === 0, errors.join(' | '));
    await context.close();
  }
  {
    const { page, context, errors } = await open('?only=7&live=0&delay=50');
    await page.waitForTimeout(1500);
    const stacks = await page.evaluate((sel) => document.querySelector(sel)._chart.getOption().series.filter((s) => s.stack).length, card());
    check('stacked areas stack each line', stacks === 2, String(stacks));
    check('stacked area page loads without errors', errors.length === 0, errors.join(' | '));
    await context.close();
  }
  {
    const { page, context, errors } = await open('?only=8&live=0&delay=50');
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}/donut.png` });
    const pies = await page.evaluate((sel) => document.querySelector(sel)._chart.getOption().series.filter((s) => s.type === 'pie').length, card());
    check('a donut card draws the totals and one donut per entity with states', pies === 2, String(pies));
    const value = await page.locator(`${card()} .item .value`).first().innerText();
    check('pie values show their share', /%/.test(value), value);
    await page.locator(`${card()} .item .name`).first().click();
    await page.waitForTimeout(300);
    const slices = await page.evaluate((sel) => document.querySelector(sel)._chart.getOption().series[0].data.length, card());
    check('fading an entity takes its slice out of the pie', slices === 1, String(slices));
    const lines = await download(page, 1, 'CSV');
    check('pie CSV lists slices with their share', lines[0] === '\uFEFFname,value,unit,percent' && lines.some((l) => l.startsWith('Status: ')), lines.slice(0, 3).join(' | '));
    check('donut page loads without errors', errors.length === 0, errors.join(' | '));
    await context.close();
  }
  {
    const { page, context, errors } = await open('?only=9&live=0&delay=50');
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}/heatmap.png` });
    const cells = await page.evaluate((sel) => document.querySelector(sel)._chart.getOption().series[0].data.length, card());
    check('a 30-day heatmap has a cell for every hour', cells >= 29 * 24 && cells <= 31 * 24, String(cells));
    check('the heatmap shows its colour key', (await page.locator(`${card()} .heat-scale`).count()) === 1);
    const box = await page.locator(`${card()} .chart`).boundingBox();
    const readAt = async (x, y) => {
      await page.mouse.move(box.x + box.width * x, box.y + box.height * y);
      await page.waitForTimeout(250);
      return page.locator(`${card()} .item .value`).first().innerText();
    };
    const night = await readAt(0.3, 0.12);
    const afternoon = await readAt(0.3, 0.6);
    check('hovering a cell shows its value', night !== afternoon, `${night} / ${afternoon}`);
    check('heatmap page loads without errors', errors.length === 0, errors.join(' | '));
    await context.close();
  }
  {
    const { page, context, errors } = await open('?only=10&live=0&delay=50');
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}/heatmap-states.png` });
    const info = await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      const cells = el._heatCells();
      return { count: cells.length, states: new Set(cells.map((c) => c.state)).size, striped: cells.filter((c) => !c.color).length };
    }, card());
    check('a 7-day heatmap of states has a cell for every hour', info.count >= 6 * 24 && info.count <= 8 * 24, String(info.count));
    check('each hour takes the colour of its main state', info.states >= 3, `${info.states} states`);
    const keys = await page.locator(`${card()} .heat-scale .state-key`).allInnerTexts();
    check('the key lists the states', keys.includes('Standby') && keys.includes('Heating'), keys.join(', '));
    const box = await page.locator(`${card()} .chart`).boundingBox();
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
    await page.waitForTimeout(250);
    const hover = await page.locator(`${card()} .item .value`).first().innerText();
    check('hovering an hour shows its main state and the minutes', /\d+ min/.test(hover) && /^[A-Z]/.test(hover), hover);
    const lines = await download(page, 1, 'CSV');
    check(
      'state heatmap CSV has one row per hour with minutes per state',
      lines[0].startsWith('\uFEFFtime,Status,Status: ') && lines[0].includes('(min)') && lines.length >= 6 * 24,
      `${lines[0]} (${lines.length} lines)`,
    );
    check('state heatmap page loads without errors', errors.length === 0, errors.join(' | '));
    await context.close();
  }
  {
    const { page, context, errors } = await open('?editor=1&only=4&live=0&delay=50', { width: 1400, height: 1400 });
    await page.waitForTimeout(1200);
    const ed = 'chart-explorer-card-editor';
    await page.locator(`${ed} .row .row-text`).nth(2).click();
    await page.waitForTimeout(400);
    const drawAs = await page.locator(`${ed} [data-field="type"]`).count();
    check('the entity page offers how to draw it', drawAs === 1);
    const lineFields = await page.locator(`${ed} [data-field="curve"]`).count();
    check('a timeline entity has no line settings', lineFields === 0);
    await page.locator(`${ed} .group[data-group="state-colors"] .group-head`).click();
    await page.waitForTimeout(300);
    const pickers = await page.locator(`${ed} [data-field^="state:"]`).count();
    check('the entity page lists its states with colours', pickers >= 3, String(pickers));
    await page.screenshot({ path: `${OUT}/editor-state-colours.png` });
    const field = page.locator(`${ed} [data-field^="state:"]`).first();
    await field.fill('#ff0000');
    await field.dispatchEvent('change');
    await page.waitForTimeout(300);
    const saved = JSON.parse((await page.locator('#saved-config').textContent()) || '{}');
    const colours = saved.entities?.[2]?.state_colors ?? {};
    check('a colour picked for a state is saved, and only that one', Object.values(colours).join() === '#ff0000', JSON.stringify(colours));
    const missing = await page.locator(`${ed} [data-field="state:unavailable"]`).count();
    check('Unavailable and Unknown can get a colour too', missing === 1 && (await page.locator(`${ed} [data-field="state:unknown"]`).count()) === 1);
    await page.locator(`${ed} .add-state input`).fill('frost_protection');
    await page.locator(`${ed} .add-state button`).click();
    await page.waitForTimeout(300);
    check('a state can be added by hand', (await page.locator(`${ed} [data-field="state:frost_protection"]`).count()) === 1);
    check('editor for states loads without errors', errors.length === 0, errors.join(' | '));
    await context.close();
  }

  // ---- Load check (npm run check -- --perf) ----
  if (process.argv.includes('--perf')) {
    for (const lightweight of ['1', '0']) {
      const { page, context } = await open(`?perf=1&live=0&delay=0&lightweight=${lightweight}`, { width: 820, height: 600 });
      const started = Date.now();
      await page.waitForFunction(() => {
        const el = document.querySelector('chart-explorer-card');
        return el && el._data && !el._loading;
      }, null, { timeout: 60000 });
      const loadMs = Date.now() - started;
      const stats = await page.evaluate(async () => {
        const el = document.querySelector('chart-explorer-card');
        let points = 0;
        for (const entity of el._data.entities.values()) points += entity.raw.t.length;
        const drawn = el._chart.getOption().series.reduce((sum, s) => sum + (s.data?.length ?? 0), 0);
        const runs = 10;
        const t0 = performance.now();
        for (let i = 0; i < runs; i++) el._draw();
        const drawMs = (performance.now() - t0) / runs;
        await new Promise((r) => setTimeout(r, 1000));
        const heap = async () => {
          window.gc();
          await new Promise((r) => setTimeout(r, 300));
          window.gc();
          return performance.memory.usedJSHeapSize / 1048576;
        };
        const withData = await heap();
        // What the card holds: drop its data and the drawn chart, then measure again.
        el._data = undefined;
        el._seriesMemo.clear();
        el._zoomLevels = [];
        el._chart.clear();
        const without = await heap();
        return { points, drawn, drawMs, cardMB: withData - without };
      });
      console.log(
        `LOAD  lightweight=${lightweight === '1' ? 'on ' : 'off'}  points loaded ${stats.points}, points drawn ${stats.drawn}, ` +
          `page ready ${loadMs} ms, redraw ${stats.drawMs.toFixed(1)} ms, memory held by the card ${stats.cardMB.toFixed(1)} MB`,
      );
      await context.close();
    }
  }
} finally {
  await browser.close();
  await server.close();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed. Screenshots in ${OUT}/`);
process.exit(failed ? 1 : 0);
