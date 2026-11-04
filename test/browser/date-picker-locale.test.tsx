import assert from 'node:assert/strict'
import { test } from 'node:test'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { renderToString } from '@ketvietlab/ketjs-view'
import { DatePicker, DateTimePicker } from '../../packages/design-system/src/forms/date-time/index.tsx'

// The browser lane (browser.yml), not the HTTP and unit gate: this drives a headless Chrome. A native
// date field writes the day in the browser's language whatever the page's lang, so the runtime types
// and shows it in the reader's (#1676); the server-side half is test/design-system-dates.test.tsx.
const browser =
  process.env.KET_BROWSER_BIN ??
  (process.platform === 'darwin'
    ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    : '/usr/bin/google-chrome')
// The two modules run inline: a file:// page cannot import its neighbours.
const inline = (path: string) =>
  readFileSync(path, 'utf8')
    .replace(/^import \{[^}]*\} from '[^']+'\n/mu, '')
    .replace(/^export /gmu, '')

test('browser: a single date is typed and shown in the reader’s order and still submits ISO', {
  // On a developer's machine without Chrome this skips; in CI a missing browser must fail.
  skip: process.env.CI ? false : !existsSync(browser),
}, () => {
  const directory = mkdtempSync(join(tmpdir(), 'ket-date-locale-'))
  try {
    const root = 'packages/design-system/src/forms/date-time'
    const markup = renderToString(
      <div data-kv-design-system>
        <form id="form">
          <DatePicker
            id="due"
            name="due"
            label="Due"
            value="2026-11-25"
            min="2026-11-01"
            max="2026-12-31"
            locale="en"
            today="2026-11-20"
          />
          <DatePicker id="han" name="han" label="Hạn" value="2026-11-25" today="2026-11-20" />
          <DateTimePicker id="meet" name="meet" label="Meeting" value="2026-11-25T09:30" locale="en" />
        </form>
      </div>,
    )
    const source = `<!doctype html><html lang="vi"><style>${readFileSync(`${root}/styles.css`, 'utf8')}</style>${markup}<script type="module">
${inline(`${root}/date-math.js`)}
${inline(`${root}/runtime.js`)}
const errors = [];
const check = (condition, message) => { if (!condition) errors.push(message); };
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const type = (input, text, kind = 'input') => { input.value = text; input.dispatchEvent(new Event(kind, { bubbles: true })); };
const cleanup = attachDatePickers(document);
const form = document.getElementById('form');
const due = document.getElementById('due'), entry = document.getElementById('due-entry');
check(due.type === 'hidden', 'native field still shown: ' + due.type);
check(entry.closest('[hidden]') === null, 'typed field still hidden');
check(entry.value === '11/25/2026', 'English day: ' + entry.value);
check(entry.placeholder === 'MM/DD/YYYY', 'pattern: ' + entry.placeholder);
check(document.querySelector('label[for="due-entry"]') !== null, 'label still names the native field');
check(document.getElementById('han-entry').value === '25/11/2026', 'Vietnamese day: ' + document.getElementById('han-entry').value);
let changes = 0;
due.addEventListener('change', () => changes++);
type(entry, '12/3/2026');
check(due.value === '2026-12-03', 'typed day not submitted: ' + due.value);
check(changes === 1, 'native change not dispatched: ' + changes);
type(entry, '12/3/2026', 'change');
check(entry.value === '12/03/2026', 'typed day not tidied on leaving: ' + entry.value);
check(form.checkValidity(), 'a valid day blocks the form');
check(new FormData(form).get('due') === '2026-12-03', 'form data: ' + new FormData(form).get('due'));
type(entry, '25/11/2026');
check(due.value === '', 'a day-first date read as English: ' + due.value);
check(entry.validationMessage.includes('MM/DD/YYYY'), 'no message for a bad day: ' + entry.validationMessage);
check(!form.checkValidity(), 'a bad day passes the form');
type(entry, '1/5/2027');
check(due.value === '2027-01-05' && entry.validationMessage !== '', 'a day past max passes: ' + entry.validationMessage);
form.reset(); await tick(); await tick();
check(due.value === '2026-11-25' && entry.value === '11/25/2026', 'reset: ' + due.value + ' ' + entry.value);
check(entry.validationMessage === '', 'reset keeps the message: ' + entry.validationMessage);
const picker = due.closest('[data-ui="date-picker"]');
picker.querySelector('[name="kv-date-open"]').click(); await tick();
const status = document.querySelector('#due-calendar [data-ui="date-calendar-status"]').textContent;
check(status.startsWith('11/25/2026'), 'calendar status not month first: ' + status);
document.querySelector('#due-calendar button[data-date="2026-11-28"]').click(); await tick();
check(due.value === '2026-11-28' && entry.value === '11/28/2026', 'calendar pick: ' + due.value + ' ' + entry.value);
const meet = document.getElementById('meet'), meetDay = document.getElementById('meet-date-entry');
check(meetDay.closest('[hidden]') === null, 'date-time day still hidden');
check(meetDay.value === '11/25/2026', 'date-time day: ' + meetDay.value);
check(document.querySelector('label[for="meet-date-entry"]') !== null, 'date-time label not on the typed day');
type(meetDay, '11/26/2026');
check(meet.value === '2026-11-26T09:30', 'date-time value: ' + meet.value);
due.disabled = true; await tick();
check(entry.disabled, 'a locked native field leaves the typed one open');
due.disabled = false;
cleanup();
check(due.type === 'date' && entry.closest('[hidden]') !== null, 'dispose leaves the typed field');
check(document.querySelector('label[for="due"]') !== null, 'dispose leaves the label');
document.body.append(Object.assign(document.createElement('pre'), { id: 'result', textContent: JSON.stringify(errors) }));
</script>`
    const file = join(directory, 'fixture.html')
    writeFileSync(file, source)
    const result = spawnSync(
      browser,
      [
        '--headless=new',
        '--no-sandbox',
        '--disable-gpu',
        '--window-size=900,900',
        '--lang=vi-VN',
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
    assert.match(result.stdout, /<pre id="result">\[\]<\/pre>/, result.stdout.slice(-3000))
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
