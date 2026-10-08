// Runs only on WhatsApp Web, and stays inert unless this tab has a pending row.
(async () => {
  let contact;
  let controller;
  let closed = false;
  let busy = false;

  async function request(type) {
    const response = await chrome.runtime.sendMessage({ type });
    if (!response || response.ok !== true) throw new Error(response?.error || 'Reload the extension and try again.');
    return response;
  }

  try {
    contact = (await request('get-contact')).contact;
  } catch (error) {
    console.error('WhatsApp Helper:', error);
    return;
  }
  if (!contact) return;

  const host = document.createElement('div');
  host.id = 'wa-helper-contact';
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = `:host { all:initial; position:fixed; bottom:24px; right:24px; z-index:2147483647; }
    section { width:320px; max-width:calc(100vw - 48px); padding:16px; border-radius:12px;
      background:#fff; color:#18212b; box-shadow:0 4px 24px #0003; border:1px solid #dce3e0;
      font:14px/1.5 system-ui,sans-serif; overflow-wrap:anywhere; }
    h2 { margin:0 0 4px; font-size:15px; } p { margin:8px 0; }
    .contact { color:#58666e; white-space:pre-wrap; } .actions { display:flex; gap:8px; }
    button { font:inherit; border:1px solid #c8d2ce; border-radius:6px; background:#fff;
      color:#18212b; padding:6px 12px; cursor:pointer; }
    button:focus-visible { outline:3px solid #25d366; outline-offset:2px; }
    button:disabled { opacity:.5; cursor:wait; } [hidden] { display:none !important; }`;
  const section = document.createElement('section');
  section.setAttribute('aria-label', 'WhatsApp Helper contact preparation');
  const title = document.createElement('h2');
  title.textContent = 'Save contact';
  const details = document.createElement('p');
  details.className = 'contact';
  details.textContent = `${contact.name}\n+${contact.phone}`;
  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  const actions = document.createElement('div');
  actions.className = 'actions';
  const retry = document.createElement('button');
  retry.textContent = 'Retry';
  retry.hidden = true;
  const cancel = document.createElement('button');
  cancel.dataset.action = 'cancel';
  cancel.textContent = 'Cancel';
  actions.append(retry, cancel);
  section.append(title, details, status, actions);
  shadow.append(style, section);
  document.documentElement.append(host);

  cancel.onclick = async () => {
    closed = true;
    controller?.abort();
    try {
      await request('complete-contact');
      host.remove();
    } catch (error) {
      status.textContent = error.message;
      cancel.textContent = 'Close';
      cancel.onclick = () => host.remove();
    }
  };

  async function run() {
    if (busy || closed) return;
    busy = true;
    controller = new AbortController();
    retry.hidden = true;
    status.textContent = 'Opening WhatsApp. Waiting for this recipient’s chat…';
    try {
      const current = (await request('get-contact')).contact;
      if (!current) throw new Error('This request expired. Return to the helper and click Save contact again.');
      const result = await WhatsAppContact.prepare(current, controller.signal);
      if (closed) return;
      await request('complete-contact');
      status.textContent = result === 'saved'
        ? 'This contact is already saved. Your message is ready; click Send in WhatsApp.'
        : 'Name and phone are ready. Click Save in WhatsApp, then send your message.';
      cancel.textContent = 'Close';
    } catch (error) {
      if (!closed) {
        status.textContent = error.message;
        retry.hidden = false;
      }
    } finally {
      busy = false;
    }
  }
  retry.onclick = run;
  await run();
})();
