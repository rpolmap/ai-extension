const GROQ_BASE = "https://api.groq.com/openai/v1";
const MAX_DUMP_CHARS = 12000;

// Best first. Used only if your key has access to them.
const PREFERRED_MODELS = [
  "llama-3.3-70b-versatile",
  "openai/gpt-oss-120b",
  "openai/gpt-oss-20b",
  "llama-3.1-8b-instant"
];
const EXCLUDE = /whisper|tts|guard|orpheus|embed|prompt-guard|compound/i;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "generateStyles") {
    executePipeline(request)
      .then(css => sendResponse({ success: true, css }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
});

async function pickModel(apiKey) {
  const res = await fetch(GROQ_BASE + "/models", {
    headers: { "Authorization": "Bearer " + apiKey.trim() }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error?.message || "Could not list Groq models (status " + res.status + ").");
  }
  const ids = (data.data || []).map(m => m.id);
  for (const m of PREFERRED_MODELS) if (ids.includes(m)) return m;
  const fallback = ids.find(id => !EXCLUDE.test(id));
  if (!fallback) throw new Error("No usable chat models available for this API key.");
  return fallback;
}

function extractCss(text) {
  const fenced = text.match(/```(?:css)?\s*([\s\S]*?)```/i);
  let css = fenced ? fenced[1] : text;
  const firstBrace = css.indexOf("{");
  if (firstBrace === -1) return "";
  const lastBrace = css.lastIndexOf("}");
  const lineStart = css.lastIndexOf("\n", firstBrace);
  css = css.slice(lineStart === -1 ? 0 : lineStart, lastBrace + 1);
  return css.trim();
}

async function executePipeline({ apiKey, promptText, fullDomDump, url }) {
  const model = await pickModel(apiKey);

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

  const response = await fetch(GROQ_BASE + "/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + apiKey.trim()
    },
    body: JSON.stringify({
      model,
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
    throw new Error("[" + model + "] " + (data.error?.message || "request failed with status " + response.status));
  }

  const raw = data.choices?.[0]?.message?.content || "";
  const css = extractCss(raw);
  if (!css) throw new Error("[" + model + "] returned no usable CSS.");
  return css;
}
