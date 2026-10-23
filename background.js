chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "generateStyles") {
    callGroqAPI(request.apiKey, request.promptText)
      .then(css => sendResponse({ success: true, css }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true; 
  }
});

async function callGroqAPI(apiKey, promptText) {
  const systemPrompt = "You are a CSS generator. Return ONLY raw, valid CSS code to fulfill the user's request on a webpage. Do not include markdown codeblocks, explanations, or comments. Return pure CSS rules only. Mark every declaration !important so it overrides the site's own styles.";

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + apiKey.trim()
    },
    body: JSON.stringify({
      model: "openai/gpt-oss-20b", // Updated to current active Groq model ID
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: promptText }
      ],
      temperature: 0.2,
      reasoning_effort: "low",
      max_completion_tokens: 4000
    })
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error?.message || "Groq API failed with status " + response.status);
  }

  let rawCss = data.choices?.[0]?.message?.content || "";
  rawCss = rawCss.replace(/```css/g, "").replace(/```/g, "").trim();
  if (!rawCss) {
    throw new Error("The model returned empty CSS. Try again or rephrase.");
  }
  return rawCss;
}
