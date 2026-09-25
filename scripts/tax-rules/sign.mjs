import { createPrivateKey, sign as edSign } from "node:crypto";
import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
  canonicalBytes,
  display,
  isMain,
  readJson,
  root,
  sha256,
  validatePack
} from "./common.mjs";

export async function signPack(packFile,{privateKeyFile,keyId,outputFile}){
  if(!privateKeyFile||!keyId)throw new Error("--private-key and --key-id are required.");
  const resolvedPrivate=path.resolve(privateKeyFile);
  const relative=path.relative(root,resolvedPrivate);
  if(relative===""||(!relative.startsWith("..")&&!path.isAbsolute(relative))){
    throw new Error("Private key must remain outside the repository.");
  }
  const pack=await readJson(packFile);
  validatePack(pack,{file:packFile});
  const key=createPrivateKey(await readFile(resolvedPrivate));
  if(key.asymmetricKeyType!=="ed25519")throw new Error("Private key must be PKCS#8 Ed25519.");
  const output=path.resolve(outputFile||String(packFile).replace(/\.json$/,".sig"));
  try{await access(output);throw new Error(`${display(output)} already exists; signatures are immutable.`);}catch(error){
    if(error.code!=="ENOENT")throw error;
  }
  const canonical=canonicalBytes(pack);
  const metadata={
    formatVersion:1,
    algorithm:"Ed25519",
    keyId,
    canonicalization:"RFC8785",
    sha256:sha256(canonical),
    signature:edSign(null,canonical,key).toString("base64")
  };
  await writeFile(output,JSON.stringify(metadata,null,2)+"\n",{flag:"wx",mode:0o644});
  return{output,metadata};
}

function option(args,name){
  const index=args.indexOf(name);
  return index<0?undefined:args[index+1];
}
if(isMain(import.meta.url)){
  try{
    const args=process.argv.slice(2);
    if(!args[0])throw new Error("Usage: tax-rules:sign -- <pack.json> --private-key <outside-repo.pk8> --key-id <id> [--output <pack.sig>]");
    const result=await signPack(path.resolve(args[0]),{
      privateKeyFile:option(args,"--private-key"),
      keyId:option(args,"--key-id"),
      outputFile:option(args,"--output")
    });
    console.log(`Wrote detached Ed25519 signature ${display(result.output)}. Index was not modified.`);
  }catch(error){console.error(error.message);process.exitCode=1;}
}
