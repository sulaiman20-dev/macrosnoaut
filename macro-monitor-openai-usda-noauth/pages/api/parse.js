// pages/api/parse.js

// NOTE: uses built-in fetch (Node 18 on Vercel)
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
  const Z = { calories: 0, protein: 0, fat: 0, carbs: 0, fiber: 0, sodium: 0, potassium: 0, magnesium: 0 };
  for (const it of items) for (const k of Object.keys(Z)) Z[k] += num(it[k]);
  for (const k of Object.keys(Z)) Z[k] = round1(Z[k]);
  return Z;
}

async function openaiParse(text) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");

  const system = `
You are a nutrition parsing assistant.
Extract foods and amounts from user text into a JSON array.

Return STRICT JSON only, no markdown.
Schema:
{
  "items": [
    {
      "name": string,                // user-facing label
      "query": string,               // USDA search query
      "grams": number|null,          // preferred; if unknown null
      "count": number|null,          // e.g. eggs: 3
      "unit": string|null            // e.g. "egg", "cup", "tbsp"
    }
  ]
}

Rules:
- Split compound inputs into multiple items (eggs, spinach, onions, yogurt, blueberries).
- If user gives count + common unit (e.g. "3 eggs"), set count=3, unit="egg", grams=null.
- For packaged foods (e.g. "Chobani Zero Sugar yogurt"), keep query close to brand/product.
- Keep names short and readable.
`;

  const body = {
    model: OPENAI_MODEL,
    input: [
      { role: "system", content: system },
      { role: "user", content: text },
    ],
    // Encourage strict JSON
    response_format: { type: "json_schema", json_schema: {
      name: "food_parse",
      schema: {
        type: "object",
        properties: {
          items: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                query: { type: "string" },
                grams: { anyOf: [{ type: "number" }, { type: "null" }] },
                count: { anyOf: [{ type: "number" }, { type: "null" }] },
                unit: { anyOf: [{ type: "string" }, { type: "null" }] }
              },
              required: ["name", "query", "grams", "count", "unit"]
            }
          }
        },
        required: ["items"]
      }
    } }
  };

  const resp = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  const txt = await resp.text();
  let j;
  try { j = JSON.parse(txt); } catch { throw new Error(`OpenAI non-JSON response (${resp.status}): ${txt.slice(0, 200)}`); }
  if (!resp.ok) throw new Error(j?.error?.message || `OpenAI error ${resp.status}`);

  // responses API with json_schema returns structured content; safest is to read output_text when present
  // but with json_schema, we can often use: j.output[0].content[0].json
  const content = j?.output?.[0]?.content?.find?.(c => c.type === "output_json") || j?.output?.[0]?.content?.[0];
  const parsed = content?.json || content?.output_json || null;

  if (!parsed?.items || !Array.isArray(parsed.items)) {
    // Fallback: try output_text
    const out = j?.output_text;
    if (out) {
      try {
        const p2 = JSON.parse(out);
        if (p2?.items) return p2;
      } catch {}
    }
    throw new Error("OpenAI parse failed: missing items");
  }

  // Sanitize
  parsed.items = parsed.items.slice(0, 12).map(it => ({
    name: String(it.name || it.query || "Item").slice(0, 120),
    query: String(it.query || it.name || "").slice(0, 160),
    grams: it.grams === null ? null : clamp(it.grams, 1, 2000),
    count: it.count === null ? null : clamp(it.count, 0.25, 50),
    unit: it.unit === null ? null : String(it.unit).slice(0, 30),
  })).filter(it => it.query);

  return parsed;
}

async function usdaSearch(query, usdaKey) {
  const url = new URL("https://api.nal.usda.gov/fdc/v1/foods/search");
  url.searchParams.set("api_key", usdaKey);

  const resp = await fetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, pageSize: 5 })
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
  // Prefer Foundation / SR Legacy / Survey over Branded if possible; but accept branded when it's clearly packaged
  const score = (f) => {
    const dt = (f.dataType || "").toLowerCase();
    let s = 0;
    if (dt.includes("foundation")) s += 6;
    if (dt.includes("sr")) s += 5;
    if (dt.includes("survey")) s += 4;
    if (dt.includes("branded")) s += 2;
    // Prefer higher score if has nutrients listed
    if (Array.isArray(f.foodNutrients) && f.foodNutrients.length > 0) s += 1;
    return s;
  };
  return foods.slice().sort((a, b) => score(b) - score(a))[0];
}

function nutrientsPer100g(foodDetail) {
  // Returns map of nutrient name -> value per 100g
  const out = {};
  const n = foodDetail?.foodNutrients || [];
  for (const x of n) {
    const name = (x.nutrient?.name || "").toLowerCase();
    const unit = (x.nutrient?.unitName || "").toLowerCase();
    const val = num(x.amount, null);
    if (val == null) continue;

    // Map common
    if (name === "energy" && (unit === "kcal" || unit === "kj")) {
      // USDA energy might be kcal already; if kJ, convert to kcal
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

// Rough unit defaults when grams aren't provided.
// This is just to keep prototype usable; later we can make it smarter.
function estimateGrams(item) {
  const q = (item.query || item.name || "").toLowerCase();

  // Eggs
  if ((item.unit || "").toLowerCase().includes("egg") || q.includes("egg")) {
    const c = item.count || 1;
    return 50 * c; // ~50g per large egg
  }

  // Tbsp
  if ((item.unit || "").toLowerCase().includes("tbsp") || q.includes("tablespoon")) {
    const c = item.count || 1;
    return 15 * c;
  }

  // Cup (spinach raw is light; yogurt is heavy—this is crude)
  if ((item.unit || "").toLowerCase().includes("cup") || q.includes("cup")) {
    const c = item.count || 1;
    if (q.includes("spinach")) return 30 * c;
    return 245 * c;
  }

  // default if unknown: treat as one serving ~100g
  return 100;
}

export default async function handler(req, res) {
  try {
    res.setHeader("Content-Type", "application/json");

    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const usdaKey = process.env.USDA_API_KEY;
    if (!usdaKey) throw new Error("USDA_API_KEY is not set");

    const text = (req.body?.text || "").trim();
    if (!text) return res.status(400).json({ error: "Missing text" });

    const parsed = await openaiParse(text);

    const outItems = [];
    for (const it of parsed.items) {
      const foods = await usdaSearch(it.query, usdaKey);
      const best = pickBestFood(foods);
      if (!best?.fdcId) {
        outItems.push({
          name: it.name,
          calories: 0, protein: 0, fat: 0, carbs: 0, fiber: 0,
          sodium: 0, potassium: 0, magnesium: 0,
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

    return res.status(200).json({ items: outItems, totals: sumItems(outItems) });
  } catch (e) {
    console.error("parse error:", e);
    return res.status(500).json({ error: "Server error", detail: String(e?.message || e) });
  }
}
