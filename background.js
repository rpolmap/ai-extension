chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "generateStyles") {
    callGroqAPI(request.apiKey, request.promptText)
      .then(css => sendResponse({ success: true, css }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true; 
  }
});

async function callGroqAPI(apiKey, promptText) {
  const systemPrompt = "You are a CSS generator. Return ONLY raw, valid CSS code to fulfill the user's request on a webpage. Do not include markdown codeblocks, explanations, or comments. Return pure CSS rules only.";

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + apiKey.trim()
    },
    body: JSON.stringify({
      model: "llama-3.1-8b-instant", // Updated to active model identifier
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: promptText }
      ],
      temperature: 0.2
    })
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error?.message || "Groq API failed with status " + response.status);
  }

  let rawCss = data.choices?.[0]?.message?.content || "";
  return rawCss.replace(/```css/g, "").replace(/```/g, "").trim();
}
