const tags = new Set(['p', 'div', 'br', 'b', 'strong', 'i', 'em', 'ul', 'ol', 'li', 'a']);
const omitted = new Set(['script', 'style', 'template', 'iframe', 'object', 'embed', 'noscript']);
const blocks = new Set(['p', 'div', 'br', 'li', 'ul', 'ol']);

export function safeLink(value) {
  try {
    const url = new URL(value.trim());
    return ['https:', 'http:', 'mailto:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

export function cleanDescription(html) {
  const template = document.createElement('template');
  template.innerHTML = html;
  const output = document.createElement('div');

  function copy(node, parent) {
    if (node.nodeType === Node.TEXT_NODE) {
      parent.append(node.data);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE || node.namespaceURI !== 'http://www.w3.org/1999/xhtml') return;
    const tag = node.localName;
    if (omitted.has(tag)) return;

    const href = tag === 'a' ? safeLink(node.getAttribute('href') ?? '') : null;
    let target = parent;
    if (tags.has(tag) && (tag !== 'a' || href)) {
      target = document.createElement(tag);
      if (href) {
        target.href = href;
        target.target = '_blank';
        target.rel = 'noopener noreferrer';
      }
      if (tag === 'ul' && node.hasAttribute('data-checklist')) target.dataset.checklist = '';
      if (tag === 'li' && parent.hasAttribute('data-checklist')) {
        target.dataset.checked = String(node.dataset.checked === 'true');
      }
      parent.append(target);
    }
    if (tag === 'span') {
      const marks = [];
      if (node.style.fontWeight === 'bold' || Number(node.style.fontWeight) >= 600) marks.push('strong');
      if (node.style.fontStyle === 'italic') marks.push('em');
      for (const mark of marks) {
        const wrapper = document.createElement(mark);
        target.append(wrapper);
        target = wrapper;
      }
    }
    for (const child of node.childNodes) copy(child, target);
  }

  for (const node of template.content.childNodes) copy(node, output);
  const textOf = node => {
    if (node.nodeType === Node.TEXT_NODE) return node.data;
    const text = Array.from(node.childNodes, textOf).join('');
    return blocks.has(node.localName) ? '\n' + text + '\n' : text;
  };
  const text = textOf(output).trim();
  return { html: text ? output.innerHTML : '', text };
}

export function descriptionHtml(task) {
  if (task.description !== undefined) return cleanDescription(task.description).html;
  const node = document.createElement('div');
  node.textContent = task.notes;
  return node.innerHTML.replace(/\r\n?|\n/g, '<br>');
}

export function mountDescription(field, toolbar, changed) {
  let selection;
  const remember = () => {
    const current = window.getSelection();
    if (current.rangeCount && field.contains(current.getRangeAt(0).commonAncestorContainer)) {
      selection = current.getRangeAt(0).cloneRange();
    }
  };
  const restore = () => {
    const current = window.getSelection();
    if (document.activeElement === field && current.rangeCount &&
        field.contains(current.getRangeAt(0).commonAncestorContainer)) return;
    field.focus();
    if (!selection || !field.contains(selection.commonAncestorContainer)) {
      selection = document.createRange();
      selection.selectNodeContents(field);
      selection.collapse(false);
    }
    current.removeAllRanges();
    current.addRange(selection);
  };
  for (const type of ['keyup', 'pointerup', 'focusout', 'input']) field.addEventListener(type, remember);
  toolbar.addEventListener('pointerdown', remember);
  toolbar.addEventListener('mousedown', event => event.preventDefault());

  toolbar.addEventListener('click', event => {
    const command = event.target.closest('button')?.dataset.format;
    if (!command) return;
    remember();
    if (command === 'link') {
      const entry = window.prompt('Enter a link URL (https://, http://, or mailto:)');
      if (!entry) return;
      const href = safeLink(entry);
      if (!href) {
        window.alert('Enter a valid web or email link.');
        return;
      }
      restore();
      if (window.getSelection().isCollapsed) {
        const link = document.createElement('a');
        link.href = href;
        link.textContent = entry.trim();
        document.execCommand('insertHTML', false, link.outerHTML);
      } else {
        document.execCommand('createLink', false, href);
      }
    } else {
      restore();
      const listItem = () => {
        const anchor = window.getSelection().anchorNode;
        return (anchor?.nodeType === Node.ELEMENT_NODE ? anchor : anchor?.parentElement)?.closest('li');
      };
      if (command === 'checklist') {
        if (listItem()?.parentElement.localName !== 'ul') document.execCommand('insertUnorderedList');
        const list = listItem()?.parentElement;
        if (list?.localName === 'ul') list.toggleAttribute('data-checklist');
      } else if (command === 'checked') {
        const item = listItem();
        if (item?.parentElement.hasAttribute('data-checklist')) item.dataset.checked = String(item.dataset.checked !== 'true');
      } else {
        if (command === 'bold' || command === 'italic') document.execCommand('styleWithCSS', false, false);
        document.execCommand(command);
      }
    }
    remember();
    changed();
  });
  field.addEventListener('click', event => {
    if (event.target.closest('a')) event.preventDefault();
  });
  field.addEventListener('drop', event => event.preventDefault());
  field.addEventListener('paste', event => {
    event.preventDefault();
    const html = event.clipboardData?.getData('text/html');
    const text = event.clipboardData?.getData('text/plain') ?? '';
    const cleaned = html ? cleanDescription(html).html : '';
    if (cleaned) document.execCommand('insertHTML', false, cleaned);
    else if (text) document.execCommand('insertText', false, text);
    changed();
  });
}
