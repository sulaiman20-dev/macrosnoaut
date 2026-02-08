export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed",
      gotMethod: req.method,
      headers: req.headers?.["content-type"] || null,
    });
  }
  // ...rest of your existing code...
}



import OpenAI from "openai";
import { estimateGrams, roundItem, toNumber } from "../../lib/normalize.js";
import { usdaSearchFood, usdaGetFoodPer100 } from "../../lib/usda.js";

const openai=new OpenAI({apiKey:process.env.OPENAI_API_KEY});

export default async function handler(req,res){
  if(req.method!=="POST") return res.status(405).json({error:"Method not allowed"});
  const {text}=req.body||{};
  if(!text) return res.status(400).json({error:"Missing text"});

  const schema={name:"ParsedFoods",strict:true,schema:{type:"object",properties:{items:{type:"array",items:{type:"object",properties:{name:{type:"string"},qty:{type:"number"},unit:{type:"string"},grams:{type:["number","null"]},usdaQuery:{type:"string"}},required:["name","qty","unit","grams","usdaQuery"]}}},required:["items"]}};
  const resp=await openai.responses.create({
    model:"gpt-5-mini",
    input:[{role:"system",content:"Parse foods only. No nutrition."},{role:"user",content:text}],
    text:{format:{type:"json_schema",json_schema:schema}}
  });
  const parsed=JSON.parse(resp.output_text||"{}");
  const out=[];
  for(const p of (parsed.items||[])){
    const grams=p.grams??estimateGrams(p);
    const fdcId=await usdaSearchFood(p.usdaQuery||p.name);
    if(!fdcId){ out.push(roundItem({name:p.name})); continue; }
    const per100=await usdaGetFoodPer100(fdcId);
    const g=grams??100; const f=g/100;
    out.push(roundItem({name:`${p.name} (${Math.round(g)}g)`,
      calories:per100.calories*f,protein:per100.protein*f,fat:per100.fat*f,carbs:per100.carbs*f,fiber:per100.fiber*f,
      sodium:per100.sodium*f,potassium:per100.potassium*f,magnesium:per100.magnesium*f}));
  }
  res.json({items:out});
}
