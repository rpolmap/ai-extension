// AI Web Customizer – editor page (replica + floating style box)

// ===== Settings you may want to tweak =====
const GROQ_BASE = 'https://api.groq.com/openai/v1';
const MAX_INPUT_CHARS = 16000;   // how much of the page is sent to the AI (raise on a paid Groq plan)
const MAX_OUTPUT_TOKENS = 5000;  // how long the rebuilt page may be (raise on a paid Groq plan)

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
// Page -> compact text for the AI
// ---------------------------------------------------------------------------
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const DROP = new Set(['script', 'noscript', 'style', 'link', 'meta', 'title', 'base', 'template', 'iframe', 'object', 'embed', 'canvas', 'video', 'audio', 'source', 'track', 'head']);
const KEEP_ATTRS = new Set(['id', 'href', 'src', 'alt', 'title', 'type', 'name', 'value', 'placeholder', 'action', 'method', 'for', 'role', 'aria-label', 'colspan', 'rowspan', 'checked', 'selected', 'disabled', 'required', 'data-href', 'formaction', 'min', 'max', 'rows', 'cols', 'maxlength']);
const EMPTY_SKIP = new Set(['div', 'span', 'section', 'article', 'aside', 'header', 'footer', 'nav', 'main', 'p', 'ul', 'ol', 'li', 'i', 'b', 'em', 'strong', 'small']);
const BLOCK = new Set(['div', 'section', 'article', 'aside', 'header', 'footer', 'nav', 'main', 'p', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'form', 'table', 'tr', 'figure', 'blockquote', 'pre']);

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

// keepStyle=false -> unstyled structure (original site). keepStyle=true -> full current page incl. CSS.
// Long data-URIs, long values and inline <svg> icons are swapped for [[DATA:n]] / [[SVG:n]] tokens
// so they don't eat the token budget; restoreAssets() puts them back afterwards.
function buildOutline(html, { keepStyle, maxChars }) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const assets = { svg: {}, data: {} };
  let svgCount = 0;
  let dataCount = 0;

  const tokenizeData = (str) => str.replace(/data:[^\s"')]{80,}/gi, (m) => {
    assets.data[++dataCount] = m;
    return `[[DATA:${dataCount}]]`;
  });

  const attrsOf = (el) => {
    let out = '';
    for (const a of Array.from(el.attributes)) {
      const n = a.name.toLowerCase();
      const isStyleAttr = n === 'class' || n === 'style';
      if (!KEEP_ATTRS.has(n) && !(keepStyle && isStyleAttr)) continue;
      let v = a.value;
      if (!isStyleAttr && (/^data:/i.test(v) || v.length > 300)) {
        assets.data[++dataCount] = v;
        v = `[[DATA:${dataCount}]]`;
      } else {
        v = tokenizeData(v);
      }
      out += ` ${n}="${escAttr(v)}"`;
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
        out += esc(t.length > 700 ? t.slice(0, 700) + '…' : t);
        continue;
      }
      if (node.nodeType !== 1) continue;

      const tag = node.tagName.toLowerCase();
      if (tag === 'svg') {
        const s = node.outerHTML;
        if (s.length <= 6000) {
          assets.svg[++svgCount] = s;
          out += `[[SVG:${svgCount}]]`;
        }
        continue;
      }
      if (DROP.has(tag) || node.hasAttribute('hidden')) continue;

      const a = attrsOf(node);
      if (VOID.has(tag)) { out += `<${tag}${a}>`; continue; }

      const inner = walk(node);
      if (inner.trim() === '' && EMPTY_SKIP.has(tag) && (!keepStyle || a === '')) continue;

      // Plain wrapper with a single child: drop the wrapper to save tokens
      const onlyChild = node.children.length === 1 &&
        !Array.from(node.childNodes).some((n) => n.nodeType === 3 && n.nodeValue.trim());
      if ((tag === 'div' || tag === 'span') && a === '' && onlyChild) { out += inner; continue; }

      out += `<${tag}${a}>${inner}</${tag}>`;
      if (BLOCK.has(tag)) out += '\n';
    }
    return out;
  };

  let head = `<meta charset="utf-8">\n<title>${esc(doc.title || '')}</title>\n`;
  if (keepStyle) {
    doc.querySelectorAll('style').forEach((s) => { head += `<style>${tokenizeData(s.textContent)}</style>\n`; });
    doc.querySelectorAll('link[rel~="stylesheet"]').forEach((l) => {
      const h = l.getAttribute('href');
      if (h) head += `<link rel="stylesheet" href="${escAttr(tokenizeData(h))}">\n`;
    });
  }
  const bodyAttrs = keepStyle ? attrsOf(doc.body) : '';
  let text = `<!DOCTYPE html>\n<html>\n<head>\n${head}</head>\n<body${bodyAttrs}>\n${walk(doc.body).trim()}\n</body>\n</html>`;

  let truncated = false;
  if (text.length > maxChars) {
    truncated = true;
    text = text.slice(0, maxChars);
    const lt = text.lastIndexOf('>');
    if (lt > 0) text = text.slice(0, lt + 1);
    text += '\n<!-- the rest of the page was cut off -->';
  }
  return { text, assets, truncated };
}

// ---------------------------------------------------------------------------
// AI output -> safe, working HTML document
// ---------------------------------------------------------------------------
function extractHtml(raw) {
  let t = (raw || '').trim();
  const fenced = t.match(/```(?:html)?\s*([\s\S]*?)(?:```|$)/i);
  if (fenced) t = fenced[1];
  const start = t.search(/<!doctype|<html|<head|<body|<style/i);
  if (start === -1) return '';
  t = t.slice(start);
  const end = t.toLowerCase().lastIndexOf('</html>');
  if (end !== -1) t = t.slice(0, end + 7);
  return t.trim();
}

function restoreAssets(doc, assets) {
  const fill = (s) => s.replace(/\[\[DATA:(\d+)\]\]/g, (m, n) => (assets.data[n] !== undefined ? assets.data[n] : ''));

  const walker = doc.createTreeWalker(doc.documentElement, NodeFilter.SHOW_TEXT);
  const texts = [];
  while (walker.nextNode()) texts.push(walker.currentNode);

  for (const t of texts) {
    const parentName = t.parentNode ? t.parentNode.nodeName : '';
    if (parentName === 'STYLE') { t.nodeValue = fill(t.nodeValue); continue; }
    if (!/\[\[(?:SVG|DATA):\d+\]\]/.test(t.nodeValue)) continue;

    const frag = doc.createDocumentFragment();
    for (const part of t.nodeValue.replace(/\[\[DATA:\d+\]\]/g, '').split(/(\[\[SVG:\d+\]\])/)) {
      const m = part.match(/^\[\[SVG:(\d+)\]\]$/);
      if (m) {
        if (assets.svg[m[1]]) {
          const tpl = doc.createElement('template');
          tpl.innerHTML = assets.svg[m[1]];
          frag.appendChild(tpl.content);
        }
      } else if (part) {
        frag.appendChild(doc.createTextNode(part));
      }
    }
    t.parentNode.replaceChild(frag, t);
  }

  doc.querySelectorAll('*').forEach((el) => {
    for (const a of Array.from(el.attributes)) {
      if (a.value.includes('[[DATA:')) el.setAttribute(a.name, fill(a.value));
    }
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

// Parse -> restore icons/images -> strip anything executable -> fix links -> add <base>.
// The editor page's CSP (script-src 'self') is a second wall: nothing inline can run in the replica anyway.
function buildFinalHtml(rawHtml, { assets, baseUrl, fixLinks }) {
  const doc = new DOMParser().parseFromString(rawHtml, 'text/html');
  if (assets) restoreAssets(doc, assets);

  doc.querySelectorAll('script, iframe, frame, frameset, object, embed, applet, base, meta[http-equiv], meta[name="referrer"]').forEach((n) => n.remove());
  doc.querySelectorAll('*').forEach((el) => {
    for (const a of Array.from(el.attributes)) {
      if (/^on/i.test(a.name) || /^\s*javascript:/i.test(a.value)) el.removeAttribute(a.name);
    }
  });

  if (fixLinks) {
    doc.querySelectorAll('a[href]').forEach((a) => a.setAttribute('href', fixHref(a.getAttribute('href'))));
    doc.querySelectorAll('[data-href]').forEach((el) => el.setAttribute('data-href', fixHref(el.getAttribute('data-href'))));
    doc.querySelectorAll('form[action]').forEach((f) => f.setAttribute('action', fixHref(f.getAttribute('action'))));
  }

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

  return '<!DOCTYPE html>\n' + doc.documentElement.outerHTML;
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
  'You are a senior front-end developer who rebuilds web pages.',
  'You receive a web page (either an unstyled structure outline, or the current version of an already redesigned page) and a change request from the user.',
  'Reply with ONE complete, self-contained HTML document that replaces the page.',
  '',
  'RULES',
  '1. Write ALL the CSS from scratch inside a single <style> in <head>. No CSS frameworks. You may link Google Fonts.',
  '2. Keep EVERY link, button, form, input, select and textarea from the input: same visible text and same href / action / type / name / id / placeholder / value. Restyle them to match the new design. Only remove or rename one if the user explicitly asks.',
  '3. If the user asks for a new button, link or menu item, add it. If they say where it goes, use <a href="https://full-url">Label</a> styled as a button, always with a full absolute URL starting with https:// (for a plain site name like "youtube" use https://www.youtube.com). For a section of this same page use href="#id" and give that section a matching id. Use <button> only for things that do not navigate. Never use javascript:, onclick or <script>.',
  '4. Keep all text and all images (same src) unless the user asks to change them. Tokens like [[SVG:3]] and [[DATA:2]] stand for icons and long image data: leave them exactly where they are (or drop them together with the element they belong to).',
  '5. If the input already contains a <style>, it is an already redesigned page: apply ONLY what the user asks and keep everything else identical.',
  '6. If the input is an unstyled outline, create a polished, modern, responsive design that follows the request (colors, theme, mood). If the user gave no style details, choose a clean modern look.',
  '7. No JavaScript, no comments, no explanations, no markdown fences. Output only the HTML, starting with <!DOCTYPE html>.'
].join('\n');

async function generatePage({ apiKey, promptText, outline, url, isEdited }) {
  const model = await pickModel(apiKey);
  let scale = 1;

  for (let attempt = 0; attempt < 3; attempt++) {
    const input = scale < 1 ? outline.slice(0, Math.floor(outline.length * scale)) : outline;
    const userMessage =
      'Page URL: ' + (url || 'unknown') + '\n' +
      'Current page: ' + (isEdited ? 'an already redesigned page (keep everything the request does not mention)' : 'unstyled page structure (design everything from scratch)') + '\n' +
      'User request: ' + promptText + '\n\n' + input;

    const response = await fetch(GROQ_BASE + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userMessage }
        ],
        temperature: 0.3,
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
    const isEdited = state.index > 0;

    log('Step 1: Reading the page structure, buttons and links...', 'info');
    const { text, assets, truncated } = buildOutline(current.html, { keepStyle: isEdited, maxChars: MAX_INPUT_CHARS });
    log(`Sent ${text.length.toLocaleString()} characters of the ${isEdited ? 'current page' : 'page structure'} to the AI.`, 'dim');
    if (truncated) log('This page is large: only the first part could be sent. Raise MAX_INPUT_CHARS in app.js if your Groq plan allows it.', 'dim');

    log('Step 2 & 3: Rebuilding HTML and CSS from scratch...', 'info');
    const { raw, model, cut } = await generatePage({ apiKey, promptText, outline: text, url: state.url, isEdited });

    const html = extractHtml(raw);
    if (!html) throw new Error('[' + model + '] returned no usable HTML.');
    if (cut) log('The AI hit its length limit, so the bottom of the page may be missing. Raise MAX_OUTPUT_TOKENS in app.js if your plan allows it.', 'dim');

    const finalHtml = buildFinalHtml(html, { assets, baseUrl: state.base, fixLinks: true });
    const check = new DOMParser().parseFromString(finalHtml, 'text/html');
    if (!check.body || (!check.body.textContent.trim() && !check.body.querySelector('img, svg, input, button'))) {
      throw new Error('[' + model + '] returned an empty page.');
    }

    // New edit: drop any redo history after the current position
    state.versions = state.versions.slice(0, state.index + 1);
    state.versions.push({ prompt: promptText, html: finalHtml });
    state.index = state.versions.length - 1;
    state.showOriginal = false;

    log('Showing the new version in the replica...', 'dim');
    render();
    persist();
    log('SUCCESS: Page rebuilt!', 'info');

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

  const original = buildFinalHtml(rec.html, { assets: null, baseUrl: state.base, fixLinks: false });
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
