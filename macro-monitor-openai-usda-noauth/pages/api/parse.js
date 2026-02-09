// pages/api/parse.js
// OpenAI + USDA parser (no response_format)
// Requires env vars:
// - OPENAI_API_KEY
// - USDA_API_KEY

const OPENAI_MODEL = "gpt-5-mini";

function num(x, d = 0) {
  const n = Number(x);
  return Number.isFinite(n) ? n : d;
}
function round1(x) {
  return Math.round(num(x) * 10) / 10;
}
function clamp(x, lo, hi) {
  x = num(x);
  return Math.max(lo, Math.min(hi, x));
}

function sumItems(items) {
  const Z = {
    calories: 0,
    protein: 0,
    fat: 0,
    carbs: 0,
    fiber: 0,
    sodium: 0,
    potassium: 0,
    magnesium: 0,
  };
  for (const it of items) {
    for (const k of Object.keys(Z)) Z[k] += num(it[k]);
  }
  for (const k of Object.keys(Z)) Z[k] = round1(Z[k]);
  return Z;
}

// ---------- OpenAI: turn text into { items: [{name, query, grams|null, count|null, unit|null}] } ----------

async function openaiParse(text) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");

  const system = `
You are a nutrition parsing assistant.

TASK:
Extract foods and amounts from user text into a JSON object.

OUTPUT RULES (CRITICAL):
- Return ONLY valid JSON.
- No markdown, no commentary, no backticks.
- Must match the schema exactly.

SCHEMA:
{
  "items": [
    {
      "name": "short user-facing label",
      "query": "USDA search query string",
      "grams": number|null,
      "count": number|null,
      "unit": string|null
    }
  ]
}

GUIDELINES:
- Split compound inputs into multiple items (eggs, spinach, onions, yogurt, blueberries).
- If user gives a count and a common unit (e.g. "3 eggs"), set count=3, unit="egg", grams=null.
- If user gives grams (e.g. "30g blueberries"), set grams=30, count=null, unit="g" (or null).
- For packaged foods (e.g. "Chobani Zero Sugar yogurt"), keep query close to brand/product.
- Keep items <= 12.
`;

  const body = {
    model: OPENAI_MODEL,
    input: [
      { role: "system", content: system },
      { role: "user", content: text },
    ],
    max_output_tokens: 700,
  };

  const resp = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const raw = await resp.text();
  let j;
  try {
    j = JSON.parse(raw);
  } catch {
    throw new Error(`OpenAI non-JSON response (${resp.status}): ${raw.slice(0, 200)}`);
  }

  if (!resp.ok) {
    throw new Error(j?.error?.message || `OpenAI error ${resp.status}`);
  }

   // Responses API sometimes doesn't populate output_text.
  // Extract text from output[] blocks instead.
  const extractText = (respJson) => {
    // Preferred: output_text if present
    if (typeof respJson?.output_text === "string" && respJson.output_text.trim()) {
      return respJson.output_text.trim();
    }

    const outs = Array.isArray(respJson?.output) ? respJson.output : [];
    let buf = "";

    for (const o of outs) {
      const content = Array.isArray(o?.content) ? o.content : [];
      for (const c of content) {
        // Common shapes:
        // { type: "output_text", text: "..." }
        // { type: "text", text: "..." }
        if (typeof c?.text === "string") buf += c.text;
        if (typeof c?.content === "string") buf += c.content;
      }
    }

    return buf.trim();
  };

  const out = extractText(j);
  if (!out) {
    throw new Error(
      `OpenAI returned no text. Raw keys: ${Object.keys(j || {}).join(", ")}`
    );
  }

  // Extract JSON object if model added extra text
  let jsonStr = out;
  if (!out.startsWith("{")) {
    const m = out.match(/\{[\s\S]*\}/);
    if (!m) throw new Error(`OpenAI output not JSON: ${out.slice(0, 200)}`);
    jsonStr = m[0];
  }

  let parsed;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new Error(`Failed to parse OpenAI JSON: ${jsonStr.slice(0, 200)}`);
  }

  if (!parsed?.items || !Array.isArray(parsed.items)) {
    throw new Error("OpenAI parse failed: missing items[]");
  }

  // Sanitize
  parsed.items = parsed.items
    .slice(0, 12)
    .map((it) => ({
      name: String(it.name || it.query || "Item").slice(0, 120),
      query: String(it.query || it.name || "").slice(0, 160),
      grams:
        it.grams === null || it.grams === undefined
          ? null
          : clamp(it.grams, 1, 2000),
      count:
        it.count === null || it.count === undefined
          ? null
          : clamp(it.count, 0.25, 50),
      unit: it.unit === null || it.unit === undefined ? null : String(it.unit).slice(0, 30),
    }))
    .filter((it) => it.query);

  return parsed;
}

// ---------- USDA helpers ----------

async function usdaSearch(query, usdaKey) {
  const url = new URL("https://api.nal.usda.gov/fdc/v1/foods/search");
  url.searchParams.set("api_key", usdaKey);

  const resp = await fetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, pageSize: 5 }),
  });

  const j = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(j?.message || `USDA search error ${resp.status}`);
  return j?.foods || [];
}

async function usdaFoodDetails(fdcId, usdaKey) {
  const url = new URL(`https://api.nal.usda.gov/fdc/v1/food/${fdcId}`);
  url.searchParams.set("api_key", usdaKey);

  const resp = await fetch(url.toString());
  const j = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(j?.message || `USDA food error ${resp.status}`);
  return j;
}

function pickBestFood(foods) {
  if (!foods?.length) return null;

  const score = (f) => {
    const dt = String(f.dataType || "").toLowerCase();
    let s = 0;
    if (dt.includes("foundation")) s += 6;
    if (dt.includes("sr")) s += 5;
    if (dt.includes("survey")) s += 4;
    if (dt.includes("branded")) s += 2;
    if (Array.isArray(f.foodNutrients) && f.foodNutrients.length > 0) s += 1;
    return s;
  };

  return foods.slice().sort((a, b) => score(b) - score(a))[0];
}

function nutrientsPer100g(foodDetail) {
  const out = {};
  const n = foodDetail?.foodNutrients || [];

  for (const x of n) {
    const name = String(x.nutrient?.name || "").toLowerCase();
    const unit = String(x.nutrient?.unitName || "").toLowerCase();
    const val = num(x.amount, null);
    if (val == null) continue;

    if (name === "energy") {
      // energy in kcal (or kJ sometimes)
      out.energy_kcal = unit === "kj" ? val / 4.184 : val;
    }
    if (name === "protein") out.protein_g = val;
    if (name === "total lipid (fat)") out.fat_g = val;
    if (name === "carbohydrate, by difference") out.carbs_g = val;
    if (name === "fiber, total dietary") out.fiber_g = val;

    if (name === "sodium, na") out.sodium_mg = unit === "mg" ? val : val * 1000;
    if (name === "potassium, k") out.potassium_mg = unit === "mg" ? val : val * 1000;
    if (name === "magnesium, mg") out.magnesium_mg = unit === "mg" ? val : val * 1000;
  }

  return out;
}

function scale(per100, grams) {
  const f = grams / 100;
  return {
    calories: round1((per100.energy_kcal || 0) * f),
    protein: round1((per100.protein_g || 0) * f),
    fat: round1((per100.fat_g || 0) * f),
    carbs: round1((per100.carbs_g || 0) * f),
    fiber: round1((per100.fiber_g || 0) * f),
    sodium: round1((per100.sodium_mg || 0) * f),
    potassium: round1((per100.potassium_mg || 0) * f),
    magnesium: round1((per100.magnesium_mg || 0) * f),
  };
}

// Rough defaults when grams aren't provided
function estimateGrams(item) {
  const q = String(item.query || item.name || "").toLowerCase();
  const unit = String(item.unit || "").toLowerCase();

  // Eggs
  if (unit.includes("egg") || q.includes("egg")) {
    const c = item.count || 1;
    return 50 * c; // ~50g per large egg
  }

  // Tbsp
  if (unit.includes("tbsp") || unit.includes("tablespoon") || q.includes("tablespoon")) {
    const c = item.count || 1;
    return 15 * c;
  }

  // Cup
  if (unit.includes("cup") || q.includes("cup")) {
    const c = item.count || 1;
    if (q.includes("spinach")) return 30 * c; // raw spinach is light
    return 245 * c; // generic cup estimate
  }

  // default: 100g
  return 100;
}

// ---------- Next.js API route ----------

export default async function handler(req, res) {
  try {
    res.setHeader("Content-Type", "application/json");

    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed", gotMethod: req.method });
    }

    const usdaKey = process.env.USDA_API_KEY;
    if (!usdaKey) throw new Error("USDA_API_KEY is not set");

    const text = String(req.body?.text || "").trim();
    if (!text) return res.status(400).json({ error: "Missing text" });

    // 1) LLM parses text into items
    const parsed = await openaiParse(text);

    // 2) USDA converts each item into nutrients
    const outItems = [];
    for (const it of parsed.items) {
      const foods = await usdaSearch(it.query, usdaKey);
      const best = pickBestFood(foods);

      if (!best?.fdcId) {
        outItems.push({
          name: it.name,
          calories: 0,
          protein: 0,
          fat: 0,
          carbs: 0,
          fiber: 0,
          sodium: 0,
          potassium: 0,
          magnesium: 0,
          note: "No USDA match",
        });
        continue;
      }

      const detail = await usdaFoodDetails(best.fdcId, usdaKey);
      const per100 = nutrientsPer100g(detail);

      const grams = it.grams ?? estimateGrams(it);
      const scaled = scale(per100, grams);

      outItems.push({
        name: it.name,
        ...scaled,
      });
    }

    return res.status(200).json({
      items: outItems,
      totals: sumItems(outItems),
    });
  } catch (e) {
    console.error("parse error:", e);
    return res.status(500).json({
      error: "Server error",
      detail: String(e?.message || e),
    });
  }
}
