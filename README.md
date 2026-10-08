# WhatsApp Helper extension

## Install in Chrome or Edge

1. Open `chrome://extensions` (Chrome) or `edge://extensions` (Edge).
2. Turn on **Developer mode**.
3. Click **Load unpacked** and select the `whatsapp-helper` folder containing `manifest.json`. If using the ZIP, extract it first and select the extracted folder.
4. Pin **WhatsApp Helper**, then click its toolbar icon to open the helper.

The extension does not need Node, npm, a server, or a build step to run. Its scripts only run on WhatsApp Web.

## Save a contact and prepare a message

- Enter the full international **phone** and **name** in a row. Name is always available, even if the template does not use `{{name}}`.
- Click **Save contact** beside **Send**. The extension opens a dedicated WhatsApp Web tab with the recipient and draft message, opens contact information, and prepares a recognized new-contact form.
- Click WhatsApp's **Save**, then send the message yourself. The extension never clicks either button.
- In extension mode, **Send** also prepares the contact when a usable name is present. With no name, it uses the ordinary click-to-chat link. Name is required for sending only when the template requires `{{name}}`.
- An explicit **Edit contact** control for the matching recipient means the contact is already saved; the extension leaves it unchanged. A public profile name alone does not establish this.
- **Cancel** stops preparation and discards this tab's pending request. **Retry** can use a form you opened manually. Opening a contact draft does not mark the helper's row as sent.

Use WhatsApp Web in **English**. If not signed in, sign in first, open the recipient's chat, then click **Retry**. If the extension cannot recognize the sidebar, open **Contact info → Add to contacts → New contact** yourself and click **Retry**. If the phone or country code does not match, verify it manually before saving.

Names for contact preparation must be at most 200 characters. A longer optional name does not block ordinary message sending. The complete supplied name is put into **First name**, preserving non-Latin names. A form that already has a name is left for you to review manually.

## Existing templates

The extension page has separate local storage from the standalone HTML page. In your old helper, click **Export JSON**. Open the helper from the extension toolbar, then **Import JSON**. Contact rows still are not saved between page loads.

Opening `index.html` directly still works for ordinary message preparation; contact preparation requires opening it from the extension toolbar.

## Verification and current limitation

Automated tests load the actual Manifest V3 extension in Chromium and fulfill WhatsApp network requests with simulated contact pages. They cover new and saved contacts, Send integration, country codes, mismatched numbers, missing controls, manual-open form retries, cancellation, and preventing automatic Save/Send. **These tests do not verify compatibility with a logged-in WhatsApp account.** WhatsApp markup can change, and unfamiliar forms stop with a visible explanation.

Pending contact name/phone are kept only in extension session storage, tied to the new tab. Requests expire after fifteen minutes and are cleared when completed, cancelled, or their tab closes. Contact details are not passed in URL fragments or sent to a third-party service; WhatsApp receives the usual phone and message query parameters.

Developer checks (source checkout; the extension-only ZIP omits test files):

```powershell
npm test
npm install
npx playwright install chromium
npm run test:browser
```

Playwright is a **development-only** dependency. `CHROME_PATH` may point to another Chromium/Chrome for Testing executable. In a restricted environment, `WA_TEST_PLAYWRIGHT_MODULE` may point to an already installed Playwright package; this session used the existing local package because registry downloads were blocked. `WA_TEST_DEBUG=1` enables browser console diagnostics.

Manual live acceptance: test an unsaved number, an already-saved number, country-prefix handling, and cancelling/retrying a contact form in your own signed-in account. Confirm only the intended name/number are prepared and that Save/Send still require your clicks.

References: [Chrome extension content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts), [Chrome session storage](https://developer.chrome.com/docs/extensions/reference/api/storage), [Playwright extension testing](https://playwright.dev/docs/chrome-extensions).
