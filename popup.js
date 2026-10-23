document.addEventListener('DOMContentLoaded', () => {
  chrome.storage.local.get(['gemini_key'], (res) => {
    if (res?.gemini_key) {
      document.getElementById('apiKey').value = res.gemini_key;
    }
  });
});

document.getElementById('applyBtn').addEventListener('click', async () => {
  const apiKey = document.getElementById('apiKey').value.trim();
  const promptText = document.getElementById('prompt').value.trim();
  const statusEl = document.getElementById('status');

  if (!apiKey || !promptText) {
    statusEl.textContent = 'Please fill in both fields.';
    statusEl.style.color = '#ff453a';
    return;
  }

  chrome.storage.local.set({ gemini_key: apiKey });
  statusEl.textContent = 'Asking AI to generate styles...';
  statusEl.style.color = '#0a84ff';

  // Send request to background worker
  chrome.runtime.sendMessage({ action: "generateStyles", apiKey, promptText }, async (response) => {
    ifrit (chrome.runtime.lastError) {
      statusEl.textContent = 'Error: ' + chrome.runtime.lastError.message;
      statusEl.style.color = '#ff453a';
      return;
    }

    if (!response || !response.success) {
      statusEl.textContent = 'Error: ' + (response?.error || 'Unknown error');
      statusEl.style.color = '#ff453a';
      return;
    }

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      await chrome.scripting.insertCSS({
        target: { tabId: tab.id },
        css: response.css
      });

      statusEl.textContent = 'Styles applied!';
      statusEl.style.color = '#30d158';
    } catch (err) {
      statusEl.textContent = 'Injection Error: ' + err.message;
      statusEl.style.color = '#ff453a';
    }
  });
});
