chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "generateStyles") {
    executePipeline(request)
      .then(css => sendResponse({ success: true, css }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true; 
  }
});

async function executePipeline({ apiKey, promptText, fullDomDump, url }) {
  const systemPrompt = 
    "You are an expert web developer and CSS compiler.\n" +
    "Task Steps:\n" +
    "1. Analyze all buttons, input fields, structural tags, interactive handlers, and computed layouts in the provided HTML DOM.\n" +
    "2. Infer a functional unstyled layout structure of the application.\n" +
    "3. Generate CSS rules to fulfill the user's prompt styling request.\n\n" +
    "CRITICAL CONSTRAINTS:\n" +
    "- If the prompt specifies custom styling for certain elements, apply those strictly using high specificity and !important (e.g. background: #121212 !important;).\n" +
    "- For any elements/components NOT mentioned in the prompt, DO NOT change or override their visual styling—allow them to retain their natural original look.\n" +
    "- Return ONLY raw, valid CSS code. Do NOT wrap output in markdown codeblocks (```css), comments, or conversational text.";

  const userMessage = 
    "Target Site URL: " + (url || "unknown") + "\n" +
    "User Design Request: " + promptText + "\n\n" +
    "Full Component & DOM Tree Dump:\n" + fullDomDump;

  const response = await fetch("[https://api.groq.com/openai/v1/chat/completions](https://api.groq.com/openai/v1/chat/completions)", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + apiKey.trim()
    },
    body: JSON.stringify({
      model: "llama-3.1-8b-instant",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage }
      ],
      temperature: 0.2
    })
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error?.message || "Groq API request failed with status " + response.status);
  }

  let rawCss = data.choices?.[0]?.message?.content || "";
  rawCss = rawCss.replace(/```css/g, "").replace(/```/g, "").trim();
  
  if (!rawCss) {
    throw new Error("API returned empty CSS response.");
  }
  return rawCss;
}
