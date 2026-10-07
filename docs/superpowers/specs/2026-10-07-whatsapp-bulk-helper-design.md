# WhatsApp Bulk Helper — Design

Date: 2026-10-07

## Goal

A static web page that lets one user send personalized WhatsApp messages to a small list of contacts (~10 per send), one contact at a time. The user defines reusable message templates with placeholders, fills per-contact values in a table (or pastes them from Excel/Sheets), and clicks a button per contact that opens WhatsApp with the message prefilled. The user presses send inside WhatsApp.

### Success criteria

- Create, edit, delete templates; they survive browser restarts.
- Pick a template, paste 10 rows from Excel, and send all 10 messages with one click per row plus one send press in WhatsApp.
- Invalid rows (bad phone, missing required field) cannot be sent and show what is wrong.
- Templates can be exported to and imported from a JSON file as backup.

### Non-goals

- No WhatsApp API, no automation, no unattended sending, no "send all" button.
- No backend, accounts, multi-device sync or team sharing.
- No persistence of contact rows between page loads.
- No field types other than plain text.
- No default country code; phone numbers are always entered in full international format.

## Architecture

Static files, no build step, no dependencies. Works opened from disk or hosted on any static host (e.g. GitHub Pages).

```
index.html   markup: two tabs (Templates, Send)
style.css    styles
app.js       all logic, ES module; exports pure functions for tests
test.html    loads app.js pure functions, runs asserts, prints pass/fail
```

### Transport

Each message is sent via a WhatsApp click-to-chat link:

```
https://wa.me/<digits>?text=<encodeURIComponent(message)>
```

Rendered as a plain `<a href=... target="_blank" rel="noopener">` styled as a button, so browsers treat it as a user-initiated navigation and do not block it.

## Data model

`localStorage` key `wa-helper:templates` holds a JSON array:

```json
[
  {
    "id": "uuid",
    "name": "Order ready",
    "body": "Hi {{name}}, order {{order_id}} ready.{{note}}",
    "fields": {
      "name": { "required": true },
      "order_id": { "required": true },
      "note": { "required": false }
    }
  }
]
```

- `id` from `crypto.randomUUID()`.
- Placeholder syntax: `{{ name }}`, whitespace inside braces allowed, name matches `[A-Za-z0-9_]+`. Anything else is left as literal text.
- `fields` is regenerated from `body` on every edit. Field order = order of first appearance in body. Existing `required` flags are kept for fields that still exist; new fields default to `required: true`.
- `phone` is a built-in, always-required column on every template. If the body contains `{{phone}}`, it uses the phone column value; no extra column is added and `phone` does not appear in `fields`.

## UI

Single page, two tabs.

### Templates tab

- List of templates (name), with Edit and Delete per item, and a New button.
- Editor: name input, body textarea, detected fields list with a "required" checkbox each, live preview using field names as sample values.
- Save disabled when name is empty or body is blank.
- Delete asks `confirm()`.
- Export JSON: downloads all templates as `wa-templates.json`.
- Import JSON: file picker; merges by `id` (imported overwrites same id, others kept).

### Send tab

- Template dropdown. Changing template resets the table.
- Table columns: `phone*`, then each field in order (`*` marks required), then Preview, then Send.
- Starts with one empty row. Buttons: Add row, Clear all. Each row has a delete control.
- Paste: pasting into any cell parses the clipboard as TSV and fills starting at that cell, going right and down, adding rows as needed. Columns beyond the last field are ignored.
- Preview column shows the rendered message for the row.
- Send: link button per row. Disabled (not a link) while the row is invalid. After click, the row is marked "sent" (visual only); the button stays usable for resending.

## Pure functions (exported from app.js)

| Function | Behavior |
|---|---|
| `parseFields(body)` | Returns ordered unique placeholder names, excluding `phone`. |
| `render(body, values)` | Replaces each placeholder with `values[name]`, or `""` if missing/blank. |
| `normalizePhone(s)` | Strips spaces, `-`, `(`, `)`, `.`, leading `+`; strips leading `00`. Returns digits string, or `null` if result is not 8–15 digits or contains non-digits. |
| `parseTSV(text)` | Parses Excel/Sheets clipboard text into a 2D array. Handles quoted cells (with embedded tabs, newlines and `""` escapes), `\r\n` line endings and a single trailing newline. |
| `waLink(phone, msg)` | Returns `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`. |

## Validation

Live, per row:

- Phone: `normalizePhone` returns `null` → cell marked invalid, title text "Use full international number, e.g. 85291234567".
- Required field empty or whitespace-only → cell marked invalid.
- Optional field empty → renders as `""`.
- Row valid only when all checks pass; only valid rows get an active Send link.

## Error handling

- `localStorage` unavailable or write fails → banner "Templates can't be saved in this browser"; app keeps working with in-memory templates for the session.
- Stored JSON corrupt → treated as empty list, banner shown, stored value not overwritten until the user saves.
- Import file not valid JSON or not an array of `{id, name, body}` → `alert()`, nothing changed.

## Testing

`test.html` imports the pure functions from `app.js` and runs plain asserts, printing pass/fail per case to the page:

- `parseFields`: order, duplicates, spaces in braces, `phone` excluded, invalid names ignored.
- `render`: missing/blank optional values become `""`, repeated placeholders, `{{phone}}`.
- `normalizePhone`: `+852 9123-4567`, `0085291234567`, too short, too long, letters.
- `parseTSV`: plain grid, quoted cell with tab/newline/`""`, `\r\n`, trailing newline.
- `waLink`: emoji and newlines encoded.

UI (tabs, editor, paste, send links) is checked manually in a browser.
