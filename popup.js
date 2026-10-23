document.addEventListener('DOMContentLoaded', () => {
  // Load saved Groq key on startup
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
    const statusEl = document.getElementById('status');

    if (!apiKey || !promptText) {
      statusEl.textContent = 'Please fill in both fields.';
      statusEl.style.color = '#ff453a';
      return;
    }

    // Save the key locally
    chrome.storage.local.set({ groq_key: apiKey });
    statusEl.textContent = 'Asking AI to generate styles...';
    statusEl.style.color = '#9aa0a8';

    chrome.runtime.sendMessage({ action: "generateStyles", apiKey, promptText }, async (response) => {
      if (chrome.runtime.lastError) {
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
        if (!tab?.id) {
          throw new Error("No active tab found");
        }

        await chrome.scripting.insertCSS({
          target: { tabId: tab.id },
          css: response.css,
          origin: 'USER'
        });

        statusEl.textContent = 'Styles applied!';
        statusEl.style.color = '#30d158';

        // Automatically close the popup after a brief moment so you return to the page
        setTimeout(() => {
          window.close();
        }, 400);

      } catch (err) {
        statusEl.textContent = 'Injection Error: ' + err.message;
        statusEl.style.color = '#ff453a';
      }
    });
  });
});
