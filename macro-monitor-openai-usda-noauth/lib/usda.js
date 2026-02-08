const N={calories:"208",protein:"203",fat:"204",carbs:"205",fiber:"291",sodium:"307",potassium:"306",magnesium:"304"};
export async function usdaSearchFood(query){
  const key=process.env.USDA_API_KEY;
  const r=await fetch(`https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${key}`,{
    method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({query,pageSize:1})
  });
  const j=await r.json();
  return j?.foods?.[0]?.fdcId||null;
}
export async function usdaGetFoodPer100(fdcId){
  const key=process.env.USDA_API_KEY;
  const r=await fetch(`https://api.nal.usda.gov/fdc/v1/food/${fdcId}?api_key=${key}`);
  const j=await r.json();
  const map=new Map();
  (j.foodNutrients||[]).forEach(n=>{
    const num=String(n?.nutrient?.number||n?.nutrientNumber||"");
    if(num) map.set(num,n.amount);
  });
  return {
    calories: map.get(N.calories)||0,
    protein: map.get(N.protein)||0,
    fat: map.get(N.fat)||0,
    carbs: map.get(N.carbs)||0,
    fiber: map.get(N.fiber)||0,
    sodium: map.get(N.sodium)||0,
    potassium: map.get(N.potassium)||0,
    magnesium: map.get(N.magnesium)||0,
  };
}
