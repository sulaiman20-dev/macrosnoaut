import React, { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";

const LineChart = dynamic(() => import("recharts").then((m) => m.LineChart), { ssr: false });
const Line = dynamic(() => import("recharts").then((m) => m.Line), { ssr: false });
const XAxis = dynamic(() => import("recharts").then((m) => m.XAxis), { ssr: false });
const YAxis = dynamic(() => import("recharts").then((m) => m.YAxis), { ssr: false });
const Tooltip = dynamic(() => import("recharts").then((m) => m.Tooltip), { ssr: false });
const Legend = dynamic(() => import("recharts").then((m) => m.Legend), { ssr: false });
const CartesianGrid = dynamic(() => import("recharts").then((m) => m.CartesianGrid), { ssr: false });
const ResponsiveContainer = dynamic(() => import("recharts").then((m) => m.ResponsiveContainer), { ssr: false });

const T = {
  bg: "#06090f",
  sf: "#0d1320",
  sf2: "#141d2f",
  bd: "#1b2740",
  tx: "#e4eaf2",
  txd: "#8694ad",
  txm: "#4e5d76",
  ac: "#10b981",
  warn: "#f59e0b",
  warnBg: "#3b2506",
  err: "#ef4444",
  errBg: "#3b0a0a",
  prot: "#a78bfa",
  fat: "#fb923c",
  carb: "#34d399",
  cal: "#f472b6",
  na: "#60a5fa",
  k: "#c084fc",
  mg: "#2dd4bf",
};

const Z = { calories: 0, protein: 0, fat: 0, carbs: 0, fiber: 0, sodium: 0, potassium: 0, magnesium: 0 };
const r1 = (n) => Math.round((Number(n) || 0) * 10) / 10;
const ri = (n) => Math.round(Number(n) || 0);
const todayStr = () => new Date().toISOString().slice(0, 10);
const netCarbs = (t) => Math.max(0, (t.carbs || 0) - (t.fiber || 0));

function sum(items) {
  return (items || []).reduce(
    (a, it) => {
      for (const k of Object.keys(Z)) a[k] += Number(it?.[k]) || 0;
      return a;
    },
    { ...Z }
  );
}

function Card({ children, style }) {
  return (
    <div style={{ background: T.sf, borderRadius: 14, border: `1px solid ${T.bd}`, padding: 16, ...style }}>
      {children}
    </div>
  );
}

function Metric({ label, value, unit, color, target, warn }) {
  return (
    <div
      style={{
        background: T.sf2,
        borderRadius: 11,
        padding: "13px 15px",
        border: `1px solid ${warn ? T.warn : T.bd}`,
        flex: "1 1 120px",
        minWidth: 120,
        position: "relative",
      }}
    >
      {warn && <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: T.warn }} />}
      <div
        style={{
          fontSize: 10.5,
          color: color || T.txd,
          fontWeight: 800,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          marginBottom: 3,
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 24, fontWeight: 900, color: T.tx, fontFamily: "ui-monospace, SFMono-Regular" }}>
        {unit === "mg" ? ri(value) : r1(value)}
        <span style={{ fontSize: 12, color: T.txd, fontWeight: 400, marginLeft: 3 }}>{unit}</span>
      </div>
      {target != null && <div style={{ fontSize: 10.5, color: T.txm, marginTop: 1 }}>/ {target}</div>}
    </div>
  );
}

function Modal({ title, children, onClose }) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.75)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        backdropFilter: "blur(5px)",
        padding: 16,
      }}
    >
      <div
        style={{
          background: T.sf,
          borderRadius: 16,
          border: `1px solid ${T.bd}`,
          width: "100%",
          maxWidth: 560,
          maxHeight: "85vh",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            padding: "16px 20px",
            borderBottom: `1px solid ${T.bd}`,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div style={{ fontSize: 15, fontWeight: 900, color: T.tx }}>{title}</div>
          {onClose && (
            <button onClick={onClose} style={{ background: "none", border: "none", color: T.txd, fontSize: 22, cursor: "pointer" }}>
              ✕
            </button>
          )}
        </div>
        <div style={{ padding: 20, overflow: "auto" }}>{children}</div>
      </div>
    </div>
  );
}

function defaultData() {
  return {
    days: {},
    // explicit mapping (edit in UI if needed)
    formBaseUrl: "",
    formMap: {
      date: "entry.2005875987",
      calories: "entry.17219735",
      protein: "entry.274477235",
      fat: "entry.177798724",
      netCarbs: "entry.627541876",
      sodium: "entry.2109942087",
      potassium: "entry.75882861",
      magnesium: "entry.1303264367",
    },
  };
}

function loadData() {
  try {
    const raw = localStorage.getItem("mm:data");
    if (!raw) return defaultData();
    const j = JSON.parse(raw);
    if (!j?.days) return defaultData();
    return { ...defaultData(), ...j };
  } catch {
    return defaultData();
  }
}

function saveData(d) {
  localStorage.setItem("mm:data", JSON.stringify(d));
}

function makePrefillUrl(baseUrl, map, totals, date) {
  if (!baseUrl || !map?.date) return null;
  const url = new URL(baseUrl);

  const set = (key, val) => {
    const entry = map[key];
    if (!entry) return;
    const id = entry.replace(/^.*?(entry\.\d+)$/, "$1");
    url.searchParams.set(id, String(val));
  };

  set("date", date);
  set("calories", Math.round(totals.calories));
  set("protein", r1(totals.protein));
  set("fat", r1(totals.fat));
  set("netCarbs", r1(netCarbs(totals)));
  set("sodium", Math.round(totals.sodium));
  set("potassium", Math.round(totals.potassium));
  set("magnesium", Math.round(totals.magnesium));

  return url.toString();
}

export default function Home() {
  const [mounted, setMounted] = useState(false);
  const [tab, setTab] = useState("today");
  const [data, setData] = useState(null);
  const [selectedDate, setSelectedDate] = useState(todayStr());
  const [input, setInput] = useState("");
  const [parsing, setParsing] = useState(false);
  const [status, setStatus] = useState(null);
  const [showGuide, setShowGuide] = useState(false);

  useEffect(() => {
    setMounted(true);
    setData(loadData());
  }, []);

  useEffect(() => {
    if (!mounted || !data) return;
    saveData(data);
  }, [data, mounted]);

  const dayItems = useMemo(() => data?.days?.[selectedDate]?.items || [], [data, selectedDate]);
  const totals = useMemo(() => sum(dayItems), [dayItems]);

  const warns = useMemo(() => {
    const w = [];
    const nc = netCarbs(totals);
    if (totals.protein < 145 && dayItems.length > 2) w.push(`Protein at ${r1(totals.protein)}g — need ${r1(145 - totals.protein)}g more`);
    if (nc > 40) w.push(`Net carbs ${r1(nc)}g — above 40g`);
    if (nc > 0 && nc < 30) w.push(`Net carbs ${r1(nc)}g — below 30g min`);
    return w;
  }, [totals, dayItems.length]);

  const wkData = useMemo(() => {
    const base = new Date(selectedDate);
    const day = base.getDay();
    const diffToMon = day === 0 ? -6 : 1 - day;
    const mon = new Date(base);
    mon.setDate(base.getDate() + diffToMon);

    const out = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(mon);
      d.setDate(mon.getDate() + i);
      const ds = d.toISOString().slice(0, 10);
      const items = data?.days?.[ds]?.items || [];
      const t = sum(items);
      out.push({
        date: ds,
        label: ds.slice(5),
        has: items.length > 0,
        calories: Math.round(t.calories),
        protein: r1(t.protein),
        fat: r1(t.fat),
        netCarbs: r1(netCarbs(t)),
        sodium: Math.round(t.sodium),
        potassium: Math.round(t.potassium),
        magnesium: Math.round(t.magnesium),
      });
    }
    return out;
  }, [data, selectedDate]);

  function setDayItems(items) {
    setData((prev) => {
      const days = { ...(prev.days || {}) };
      days[selectedDate] = { items };
      return { ...prev, days };
    });
  }

  async function handleParse() {
    if (!input.trim()) return;
    setStatus(null);
    setParsing(true);
    try {
      const res = await fetch("/api/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: input.trim() }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error || "Parse failed");

      const newItems = (Array.isArray(j.items) ? j.items : []).map((it, idx) => ({
        id: `${Date.now()}-${idx}`,
        ...it,
      }));

      setDayItems([...(dayItems || []), ...newItems]);
      setInput("");
      setStatus({ type: "ok", t: "✓ Added" });
    } catch (e) {
      setStatus({ type: "err", t: `Error: ${String(e.message || e)}` });
    } finally {
      setParsing(false);
    }
  }

  function deleteItem(id) {
    setDayItems(dayItems.filter((it) => it.id !== id));
  }

  function openGoogleForm() {
    const url = makePrefillUrl(data.formBaseUrl, data.formMap, totals, selectedDate);
    if (!url) {
      setShowGuide(true);
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  }

  if (!mounted || !data) {
    return (
      <div style={{ minHeight: "100vh", background: T.bg, display: "flex", alignItems: "center", justifyContent: "center", color: T.tx }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 44, marginBottom: 12 }}>🥩</div>
          <div style={{ fontSize: 15, fontWeight: 800 }}>Loading...</div>
        </div>
      </div>
    );
  }

  const stColor =
    status?.type === "err"
      ? { bg: T.errBg, fg: "#fca5a5", bd: "rgba(239,68,68,0.3)" }
      : status?.type === "ok"
      ? { bg: "rgba(16,185,129,0.1)", fg: T.ac, bd: "rgba(16,185,129,0.3)" }
      : { bg: "rgba(96,165,250,0.1)", fg: T.na, bd: "rgba(96,165,250,0.3)" };

  return (
    <div style={{ minHeight: "100vh", background: T.bg, color: T.tx, fontFamily: "ui-sans-serif,system-ui" }}>
      <style>{`*{box-sizing:border-box}body{background:${T.bg}}input:focus,textarea:focus{outline:none;border-color:${T.ac}!important}`}</style>

      <div style={{ background: T.sf, borderBottom: `1px solid ${T.bd}`, padding: "14px 20px", position: "sticky", top: 0, zIndex: 50 }}>
        <div style={{ maxWidth: 780, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 26 }}>🥩</span>
            <div>
              <div style={{ fontSize: 17, fontWeight: 900 }}>Macro Monitor</div>
              <div style={{ fontSize: 10.5, color: T.txm }}>{todayStr()} · OpenAI + USDA</div>
            </div>
          </div>

          <div style={{ display: "flex", gap: 3, background: T.sf2, borderRadius: 12, padding: 3 }}>
            {[
              ["today", "📋", "Today"],
              ["week", "📊", "Week"],
              ["settings", "⚙️", "Settings"],
            ].map(([k, ic, lb]) => (
              <button
                key={k}
                onClick={() => setTab(k)}
                style={{
                  background: tab === k ? T.ac : "transparent",
                  color: tab === k ? "#fff" : T.txd,
                  border: "none",
                  borderRadius: 10,
                  padding: "10px 16px",
                  fontSize: 13,
                  fontWeight: 800,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <span style={{ fontSize: 14 }}>{ic}</span>
                {lb}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 780, margin: "0 auto", padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
        {tab === "today" && (
          <>
            <Card>
              <div style={{ fontSize: 13, color: T.txd, marginBottom: 10, fontWeight: 800 }}>
                Describe what you ate — GPT-5-mini parses, USDA calculates
              </div>

              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleParse();
                  }
                }}
                placeholder='e.g. "3 eggs with spinach and butter, 1 LMNT packet"'
                rows={3}
                style={{ width: "100%", background: T.sf2, border: `1px solid ${T.bd}`, borderRadius: 10, padding: "12px 14px", color: T.tx, fontSize: 14, resize: "vertical" }}
              />

              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <button
                  onClick={handleParse}
                  disabled={!input.trim() || parsing}
                  style={{
                    flex: 1,
                    background: input.trim() && !parsing ? T.ac : T.sf2,
                    border: "none",
                    borderRadius: 10,
                    padding: "11px 16px",
                    color: input.trim() && !parsing ? "#fff" : T.txm,
                    cursor: input.trim() && !parsing ? "pointer" : "default",
                    fontSize: 14,
                    fontWeight: 900,
                  }}
                >
                  {parsing ? "Analyzing..." : "🧠 Analyze & Add"}
                </button>
              </div>

              {status && (
                <div style={{ marginTop: 10, fontSize: 13, padding: "8px 12px", borderRadius: 8, background: stColor.bg, color: stColor.fg, border: `1px solid ${stColor.bd}` }}>
                  {status.t}
                </div>
              )}
            </Card>

            {warns.map((w, i) => (
              <div key={i} style={{ background: T.warnBg, border: `1px solid ${T.warn}`, borderRadius: 10, padding: "10px 14px", fontSize: 13, color: "#fcd34d" }}>
                ⚡ {w}
              </div>
            ))}

            <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
              <Metric label="Calories" value={totals.calories} unit="kcal" color={T.cal} />
              <Metric label="Protein" value={totals.protein} unit="g" color={T.prot} target="145g" warn={totals.protein < 145 && dayItems.length > 2} />
              <Metric label="Fat" value={totals.fat} unit="g" color={T.fat} />
              <Metric label="Net Carbs" value={netCarbs(totals)} unit="g" color={T.carb} target="30–35g" warn={netCarbs(totals) < 30 || netCarbs(totals) > 40} />
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
              <Metric label="Sodium" value={totals.sodium} unit="mg" color={T.na} />
              <Metric label="Potassium" value={totals.potassium} unit="mg" color={T.k} />
              <Metric label="Magnesium" value={totals.magnesium} unit="mg" color={T.mg} />
            </div>

            {dayItems.length > 0 && (
              <Card style={{ padding: 0 }}>
                <div style={{ padding: "12px 16px", borderBottom: `1px solid ${T.bd}`, fontSize: 12.5, fontWeight: 900, color: T.txd }}>
                  {selectedDate} Log · {dayItems.length} item{dayItems.length > 1 ? "s" : ""}
                </div>
                {dayItems.map((it) => (
                  <div key={it.id} style={{ padding: "10px 16px", borderBottom: `1px solid ${T.bd}`, display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 800, color: T.tx, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {it.name}
                      </div>
                      <div style={{ fontSize: 11, color: T.txd, marginTop: 2, fontFamily: "ui-monospace, SFMono-Regular" }}>
                        {ri(it.calories)}cal · {r1(it.protein)}p · {r1(it.fat)}f · {r1(Math.max(0, (it.carbs || 0) - (it.fiber || 0)))}nc
                        <span style={{ color: T.txm }}> · {ri(it.sodium)}Na · {ri(it.potassium)}K · {ri(it.magnesium)}Mg</span>
                      </div>
                    </div>
                    <button onClick={() => deleteItem(it.id)} style={{ background: "none", border: "none", color: T.txm, cursor: "pointer", fontSize: 15 }}>
                      ✕
                    </button>
                  </div>
                ))}
              </Card>
            )}

            <button
              onClick={openGoogleForm}
              disabled={!dayItems.length}
              style={{
                width: "100%",
                background: dayItems.length ? "#2563eb" : T.sf2,
                border: "none",
                borderRadius: 10,
                padding: 14,
                fontSize: 15,
                fontWeight: 900,
                color: dayItems.length ? "#fff" : T.txm,
                cursor: dayItems.length ? "pointer" : "default",
              }}
            >
              📊 Log Day in Google Sheet
            </button>

            {!data.formBaseUrl && dayItems.length > 0 && (
              <div style={{ textAlign: "center", fontSize: 12, color: T.txd }}>
                Add your Google Form prefill base URL in{" "}
                <button onClick={() => setTab("settings")} style={{ background: "none", border: "none", color: T.ac, cursor: "pointer", fontSize: 12, fontWeight: 900 }}>
                  Settings
                </button>{" "}
                to enable.
              </div>
            )}
          </>
        )}

        {tab === "week" && (
          <>
            <Card>
              <div style={{ fontSize: 13, fontWeight: 900, color: T.txd, marginBottom: 14 }}>Macros · Weekly</div>
              <div style={{ width: "100%", height: 260 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={wkData} margin={{ top: 5, right: 10, left: -15, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={T.bd} />
                    <XAxis dataKey="label" stroke={T.txm} fontSize={11} />
                    <YAxis stroke={T.txm} fontSize={10} />
                    <Tooltip contentStyle={{ background: T.sf, border: `1px solid ${T.bd}`, borderRadius: 8, fontSize: 11.5, color: T.tx }} />
                    <Legend wrapperStyle={{ fontSize: 10.5 }} />
                    <Line type="monotone" dataKey="calories" name="Cal" stroke={T.cal} strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="protein" name="Prot" stroke={T.prot} strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="fat" name="Fat" stroke={T.fat} strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="netCarbs" name="NC" stroke={T.carb} strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <Card>
              <div style={{ fontSize: 13, fontWeight: 900, color: T.txd, marginBottom: 14 }}>Electrolytes · Weekly (mg)</div>
              <div style={{ width: "100%", height: 260 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={wkData} margin={{ top: 5, right: 10, left: -15, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={T.bd} />
                    <XAxis dataKey="label" stroke={T.txm} fontSize={11} />
                    <YAxis stroke={T.txm} fontSize={10} />
                    <Tooltip contentStyle={{ background: T.sf, border: `1px solid ${T.bd}`, borderRadius: 8, fontSize: 11.5, color: T.tx }} />
                    <Legend wrapperStyle={{ fontSize: 10.5 }} />
                    <Line type="monotone" dataKey="sodium" name="Na" stroke={T.na} strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="potassium" name="K" stroke={T.k} strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="magnesium" name="Mg" stroke={T.mg} strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </>
        )}

        {tab === "settings" && (
          <>
            <Card>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <div style={{ fontSize: 14, fontWeight: 900, color: T.tx }}>📊 Google Sheet Integration</div>
                <button
                  onClick={() => setShowGuide(true)}
                  style={{ background: T.sf2, border: `1px solid ${T.bd}`, borderRadius: 8, padding: "6px 14px", color: T.ac, cursor: "pointer", fontSize: 12, fontWeight: 900 }}
                >
                  Setup Guide
                </button>
              </div>

              <div style={{ fontSize: 12, color: T.txd, marginBottom: 10 }}>
                Paste your Google Form <b>prefill base link</b> (viewform?usp=pp_url...) and confirm the 8 entry mappings.
              </div>

              <input
                value={data.formBaseUrl || ""}
                onChange={(e) => setData((p) => ({ ...p, formBaseUrl: e.target.value.trim() }))}
                placeholder="https://docs.google.com/forms/d/e/XXXX/viewform?usp=pp_url"
                style={{
                  width: "100%",
                  background: T.sf2,
                  border: `1px solid ${T.bd}`,
                  borderRadius: 8,
                  padding: "10px 12px",
                  color: T.tx,
                  fontSize: 12,
                  fontFamily: "ui-monospace, SFMono-Regular",
                }}
              />

              <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                {Object.entries(data.formMap).map(([k, v]) => (
                  <div key={k}>
                    <div style={{ fontSize: 10.5, color: T.txm, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>{k}</div>
                    <input
                      value={v}
                      onChange={(e) => setData((p) => ({ ...p, formMap: { ...p.formMap, [k]: e.target.value.trim() } }))}
                      style={{
                        width: "100%",
                        background: T.sf2,
                        border: `1px solid ${T.bd}`,
                        borderRadius: 8,
                        padding: "10px 12px",
                        color: T.tx,
                        fontSize: 12,
                        fontFamily: "ui-monospace, SFMono-Regular",
                      }}
                    />
                  </div>
                ))}
              </div>
            </Card>
          </>
        )}
      </div>

      {showGuide && (
        <Modal title="✅ Google Form Setup Guide" onClose={() => setShowGuide(false)}>
          <ol style={{ color: T.tx, fontSize: 13, lineHeight: 1.7, paddingLeft: 18 }}>
            <li>Create a Google Sheet.</li>
            <li>Create a Google Form and link it to the Sheet (Responses → Link to Sheets).</li>
            <li>Add fields: Date, Calories, Protein, Fat, Net Carbs, Sodium, Potassium, Magnesium.</li>
            <li>Form ⋮ menu → <b>Get pre-filled link</b>.</li>
            <li>Fill sample values → “Get link”. Copy the <code>viewform?usp=pp_url</code> URL into Settings.</li>
            <li>Copy each <code>entry.########</code> into the mapping fields in Settings.</li>
          </ol>
        </Modal>
      )}
    </div>
  );
}
