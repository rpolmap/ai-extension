document.addEventListener('DOMContentLoaded', () => {
  // Load saved API key from storage
  chrome.storage?.local?.get(['gemini_key'], (res) => {
    if (res?.gemini_key) {
      document.getElementById('apiKey').value = res.gemini_key;
    }
  });
});

document.getElementById('applyBtn').addEventListener('click', async () => {
  const apiKey = document.getElementById('apiKey').value.trim();
  const promptText = document.getElementById('prompt').value.trim();
  const statusEl = document.getElementById('status');

  if (!apiKey) {
    statusEl.textContent = 'Please enter an API key.';
    statusEl.style.color = '#ff453a';
    return;
  }
  if (!promptText) {
    statusEl.textContent = 'Please describe your desired change.';
    statusEl.style.color = '#ff453a';
    return;
  }

  // Save key for future use
  if (chrome.storage?.local) {
    chrome.storage.local.set({ gemini_key: apiKey });
  }

  statusEl.textContent = 'Asking AI to generate styles...';
  statusEl.style.color = '#0a84ff';

  try {
    const systemPrompt = "You are a CSS generator. Return ONLY raw, valid CSS code to fulfill the user's request on a webpage. Do not include markdown codeblocks (like ```css), explanations, or comments. Return pure CSS rules only.";
    
    const response = await fetch(`[https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=$](https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=$){apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          { role: 'user', parts: [{ text: `${systemPrompt}\n\nUser request: ${promptText}` }] }
        ]
      })
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error?.message || 'API request failed.');
    }

    let rawCss = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    // Clean codeblock markers if any were returned
    rawCss = rawCss.replace(/```css/g, '').replace(/```/g, '').trim();

    if (!rawCss) {
      throw new Error('No CSS returned from AI.');
    }

    // Inject generated CSS into active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await chrome.scripting.insertCSS({
      target: { tabId: tab.id },
      css: rawCss
    });

    statusEl.textContent = 'Styles applied!';
    statusEl.style.color = '#30d158';

  } catch (err) {
    statusEl.textContent = 'Error: ' + err.message;
    statusEl.style.color = '#ff453a';
  }
});
