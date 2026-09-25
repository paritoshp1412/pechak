import { copyFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
  display,
  expectedReleasePaths,
  isMain,
  publicKeyPath,
  readJson,
  root,
  validateIndex,
  validatePack
} from "./common.mjs";
import { verifyRelease } from "./verify.mjs";

export async function promote(packFile,signatureFile,{indexFile=path.join(root,"tax-rules","index.json")}={}){
  const pack=validatePack(await readJson(packFile),{file:packFile});
  if(pack.status!=="final")throw new Error("Only final rule packs can be promoted.");
  const destinations=expectedReleasePaths(pack);
  const sources=[path.resolve(packFile),path.resolve(signatureFile)];
  const targets=[destinations.packPath,destinations.signaturePath].map(file=>path.resolve(file));
  for(let index=0;index<targets.length;index++){
    if(sources[index]===targets[index])continue;
    const target=targets[index];
    try{await readFile(target);throw new Error(`${display(target)} already exists; immutable releases cannot be overwritten.`);}
    catch(error){if(error.code!=="ENOENT")throw error;}
  }
  const verified=await verifyRelease(packFile,signatureFile);
  let index;
  try{index=validateIndex(await readJson(indexFile),{file:indexFile});}
  catch(error){
    if(error.code!=="ENOENT")throw error;
    index={schemaVersion:1,jurisdiction:"IN",updatedAt:pack.publishedAt,releases:[]};
  }
  if(index.releases.some(release=>release.rulePackVersion===pack.rulePackVersion||release.path===repoPath(destinations.packPath))){
    throw new Error(`${pack.rulePackVersion} is already present in the index.`);
  }
  const keyPath=publicKeyPath(verified.signature.keyId);
  await readFile(keyPath);
  const release={
    financialYear:pack.financialYear,
    assessmentYear:pack.assessmentYear,
    version:destinations.version,
    rulePackVersion:pack.rulePackVersion,
    status:pack.status,
    publishedAt:pack.publishedAt,
    minimumAppVersion:pack.minimumAppVersion,
    path:repoPath(destinations.packPath),
    signaturePath:repoPath(destinations.signaturePath),
    keyId:verified.signature.keyId,
    publicKeyPath:repoPath(keyPath),
    sha256:verified.sha256
  };
  const next={...index,updatedAt:new Date().toISOString(),releases:[...index.releases,release]};
  validateIndex(next);
  await mkdir(path.dirname(destinations.packPath),{recursive:true});
  const copied=[];
  try{
    if(sources[0]!==targets[0]){await copyFile(packFile,destinations.packPath,0x1);copied.push(destinations.packPath);}
    if(sources[1]!==targets[1]){await copyFile(signatureFile,destinations.signaturePath,0x1);copied.push(destinations.signaturePath);}
    const temporary=`${indexFile}.${process.pid}.tmp`;
    await writeFile(temporary,JSON.stringify(next,null,2)+"\n",{flag:"wx"});
    await rename(temporary,indexFile);
  }catch(error){
    await Promise.all(copied.map(file=>rm(file,{force:true})));
    throw error;
  }
  return release;
}
function repoPath(file){
  return path.relative(root,path.resolve(file)).replaceAll("\\","/");
}
if(isMain(import.meta.url)){
  try{
    const args=process.argv.slice(2);
    if(args.length<2)throw new Error("Usage: tax-rules:promote -- <candidate.json> <candidate.sig> [--index <index.json>]");
    const indexAt=args.indexOf("--index");
    const release=await promote(path.resolve(args[0]),path.resolve(args[1]),{indexFile:indexAt<0?undefined:path.resolve(args[indexAt+1])});
    console.log(`Promoted ${release.rulePackVersion}; ${release.path} and signature are immutable, index updated last.`);
  }catch(error){console.error(error.message);process.exitCode=1;}
}
