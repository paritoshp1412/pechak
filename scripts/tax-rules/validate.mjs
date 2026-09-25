import path from "node:path";
import process from "node:process";
import {
  assertImmutableUnchanged,
  display,
  isMain,
  readJson,
  root,
  validateIndex,
  validatePack
} from "./common.mjs";
import { verifyRelease } from "./verify.mjs";

export async function validateRepository(files=[]){
  if(files.length){
    for(const file of files){
      const resolved=path.resolve(file);
      validatePack(await readJson(resolved),{file:resolved});
      await assertImmutableUnchanged(resolved);
    }
    return;
  }
  const indexFile=path.join(root,"tax-rules","index.json");
  const index=validateIndex(await readJson(indexFile),{file:indexFile});
  for(const release of index.releases){
    const packFile=path.join(root,release.path);
    const signatureFile=path.join(root,release.signaturePath);
    const result=await verifyRelease(packFile,signatureFile,{publicKeyFile:path.join(root,release.publicKeyPath)});
    if(result.pack.rulePackVersion!==release.rulePackVersion)throw new Error(`${release.rulePackVersion} index/pack mismatch.`);
    if(result.pack.assessmentYear!==release.assessmentYear||result.pack.minimumAppVersion!==release.minimumAppVersion||
       result.pack.publishedAt!==release.publishedAt||result.pack.status!==release.status){
      throw new Error(`${release.rulePackVersion} index metadata does not match the pack.`);
    }
    if(result.signature.keyId!==release.keyId)throw new Error(`${release.rulePackVersion} index/signature key mismatch.`);
    if(result.sha256!==release.sha256)throw new Error(`${release.rulePackVersion} index hash mismatch.`);
  }
}
if(isMain(import.meta.url)){
  try{
    const files=process.argv.slice(2);
    await validateRepository(files);
    console.log(files.length?`Validated ${files.map(display).join(", ")}.`:"Validated tax-rule index, packs, semantics, immutable artifacts, hashes, and signatures.");
  }catch(error){console.error(error.message);process.exitCode=1;}
}
