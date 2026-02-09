// pages/api/parse.js
// Next.js API route: POST /api/parse
//
// Env vars required on Vercel:
// - OPENAI_API_KEY
// - USDA_API_KEY   (optional if you use USDA later in this route; kept for compatibility)

const OPENAI_URL = "https://api.openai.com/v1/responses";
const MODEL = process.env.OPENAI_MODEL || "gpt-5-mini";

function extractResponseText(respJson) {
  // 1) preferred if present
  if (typeof respJson?.output_text === "string" && respJson.output_text.trim()) {
    return respJson.output_text.trim();
  }

  // 2) canonical: iterate output[].content[].text
  const outs = Array.isArray(respJson?.output) ? respJson.output : [];
  let buf = "";
  for (const o of outs) {
    const content = Array.isArray(o?.content) ? o.content : [];
    for (const c of content) {
      if (typeof c?.text === "string") buf += c.text;
      if (typeof c?.content === "string") buf += c.content;
    }
  }
  return buf.trim();
}

function stripCodeFences(s) {
  // removes ```json ... ``` or ``` ... ```
  return s
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/i, "")
    .trim();
}

function tryParseJson(text) {
  const cleaned = stripCodeFences(String(text || "").trim());

  // First attempt: direct parse
  try {
    return JSON.parse(cleaned);
  } catch {}

  // Fallback: extract first JSON object/array from text
  const s = cleaned;

  // Find first "{" or "[" and attempt to parse balanced chunk
  const startObj = s.indexOf("{");
  const startArr = s.indexOf("[");
  let start = -1;
  if (startObj === -1) start = startArr;
  else if (startArr === -1) start = startObj;
  else start = Math.min(startObj, startArr);

  if (start === -1) {
    throw new Error("No JSON object/array found in model output");
  }

  const opener = s[start];
  const closer = opener === "{" ? "}" : "]";

  let depth = 0;
  let inStr = false;
  let esc = false;

  for (let i = start; i < s.length; i++) {
    const ch = s[i];

    if (inStr) {
      if (esc) {
        esc = false;
      } else if (ch === "\\") {
        esc = true;
      } else if (ch === '"') {
        inStr = false;
      }
      continue;
    } else {
      if (ch === '"') {
        inStr = true;
        continue;
      }
    }

    if (ch === opener) depth++;
    if (ch === closer) depth--;

    if (depth === 0) {
      const candidate = s.slice(start, i + 1);
      try {
        return JSON.parse(candidate);
      } catch (e) {
        throw new Error(
          `Found JSON-like block but JSON.parse failed: ${e?.message || e}`
        );
      }
    }
  }

  throw new Error("Unbalanced JSON in model output");
}

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { text } = req.body || {};
    const input = String(text || "").trim();

    if (!input) {
      return res.status(400).json({ error: "Missing 'text' in request body" });
    }

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: "Missing OPENAI_API_KEY env var" });
    }

    // We tell the model to return JSON ONLY (no prose).
    const system = `
You are a nutrition logging parser.
Return ONLY valid JSON. No markdown. No code fences. No commentary.
Schema:
{
  "items": [
    {
      "query": string,              // short search phrase for USDA (e.g., "large egg", "raw spinach")
      "display": string,            // user-friendly name
      "quantity": number,           // numeric quantity
      "unit": string,               // e.g., "egg", "g", "oz", "cup", "tbsp", "tsp", "serving"
      "notes": string|null          // optional extra context (brand, "cooked", etc)
    }
  ]
}
If the input is ambiguous, make a best guess and put uncertainty in "notes".
`;

    const payload = {
      model: MODEL,
      input: [
        { role: "system", content: system.trim() },
        { role: "user", content: input },
      ],
      // Keep it small and deterministic for a parser
      temperature: 0.2,
      max_output_tokens: 600,
    };

    const r = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const raw = await r.text();
    let j;
    try {
      j = JSON.parse(raw);
    } catch (e) {
      console.error("parse error: OpenAI non-JSON response:", raw.slice(0, 500));
      return res.status(502).json({ error: "OpenAI returned non-JSON", raw });
    }

    if (!r.ok) {
      // pass through useful message
      const msg =
        j?.error?.message ||
        j?.message ||
        `OpenAI error (${r.status})`;
      console.error("parse error: OpenAI error:", msg);
      return res.status(r.status).json({ error: msg });
    }

    const outText = extractResponseText(j);
    if (!outText) {
      console.error("parse error: OpenAI returned no text blocks", j);
      return res.status(502).json({ error: "OpenAI returned empty text output" });
    }

    let parsed;
    try {
      parsed = tryParseJson(outText);
    } catch (e) {
      console.error("parse error: Failed to parse OpenAI JSON:", outText);
      return res.status(502).json({
        error: `Failed to parse OpenAI JSON: ${e?.message || e}`,
        modelText: outText,
      });
    }

    if (!parsed || !Array.isArray(parsed.items)) {
      return res.status(502).json({
        error: "Model JSON missing required 'items' array",
        modelJson: parsed,
      });
    }

    // Basic normalization / safety
    const items = parsed.items
      .filter(Boolean)
      .map((it) => ({
        query: String(it.query || it.display || "").trim(),
        display: String(it.display || it.query || "").trim(),
        quantity: Number(it.quantity || 1),
        unit: String(it.unit || "serving").trim(),
        notes: it.notes == null ? null : String(it.notes),
      }))
      .filter((it) => it.query && it.display && Number.isFinite(it.quantity));

    return res.status(200).json({ items });
  } catch (err) {
    console.error("parse error:", err);
    return res.status(500).json({ error: err?.message || "Server error" });
  }
}
