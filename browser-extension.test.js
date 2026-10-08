// Real Chromium extension tests. All WhatsApp requests use local fixtures.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = process.env.WA_TEST_PLAYWRIGHT_MODULE
  ? require(path.resolve(process.env.WA_TEST_PLAYWRIGHT_MODULE)) : require('playwright');

function fixture(scenario) {
  const saved = scenario === 'saved';
  const phone = scenario === 'wrong-phone' ? '85299999999' : '85291234567';
  const missing = ['missing-controls', 'retry-existing-form'].includes(scenario);
  const split = ['split-phone', 'split-full-phone'].includes(scenario);
  let form = `<form data-testid="contact-form"><h2>${scenario === 'missing-heading' ? 'Contact' : saved ? 'Edit contact' : 'New contact'}</h2><label>First name<input id="first"></label><label>Last name<input id="last"></label>${split ? '<label>Country code<select><option>Hong Kong (+852)</option></select></label>' : ''}<label>Phone number<input id="phone" value="${scenario === 'split-phone' ? '91234567' : phone}"></label><button id="save" type="button">Save</button></form>`;
  if (scenario === 'form-title-outside') form = '<h2>New contact</h2>' + form.replace('<h2>New contact</h2>', '');
  if (scenario === 'mixed-fields') {
    const phoneField = `<label>Phone number<input id="phone" value="${phone}"></label>`;
    form = form.replace(phoneField, '') + phoneField;
  }
  return `<!doctype html><html lang="en"><body>
    <main id="main"><header><button data-testid="conversation-info-header" id="info">+852 9123 4567</button></header>
    <footer><button id="send">Send</button><textarea id="draft"></textarea></footer></main>
    <aside id="drawer" data-testid="contact-info-drawer"></aside>
    <script>
    window.savedClicks = 0; window.sentClicks = 0;
    document.querySelector('#send').onclick = () => window.sentClicks++;
    document.querySelector('#draft').value = new URL(location.href).searchParams.get('text');
    document.querySelector('#info').onclick = () => {
      document.querySelector('#drawer').innerHTML = '<h2>Contact info</h2><span dir="ltr">+852 9123 4567</span>' +
        ${JSON.stringify(missing ? '<p>No supported contact action</p>' : `<button id="add">${saved ? 'Edit contact' : 'Add to contacts'}</button>`)};
      const add = document.querySelector('#add');
      if (!add) return;
      add.onclick = () => setTimeout(() => {
        document.querySelector('#drawer').innerHTML = ${JSON.stringify(form)};
        document.querySelector('#save').onclick = () => window.savedClicks++;
      }, 20);
    };
    </script></body></html>`;
}

test('real extension prepares only new contacts and never clicks Save or Send', { timeout: 90000 }, async (t) => {
  const root = __dirname;
  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium', headless: true,
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
    args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`],
  });
  t.after(() => context.close());
  context.setDefaultTimeout(12000);
  let scenario = 'new';
  await context.route('https://web.whatsapp.com/**', (route) => route.fulfill({
    contentType: 'text/html; charset=utf-8', body: fixture(scenario),
  }));
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const origin = `chrome-extension://${worker.url().split('/')[2]}`;
  const page = await context.newPage();
  const errors = [];
  context.on('page', (p) => {
    p.on('pageerror', (error) => errors.push(error.message));
    if (process.env.WA_TEST_DEBUG) p.on('console', (message) => console.log('browser', message.text()));
  });
  await page.goto(`${origin}/index.html`);
  await page.evaluate(() => localStorage.setItem('wa-helper:templates', JSON.stringify([
    { id: 'test', name: 'Test', body: 'Hi {{name}} & ?\n👋', fields: { name: { required: true } } },
  ])));
  await page.reload();
  await page.locator('input[data-col=phone]').fill('+852 9123 4567');
  assert.equal(await page.locator('.save-contact').isEnabled(), false);
  await page.locator('input[data-col=name]').fill('Ann & 李');
  assert.equal(await page.locator('.save-contact').isEnabled(), true);
  assert.equal(await page.locator('input[data-col=name]').count(), 1);

  for (const item of ['new', 'send-button', 'saved', 'split-phone', 'split-full-phone', 'wrong-phone', 'missing-controls', 'retry-existing-form', 'missing-heading', 'form-title-outside', 'mixed-fields']) {
    await t.test(item, async (caseTest) => {
      scenario = item;
      const newPage = context.waitForEvent('page');
      await page.locator(item === 'send-button' ? '.send-link' : '.save-contact').click();
      const whatsapp = await newPage;
      caseTest.after(() => whatsapp.close());
      await whatsapp.waitForURL('https://web.whatsapp.com/**');
      await whatsapp.waitForFunction(() => {
        const text = document.getElementById('wa-helper-contact')?.shadowRoot.querySelector('[role=status]')?.textContent;
        return text && !/Opening|Preparing|Waiting/.test(text);
      });
      let status = await whatsapp.locator('#wa-helper-contact [role=status]').textContent();
      if (item === 'retry-existing-form') {
        await whatsapp.evaluate(() => {
          document.getElementById('drawer').innerHTML = '<form><h2>New contact</h2><label>First name<input id="first"></label><label>Phone number<input id="phone" value="85291234567"></label><button type="button">Save</button></form>';
        });
        await whatsapp.locator('#wa-helper-contact button').filter({ hasText: 'Retry' }).click();
        await whatsapp.waitForFunction(() => {
          const status = document.getElementById('wa-helper-contact').shadowRoot.querySelector('[role=status]').textContent;
          return !/Opening|Preparing|Waiting/.test(status);
        });
        status = await whatsapp.locator('#wa-helper-contact [role=status]').textContent();
      }
      const values = await whatsapp.evaluate(() => ({
        first: document.getElementById('first')?.value, phone: document.getElementById('phone')?.value,
        saved: window.savedClicks, sent: window.sentClicks, draft: document.getElementById('draft').value,
      }));
      assert.equal(values.saved, 0);
      assert.equal(values.sent, 0);
      assert.equal(values.draft, 'Hi Ann & 李 & ?\n👋');
      if (['new', 'send-button', 'split-phone', 'split-full-phone', 'retry-existing-form', 'form-title-outside'].includes(item)) {
        assert.match(status, /Click Save/);
        assert.equal(values.first, 'Ann & 李');
        assert.equal(values.phone, item === 'split-phone' ? '91234567' : '85291234567');
      } else if (item === 'saved') {
        assert.match(status, /already saved/);
        assert.equal(values.first, undefined);
      } else {
        assert.match(status, item === 'wrong-phone' || item === 'mixed-fields' ? /does not match/ : item === 'missing-heading' ? /new.contact form/i : /contact controls/);
        if (['wrong-phone', 'missing-heading', 'mixed-fields'].includes(item)) assert.equal(values.first, '');
        await whatsapp.locator('#wa-helper-contact [data-action=cancel]').click();
        await whatsapp.waitForFunction(() => !document.getElementById('wa-helper-contact'));
      }
      await whatsapp.close();
    });
  }
  await t.test('cancel stops preparation and discards the pending contact', async () => {
    scenario = 'missing-controls';
    const newPage = context.waitForEvent('page');
    await page.locator('.save-contact').click();
    const whatsapp = await newPage;
    await whatsapp.locator('#wa-helper-contact [data-action=cancel]').click();
    await whatsapp.waitForFunction(() => !document.getElementById('wa-helper-contact'));
    const pending = await worker.evaluate(() => chrome.storage.session.get(null));
    assert.deepEqual(pending, {});
    await whatsapp.close();
  });
  await t.test('name is optional when sending a template that does not require it', async () => {
    await page.evaluate(() => localStorage.setItem('wa-helper:templates', JSON.stringify([
      { id: 'plain', name: 'Plain', body: 'Hello', fields: {} },
    ])));
    await page.reload();
    await page.locator('input[data-col=phone]').fill('85291234567');
    assert.equal(await page.locator('.save-contact').isEnabled(), false);
    assert.equal(await page.locator('.send-link').getAttribute('href'), 'https://wa.me/85291234567?text=Hello');
    await page.locator('input[data-col=name]').fill('a'.repeat(201));
    assert.equal(await page.locator('.save-contact').isEnabled(), false);
    const intercepted = await page.locator('.send-link').evaluate((link) => {
      const event = new MouseEvent('click', { cancelable: true });
      link.onclick(event);
      return event.defaultPrevented;
    });
    assert.equal(intercepted, false, 'a contact name that cannot be saved must not block ordinary sending');
  });
  assert.deepEqual(errors, []);
});
