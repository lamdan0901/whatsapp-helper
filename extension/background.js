// Session storage survives worker suspension, but not a browser restart.
const CONTACT_TTL = 15 * 60 * 1000;
const contactKey = (id) => `contact:${id}`;

function isHelper(sender) {
  return sender.id === chrome.runtime.id && sender.url === chrome.runtime.getURL('index.html');
}

function isWhatsApp(sender) {
  return sender.id === chrome.runtime.id && sender.tab && sender.frameId === 0 &&
    typeof sender.url === 'string' && new URL(sender.url).origin === 'https://web.whatsapp.com';
}

async function handleContact(message, sender) {
  if (message.type === 'prepare-contact') {
    if (typeof message.phone !== 'string' || !/^\d{8,15}$/.test(message.phone) ||
        typeof message.name !== 'string' || !message.name.trim() || message.name.length > 200 ||
        typeof message.message !== 'string') {
      throw new Error('Enter a valid international phone number and a name (up to 200 characters).');
    }
    // Store before navigation, so even a fast page load cannot miss the request.
    const tab = await chrome.tabs.create({ url: 'about:blank', active: true });
    const contact = { phone: message.phone, name: message.name.trim(), expiresAt: Date.now() + CONTACT_TTL };
    await chrome.storage.session.set({ [contactKey(tab.id)]: contact });
    const url = new URL('https://web.whatsapp.com/send');
    url.searchParams.set('phone', message.phone);
    url.searchParams.set('text', message.message);
    await chrome.tabs.update(tab.id, { url: url.href });
    return { ok: true };
  }
  const key = contactKey(sender.tab.id);
  if (message.type === 'complete-contact') {
    await chrome.storage.session.remove(key);
    return { ok: true };
  }
  const stored = await chrome.storage.session.get(key);
  const contact = stored[key];
  if (!contact) return { ok: true, contact: null };
  if (contact.expiresAt <= Date.now()) {
    await chrome.storage.session.remove(key);
    return { ok: true, contact: null };
  }
  return { ok: true, contact };
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (!message || typeof message !== 'object') return;
  const allowed = message.type === 'prepare-contact' ? isHelper(sender) :
    ['get-contact', 'complete-contact'].includes(message.type) && isWhatsApp(sender);
  if (!allowed) return;
  handleContact(message, sender).then(respond, (error) => respond({ ok: false, error: error.message }));
  return true;
});

chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL('index.html') }).catch(console.error);
});

chrome.tabs.onRemoved.addListener((id) => chrome.storage.session.remove(contactKey(id)));
