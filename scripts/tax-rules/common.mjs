import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import canonicalize from "canonicalize";

export const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..","..");
export const taxRulesRoot=path.join(root,"tax-rules");
const schemaRoot=path.join(taxRulesRoot,"schemas");
const appPackage=JSON.parse(await readFile(path.join(root,"package.json"),"utf8"));
export const appVersion=appPackage.version;
export function isMain(moduleUrl){
  return Boolean(process.argv[1])&&path.resolve(process.argv[1])===fileURLToPath(moduleUrl);
}

const schemas={
  pack:JSON.parse(await readFile(path.join(schemaRoot,"rule-pack-v1.schema.json"),"utf8")),
  index:JSON.parse(await readFile(path.join(schemaRoot,"index-v1.schema.json"),"utf8")),
  signature:JSON.parse(await readFile(path.join(schemaRoot,"signature-v1.schema.json"),"utf8"))
};
const ajv=new Ajv2020({allErrors:true,strict:true});
ajv.addFormat("date",{type:"string",validate:value=>isDate(value)});
ajv.addFormat("date-time",{type:"string",validate:value=>isDateTime(value)});
ajv.addFormat("uri",{type:"string",validate:value=>{try{return Boolean(new URL(value));}catch{return false;}}});
const validators={
  pack:ajv.compile(schemas.pack),
  index:ajv.compile(schemas.index),
  signature:ajv.compile(schemas.signature)
};

export function readJson(file){
  return readFile(file,"utf8").then(text=>{
    try{return JSON.parse(text);}
    catch(error){throw new Error(`${display(file)} is not valid JSON: ${error.message}`);}
  });
}
export function display(file){
  const relative=path.relative(root,path.resolve(file));
  return relative.startsWith("..")?path.resolve(file):relative.replaceAll("\\","/");
}
export function canonicalBytes(value){
  const json=canonicalize(value);
  if(typeof json!=="string")throw new Error("RFC 8785 canonicalization failed.");
  return Buffer.from(json,"utf8");
}
export function sha256(bytes){
  return createHash("sha256").update(bytes).digest("hex");
}
export function parseVersion(value,label="version"){
  const match=/^(\d+)\.(\d+)\.(\d+)$/.exec(value||"");
  if(!match)throw new Error(`${label} must be a three-part semantic version.`);
  return match.slice(1).map(Number);
}
export function compareVersions(a,b){
  const av=parseVersion(a),bv=parseVersion(b);
  for(let i=0;i<3;i++)if(av[i]!==bv[i])return av[i]-bv[i];
  return 0;
}
export function assertSchema(kind,value,label=kind){
  const validate=validators[kind];
  if(!validate)throw new Error(`Unknown schema kind: ${kind}`);
  if(validate(value))return;
  const details=validate.errors.map(error=>`${error.instancePath||"/"} ${error.message}`).join("; ");
  throw new Error(`${label} failed closed-schema validation: ${details}`);
}
export function validatePack(pack,{file,compatibleVersion=appVersion}={}){
  const label=file?display(file):"rule pack";
  assertSchema("pack",pack,label);
  const errors=[];
  const [startYear,endSuffix]=pack.financialYear.split("-").map(Number);
  const expectedEnd=(startYear+1)%100;
  if(endSuffix!==expectedEnd)errors.push("financialYear must cover consecutive years");
  const expectedAssessment=`${startYear+1}-${String((startYear+2)%100).padStart(2,"0")}`;
  if(pack.assessmentYear!==expectedAssessment)errors.push(`assessmentYear must be ${expectedAssessment}`);
  if(pack.effectiveFrom!==`${startYear}-04-01`)errors.push("effectiveFrom must be the first day of the financial year");
  const expectedPackVersion=`in-fy${pack.financialYear}-v${releaseNumber(pack.rulePackVersion)}`;
  if(pack.rulePackVersion!==expectedPackVersion)errors.push(`rulePackVersion must be ${expectedPackVersion}`);
  const rules=pack.rules;
  if(rules.fy!==`FY${pack.financialYear}`)errors.push("rules.fy does not match financialYear");
  if(rules.ay!==`AY${pack.assessmentYear}`)errors.push("rules.ay does not match assessmentYear");
  if(rules.fyStart!==`${startYear}-04-01`)errors.push("rules.fyStart does not match financialYear");
  if(rules.fyEnd!==`${startYear+1}-03-31`)errors.push("rules.fyEnd does not match financialYear");
  if(pack.effectiveFrom!==rules.fyStart)errors.push("effectiveFrom does not match rules.fyStart");
  if(compareVersions(pack.minimumAppVersion,compatibleVersion)>0)errors.push(`minimumAppVersion ${pack.minimumAppVersion} exceeds app ${compatibleVersion}`);
  if(pack.status!=="final"&&file&&isReleasePath(file))errors.push("immutable release packs must have final status");
  if(!pack.sourceUrls.some(url=>isOfficialGovernmentUrl(url)))errors.push("sourceUrls must include an official .gov.in or .nic.in source");
  validateSlabs(rules.newSlabs,"rules.newSlabs",errors);
  validateSlabs(rules.oldSlabs,"rules.oldSlabs",errors);
  validateSlabs(rules.surchargeSlabs,"rules.surchargeSlabs",errors);
  if(rules.rebate.newMax>rules.rebate.newLimit)errors.push("new-regime rebate cannot exceed its income limit");
  if(rules.rebate.oldMax>rules.rebate.oldLimit)errors.push("old-regime rebate cannot exceed its income limit");
  if(rules.fdTds.seniorThreshold<rules.fdTds.threshold)errors.push("senior FD threshold cannot be lower than the normal threshold");
  validateCheckpoints(rules,startYear,errors);
  if(file){
    const normalized=path.resolve(file);
    const releaseMatch=normalized.replaceAll("\\","/").match(/\/tax-rules\/in\/fy-(\d{4}-\d{2})\/v(\d+)\.json$/);
    if(releaseMatch&&(releaseMatch[1]!==pack.financialYear||Number(releaseMatch[2])!==releaseNumber(pack.rulePackVersion))){
      errors.push("financial year/version metadata does not match the immutable release path");
    }
  }
  if(errors.length)throw new Error(`${label} failed semantic validation:\n- ${errors.join("\n- ")}`);
  return pack;
}
export function validateSignatureMetadata(signature,label="signature"){
  assertSchema("signature",signature,label);
  return signature;
}
export function validateIndex(index,{file}={}){
  const label=file?display(file):"tax-rule index";
  assertSchema("index",index,label);
  const seenVersions=new Set(),seenPaths=new Set();
  const errors=[];
  for(const release of index.releases){
    if(seenVersions.has(release.rulePackVersion))errors.push(`duplicate rulePackVersion ${release.rulePackVersion}`);
    if(seenPaths.has(release.path)||seenPaths.has(release.signaturePath))errors.push(`duplicate release path for ${release.rulePackVersion}`);
    seenVersions.add(release.rulePackVersion);seenPaths.add(release.path);seenPaths.add(release.signaturePath);
    const expectedBase=`tax-rules/in/fy-${release.financialYear}/v${release.version}`;
    if(release.path!==`${expectedBase}.json`||release.signaturePath!==`${expectedBase}.sig`)errors.push(`${release.rulePackVersion} path/version mismatch`);
    if(release.rulePackVersion!==`in-fy${release.financialYear}-v${release.version}`)errors.push(`${release.rulePackVersion} metadata mismatch`);
    if(release.publicKeyPath!==`tax-rules/keys/${release.keyId}.pub.pem`)errors.push(`${release.rulePackVersion} key path mismatch`);
  }
  if(errors.length)throw new Error(`${label} failed semantic validation:\n- ${errors.join("\n- ")}`);
  return index;
}
export function expectedReleasePaths(pack){
  const version=releaseNumber(pack.rulePackVersion);
  const base=path.join(taxRulesRoot,"in",`fy-${pack.financialYear}`,`v${version}`);
  return{version,packPath:`${base}.json`,signaturePath:`${base}.sig`};
}
export function releaseNumber(rulePackVersion){
  const match=/-v([1-9]\d*)$/.exec(rulePackVersion||"");
  if(!match)throw new Error(`Invalid rulePackVersion: ${rulePackVersion}`);
  return Number(match[1]);
}
export function isReleasePath(file){
  const relative=path.relative(taxRulesRoot,path.resolve(file)).replaceAll("\\","/");
  return /^in\/fy-\d{4}-\d{2}\/v[1-9]\d*\.(json|sig)$/.test(relative);
}
export function assertImmutableUnchanged(file){
  const relative=path.relative(root,path.resolve(file)).replaceAll("\\","/");
  if(relative.startsWith("..")||!isReleasePath(file))return;
  try{execFileSync("git",["cat-file","-e",`HEAD:${relative}`],{cwd:root,stdio:"ignore"});}
  catch{return;}
  try{execFileSync("git",["diff","--quiet","HEAD","--",relative],{cwd:root,stdio:"ignore"});}
  catch(error){
    if(error.status===1)throw new Error(`${relative} is an immutable release artifact already present at HEAD; publish a new version instead.`);
    throw new Error(`Could not verify immutable artifact ${relative}: ${error.message}`);
  }
}
export function publicKeyPath(keyId){
  return path.join(taxRulesRoot,"keys",`${keyId}.pub.pem`);
}

function isDate(value){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
  const date=new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf())&&date.toISOString().slice(0,10)===value;
}
function isDateTime(value){
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value))return false;
  return !Number.isNaN(new Date(value).valueOf());
}
function isOfficialGovernmentUrl(value){
  try{
    const host=new URL(value).hostname.toLowerCase();
    return host.endsWith(".gov.in")||host==="gov.in"||host.endsWith(".nic.in")||host==="nic.in";
  }catch{return false;}
}
function validateSlabs(slabs,label,errors){
  let previous=0;
  slabs.forEach((slab,index)=>{
    const [from,upTo]=slab;
    if(index===0&&from!==0)errors.push(`${label} must start at zero`);
    if(from!==previous)errors.push(`${label}[${index}] must start at the preceding upper bound`);
    if(upTo<=from)errors.push(`${label}[${index}] upper bound must exceed lower bound`);
    previous=upTo;
  });
  if(previous<1_000_000_000_000)errors.push(`${label} must end at the 1e12 sentinel or higher`);
}
function validateCheckpoints(rules,startYear,errors){
  let previousDate="",previousPct=-1;
  const dates=new Set();
  for(const [index,checkpoint] of rules.advanceTax.checkpoints.entries()){
    const [month,day]=checkpoint.date.split("-").map(Number);
    const year=month>=4?startYear:startYear+1;
    const date=`${year}-${checkpoint.date}`;
    if(!isDate(date))errors.push(`rules.advanceTax.checkpoints[${index}] is not a real date`);
    if(dates.has(checkpoint.date))errors.push(`duplicate advance-tax checkpoint ${checkpoint.date}`);
    if(previousDate&&date<=previousDate)errors.push("advance-tax checkpoints must be in FY chronological order");
    if(checkpoint.pct<=previousPct)errors.push("advance-tax checkpoint percentages must increase");
    dates.add(checkpoint.date);previousDate=date;previousPct=checkpoint.pct;
  }
  if(previousPct!==1)errors.push("final advance-tax checkpoint must require 100%");
}
