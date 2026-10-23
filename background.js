chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "generateStyles") {
    callGeminiAPI(request.apiKey, request.promptText)
      .then(css => sendResponse({ success: true, css }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true; // Keeps channel open for async response
  }
});

async function callGeminiAPI(apiKey, promptText) {
  const systemPrompt = "You are a CSS generator. Return ONLY raw, valid CSS code to fulfill the user's request on a webpage. Do not include markdown codeblocks, explanations, or comments. Return pure CSS rules only.";
  
  // Using the supported model gemini-2.5-flash
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
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
  return rawCss.replace(/```css/g, '').replace(/```/g, '').trim();
}
