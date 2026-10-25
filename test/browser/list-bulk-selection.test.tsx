import assert from 'node:assert/strict'
import { test } from 'node:test'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { renderToString } from '@ketvietlab/ketjs-view'
import { inline } from '../../packages/ketsuite/src/ui/primitives.tsx'
import { page } from '../helpers/list-bulk-page.tsx'

// The browser lane (browser.yml), not the HTTP and unit gate: this drives a headless Chrome. The
// server-side half of the contract is test/list-bulk-selection.test.tsx.
const browser =
  process.env.KET_BROWSER_BIN ??
  (process.platform === 'darwin'
    ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    : '/usr/bin/google-chrome')
test('browser: zero-height bulk slots follow native form selection, extras, reset and removed rows', {
  // On a developer's machine without Chrome this skips; in CI a missing browser must fail.
  skip: process.env.CI ? false : !existsSync(browser),
}, () => {
  const directory = mkdtempSync(join(tmpdir(), 'ket-bulk-selection-'))
  try {
    const styles = [
      'packages/design-system/src/patterns/list-page/styles.css',
      'packages/design-system/src/patterns/list-page/responsive.css',
      'packages/design-system/src/primitives/actions/styles.css',
      'packages/ketsuite/src/modules/backend/design/controls.css',
      'packages/ketsuite/src/modules/backend/design/lists.css',
    ]
      .map((path) => readFileSync(path, 'utf8'))
      .join('\n')
    const runtime = stripTypeScriptTypes(
      readFileSync('packages/ketsuite/src/ui/client/bulk-selection.ts', 'utf8'),
    )
    const markup = renderToString(
      <div data-kv-design-system data-ui="app-shell">
        {page('first')}
        {page('second', [null, <button type="button">Export</button>])}
        {page('third', undefined, null)}
        {page('fourth', undefined, inline([<a href="/custom">Custom</a>]))}
      </div>,
    )
    const source = `<!doctype html><style>:root {--kv-space-2:8px;--kv-page-padding-x:16px;--admin-control-height:32px} ${styles}</style>${markup}<script type="module">
${runtime}
const errors = [];
const check = (condition, message) => { if (!condition) errors.push(message); };
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const row = id => document.querySelector('input[form="' + id + '"]');
const form = id => document.getElementById(id);
const slot = id => form(id).closest('[data-ui="list-page-tools"]');
const header = id => form(id).closest('[data-ui="list-page-actions"]');
const height = id => slot(id).getBoundingClientRect().height;
check(height('first') === 0, 'SSR blank space');
check(height('second') > 0, 'SSR extra hidden');
check(header('first').getBoundingClientRect().height > 0, 'Create hidden before selection');
check(header('third').getBoundingClientRect().height === 0, 'bulk-only header leaves empty row');
check(document.querySelectorAll('[data-ui="list-page"] > [data-ui="list-page-actions"]').length === 0, 'separate body action row remains');
check(form('first').closest('[data-ui="list-page-header"]') !== null, 'bulk form outside header');
row('first').checked = true;
const controller = new AbortController();
installBulkSelection(document, controller.signal);
check(height('first') > 0, 'restored selection not synced at install');
const change = async (id, checked) => { row(id).checked = checked; row(id).dispatchEvent(new Event('change', {bubbles:true})); await tick(); };
check(row('first').form === form('first'), 'lost native association');
await change('first', false);
const all = document.createElement('input'); all.type='checkbox'; all.setAttribute('data-ui','select-all');
document.body.append(all);
// The shared table/island handler sets associated row properties before this
// delegated change reaches the bulk selection observer.
all.addEventListener('change', () => { row('first').checked = all.checked; });
all.checked = true; all.dispatchEvent(new Event('change', {bubbles:true})); await tick();
check(height('first') > 0, 'select-all did not reveal bulk actions');
all.checked = false; all.dispatchEvent(new Event('change', {bubbles:true})); await tick();
check(height('first') === 0, 'clear-all retained action spacing');
await change('first', true);
check(height('first') > 0 && !form('first').hidden, 'selection did not reveal whole slot');
check(form('second').hidden, 'unrelated bulk menu revealed');
check(new FormData(form('first')).get('ids') === 'first', 'selected value missing');
check(new FormData(form('first')).get('token') === 'preserved', 'hidden value missing');
form('first').querySelector('details').open = true;
const trigger = form('first').querySelector('summary').getBoundingClientRect();
const primary = header('first').querySelector('a[href="/new"]').getBoundingClientRect();
check(Math.abs((primary.top + primary.bottom) / 2 - (trigger.top + trigger.bottom) / 2) <= 1, 'mobile bulk wraps below primary');
check(matchMedia('(max-width: 42rem)').matches, 'responsive fixture is not narrow');
await change('fourth', true);
const custom = header('fourth').querySelector('a[href="/custom"]').getBoundingClientRect();
const customBulk = form('fourth').querySelector('summary').getBoundingClientRect();
check(Math.abs((custom.top + custom.bottom) / 2 - (customBulk.top + customBulk.bottom) / 2) <= 1, 'inline primary forces bulk onto another mobile row');
const menu = form('first').querySelector('[data-ui="bulk-actions-menu"]').getBoundingClientRect();
check(menu.right <= trigger.right + 1, 'header bulk menu does not align inward');
check(menu.left >= 0 && menu.right <= innerWidth, 'header bulk menu leaves viewport');
check(menu.top >= trigger.bottom, 'bulk menu overlaps its trigger');
await change('first', false);
check(height('first') === 0 && form('first').hidden, 'deselection blank space');
check(header('first').getBoundingClientRect().height > 0 && !header('first').hidden, 'deselection hides Create');
await change('third', true);
check(!header('third').hidden && height('third') > 0, 'bulk-only header does not reveal');
await change('third', false);
check(header('third').getBoundingClientRect().height === 0, 'bulk-only header does not collapse');
check(!form('first').querySelector('details').open, 'menu left open');
check(height('second') > 0, 'deselection hid extra');
await change('second', true);
await change('first', true);
await change('first', false);
check(!form('second').hidden, 'deselection hid another selected form');
form('second').reset(); await tick();
check(form('second').hidden && height('second') > 0, 'reset lost extra or retained bulk');
await change('first', true);
row('first').remove(); await tick();
check(height('first') === 0, 'removed selection left gap');
const replacement = document.createElement('input'); replacement.type='checkbox'; replacement.setAttribute('data-ui','kt-row-select'); replacement.setAttribute('form','first'); replacement.checked=true;
document.body.append(replacement); await tick();
check(height('first') > 0, 'island replacement not synced');
replacement.disabled=true; await tick();
check(height('first') === 0, 'disabled selection enabled actions');
// Stateful KetTable persists selected ids separately from its visible checkboxes.
const persisted = document.createElement('div'); persisted.setAttribute('data-ui','kt-select-persisted');
document.body.append(persisted);
persisted.innerHTML = '<input type="hidden" name="selected.product" value="1" form="first">';
await tick();
check(height('first') > 0 && !form('first').hidden, 'persisted island selection did not reveal actions');
check(form('second').hidden, 'persisted selection revealed unrelated form');
check(new FormData(form('first')).get('selected.product') === '1', 'persisted selected id missing');
persisted.replaceChildren(); await tick();
check(height('first') === 0, 'clearing island selection retained action spacing');
controller.abort();
document.body.append(Object.assign(document.createElement('pre'), {id:'result', textContent: JSON.stringify(errors)}));
</script>`
    const file = join(directory, 'fixture.html')
    writeFileSync(file, source)
    const result = spawnSync(
      browser,
      [
        '--headless=new',
        '--no-sandbox',
        '--disable-gpu',
        '--window-size=600,800',
        '--disable-background-networking',
        '--no-first-run',
        '--no-default-browser-check',
        `--user-data-dir=${join(directory, 'profile')}`,
        '--virtual-time-budget=3000',
        '--dump-dom',
        `file://${file}`,
      ],
      { encoding: 'utf8', timeout: 30000, maxBuffer: 4 * 1024 * 1024 },
    )
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /<pre id="result">\[\]<\/pre>/, result.stdout.slice(-5000))
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
