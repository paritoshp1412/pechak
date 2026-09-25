import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { signPack } from "../../scripts/tax-rules/sign.mjs";
import { promote } from "../../scripts/tax-rules/promote.mjs";
import { root } from "../../scripts/tax-rules/common.mjs";
import { verifyRelease } from "../../scripts/tax-rules/verify.mjs";

const publishedPack=path.join(root,"tax-rules","in","fy-2026-27","v1.json");

test("Ed25519 signing and verification fail closed on mutation, wrong key, and missing signature",async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),"pechak-tax-sign-"));
  try{
    const packFile=path.join(directory,"candidate.json");
    const privateFile=path.join(directory,"release.pk8");
    const publicFile=path.join(directory,"release.pub.pem");
    const signatureFile=path.join(directory,"candidate.sig");
    const {privateKey,publicKey}=generateKeyPairSync("ed25519");
    await Promise.all([
      writeFile(packFile,await readFile(publishedPack)),
      writeFile(privateFile,privateKey.export({type:"pkcs8",format:"pem"})),
      writeFile(publicFile,publicKey.export({type:"spki",format:"pem"}))
    ]);
    await signPack(packFile,{privateKeyFile:privateFile,keyId:"test-release-key",outputFile:signatureFile});
    const verified=await verifyRelease(packFile,signatureFile,{publicKeyFile:publicFile});
    assert.equal(verified.signature.algorithm,"Ed25519");
    await assert.rejects(signPack(packFile,{privateKeyFile:privateFile,keyId:"test-release-key",outputFile:signatureFile}),/already exists/i);
    const changed=JSON.parse(await readFile(packFile,"utf8"));changed.rules.cess=.05;
    await writeFile(packFile,JSON.stringify(changed));
    await assert.rejects(verifyRelease(packFile,signatureFile,{publicKeyFile:publicFile}),/SHA-256 mismatch/i);
    await writeFile(packFile,await readFile(publishedPack));
    const wrong=generateKeyPairSync("ed25519").publicKey;
    const wrongFile=path.join(directory,"wrong.pub.pem");
    await writeFile(wrongFile,wrong.export({type:"spki",format:"pem"}));
    await assert.rejects(verifyRelease(packFile,signatureFile,{publicKeyFile:wrongFile}),/verification failed/i);
    await assert.rejects(verifyRelease(packFile,signatureFile,{publicKeyFile:path.join(directory,"missing.pub.pem")}),/ENOENT|no such file/i);
    await assert.rejects(verifyRelease(packFile,path.join(directory,"missing.sig"),{publicKeyFile:publicFile}),/ENOENT|no such file/i);
  }finally{await rm(directory,{recursive:true,force:true});}
});

test("signing refuses repository-local private key material",async()=>{
  await assert.rejects(signPack(publishedPack,{
    privateKeyFile:path.join(root,"tax-rules","private","forbidden.pk8"),
    keyId:"test-release-key",
    outputFile:path.join(tmpdir(),"unused.sig")
  }),/outside the repository/i);
});

test("promotion refuses overwriting an immutable release path before changing the index",async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),"pechak-tax-promote-"));
  try{
    const candidate=path.join(directory,"candidate.json"),signature=path.join(directory,"candidate.sig");
    await Promise.all([writeFile(candidate,await readFile(publishedPack)),writeFile(signature,"{}")]);
    await assert.rejects(promote(candidate,signature),/already exists|cannot be overwritten/i);
  }finally{await rm(directory,{recursive:true,force:true});}
});
