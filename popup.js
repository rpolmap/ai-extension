function logToTerminal(msg, type = 'normal') {
  const term = document.getElementById('terminal');
  if (!term) return;
  const line = document.createElement('div');
  
  if (type === 'err') line.className = 'log-err';
  else if (type === 'info') line.className = 'log-info';
  else if (type === 'dim') line.className = 'log-dim';
  
  const timestamp = new Date().toLocaleTimeString('en-US', { hour12: false });
  line.textContent = `[${timestamp}] ${msg}`;
  term.appendChild(line);
  term.scrollTop = term.scrollHeight;
}

// Deep page inspector executed inside the target tab
function inspectPageStructure() {
  const dump = [];
  
  // 1. Scrape all interactive components, forms, and buttons
  const elements = document.querySelectorAll('button, input, select, textarea, a, form, [onclick], [role="button"]');
  dump.push(`=== INTERACTIVE ELEMENTS (${elements.length}) ===`);
  elements.forEach((el, idx) => {
    let desc = `${el.tagName.toLowerCase()}`;
    if (el.id) desc += `#${el.id}`;
    if (el.className && typeof el.className === 'string') desc += `.${el.className.trim().replace(/\s+/g, '.')}`;
    const text = (el.innerText || el.placeholder || '').trim().replace(/\s+/g, ' ').slice(0, 30);
    if (text) desc += ` "${text}"`;
    dump.push(`[${idx}] ${desc}`);
  });

  // 2. Extract DOM outline structure
  dump.push('\n=== DOM HIERARCHY ===');
  function walk(node, depth = 0) {
    if (depth > 4) return;
    for (const child of node.children) {
      if (['SCRIPT', 'STYLE', 'SVG', 'PATH', 'NOSCRIPT'].includes(child.tagName)) continue;
      let label = child.tagName.toLowerCase();
      if (child.id) label += `#${child.id}`;
      if (child.className && typeof child.className === 'string') {
        const cls = child.className.trim().split(/\s+/).slice(0, 2).join('.');
        if (cls) label += `.${cls}`;
      }
      dump.push('  '.repeat(depth) + label);
      walk(child, depth + 1);
    }
  }
  if (document.body) walk(document.body, 0);

  return {
    url: location.href,
    dump: dump.join('\n')
  };
}

document.addEventListener('DOMContentLoaded', () => {
  chrome.storage.local.get(['groq_key'], (res) => {
    if (res?.groq_key) {
      document.getElementById('apiKey').value = res.groq_key;
    }
  });

  const applyBtn = document.getElementById('applyBtn');
  if (!applyBtn) return;

  applyBtn.addEventListener('click', async () => {
    const apiKey = document.getElementById('apiKey').value.trim();
    const promptText = document.getElementById('prompt').value.trim();

    if (!apiKey || !promptText) {
      logToTerminal("ERROR: Key and prompt required.", "err");
      return;
    }

    chrome.storage.local.set({ groq_key: apiKey });
    
    logToTerminal("Step 1: Inspecting DOM, buttons, scripts...", "info");

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) throw new Error("No active tab found");

      // Step 1: Scrape DOM and buttons
      const [execution] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: inspectPageStructure
      });

      const pageData = execution?.result;
      if (!pageData) throw new Error("Failed to scan page components.");

      logToTerminal(`Scanned page. Sent structure dump to AI.`, "dim");
      logToTerminal("Step 2 & 3: Generating styled CSS...", "info");

      // Send structure dump to AI
      chrome.runtime.sendMessage({
        action: "generateStyles",
        apiKey,
        promptText,
        fullDomDump: pageData.dump,
        url: pageData.url
      }, async (response) => {
        if (chrome.runtime.lastError) {
          logToTerminal("Runtime Error: " + chrome.runtime.lastError.message, "err");
          return;
        }

        if (!response || !response.success) {
          logToTerminal("API Error: " + (response?.error || "Unknown response"), "err");
          return;
        }

        logToTerminal("Injecting custom styles into page...", "dim");

        try {
          // Remove CSS applied by a previous run on this tab
          const key = 'applied_css_' + tab.id;
          const prev = (await chrome.storage.session.get(key))[key];
          if (prev) {
            await chrome.scripting.removeCSS({
              target: { tabId: tab.id },
              css: prev,
              origin: 'USER'
            }).catch(() => {});
          }

          await chrome.scripting.insertCSS({
            target: { tabId: tab.id },
            css: response.css,
            origin: 'USER'
          });
          await chrome.storage.session.set({ [key]: response.css });
        } catch (e) {
          logToTerminal("Inject Error: " + e.message, "err");
          return;
        }

        logToTerminal("SUCCESS: Styles applied!", "info");

        // Close extension popup after completion
        setTimeout(() => {
          window.close();
        }, 800);
      });

    } catch (err) {
      logToTerminal("Execution Error: " + err.message, "err");
    }
  });
});
