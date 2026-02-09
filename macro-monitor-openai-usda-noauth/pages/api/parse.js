export default async function handler(req, res) {
  try {
    res.setHeader("Content-Type", "application/json");

    if (req.method !== "POST") {
      return res.status(405).json({
        error: "Method not allowed",
        gotMethod: req.method,
        contentType: req.headers?.["content-type"] || null,
      });
    }

    const body = req.body || {};
    const text = (body.text || "").trim();
    if (!text) return res.status(400).json({ error: "Missing text" });

    // TEMP: stub so we can confirm everything works end-to-end
    return res.status(200).json({
      items: [
        {
          name: text,
          calories: 0,
          protein: 0,
          fat: 0,
          carbs: 0,
          fiber: 0,
          sodium: 0,
          potassium: 0,
          magnesium: 0,
        },
      ],
    });
  } catch (e) {
    console.error("parse error:", e);
    return res.status(500).json({ error: "Server error", detail: String(e?.message || e) });
  }
}
