# WhatsApp contact extension

The user approved a browser extension for the existing helper. The goal is to prepare a new WhatsApp contact from a row's phone and name while leaving Save and Send to the user.

## Integration

Load this repository as an unpacked Chrome/Edge Manifest V3 extension. Its toolbar action opens the existing index.html in an extension tab; no duplicate app or build dependencies. Existing templates can be transferred from the standalone page with Export/Import JSON because extension storage has a separate origin.

The table always includes phone and name, without duplicating a {{name}} field. Name is required for Save contact, but only required for Send if the template requires it. The separate Save contact button prepares the contact and message. Send prepares the same flow when a name is available in extension mode; ordinary click-to-chat stays available otherwise.

## WhatsApp flow

Create a dedicated WhatsApp Web tab with the recipient and draft message. Store its pending contact in chrome.storage.session before navigating, indexed by that tab. A content script only acts on that tab and opens its recipient's contact information. An explicit Edit contact control means already saved; do not overwrite it. An Add to contacts control opens the new-contact form. Fill the name only after the form's phone, including a separate country prefix when present, matches the requested full international number. Never infer saved status from a display name.

The extension never clicks Save or Send. An unobtrusive panel reports progress and offers Retry/Cancel if login, an unsupported language, or changed WhatsApp markup prevents preparation. Cancel releases the pending request. Forms must be recognized unambiguously; uncertain identity or phone formatting stops with an actionable message. English WhatsApp UI is supported initially.

## Limits and verification

Only WhatsApp Web receives the content script. The extension has storage permission and its WhatsApp host permission, with no external messaging endpoint. Pending contacts expire after fifteen minutes and are removed on completion/cancel/tab close. User-entered content uses textContent/value, never HTML interpolation.

Run the existing Node suite, service-worker tests for tab isolation/expiry/validation, and real Chromium extension tests using an intercepted WhatsApp fixture. Cover new/saved contacts, mismatched numbers, separate country codes, missing forms, and manual-only Save/Send. These fixtures do not prove compatibility with the user's logged-in WhatsApp account; document that remaining live check clearly.
