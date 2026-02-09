// pages/api/parse.js
//
// Expects env vars (Vercel Project Settings → Environment Variables):
// - OPENAI_API_KEY
// - USDA_API_KEY
// Optional:
// - OPENAI_MODEL (default: gpt-5-mini)

const OPENAI_MODEL_DEFAULT = "gpt-5-mini";

// USDA nutrient IDs we care about (FoodData Central)
const NUTRIENT_IDS = {
  calories: 1008, // Energy (kcal)
  protein: 1003,  // Protein
  fat: 1004,      // Total lipid (fat)
  carbs: 1005,    // Carbohydrate, by difference
  fiber: 1079,    // Fiber, total dietary
  sodium: 1093,   // Sodium, Na
  potassium: 1092,// Potassium, K
  magnesium: 1090 // Magnesium, Mg
};

const OZ_TO_G = 28.349523125;
const LB_TO_G = 453.59237;

// ---- helpers ----
function clampNumber(n, fallback = 0) {
  const x = Number(n);
  return Number.isFinite(x) ? x : fallback;
}

function normStr(s) {
  return String(s || "").trim();
}

function unitToGrams(quantity, unit) {
  const q = clampNumber(quantity, 0);
  const u = normStr(unit).toLowerCase();

  if (!q) return 0;

  if (u === "g" || u === "gram" || u === "grams") return q;
  if (u === "kg" || u === "kilogram" || u === "kilograms") return q * 1000;
  if (u === "oz" || u === "ounce" || u === "ounces") return q * OZ_TO_G;
  if (u === "lb" || u === "pound" || u === "pounds") return q * LB_TO_G;
  if (u === "mg") return q / 1000;

  // Unknown here: return 0 so we can fall back to USDA serving size
  return 0;
}

function safeJsonParse(maybeJson) {
  try {
    return JSON.parse(maybeJson);
  } catch {
    return null;
  }
}

function round1(n) {
  return Math.round((clampNumber(n, 0) * 10)) / 10;
}

function round0(n) {
  return Math.round(clampNumber(n, 0));
}

function addEightFields(obj, add) {
  // Add the 8 tracked fields + carbs/fiber used by UI totals
  const out = { ...obj };
  out.calories = clampNumber(out.calories) + clampNumber(add.calories);
  out.protein = clampNumber(out.protein) + clampNumber(add.protein);
  out.fat = clampNumber(out.fat) + clampNumber(add.fat);
  out.carbs = clampNumber(out.carbs) + clampNumber(add.carbs);
  out.fiber = clampNumber(out.fiber) + clampNumber(add.fiber);
  out.sodium = clampNumber(out.sodium) + clampNumber(add.sodium);
  out.potassium = clampNumber(out.potassium) + clampNumber(add.potassium);
  out.magnesium = clampNumber(out.magnesium) + clampNumber(add.magnesium);
  return out;
}

function emptyNutrients() {
  return {
    calories: 0,
    protein: 0,
    fat: 0,
    carbs: 0,
    fiber: 0,
    sodium: 0,
    potassium: 0,
    magnesium: 0
  };
}

// ---- OpenAI: parse text -> ingredient list ----
async function openaiParseTextToItems(text) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Missing OPENAI_API_KEY env var");

  const model = process.env.OPENAI_MODEL || OPENAI_MODEL_DEFAULT;

  // We try Chat Completions with JSON output first (most reliable for parsing).
  const payload = {
    model,
    messages: [
      {
        role: "system",
        content:
          "You extract structured food items from user text.\n" +
          "Return ONLY valid JSON.\n" +
          "Schema: {\"items\":[{\"name\":\"string\",\"quantity\":number,\"unit\":\"string\"}]}\n" +
          "Rules:\n" +
          "- quantity must be a number (use 1 if missing)\n" +
          "- unit should be one of: g, oz, lb, ml, cup, tbsp, tsp, serving, piece, egg\n" +
          "- Keep names simple (e.g., 'eggs', 'spinach', 'diced onion')\n" +
          "- If user includes a brand (e.g., 'Chobani Zero Sugar yogurt'), keep it in the name.\n"
      },
      { role: "user", content: text }
    ],
    // Some models allow this, some don’t. If it errors, we fallback below.
    response_format: { type: "json_object" }
  };

  let raw;
  let parsed;

  try {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    raw = await r.text();
    if (!r.ok) {
      // If we got a JSON error response, surface it cleanly.
      const j = safeJsonParse(raw);
      const msg =
        j?.error?.message ||
        `OpenAI error ${r.status}: ${raw?.slice(0, 200) || "unknown error"}`;
      throw new Error(msg);
    }

    const j = safeJsonParse(raw);
    const content = j?.choices?.[0]?.message?.content;
    parsed = safeJsonParse(content);
  } catch (e) {
    // Fallback: call Responses API without fancy params, then extract JSON from text.
    const r2 = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        input:
          "Extract food items as JSON ONLY.\n" +
          "Schema: {\"items\":[{\"name\":\"string\",\"quantity\":number,\"unit\":\"string\"}]}\n" +
          "Text:\n" +
          text
      })
    });

    const raw2 = await r2.text();
    if (!r2.ok) {
      const j2 = safeJsonParse(raw2);
      const msg =
        j2?.error?.message ||
        `OpenAI error ${r2.status}: ${raw2?.slice(0, 200) || "unknown error"}`;
      throw new Error(msg);
    }

    const j2 = safeJsonParse(raw2);

    // Try to find any text output in common places
    let outText = j2?.output_text;
    if (!outText && Array.isArray(j2?.output)) {
      // scan output parts
      for (const part of j2.output) {
        if (Array.isArray(part?.content)) {
          for (const c of part.content) {
            if (c?.type === "output_text" && c?.text) {
              outText = c.text;
              break;
            }
          }
        }
        if (outText) break;
      }
    }

    parsed = safeJsonParse(outText);
    if (!parsed) throw e; // original error is usually more helpful
  }

  const items = Array.isArray(parsed?.items) ? parsed.items : [];
  return items
    .map((it) => ({
      name: normStr(it?.name),
      quantity: clampNumber(it?.quantity, 1) || 1,
      unit: normStr(it?.unit) || "serving"
    }))
    .filter((it) => it.name);
}

// ---- USDA lookup ----
async function usdaSearchTopFood(query) {
  const apiKey = process.env.USDA_API_KEY;
  if (!apiKey) throw new Error("Missing USDA_API_KEY env var");

  const url = "https://api.nal.usda.gov/fdc/v1/foods/search";
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      pageSize: 1
    })
  });

  const raw = await r.text();
  if (!r.ok) throw new Error(`USDA search error ${r.status}: ${raw?.slice(0, 200)}`);

  const j = safeJsonParse(raw);
  const food = j?.foods?.[0];
  if (!food?.fdcId) return null;
  return food;
}

async function usdaGetFoodDetails(fdcId) {
  const apiKey = process.env.USDA_API_KEY;
  const url = `https://api.nal.usda.gov/fdc/v1/food/${fdcId}?api_key=${encodeURIComponent(
    apiKey
  )}`;

  const r = await fetch(url);
  const raw = await r.text();
  if (!r.ok) throw new Error(`USDA details error ${r.status}: ${raw?.slice(0, 200)}`);

  return safeJsonParse(raw);
}

function extractNutrientsFromFoodDetails(foodDetails) {
  // Food details commonly includes "foodNutrients": [{ nutrient: { id }, amount, ... }]
  const out = emptyNutrients();
  const list = Array.isArray(foodDetails?.foodNutrients) ? foodDetails.foodNutrients : [];

  for (const fn of list) {
    const id = fn?.nutrient?.id;
    const amt = clampNumber(fn?.amount, null);
    if (amt == null) continue;

    if (id === NUTRIENT_IDS.calories) out.calories = amt;
    else if (id === NUTRIENT_IDS.protein) out.protein = amt;
    else if (id === NUTRIENT_IDS.fat) out.fat = amt;
    else if (id === NUTRIENT_IDS.carbs) out.carbs = amt;
    else if (id === NUTRIENT_IDS.fiber) out.fiber = amt;
    else if (id === NUTRIENT_IDS.sodium) out.sodium = amt;
    else if (id === NUTRIENT_IDS.potassium) out.potassium = amt;
    else if (id === NUTRIENT_IDS.magnesium) out.magnesium = amt;
  }

  return out;
}

function scaleNutrients(base, factor) {
  // base is per 100g (most common). factor scales.
  return {
    calories: base.calories * factor,
    protein: base.protein * factor,
    fat: base.fat * factor,
    carbs: base.carbs * factor,
    fiber: base.fiber * factor,
    sodium: base.sodium * factor,
    potassium: base.potassium * factor,
    magnesium: base.magnesium * factor
  };
}

async function nutrientsForItemViaUsda(item) {
  const name = normStr(item.name);
  const quantity = clampNumber(item.quantity, 1) || 1;
  const unit = normStr(item.unit) || "serving";

  const top = await usdaSearchTopFood(name);
  if (!top?.fdcId) {
    // no match: return zeros but keep the item
    return { ...item, ...emptyNutrients(), source: "usda:none" };
  }

  const details = await usdaGetFoodDetails(top.fdcId);
  const per100g = extractNutrientsFromFoodDetails(details);

  // Determine grams for this item
  let grams = unitToGrams(quantity, unit);

  // If we couldn't convert unit -> grams, fall back to USDA servingSize if available
  if (!grams) {
    const ss = clampNumber(details?.servingSize, 0);
    const ssUnit = normStr(details?.servingSizeUnit).toLowerCase();
    if (ss && (ssUnit.includes("g") || ssUnit === "g" || ssUnit === "gram" || ssUnit === "grams")) {
      grams = quantity * ss;
    } else {
      // last-resort fallback: treat 1 "serving" as 100g
      grams = quantity * 100;
    }
  }

  // Scale: assume nutrients are per 100g
  const factor = grams / 100;

  const scaled = scaleNutrients(per100g, factor);

  return {
    ...item,
    calories: round0(scaled.calories),
    protein: round1(scaled.protein),
    fat: round1(scaled.fat),
    carbs: round1(scaled.carbs),
    fiber: round1(scaled.fiber),
    sodium: round0(scaled.sodium),
    potassium: round0(scaled.potassium),
    magnesium: round0(scaled.magnesium),
    source: "usda"
  };
}

function matchCustomFood(itemName, customFoods) {
  const n = normStr(itemName).toLowerCase();
  if (!n) return null;
  const foods = Array.isArray(customFoods) ? customFoods : [];

  // Very simple fuzzy match: if the custom food name is contained in item text or vice versa.
  // You can tighten this later.
  for (const cf of foods) {
    const cn = normStr(cf?.name).toLowerCase();
    if (!cn) continue;
    if (n.includes(cn) || cn.includes(n)) return cf;
  }
  return null;
}

// ---- API handler ----
export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const text = normStr(req.body?.text);
    const customFoods = req.body?.customFoods || [];

    if (!text) return res.status(400).json({ error: "Missing text" });

    // 1) Parse the text into ingredient items
    const parsedItems = await openaiParseTextToItems(text);

    if (!parsedItems.length) {
      return res.status(200).json({ items: [] });
    }

    // 2) For each parsed item, compute nutrients (custom food OR USDA)
    const outItems = [];
    for (const it of parsedItems) {
      const cf = matchCustomFood(it.name, customFoods);

      if (cf) {
        // Apply quantity multiplier if user says "2 LMNT packets" etc.
        const mult = clampNumber(it.quantity, 1) || 1;
        outItems.push({
          name: cf.name,
          calories: round0(clampNumber(cf.calories) * mult),
          protein: round1(clampNumber(cf.protein) * mult),
          fat: round1(clampNumber(cf.fat) * mult),
          carbs: round1(clampNumber(cf.carbs) * mult),
          fiber: round1(clampNumber(cf.fiber) * mult),
          sodium: round0(clampNumber(cf.sodium) * mult),
          potassium: round0(clampNumber(cf.potassium) * mult),
          magnesium: round0(clampNumber(cf.magnesium) * mult),
          source: "custom"
        });
      } else {
        outItems.push(await nutrientsForItemViaUsda(it));
      }
    }

    return res.status(200).json({ items: outItems });
  } catch (e) {
    console.error("parse error:", e);
    return res.status(500).json({
      error: e?.message || "Server error"
    });
  }
}
