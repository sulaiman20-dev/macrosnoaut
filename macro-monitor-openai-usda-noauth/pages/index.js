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
    const id = entry.replace(/^.*?(entry\.\d+)$/, "*
