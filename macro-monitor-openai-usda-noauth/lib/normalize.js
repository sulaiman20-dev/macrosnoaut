export const toNumber = (x)=>{ const n=Number(x); return Number.isFinite(n)?n:0; };
export function estimateGrams({name,qty,unit}){
  const q=toNumber(qty)||1; const u=(unit||"").toLowerCase();
  if(["g","gram","grams"].includes(u)) return q;
  if(["oz","ounce","ounces"].includes(u)) return q*28.3495;
  if(/egg/.test((name||"").toLowerCase())) return q*50;
  if(["tbsp","tablespoon"].includes(u)) return q*15;
  if(["tsp","teaspoon"].includes(u)) return q*5;
  return null;
}
export function roundItem(it){
  const r=(n)=>Math.round((toNumber(n))*10)/10;
  const ri=(n)=>Math.round(toNumber(n));
  return {
    name: it.name||"",
    calories: ri(it.calories),
    protein: r(it.protein),
    fat: r(it.fat),
    carbs: r(it.carbs),
    fiber: r(it.fiber),
    sodium: ri(it.sodium),
    potassium: ri(it.potassium),
    magnesium: ri(it.magnesium)
  };
}
