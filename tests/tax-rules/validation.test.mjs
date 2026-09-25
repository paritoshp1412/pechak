import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  fieldDiff
} from "../../scripts/tax-rules/diff.mjs";
import {
  assertImmutableUnchanged,
  root,
  validateIndex,
  validatePack
} from "../../scripts/tax-rules/common.mjs";

const pack=JSON.parse(await readFile(path.join(root,"tax-rules","in","fy-2026-27","v1.json"),"utf8"));
const clone=value=>structuredClone(value);

test("published pack passes schema and semantic validation",()=>{
  assert.equal(validatePack(clone(pack)).rulePackVersion,"in-fy2026-27-v1");
});
test("committed immutable pack passes repository validation across Git line-ending filters",()=>{
  assert.doesNotThrow(()=>assertImmutableUnchanged(path.join(root,"tax-rules","in","fy-2026-27","v1.json")));
});
test("closed schema rejects unknown metadata and rule fields",()=>{
  const metadata=clone(pack);metadata.unexpected=true;
  assert.throws(()=>validatePack(metadata),/additional properties/i);
  const rules=clone(pack);rules.rules.cg.richerInventedRate=0.1;
  assert.throws(()=>validatePack(rules),/additional properties/i);
});
test("semantic validation rejects malformed dates, rates, slabs, and checkpoints",()=>{
  const date=clone(pack);date.rules.fyEnd="2027-02-30";
  assert.throws(()=>validatePack(date),/format|fyEnd/i);
  const rate=clone(pack);rate.rules.cess=1.1;
  assert.throws(()=>validatePack(rate),/must be <= 1/i);
  const slab=clone(pack);slab.rules.newSlabs[1][0]=399999;
  assert.throws(()=>validatePack(slab),/preceding upper bound/i);
  const checkpoint=clone(pack);checkpoint.rules.advanceTax.checkpoints[2].pct=0.5;
  assert.throws(()=>validatePack(checkpoint),/percentages must increase|final advance-tax/i);
});
test("future minimum app versions and FY/AY/version mismatches fail closed",()=>{
  const incompatible=clone(pack);incompatible.minimumAppVersion="99.0.0";
  assert.throws(()=>validatePack(incompatible),/exceeds app/i);
  const year=clone(pack);year.assessmentYear="2028-29";
  assert.throws(()=>validatePack(year),/assessmentYear/i);
  const version=clone(pack);version.rulePackVersion="in-fy2026-27-v2";
  assert.throws(()=>validatePack(version,{file:path.join(root,"tax-rules","in","fy-2026-27","v1.json")}),/path/i);
});
test("index validation rejects duplicates and unknown fields",()=>{
  const release={
    financialYear:"2026-27",assessmentYear:"2027-28",version:1,rulePackVersion:"in-fy2026-27-v1",
    status:"final",publishedAt:"2026-09-25T00:00:00Z",minimumAppVersion:"1.5.0",
    path:"tax-rules/in/fy-2026-27/v1.json",signaturePath:"tax-rules/in/fy-2026-27/v1.sig",
    keyId:"pechak-release-2026-01",publicKeyPath:"tax-rules/keys/pechak-release-2026-01.pub.pem",
    sha256:"a".repeat(64)
  };
  assert.throws(()=>validateIndex({schemaVersion:1,jurisdiction:"IN",updatedAt:"2026-09-25T00:00:00Z",releases:[release,release]}),/duplicate/i);
  assert.throws(()=>validateIndex({schemaVersion:1,jurisdiction:"IN",updatedAt:"2026-09-25T00:00:00Z",releases:[{...release,extra:true}]}),/additional properties/i);
});
test("field-level diff reports nested changes without hiding additions",()=>{
  assert.deepStrictEqual(fieldDiff({rules:{cess:.04}},{rules:{cess:.05,newField:1}}),[
    {field:"$.rules.cess",before:.04,after:.05},
    {field:"$.rules.newField",before:null,after:1}
  ]);
});
