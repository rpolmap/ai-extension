// AI Web Customizer – editor page (replica + floating style box)

// ===== Settings you may want to tweak =====
const GROQ_BASE = 'https://api.groq.com/openai/v1';
const MAX_INPUT_CHARS = 20000;   // how much of the page outline is sent to the AI (raise on a paid Groq plan)
const MAX_OUTPUT_TOKENS = 3000;  // how long the AI's list of changes may be

// Best first. Used only if your key has access to them.
const PREFERRED_MODELS = [
  'llama-3.3-70b-versatile',
  'openai/gpt-oss-120b',
  'openai/gpt-oss-20b',
  'llama-3.1-8b-instant'
];
const EXCLUDE = /whisper|tts|guard|orpheus|embed|prompt-guard|compound/i;

const $ = (id) => document.getElementById(id);
const frame = $('replica');

const state = {
  id: null,
  url: '',
  base: '',
  versions: [],      // [{ prompt, html }]  index 0 = the original site
  index: 0,
  showOriginal: false,
  busy: false,
  blobUrl: null
};

// ---------------------------------------------------------------------------
// Terminal
// ---------------------------------------------------------------------------
function log(msg, type = 'normal') {
  const term = $('terminal');
  const line = document.createElement('div');
  if (type === 'err') line.className = 'log-err';
  else if (type === 'info') line.className = 'log-info';
  else if (type === 'dim') line.className = 'log-dim';
  const ts = new Date().toLocaleTimeString('en-US', { hour12: false });
  line.textContent = `[${ts}] ${msg}`;
  term.appendChild(line);
  term.scrollTop = term.scrollHeight;
}

// ---------------------------------------------------------------------------
// Editor box: open / minimize
// ---------------------------------------------------------------------------
function openPanel() { document.body.classList.remove('min'); $('prompt').focus(); }
function minimizePanel() { document.body.classList.add('min'); }
function setPill(text) { $('pillText').textContent = text; }

function setBusy(b) {
  state.busy = b;
  document.body.classList.toggle('busy', b);
  $('applyBtn').disabled = b;
  $('applyBtn').textContent = b ? 'Working…' : 'Apply Changes';
  setPill(b ? 'Working…' : 'Edit style');
  updateControls();
}

function flashPill(text) {
  setPill(text);
  setTimeout(() => { if (!state.busy) setPill('Edit style'); }, 2500);
}

function updateControls() {
  $('undoBtn').disabled = state.busy || state.index <= 0;
  $('redoBtn').disabled = state.busy || state.index >= state.versions.length - 1;
  $('origBtn').disabled = state.busy || state.index === 0;
  $('origBtn').setAttribute('aria-pressed', String(state.showOriginal));
  $('origBtn').textContent = state.showOriginal ? 'Show edited' : 'Show original';
}

function showFatal(msg) {
  $('fatalMsg').textContent = msg;
  document.body.classList.add('fatal');
}

// ---------------------------------------------------------------------------
// Replica rendering + making links / forms really work
// ---------------------------------------------------------------------------
function render() {
  const v = state.showOriginal ? state.versions[0] : state.versions[state.index];
  const url = URL.createObjectURL(new Blob([v.html], { type: 'text/html;charset=utf-8' }));
  const old = state.blobUrl;
  state.blobUrl = url;
  frame.src = url;
  if (old) setTimeout(() => URL.revokeObjectURL(old), 5000);
  updateControls();
}

const wired = new WeakSet();
frame.addEventListener('load', () => {
  let doc;
  try { doc = frame.contentDocument; } catch (e) { return; }
  if (!doc || wired.has(doc) || !doc.location || doc.location.href === 'about:blank') return;
  wired.add(doc);
  doc.addEventListener('click', onFrameClick, true);
  doc.addEventListener('submit', onFrameSubmit, true);
});

function openExternal(url) {
  log('Opening ' + url, 'dim');
  if (chrome.tabs && chrome.tabs.create) chrome.tabs.create({ url });
  else window.open(url, '_blank', 'noopener');
}

function scrollToHash(doc, raw) {
  let id = raw.slice(1);
  try { id = decodeURIComponent(id); } catch (e) { /* keep raw */ }
  if (!id || id === 'top') { doc.defaultView.scrollTo({ top: 0, behavior: 'smooth' }); return; }
  const target = doc.getElementById(id) || doc.getElementsByName(id)[0];
  if (target) target.scrollIntoView({ behavior: 'smooth' });
}

function onFrameClick(e) {
  const el = e.target && e.target.closest ? e.target.closest('a[href], [data-href]') : null;
  if (!el) return;
  const doc = el.ownerDocument;
  const raw = (el.matches('a[href]') ? el.getAttribute('href') : el.getAttribute('data-href') || '').trim();

  e.preventDefault();                       // never navigate inside the replica
  if (!raw) return;
  if (raw.startsWith('#')) { scrollToHash(doc, raw); return; }
  if (/^javascript:/i.test(raw)) return;

  let url;
  try { url = new URL(raw, doc.baseURI).href; } catch (err) { return; }
  if (!/^(https?|mailto|tel):/i.test(url)) return;
  openExternal(url);
}

function onFrameSubmit(e) {
  e.preventDefault();
  const form = e.target;
  if (!form || form.tagName !== 'FORM') return;
  const doc = form.ownerDocument;
  const sub = e.submitter || null;

  const method = ((sub && sub.getAttribute('formmethod')) || form.getAttribute('method') || 'get').toLowerCase();
  const actionAttr = ((sub && sub.getAttribute('formaction')) || form.getAttribute('action') || '').trim();

  let target;
  try { target = new URL(actionAttr, doc.baseURI); } catch (err) { return; }
  if (!/^https?:$/.test(target.protocol)) return;

  if (method === 'get') {
    let data;
    try { data = new FormData(form, sub || undefined); } catch (err) { data = new FormData(form); }
    target.search = '';
    for (const [k, v] of data) if (typeof v === 'string') target.searchParams.append(k, v);
    openExternal(target.href);
  } else {
    log("POST forms can't be sent from the replica – opened the form's page instead.", 'dim');
    openExternal(target.href);
  }
}

// ---------------------------------------------------------------------------
// Page preparation: sanitize + give every element a stable id (data-ai="N")
// ---------------------------------------------------------------------------
function tagElements(doc) {
  let max = 0;
  doc.querySelectorAll('[data-ai]').forEach((e) => {
    const n = parseInt(e.getAttribute('data-ai'), 10);
    if (n > max) max = n;
  });
  if (!doc.body) return;
  doc.body.querySelectorAll('*').forEach((el) => {
    if (el.tagName.toLowerCase() !== 'svg' && el.closest('svg')) return;   // only tag the <svg> root
    if (!el.hasAttribute('data-ai')) el.setAttribute('data-ai', String(++max));
  });
}

// "youtube.com/x" -> "https://youtube.com/x" so redirect buttons don't resolve against the original site
function fixHref(href) {
  const h = (href || '').trim();
  if (!h) return h;
  if (/^(https?:|mailto:|tel:|#|\/|\.|\?)/i.test(h)) return h;
  if (/^www\./i.test(h)) return 'https://' + h;
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)*\.(com|org|net|io|dev|app|co|ai|gov|edu|me|tv|ly|gg|xyz|info|biz|us|uk|de|fr|es|it|nl|br|ru|jp|cn|in|ca|au)(\/|$|\?|#)/i.test(h)) {
    return 'https://' + h;
  }
  return h;
}

// Removes anything executable. The editor page's CSP (script-src 'self') is a second wall.
function stripUnsafe(root) {
  root.querySelectorAll('script, iframe, frame, frameset, object, embed, applet, base, meta[http-equiv], meta[name="referrer"]').forEach((n) => n.remove());
  root.querySelectorAll('*').forEach((el) => {
    for (const a of Array.from(el.attributes)) {
      if (/^on/i.test(a.name) || /^\s*javascript:/i.test(a.value)) el.removeAttribute(a.name);
    }
  });
}

function buildFinalHtml(rawHtml, baseUrl) {
  const doc = new DOMParser().parseFromString(rawHtml, 'text/html');
  stripUnsafe(doc);

  const head = doc.head;
  const add = (tag, attrs) => {
    const el = doc.createElement(tag);
    for (const k in attrs) el.setAttribute(k, attrs[k]);
    head.insertBefore(el, head.firstChild);
  };
  if (!doc.querySelector('meta[name="viewport"]')) add('meta', { name: 'viewport', content: 'width=device-width, initial-scale=1' });
  add('meta', { name: 'referrer', content: 'no-referrer' });
  add('base', { href: baseUrl });
  add('meta', { charset: 'utf-8' });

  tagElements(doc);
  return '<!DOCTYPE html>\n' + doc.documentElement.outerHTML;
}

// ---------------------------------------------------------------------------
// Page -> compact outline for the AI (structure + ids + a few classes, no CSS)
// ---------------------------------------------------------------------------
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const DROP = new Set(['script', 'noscript', 'style', 'link', 'meta', 'title', 'base', 'template', 'iframe', 'object', 'embed', 'canvas', 'video', 'audio', 'source', 'track', 'head']);
const OUT_ATTRS = new Set(['id', 'href', 'src', 'alt', 'title', 'type', 'name', 'value', 'placeholder', 'action', 'method', 'for', 'role', 'aria-label', 'data-href']);
const EMPTY_SKIP = new Set(['div', 'span', 'section', 'article', 'aside', 'header', 'footer', 'nav', 'main', 'p', 'ul', 'ol', 'li', 'i', 'b', 'em', 'strong', 'small']);
const BLOCK = new Set(['div', 'section', 'article', 'aside', 'header', 'footer', 'nav', 'main', 'p', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'form', 'table', 'tr', 'figure', 'blockquote', 'pre']);

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
const clip = (s, n) => (s.length > n ? s.slice(0, n) + '…' : s);

function buildOutline(html, maxChars) {
  const doc = new DOMParser().parseFromString(html, 'text/html');

  const attrsOf = (el) => {
    let out = el.hasAttribute('data-ai') ? ` data-ai="${el.getAttribute('data-ai')}"` : '';
    const cls = (el.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean).slice(0, 3).join(' ');
    if (cls) out += ` class="${escAttr(cls)}"`;
    for (const a of Array.from(el.attributes)) {
      const n = a.name.toLowerCase();
      if (!OUT_ATTRS.has(n)) continue;
      const limit = (n === 'href' || n === 'data-href' || n === 'action') ? 100 : 60;
      out += ` ${n}="${escAttr(clip(a.value, limit))}"`;
    }
    return out;
  };

  const walk = (parent) => {
    let out = '';
    for (const node of Array.from(parent.childNodes)) {
      if (node.nodeType === 3) {
        const t = node.nodeValue.replace(/\s+/g, ' ');
        if (!t.trim()) {
          if (out && !/[\s>]$/.test(out)) out += ' ';
          continue;
        }
        out += esc(clip(t, 120));
        continue;
      }
      if (node.nodeType !== 1) continue;

      const tag = node.tagName.toLowerCase();
      if (DROP.has(tag) || node.hasAttribute('hidden')) continue;
      if (tag === 'svg') { out += `<svg${attrsOf(node)}></svg>`; continue; }

      const a = attrsOf(node);
      if (VOID.has(tag)) { out += `<${tag}${a}>`; continue; }

      const inner = walk(node);
      if (inner.trim() === '' && EMPTY_SKIP.has(tag)) continue;

      out += `<${tag}${a}>${inner}</${tag}>`;
      if (BLOCK.has(tag)) out += '\n';
    }
    return out;
  };

  let text = `<body${attrsOf(doc.body)}>\n${walk(doc.body).trim()}\n</body>`;
  let truncated = false;
  if (text.length > maxChars) {
    truncated = true;
    text = text.slice(0, maxChars);
    const lt = text.lastIndexOf('>');
    if (lt > 0) text = text.slice(0, lt + 1);
    text += '\n<!-- the rest of the page was cut off -->';
  }
  return { text, truncated };
}

// ---------------------------------------------------------------------------
// AI answer -> patch -> applied to the ORIGINAL page (everything else stays untouched)
// ---------------------------------------------------------------------------
function parsePatch(raw) {
  const t = (raw || '').replace(/```[a-z]*\n?/gi, '');
  const segs = t.split(/={2,}\s*(CSS|OPS)\s*={2,}/i);
  let css = '';
  let opsText = '';
  for (let i = 1; i < segs.length; i += 2) {
    if (segs[i].toUpperCase() === 'CSS') css = segs[i + 1] || '';
    else opsText = segs[i + 1] || '';
  }

  const ops = [];
  let badLines = 0;
  const trimmed = opsText.trim();
  let parsedAsArray = false;
  if (trimmed.startsWith('[')) {
    try { const arr = JSON.parse(trimmed); if (Array.isArray(arr)) { ops.push(...arr); parsedAsArray = true; } } catch (e) { /* fall back to lines */ }
  }
  if (!parsedAsArray) {
    for (const line of trimmed.split('\n')) {
      const l = line.trim().replace(/,$/, '');
      if (!l.startsWith('{')) continue;
      try { ops.push(JSON.parse(l)); } catch (e) { badLines++; }
    }
  }
  return { css: css.trim(), ops, badLines };
}

function applyPatch(html, patch) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const notes = [];
  let applied = 0;

  const byId = (n) => {
    const id = String(n === undefined || n === null ? '' : n).replace(/[^\d]/g, '');
    return id ? doc.querySelector(`[data-ai="${id}"]`) : null;
  };
  const ownText = (el) => Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.nodeValue.trim());

  const place = (anchor, where, nodes) => {
    const isVoid = VOID.has(anchor.tagName.toLowerCase());
    switch (where) {
      case 'before': anchor.before(...nodes, ' '); break;
      case 'inside-start': isVoid ? anchor.before(...nodes, ' ') : anchor.prepend(...nodes); break;
      case 'inside-end': isVoid ? anchor.after(' ', ...nodes) : anchor.append(...nodes); break;
      default: anchor.after(' ', ...nodes);
    }
  };

  const setText = (el, text) => {
    const walker = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) if (walker.currentNode.nodeValue.trim()) nodes.push(walker.currentNode);
    if (!nodes.length) { el.append(text); return; }
    nodes[0].nodeValue = text;
    nodes.slice(1).forEach((n) => { n.nodeValue = ''; });
  };

  const setLink = (el, href) => {
    const url = fixHref(String(href));
    if (el.matches('a')) el.setAttribute('href', url);
    else {
      const a = el.querySelector('a');
      if (a) a.setAttribute('href', url);
      else el.setAttribute('data-href', url);   // handled by the replica's click handler
    }
  };

  // Remove an item and tidy up so neighbours close the gap
  const removeItem = (el) => {
    const WRAP = new Set(['li', 'div', 'span', 'p']);
    const CASCADE = new Set(['li', 'ul', 'ol', 'div', 'span', 'p', 'nav']);
    let node = el;
    while (node.parentElement && WRAP.has(node.parentElement.tagName.toLowerCase()) &&
           node.parentElement.children.length === 1 && !ownText(node.parentElement)) {
      node = node.parentElement;
    }
    const parent = node.parentElement;
    const prev = node.previousSibling;
    const next = node.nextSibling;
    node.remove();

    const isSep = (n) => n && n.nodeType === 3 && /^\s*[|/•·\-–—,]\s*$/.test(n.nodeValue);
    if (isSep(next)) next.remove();
    else if (isSep(prev)) prev.remove();

    let p = parent;
    while (p && p !== doc.body && p !== doc.documentElement &&
           CASCADE.has(p.tagName.toLowerCase()) && p.children.length === 0 && !ownText(p)) {
      const up = p.parentElement;
      p.remove();
      p = up;
    }
  };

  for (const op of patch.ops) {
    try {
      const kind = String(op.op || '').toLowerCase();

      if (kind === 'remove') {
        const el = byId(op.target);
        if (!el || el === doc.body) throw new Error('target ' + op.target + ' not found');
        removeItem(el);

      } else if (kind === 'clone') {
        const src = byId(op.source !== undefined ? op.source : op.anchor);
        const anchor = byId(op.anchor !== undefined ? op.anchor : op.source);
        if (!src || !anchor) throw new Error('element ' + (op.source || op.anchor) + ' not found');
        const copy = src.cloneNode(true);
        [copy, ...copy.querySelectorAll('*')].forEach((e) => { e.removeAttribute('data-ai'); e.removeAttribute('id'); });
        if (op.text !== undefined && op.text !== null) setText(copy, String(op.text));
        if (op.href) setLink(copy, op.href);
        place(anchor, op.where, [copy]);

      } else if (kind === 'add') {
        const anchor = byId(op.anchor);
        if (!anchor) throw new Error('anchor ' + op.anchor + ' not found');
        const tpl = doc.createElement('template');
        tpl.innerHTML = String(op.html || '');
        stripUnsafe(tpl.content);
        tpl.content.querySelectorAll('a[href]').forEach((a) => a.setAttribute('href', fixHref(a.getAttribute('href'))));
        place(anchor, op.where, Array.from(tpl.content.childNodes));

      } else if (kind === 'settext') {
        const el = byId(op.target);
        if (!el) throw new Error('target ' + op.target + ' not found');
        setText(el, String(op.text));

      } else if (kind === 'setattr') {
        const el = byId(op.target);
        const name = String(op.name || '').toLowerCase();
        if (!el) throw new Error('target ' + op.target + ' not found');
        if (!name || name.startsWith('on') || name === 'srcdoc' || name === 'data-ai') throw new Error('attribute "' + name + '" not allowed');
        let val = String(op.value === undefined ? '' : op.value);
        if (/^\s*javascript:/i.test(val)) throw new Error('javascript: not allowed');
        if (name === 'href' || name === 'action' || name === 'data-href') val = fixHref(val);
        el.setAttribute(name, val);

      } else if (kind === 'move') {
        const el = byId(op.target);
        const anchor = byId(op.anchor);
        if (!el || !anchor || el.contains(anchor)) throw new Error('cannot move ' + op.target);
        place(anchor, op.where, [el]);

      } else {
        throw new Error('unknown operation "' + op.op + '"');
      }
      applied++;
    } catch (err) {
      notes.push('Skipped a change: ' + err.message);
    }
  }

  let cssApplied = false;
  if (patch.css) {
    let st = doc.getElementById('ai-overrides');
    if (!st) {
      st = doc.createElement('style');
      st.id = 'ai-overrides';
      doc.head.appendChild(st);
    }
    st.textContent += '\n' + patch.css;
    cssApplied = true;
  }

  tagElements(doc);   // give new elements their own ids for the next edit
  return { html: '<!DOCTYPE html>\n' + doc.documentElement.outerHTML, applied, cssApplied, notes };
}

// ---------------------------------------------------------------------------
// Groq
// ---------------------------------------------------------------------------
let cachedModel = null;

async function pickModel(apiKey) {
  if (cachedModel && cachedModel.key === apiKey) return cachedModel.model;
  const res = await fetch(GROQ_BASE + '/models', { headers: { Authorization: 'Bearer ' + apiKey } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data.error && data.error.message) || 'Could not list Groq models (status ' + res.status + ').');
  const ids = (data.data || []).map((m) => m.id);
  let model = PREFERRED_MODELS.find((m) => ids.includes(m));
  if (!model) model = ids.find((id) => !EXCLUDE.test(id));
  if (!model) throw new Error('No usable chat models available for this API key.');
  cachedModel = { key: apiKey, model };
  return model;
}

const SYSTEM_PROMPT = [
  'You are an expert front-end developer who makes small, surgical edits to an existing web page.',
  'You receive an outline of the page. Every element has an id like data-ai="12". The page ALREADY has its own complete design (colors, sizes, spacing, fonts, layout). Do NOT redesign it. Apply ONLY what the user asks and leave everything else exactly as it is.',
  '',
  'Answer in exactly this format and nothing else (no explanations, no markdown fences):',
  '===CSS===',
  '(CSS override rules, only for what the user asked to restyle. Leave empty if there is nothing to restyle.)',
  '===OPS===',
  '(one JSON object per line. Leave empty if there is nothing to add, remove or change.)',
  '',
  'CSS RULES',
  '- Select with [data-ai="N"] (comma-separate several) or with classes / ids / tag names that appear in the outline. Never invent class names.',
  '- Put !important on every declaration.',
  '- Touch only what the user mentioned. Never restyle anything else. Never hide things with display:none: use the remove operation instead.',
  '- For "all buttons" style the tag/classes those buttons really use (or list their data-ai selectors).',
  '',
  'OPERATIONS (N is a data-ai number)',
  '{"op":"remove","target":N}',
  '{"op":"clone","source":N,"anchor":N,"where":"after","text":"Label","href":"https://example.com"}   (new button/link/menu item that looks exactly like existing element N)',
  '{"op":"add","anchor":N,"where":"after","html":"<a href=\\"https://example.com\\">Label</a>"}   (only when there is nothing similar to clone)',
  '{"op":"setText","target":N,"text":"New text"}',
  '{"op":"setAttr","target":N,"name":"href","value":"https://example.com"}',
  '{"op":"move","target":N,"anchor":N,"where":"before"}',
  'where is one of: before, after, inside-start, inside-end.',
  '',
  'OPERATION RULES',
  '- To add a button, link or menu item, ALWAYS prefer "clone" of the most similar existing element so it automatically gets the same size, colors and font. Put it next to its siblings with anchor + where. Do not restyle the clone unless the user asked.',
  '- To remove something, target the outermost element that exists only for that item (for example the <li> or wrapper <div> around a button), so the neighbours close the gap. Remove only what the user named.',
  '- Redirects: href must be a full absolute URL starting with https:// (a plain site name like "youtube" becomes https://www.youtube.com). To jump to a section of this same page use "#id" of an element that has an id attribute.',
  '- Keep every other button, link and form untouched. No JavaScript, no onclick, no <script>.'
].join('\n');

async function generatePage({ apiKey, promptText, outline, url }) {
  const model = await pickModel(apiKey);
  let scale = 1;

  for (let attempt = 0; attempt < 3; attempt++) {
    const input = scale < 1 ? outline.slice(0, Math.floor(outline.length * scale)) : outline;
    const userMessage =
      'Page URL: ' + (url || 'unknown') + '\n' +
      'User request: ' + promptText + '\n\n' +
      'Page outline:\n' + input;

    const response = await fetch(GROQ_BASE + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userMessage }
        ],
        temperature: 0.2,
        max_completion_tokens: Math.floor(MAX_OUTPUT_TOKENS * scale)
      })
    });

    let data;
    try { data = await response.json(); }
    catch (e) { throw new Error('Groq returned a non-JSON response (status ' + response.status + ').'); }

    if (response.status === 413 && attempt < 2) {
      scale *= 0.6;
      log('Request too large for your Groq limits – retrying with a smaller page…', 'dim');
      continue;
    }
    if (!response.ok) {
      throw new Error('[' + model + '] ' + ((data.error && data.error.message) || 'request failed with status ' + response.status));
    }

    const choice = data.choices && data.choices[0];
    return { raw: (choice && choice.message && choice.message.content) || '', model, cut: !!(choice && choice.finish_reason === 'length') };
  }
  throw new Error('Request too large for your Groq limits.');
}

// ---------------------------------------------------------------------------
// Apply / undo / redo / persistence
// ---------------------------------------------------------------------------
function persist() {
  chrome.storage.local.set({
    [state.id + '_edits']: {
      index: state.index,
      edits: state.versions.slice(1).map((v) => ({ prompt: v.prompt, html: v.html }))
    }
  });
}

async function applyChanges() {
  if (state.busy) return;
  const apiKey = $('apiKey').value.trim();
  const promptText = $('prompt').value.trim();

  if (!apiKey || !promptText) {
    log('ERROR: Key and prompt required.', 'err');
    return;
  }
  chrome.storage.local.set({ groq_key: apiKey });
  setBusy(true);
  let ok = false;

  try {
    const current = state.versions[state.index];

    log('Step 1: Reading the page structure, buttons and links...', 'info');
    const { text, truncated } = buildOutline(current.html, MAX_INPUT_CHARS);
    log(`Sent ${text.length.toLocaleString()} characters of the page outline to the AI.`, 'dim');
    if (truncated) log('This page is large: only the first part could be sent. Raise MAX_INPUT_CHARS in app.js if your Groq plan allows it.', 'dim');

    log('Step 2 & 3: Asking the AI for the changes...', 'info');
    const { raw, model, cut } = await generatePage({ apiKey, promptText, outline: text, url: state.url });

    const patch = parsePatch(raw);
    if (!patch.css && !patch.ops.length) throw new Error('[' + model + '] returned no changes. Try describing the change more specifically.');
    if (cut) log('The AI hit its length limit, so some changes may be missing. Raise MAX_OUTPUT_TOKENS in app.js if your plan allows it.', 'dim');
    if (patch.badLines) log(patch.badLines + ' change line(s) from the AI were unreadable and ignored.', 'dim');

    const result = applyPatch(current.html, patch);
    result.notes.forEach((n) => log(n, 'dim'));
    if (!result.applied && !result.cssApplied) throw new Error('None of the AI\'s changes could be applied. Try rephrasing your request.');
    log(`Applied ${result.applied} page change(s)${result.cssApplied ? ' + style changes' : ''}.`, 'dim');

    // New edit: drop any redo history after the current position
    state.versions = state.versions.slice(0, state.index + 1);
    state.versions.push({ prompt: promptText, html: result.html });
    state.index = state.versions.length - 1;
    state.showOriginal = false;

    log('Showing the new version in the replica...', 'dim');
    render();
    persist();
    log('SUCCESS: Changes applied!', 'info');

    minimizePanel();            // the tab stays open; the box just folds away
    ok = true;
  } catch (err) {
    log('Error: ' + err.message, 'err');
    openPanel();
  } finally {
    setBusy(false);
    if (ok) flashPill('✓ Applied');
  }
}

function goTo(index) {
  state.index = index;
  state.showOriginal = false;
  render();
  persist();
  log('Now showing: ' + (index === 0 ? 'original site' : '"' + state.versions[index].prompt + '"'), 'dim');
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
(async function init() {
  const id = new URLSearchParams(location.search).get('id');
  const [recObj, savedObj, keyObj] = await Promise.all([
    id ? chrome.storage.local.get(id) : Promise.resolve({}),
    id ? chrome.storage.local.get(id + '_edits') : Promise.resolve({}),
    chrome.storage.local.get('groq_key')
  ]);
  const rec = id ? recObj[id] : null;

  if (keyObj && keyObj.groq_key) $('apiKey').value = keyObj.groq_key;

  $('minBtn').addEventListener('click', minimizePanel);
  $('pill').addEventListener('click', openPanel);
  $('applyBtn').addEventListener('click', applyChanges);
  $('undoBtn').addEventListener('click', () => { if (state.index > 0) goTo(state.index - 1); });
  $('redoBtn').addEventListener('click', () => { if (state.index < state.versions.length - 1) goTo(state.index + 1); });
  $('origBtn').addEventListener('click', () => { state.showOriginal = !state.showOriginal; render(); });
  $('prompt').addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') applyChanges();
  });

  if (!rec) { showFatal('This replica is no longer available. Click the extension icon on a website to open a new one.'); return; }
  if (rec.error) { showFatal(rec.error); return; }

  state.id = id;
  state.url = rec.url;
  state.base = rec.baseUrl || rec.url;

  let host = rec.url;
  try { host = new URL(rec.url).hostname; } catch (e) { /* keep url */ }
  document.title = 'AI Web Customizer – ' + (rec.title || host);

  const original = buildFinalHtml(rec.html, state.base);
  state.versions = [{ prompt: 'Original', html: original }];

  const saved = savedObj && savedObj[id + '_edits'];
  if (saved && Array.isArray(saved.edits)) {
    saved.edits.forEach((e) => state.versions.push({ prompt: e.prompt, html: e.html }));
    state.index = Math.min(Math.max(saved.index || 0, 0), state.versions.length - 1);
  }

  render();
  log('Replica of ' + host + ' is ready.', 'info');
  openPanel();
})();
