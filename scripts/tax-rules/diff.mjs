import path from "node:path";
import process from "node:process";
import { display, isMain, readJson } from "./common.mjs";

export function fieldDiff(before,after){
  const changes=[];
  walk(before,after,"$",changes);
  return changes;
}
function walk(before,after,pointer,changes){
  if(Object.is(before,after))return;
  const beforeObject=before!==null&&typeof before==="object";
  const afterObject=after!==null&&typeof after==="object";
  if(beforeObject&&afterObject&&Array.isArray(before)===Array.isArray(after)){
    const keys=new Set([...Object.keys(before),...Object.keys(after)]);
    for(const key of [...keys].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}))){
      walk(before[key],after[key],`${pointer}${Array.isArray(before)?`[${key}]`:`.${key}`}`,changes);
    }
    return;
  }
  changes.push({field:pointer,before:before===undefined?null:before,after:after===undefined?null:after});
}
function render(value){
  const json=JSON.stringify(value);
  return json===undefined?"<missing>":json;
}
if(isMain(import.meta.url)){
  try{
    const args=process.argv.slice(2);
    if(args.length!==2)throw new Error("Usage: tax-rules:diff -- <old.json> <new.json>");
    const [before,after]=await Promise.all(args.map(file=>readJson(path.resolve(file))));
    const changes=fieldDiff(before,after);
    console.log(`Field-level diff: ${display(args[0])} -> ${display(args[1])}`);
    if(!changes.length)console.log("No changes.");
    for(const change of changes)console.log(`${change.field}: ${render(change.before)} -> ${render(change.after)}`);
  }catch(error){console.error(error.message);process.exitCode=1;}
}
