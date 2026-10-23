const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = "llama-3.3-70b-versatile";
const MAX_DUMP_CHARS = 12000;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "generateStyles") {
    executePipeline(request)
      .then(css => sendResponse({ success: true, css }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true; // keep channel open for async response
  }
});

function extractCss(text) {
  // Prefer content inside a code fence if the model added one
  const fenced = text.match(/```(?:css)?\s*([\s\S]*?)```/i);
  let css = fenced ? fenced[1] : text;
  // Drop any chatter before the first rule
  const firstBrace = css.indexOf("{");
  if (firstBrace === -1) return "";
  const lastBrace = css.lastIndexOf("}");
  const lineStart = css.lastIndexOf("\n", firstBrace);
  css = css.slice(lineStart === -1 ? 0 : lineStart, lastBrace + 1);
  return css.trim();
}

async function executePipeline({ apiKey, promptText, fullDomDump, url }) {
  const systemPrompt =
    "You are an expert web developer who writes CSS.\n" +
    "You receive an outline of a web page (interactive elements and DOM hierarchy) and a styling request.\n\n" +
    "RULES:\n" +
    "- Only use selectors that appear in the provided outline (ids, classes, tag names). Do not invent class names.\n" +
    "- Apply the requested styles with high specificity and !important (e.g. background: #121212 !important;).\n" +
    "- Do NOT style anything the user did not mention.\n" +
    "- Return ONLY raw CSS. No markdown fences, no comments, no explanations.";

  const dump = (fullDomDump || "").slice(0, MAX_DUMP_CHARS);

  const userMessage =
    "Target Site URL: " + (url || "unknown") + "\n" +
    "User Design Request: " + promptText + "\n\n" +
    "Page outline:\n" + dump;

  const response = await fetch(GROQ_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + apiKey.trim()
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage }
      ],
      temperature: 0.2
    })
  });

  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error("Groq returned a non-JSON response (status " + response.status + ").");
  }

  if (!response.ok) {
    throw new Error(data.error?.message || "Groq API request failed with status " + response.status);
  }

  const raw = data.choices?.[0]?.message?.content || "";
  const css = extractCss(raw);
  if (!css) {
    throw new Error("API returned no usable CSS.");
  }
  return css;
}
