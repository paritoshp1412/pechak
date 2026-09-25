import { createPublicKey, verify as verifySignature } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
  assertImmutableUnchanged,
  canonicalBytes,
  display,
  isMain,
  publicKeyPath,
  readJson,
  sha256,
  validatePack,
  validateSignatureMetadata
} from "./common.mjs";

export async function verifyRelease(packFile,signatureFile,{publicKeyFile}={}){
  const [pack,signature]=await Promise.all([readJson(packFile),readJson(signatureFile)]);
  validatePack(pack,{file:packFile});
  validateSignatureMetadata(signature,display(signatureFile));
  await Promise.all([assertImmutableUnchanged(packFile),assertImmutableUnchanged(signatureFile)]);
  const keyFile=publicKeyFile||publicKeyPath(signature.keyId);
  const key=createPublicKey(await readFile(keyFile));
  if(key.asymmetricKeyType!=="ed25519")throw new Error(`${display(keyFile)} is not an Ed25519 public key.`);
  const canonical=canonicalBytes(pack);
  const digest=sha256(canonical);
  if(digest!==signature.sha256)throw new Error(`SHA-256 mismatch for ${display(packFile)}.`);
  const bytes=Buffer.from(signature.signature,"base64");
  if(bytes.length!==64)throw new Error(`${display(signatureFile)} does not contain a 64-byte Ed25519 signature.`);
  if(!verifySignature(null,canonical,key,bytes))throw new Error(`Ed25519 signature verification failed for ${display(packFile)}.`);
  return{pack,signature,sha256:digest,publicKeyFile:path.resolve(keyFile)};
}

function option(args,name){
  const index=args.indexOf(name);
  if(index<0)return undefined;
  if(!args[index+1])throw new Error(`${name} requires a value.`);
  return args[index+1];
}
if(isMain(import.meta.url)){
  try{
    const args=process.argv.slice(2);
    if(args.length<2)throw new Error("Usage: tax-rules:verify -- <pack.json> <pack.sig> [--public-key <public.pem>]");
    const result=await verifyRelease(path.resolve(args[0]),path.resolve(args[1]),{publicKeyFile:option(args,"--public-key")});
    console.log(`Verified ${display(args[0])}: Ed25519, RFC8785, sha256 ${result.sha256}.`);
  }catch(error){console.error(error.message);process.exitCode=1;}
}
