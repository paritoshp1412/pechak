import { generateKeyPairSync } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { display, isMain, publicKeyPath, root } from "./common.mjs";

export async function bootstrapKey({keyId,privateKeyOut}){
  if(!/^[a-z0-9][a-z0-9-]{2,80}$/.test(keyId||""))throw new Error("--key-id must be a lowercase release-key identifier.");
  if(!privateKeyOut)throw new Error("--private-key-out is required.");
  const privateFile=path.resolve(privateKeyOut);
  const relative=path.relative(root,privateFile);
  if(relative===""||(!relative.startsWith("..")&&!path.isAbsolute(relative))){
    throw new Error("Private key output must be outside the repository.");
  }
  const publicFile=publicKeyPath(keyId);
  const {privateKey,publicKey}=generateKeyPairSync("ed25519");
  await mkdir(path.dirname(privateFile),{recursive:true});
  await mkdir(path.dirname(publicFile),{recursive:true});
  await writeFile(privateFile,privateKey.export({type:"pkcs8",format:"pem"}),{flag:"wx",mode:0o600});
  try{
    await writeFile(publicFile,publicKey.export({type:"spki",format:"pem"}),{flag:"wx",mode:0o644});
  }catch(error){
    const { rm }=await import("node:fs/promises");
    await rm(privateFile,{force:true});
    throw error;
  }
  return{privateFile,publicFile};
}
function option(args,name){
  const index=args.indexOf(name);
  return index<0?undefined:args[index+1];
}
if(isMain(import.meta.url)){
  try{
    const args=process.argv.slice(2);
    const result=await bootstrapKey({keyId:option(args,"--key-id"),privateKeyOut:option(args,"--private-key-out")});
    console.log(`Private PKCS#8 key: ${result.privateFile}`);
    console.log(`Commit only public key: ${display(result.publicFile)}`);
  }catch(error){console.error(error.message);process.exitCode=1;}
}
