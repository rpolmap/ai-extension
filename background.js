// AI Web Customizer – background service worker
// Clicking the toolbar icon snapshots the current tab and opens it in a full-page editor (app.html).

const APP_PAGE = 'app.html';
const SESSION_MAX_AGE = 24 * 60 * 60 * 1000;

chrome.action.onClicked.addListener(async (tab) => {
  // Clicked while already inside the editor: nothing to capture.
  if (tab && tab.url && tab.url.startsWith(chrome.runtime.getURL(APP_PAGE))) return;

  const id = 'session_' + Date.now();
  let record;

  try {
    if (!tab || !tab.id) throw new Error('No active tab found.');
    const [res] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: captureReplica
    });
    if (!res || !res.result) throw new Error('The page returned no content.');
    record = res.result;
  } catch (err) {
    record = { error: friendlyError(err) };
  }

  await cleanOldSessions();
  await chrome.storage.local.set({ [id]: record });

  const props = { url: chrome.runtime.getURL(APP_PAGE + '?id=' + id) };
  if (tab && typeof tab.index === 'number') {
    props.index = tab.index + 1;
    props.openerTabId = tab.id;
  }
  chrome.tabs.create(props);
});

function friendlyError(err) {
  const msg = (err && err.message) || String(err);
  if (/cannot access|chrome:\/\/|extensions gallery|chrome web store|showing error page/i.test(msg)) {
    return "Chrome doesn't let extensions read this page (chrome:// pages, the Web Store and some built-in pages are blocked). Open a normal website and click the icon again.";
  }
  return 'Could not read this page: ' + msg;
}

async function cleanOldSessions() {
  try {
    const keys = chrome.storage.local.getKeys
      ? await chrome.storage.local.getKeys()
      : Object.keys(await chrome.storage.local.get(null));
    const stale = keys.filter((k) => {
      const m = k.match(/^session_(\d+)/);
      return m && Date.now() - Number(m[1]) > SESSION_MAX_AGE;
    });
    if (stale.length) await chrome.storage.local.remove(stale);
  } catch (e) { /* cleanup is best-effort */ }
}

// ---------------------------------------------------------------------------
// Runs INSIDE the website tab. Must be fully self-contained (no outside refs).
// Returns a static, script-free copy of the page that can be shown in an iframe.
// ---------------------------------------------------------------------------
function captureReplica() {
  const doc = document;
  const baseUrl = doc.baseURI;
  const abs = (u) => { try { return new URL(u, baseUrl).href; } catch (e) { return u; } };

  const clone = doc.documentElement.cloneNode(true);

  // Pair live <-> cloned nodes BEFORE removing anything so indexes line up.
  const liveImgs = doc.querySelectorAll('img');
  const cloneImgs = clone.querySelectorAll('img');
  const liveStyles = doc.querySelectorAll('style');
  const cloneStyles = clone.querySelectorAll('style');

  // Images: use the file the browser actually loaded (handles srcset / lazy loading).
  liveImgs.forEach((live, i) => {
    const c = cloneImgs[i];
    if (!c) return;
    let src = live.currentSrc || live.getAttribute('src') || '';
    const lazy = c.getAttribute('data-src') || c.getAttribute('data-lazy-src') || c.getAttribute('data-original');
    if (lazy && (!live.complete || live.naturalWidth <= 2)) src = lazy;
    if (src) c.setAttribute('src', abs(src));
    ['srcset', 'sizes', 'loading'].forEach((a) => c.removeAttribute(a));
  });

  // <style> tags filled by CSS-in-JS (insertRule) are empty in the markup: read them from the CSSOM.
  liveStyles.forEach((live, i) => {
    try {
      const rules = live.sheet && live.sheet.cssRules;
      if (rules && rules.length && cloneStyles[i]) {
        cloneStyles[i].textContent = Array.from(rules, (r) => r.cssText).join('\n');
      }
    } catch (e) { /* keep original text */ }
  });

  let adopted = '';
  try {
    (doc.adoptedStyleSheets || []).forEach((sh) => {
      adopted += Array.from(sh.cssRules, (r) => r.cssText).join('\n') + '\n';
    });
  } catch (e) { /* ignore */ }

  // Remove everything that executes, embeds, or would break the replica.
  clone.querySelectorAll(
    'script, noscript, iframe, frame, frameset, object, embed, applet, video, audio, canvas, template, ' +
    'picture source, base, meta[http-equiv], ' +
    'link[rel~="preload"], link[rel~="modulepreload"], link[rel~="prefetch"], link[rel~="preconnect"], link[rel~="dns-prefetch"]'
  ).forEach((n) => n.remove());

  clone.querySelectorAll('*').forEach((el) => {
    for (const attr of Array.from(el.attributes)) {
      if (/^on/i.test(attr.name) || /^\s*javascript:/i.test(attr.value)) el.removeAttribute(attr.name);
    }
    el.removeAttribute('integrity');
    el.removeAttribute('crossorigin');
    el.removeAttribute('nonce');
  });

  // Make every URL absolute so links, forms and stylesheets keep working outside the site.
  clone.querySelectorAll('a[href], area[href], link[href]').forEach((el) => {
    const h = (el.getAttribute('href') || '').trim();
    if (h && !h.startsWith('#')) el.setAttribute('href', abs(h));
  });
  clone.querySelectorAll('form[action]').forEach((f) => {
    f.setAttribute('action', abs(f.getAttribute('action')));
  });

  let head = clone.querySelector('head');
  if (!head) {
    head = doc.createElement('head');
    clone.insertBefore(head, clone.firstChild);
  }
  if (adopted.trim()) {
    const s = doc.createElement('style');
    s.textContent = adopted;
    head.appendChild(s);
  }
  const base = doc.createElement('base');
  base.setAttribute('href', baseUrl);
  const charset = doc.createElement('meta');
  charset.setAttribute('charset', 'utf-8');
  head.insertBefore(base, head.firstChild);
  head.insertBefore(charset, head.firstChild);

  return {
    url: location.href,
    baseUrl: baseUrl,
    title: doc.title || location.hostname,
    html: '<!DOCTYPE html>\n' + clone.outerHTML
  };
}
