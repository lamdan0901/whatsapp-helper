// Public DOM only. WhatsApp markup is not an API; uncertain forms stop visibly.
const WhatsAppContact = (() => {
  const clean = (value) => String(value).replace(/\s+/g, ' ').trim();
  const visible = (element) => element.getClientRects().length > 0 &&
    getComputedStyle(element).visibility !== 'hidden';
  const digits = (value) => {
    const text = clean(value);
    return /^[+\d\s().-]+$/.test(text) ? text.replace(/\D/g, '').replace(/^00/, '') : null;
  };

  function action(names, root = document) {
    return [...root.querySelectorAll('button, [role="button"], [role="menuitem"]')].find((node) =>
      visible(node) && !node.disabled && names.some((name) =>
        [node.textContent, node.getAttribute('aria-label'), node.getAttribute('title')]
          .some((text) => text && clean(text).toLowerCase() === name.toLowerCase())));
  }

  function field(names, root = document) {
    const matches = [...root.querySelectorAll('input:not([type="hidden"]), select, [role="combobox"]')]
      .filter((input) => visible(input) && !input.disabled && names.some((name) => {
        const texts = [input.getAttribute('aria-label'), input.getAttribute('placeholder')];
        if (input.labels) texts.push(...[...input.labels].map((label) => {
          const copy = label.cloneNode(true);
          copy.querySelectorAll('input, select, textarea, [role="combobox"]').forEach((control) => control.remove());
          return copy.textContent;
        }));
        const labelledBy = input.getAttribute('aria-labelledby');
        if (labelledBy) texts.push(labelledBy.split(/\s+/).map((id) => document.getElementById(id)?.textContent).join(' '));
        return texts.some((text) => text && clean(text).toLowerCase() === name.toLowerCase());
      }));
    if (matches.length > 1) throw new Error('More than one contact form is visible. Close other panels, then Retry.');
    return matches[0];
  }

  function hasPhone(root, phone) {
    return [...root.querySelectorAll('span, p, [data-testid="contact-info-phone"], [data-testid="phone-number"]')]
      .some((node) => visible(node) && digits(node.textContent) === phone);
  }

  function waitFor(read, message, signal, timeout = 6000) {
    return new Promise((resolve, reject) => {
      let observer;
      let timer;
      const finish = (error, value) => {
        observer?.disconnect();
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
        if (error) reject(error);
        else resolve(value);
      };
      const abort = () => finish(new Error('Contact preparation cancelled.'));
      const check = () => {
        if (signal.aborted) return abort();
        try {
          const value = read();
          if (value) finish(null, value);
        } catch (error) {
          finish(error);
        }
      };
      observer = new MutationObserver(check);
      observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
      timer = setTimeout(() => finish(new Error(message)), timeout);
      signal.addEventListener('abort', abort, { once: true });
      check();
    });
  }

  function fill(input, value) {
    if (!(input instanceof HTMLInputElement)) throw new Error('Unsupported contact input. Enter the name in WhatsApp manually.');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function paneFor(node) {
    const known = node.closest('form, [role="dialog"], aside, [data-testid*="drawer"], [data-testid="contact-form"]');
    if (known) return known;
    // Some releases use plain divs for drawers. Require a sidebar heading and
    // an ancestor that excludes the conversation and chat list.
    const titles = [...document.querySelectorAll('h1, h2, h3, [role="heading"], header span')]
      .filter((heading) => visible(heading) && /^(contact info|new contact|edit contact|add contact)$/i.test(clean(heading.textContent)));
    for (const title of titles) {
      let parent = title.parentElement;
      while (parent && parent !== document.body && parent !== document.documentElement) {
        if (parent.matches('#main, #pane-side') || parent.querySelector('#main, #pane-side')) break;
        if (parent.contains(node)) return parent;
        parent = parent.parentElement;
      }
    }
    throw new Error('Could not identify the contact sidebar. Open the new-contact form manually, then Retry.');
  }

  function formPhone(phoneInput, root, expected) {
    const number = digits(phoneInput.value);
    const code = field(['Country code', 'Phone country code', 'Dialing code', 'Country', 'Country/Region'], root);
    if (!code) return number;
    const text = code instanceof HTMLSelectElement ? code.selectedOptions[0]?.textContent :
      code instanceof HTMLInputElement ? code.value : code.textContent;
    const prefix = text?.match(/\+(\d{1,3})\b/);
    if (!prefix || !number) return null;
    if (number === expected && number.startsWith(prefix[1])) return number;
    return prefix[1] + number;
  }

  function prepareForm(contact, first, signal) {
    if (signal.aborted) throw new Error('Contact preparation cancelled.');
    const root = paneFor(first);
    const phone = field(['Phone number', 'Phone'], root);
    if (!phone || !(phone instanceof HTMLInputElement) || formPhone(phone, root, contact.phone) !== contact.phone) {
      throw new Error('The contact form phone does not match this row. Check the phone and country code manually.');
    }
    // A drawer title can be a sibling of the form. Keep phone/name lookups in
    // the form while recognizing only the surrounding drawer's own title.
    const headingRoot = root.matches('form, [data-testid="contact-form"]')
      ? root.parentElement.closest('[role="dialog"], aside, [data-testid*="drawer"]') || root : root;
    const headings = [...headingRoot.querySelectorAll('h1, h2, h3, [role="heading"], header span')].filter(visible);
    if (field(['First name', 'Name'], headingRoot) !== first) {
      throw new Error('Could not verify this is a new-contact form. Close other contact panels, then Retry.');
    }
    if (headings.some((node) => clean(node.textContent).toLowerCase() === 'edit contact')) return 'saved';
    if (!headings.some((node) => /^(new contact|add contact|create new contact|create contact)$/i.test(clean(node.textContent)))) {
      throw new Error('Could not verify this is a new-contact form. Open New contact in WhatsApp, then Retry.');
    }
    const last = field(['Last name'], root);
    if (first.value.trim() || (last && last.value.trim())) {
      throw new Error('The contact form already has a name. Check it manually to avoid overwriting a contact.');
    }
    // Keep the complete supplied name, including non-Latin names, in First name.
    fill(first, contact.name);
    return 'prepared';
  }

  async function prepare(contact, signal) {
    const existing = field(['First name', 'Name']);
    if (existing) return prepareForm(contact, existing, signal);
    let control = action(['Edit contact', 'Add to contacts', 'Add contact']);
    if (!control) {
      const header = await waitFor(() => document.querySelector('#main header'),
        'Open WhatsApp, sign in, and wait for this recipient’s chat. Then click Retry.', signal, 45000);
      const info = [...header.querySelectorAll('[data-testid="conversation-info-header"], [data-testid="conversation-info-header-chat-title"], [data-testid="conversation-header-title"], span[title]')]
        .find(visible);
      if (!info) throw new Error('Could not find the chat contact header. Open Contact info yourself, then Retry.');
      // The chat title may be a public profile name, so it is never used as saved-status proof.
      info.click();
      control = await waitFor(() => action(['Edit contact', 'Add to contacts', 'Add contact']),
        'Could not find WhatsApp’s contact controls. Use WhatsApp in English, open Contact info, then Retry.', signal);
    }
    const pane = paneFor(control);
    if (!hasPhone(pane, contact.phone)) {
      throw new Error('The contact info phone does not match this row. Check the recipient before saving.');
    }
    if (action(['Edit contact'], pane)) return 'saved';
    control.click();
    // Some versions offer a second Create new contact choice.
    let clickedCreate = false;
    const first = await waitFor(() => {
      const input = field(['First name', 'Name']);
      if (input) return input;
      const create = action(['Create new contact', 'New contact']);
      if (create && !clickedCreate) {
        clickedCreate = true;
        create.click();
      }
      return null;
    }, 'The new-contact form was not found. Open it in WhatsApp, then Retry.', signal);
    return prepareForm(contact, first, signal);
  }
  return { prepare };
})();
