import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import XLSX from "xlsx";

const root=path.resolve(import.meta.dirname,"..");
const fixture=JSON.parse(await readFile(path.join(root,"tests","fixtures","populated-state.json"),"utf8"));
const taxFixturePath=path.join(root,"tests","fixtures","tax-goldens.json");
const taxFixtures=JSON.parse(await readFile(taxFixturePath,"utf8"));
const publishedTaxPack=JSON.parse(await readFile(path.join(root,"tax-rules","in","fy-2026-27","v1.json"),"utf8"));
const expectedPath=path.join(root,"tests","golden","baseline.json");
const update=process.argv.includes("--update");
const updateTax=process.argv.includes("--update-tax");
const browserCandidates=[
  process.env.PROGRAMFILES_X86&&path.join(process.env.PROGRAMFILES_X86,"Microsoft","Edge","Application","msedge.exe"),
  process.env.PROGRAMFILES&&path.join(process.env.PROGRAMFILES,"Google","Chrome","Application","chrome.exe"),
  process.env.LOCALAPPDATA&&path.join(process.env.LOCALAPPDATA,"Microsoft","Edge","Application","msedge.exe"),
  process.env.LOCALAPPDATA&&path.join(process.env.LOCALAPPDATA,"Google","Chrome","Application","chrome.exe")
].filter(Boolean);

async function freePort(){
  return new Promise((resolve,reject)=>{
    const server=createServer();
    server.on("error",reject);
    server.listen(0,"127.0.0.1",()=>{const {port}=server.address();server.close(()=>resolve(port));});
  });
}
async function waitFor(url,attempts=100){
  let last;
  for(let i=0;i<attempts;i++){
    try{const response=await fetch(url);if(response.ok)return response;}catch(error){last=error;}
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw last||new Error(`Timed out waiting for ${url}`);
}
async function findBrowser(){
  const { access }=await import("node:fs/promises");
  for(const candidate of browserCandidates)try{await access(candidate);return candidate;}catch{}
  throw new Error("Microsoft Edge or Google Chrome is required for golden browser tests.");
}
async function populatedWorkbook(){
  const workbook=XLSX.read(await readFile(path.join(root,"public","template.xlsx")),{cellFormula:true});
  const set=(sheet,cell,value)=>{workbook.Sheets[sheet][cell]={t:typeof value==="number"?"n":"s",v:value};};
  set("Transactions","B8",1);set("Transactions","C8",4);set("Transactions","D8",2026);
  set("Transactions","G8","Salary / Recurring Income");set("Transactions","I8","External");
  set("Transactions","J8","Fixture Bank");set("Transactions","K8",75000);
  set("Transactions","L8","Salary");set("Transactions","P8","Synthetic import");
  set("Lists","A5","Fixture Bank");set("Lists","B5","Asset");set("Lists","C5","Current");
  set("Lists","D5","Bank");set("Lists","E5",10000);
  set("Investments","A6","Equity");set("Investments","B6","Stock");set("Investments","C6","Fixture Stock");
  set("Investments","D6","Fixture Bank");set("Investments","E6",5);set("Investments","F6",100);set("Investments","G6",120);
  set("Investment Lots","A5","Fixture Stock");set("Investment Lots","B5","Fixture Bank");
  set("Investment Lots","C5","2025-01-10");set("Investment Lots","D5",5);set("Investment Lots","E5",100);set("Investment Lots","F5","Test");
  set("Fixed Deposits","A5","fixture-fd");set("Fixed Deposits","B5","Fixture Bank");set("Fixed Deposits","C5",50000);
  set("Fixed Deposits","D5",0.07);set("Fixed Deposits","E5",4);set("Fixed Deposits","F5","2026-04-01");
  set("Fixed Deposits","G5","2027-04-01");set("Fixed Deposits","H5","Cumulative");set("Fixed Deposits","I5","Active");
  return XLSX.write(workbook,{type:"buffer",bookType:"xlsx",compression:true});
}
const allQueues={
  capQueue:[{id:"q-txn",action:"add"}],catQueue:[{id:"q-cat",action:"addCat"}],
  acctQueue:[{id:"q-acct",action:"addAcct"}],holdQueue:[{id:"q-hold",action:"addHold"}],
  lotQueue:[{id:"q-lot",action:"addLot"}],budQueue:[{id:"q-budget",action:"editMonthly"}],
  dedQueue:[{id:"q-ded",action:"editEntry"}],payQueue:[{id:"q-pay",action:"addPayment"}],
  cgQueue:[{id:"q-cg",action:"addEvent"}],trQueue:[{id:"q-tax",action:"save"}],
  fdQueue:[{id:"q-fd",action:"addFD"}],msQueue:[{id:"q-model",action:"save"}]
};
class Cdp{
  constructor(socket){
    this.socket=socket;this.nextId=1;this.pending=new Map();this.events=new Map();
    socket.addEventListener("message",event=>{
      const message=JSON.parse(event.data);
      if(message.id){
        const pending=this.pending.get(message.id);if(!pending)return;
        this.pending.delete(message.id);
        message.error?pending.reject(new Error(message.error.message)):pending.resolve(message.result);
      }else{
        const listeners=this.events.get(message.method)||[];
        this.events.delete(message.method);
        listeners.forEach(resolve=>resolve(message.params));
      }
    });
  }
  send(method,params={}){
    return new Promise((resolve,reject)=>{
      const id=this.nextId++;this.pending.set(id,{resolve,reject});
      this.socket.send(JSON.stringify({id,method,params}));
    });
  }
  once(method){return new Promise(resolve=>this.events.set(method,[...(this.events.get(method)||[]),resolve]));}
  async evaluate(expression){
    const result=await this.send("Runtime.evaluate",{expression,awaitPromise:true,returnByValue:true});
    if(result.exceptionDetails)throw new Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);
    return result.result.value;
  }
}

const previewPort=await freePort(),debugPort=await freePort();
const profile=await mkdtemp(path.join(tmpdir(),"pechak-golden-"));
let preview,browser;
try{
  preview=spawn(process.execPath,[path.join(root,"node_modules","vite","bin","vite.js"),"preview","--host","127.0.0.1","--port",String(previewPort)],{cwd:root,stdio:"ignore"});
  await waitFor(`http://127.0.0.1:${previewPort}/`);
  const browserPath=await findBrowser();
  browser=spawn(browserPath,["--headless=new","--disable-gpu","--no-first-run",`--remote-debugging-port=${debugPort}`,`--user-data-dir=${profile}`,"about:blank"],{stdio:"ignore"});
  await waitFor(`http://127.0.0.1:${debugPort}/json/version`);
  const page=await (await fetch(`http://127.0.0.1:${debugPort}/json/new?http://127.0.0.1:${previewPort}/?goldenTest=1`,{method:"PUT"})).json();
  const socket=new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{socket.addEventListener("open",resolve,{once:true});socket.addEventListener("error",reject,{once:true});});
  const cdp=new Cdp(socket);
  await cdp.send("Page.enable");await cdp.send("Runtime.enable");
  for(let i=0;i<100;i++){
    if(await cdp.evaluate("Boolean(window.__pechakTestApi)"))break;
    await new Promise(resolve=>setTimeout(resolve,100));
    if(i===99)throw new Error("Golden test bridge did not initialize.");
  }
  const taxResults=[];
  assert.deepStrictEqual(await cdp.evaluate("window.__pechakTestApi.taxRulesDefault()"),publishedTaxPack.rules,
    "published FY2026-27 rules must exactly mirror TAX_RULES_DEFAULT");
  for(const fixtureCase of taxFixtures){
    const actual=await cdp.evaluate(`window.__pechakTestApi.taxRuleFixture(${JSON.stringify(fixtureCase)})`);
    taxResults.push({...fixtureCase,expected:actual});
    if(!updateTax)assert.deepStrictEqual(actual,fixtureCase.expected,`tax golden failed: ${fixtureCase.name}`);
  }
  if(updateTax){
    await writeFile(taxFixturePath,JSON.stringify(taxResults,null,2)+"\n");
    console.log("Updated reviewed synthetic tax golden expectations.");
  }
  await cdp.evaluate(`window.__pechakTestApi.loadFixture(${JSON.stringify(fixture)})`);
  const largeFixture=structuredClone(fixture);
  largeFixture.queues={};
  largeFixture.state.txns=Array.from({length:5000},(_,index)=>({
    date:`2026-04-${String(index%28+1).padStart(2,"0")}`,
    kind:index%2?"Spend - Bank/Cash":"Salary / Recurring Income",
    from:index%2?"Primary Bank":"External",to:index%2?"External":"Primary Bank",
    amt:index%2?100:200,cat:index%2?"Food":"Salary",sub:"",com:`Synthetic ${index}`
  }));
  const baselineSnapshot=await cdp.evaluate("window.__pechakTestApi.snapshot()");
  const dataJourneys=await cdp.evaluate("window.__pechakTestApi.dataJourneySnapshot()");
  const explanations=await cdp.evaluate("window.__pechakTestApi.explanationSnapshot()");
  const transactionUx=await cdp.evaluate("window.__pechakTestApi.transactionUxSnapshot()");
  const driftReview=await cdp.evaluate("window.__pechakTestApi.driftReviewSnapshot()");
  const navigation=await cdp.evaluate("window.__pechakTestApi.navigationSnapshot()");
  await cdp.evaluate(`window.__pechakTestApi.loadFixture(${JSON.stringify({...fixture,queues:allQueues})})`);
  const allQueueBackup=await cdp.evaluate("window.__pechakTestApi.backupRoundTrip()");
  await cdp.evaluate(`window.__pechakTestApi.loadFixture(${JSON.stringify(largeFixture)})`);
  const largeLedger=await cdp.evaluate("window.__pechakTestApi.snapshot()");
  const populatedBytes=await populatedWorkbook();
  const emptyBytes=await readFile(path.join(root,"public","template.xlsx"));
  const emptyWorkbookImport=await cdp.evaluate(`window.__pechakTestApi.importWorkbook(${JSON.stringify(emptyBytes.toString("base64"))})`);
  const populatedWorkbookImport=await cdp.evaluate(`window.__pechakTestApi.importWorkbook(${JSON.stringify(populatedBytes.toString("base64"))})`);
  await cdp.evaluate(`window.__pechakTestApi.loadFixture(${JSON.stringify(fixture)})`);
  await cdp.evaluate("window.__pechakTestApi.prepareAllQueueMerge()");
  const actual={
    snapshot:baselineSnapshot,
    backup:await cdp.evaluate("window.__pechakTestApi.backupRoundTrip()"),
    allQueueBackup,
    largeLedger,
    emptyWorkbookImport,
    populatedWorkbookImport,
    malformedMessage:await cdp.evaluate("window.__pechakTestApi.reviewInvalidWorkbook([1,2,3,4])"),
    allQueueMerge:await cdp.evaluate("window.__pechakTestApi.mergeBundledWorkbook()")
  };
  assert.equal(actual.snapshot.finance.cashFlowCheck,0,"fixture cash flow must reconcile");
  assert.ok(Number.isFinite(actual.snapshot.tax.fdAccrued),"fixture FD tax input must be finite");
  assert.match(actual.malformedMessage,/Couldn't read file/);
  assert.ok(Object.values(actual.allQueueBackup.queues).every(count=>count===1),"every queue family must round-trip");
  assert.equal(dataJourneys.safetyCopy.queueCountsUnchanged,true,"safety copy must not clear workbook queues");
  assert.equal(dataJourneys.workbookUntouched,true,"safety copy and portable backup must not create a workbook baseline");
  assert.equal(dataJourneys.portableBackup.format,5,"portable backup format must remain readable");
  assert.deepStrictEqual(dataJourneys.labels.tabs,["Data safety","Workbook changes (1)","Update workbook"]);
  assert.ok(dataJourneys.labels.headings.includes("Safety copy (this device)"));
  assert.ok(dataJourneys.labels.headings.includes("Portable backup (JSON)"));
  assert.match(dataJourneys.labels.button,/^Saved on this device · 1 workbook change pending$/);
  assert.ok(Object.values(explanations.counts).every(count=>count>0),"every required calculation surface must expose provenance");
  assert.deepStrictEqual(explanations.labels,["Sources","Formula","Period","Exclusions","Last recalculated","App version","Tax rules","Workbook template"]);
  assert.ok(explanations.status.some(x=>/unsupported relief/i.test(x)),"tax provenance must flag unsupported relief");
  assert.equal(explanations.hasVersion,true,"provenance must show the app version");
  assert.equal(explanations.hasRules,true,"provenance must identify the active tax rules");
  assert.deepStrictEqual(transactionUx.restored,{amount:"1234",comment:"Draft",templateButtons:4});
  assert.equal(transactionUx.progressive.categoryHidden,true,"transfer forms must hide irrelevant category fields");
  assert.match(transactionUx.progressive.effect,/moves to/,"transaction form must preview the ledger effect");
  assert.equal(transactionUx.backupTemplates,1,"transaction templates must be included in backups");
  assert.equal(transactionUx.backupHasDraft,true,"transaction drafts must be included in backups");
  assert.deepStrictEqual(driftReview,{warning:true,requiresConfirmation:true,confirmDisabled:true,fingerprintShown:true});
  assert.deepStrictEqual(navigation.labels,["◇Home","⇆Activity","◎Plan","₹Tax","⋯More"]);
  assert.equal(navigation.planActive,true);assert.equal(navigation.taxActive,true);
  assert.equal(navigation.deepLink,"#taxrules","leaf routes must remain deep-linkable");
  assert.deepStrictEqual(navigation.planHubLinks,["budget","invest"]);
  assert.equal(navigation.tableColumns.firstWrap,"normal");
  assert.ok(navigation.tableColumns.firstWidth<=180,"mobile sticky table label column must leave room for values");
  assert.equal(navigation.tableColumns.sectionSticky,false,"full-width section rows must not cover scrolled table content");
  assert.ok(navigation.minTarget>=48,"mobile navigation targets must be at least 48px high");
  assert.ok(Object.values(actual.allQueueMerge.remainingQueues).every(count=>count===0),"every queue family must merge");
  const receipt=await cdp.evaluate("window.__pechakTestApi.receiptSnapshot()");
  assert.ok(receipt&&receipt.count===1,"a successful workbook update must create one receipt");
  assert.equal(receipt.hasSource,true);assert.equal(receipt.hasOutput,true);
  assert.equal(receipt.appliedFamilies,12,"receipt must report every queue family");
  assert.equal(receipt.backupCount,1,"receipts must be included in portable backups");
  assert.notDeepStrictEqual(actual.allQueueMerge.output,actual.allQueueMerge.source,"merge must change workbook XML");
  const cgReclassify=await cdp.evaluate("window.__pechakTestApi.cgReclassifyRoundTrip()");
  assert.equal(cgReclassify.rowCountAfterAdd,1,"CG add merge must write exactly one sale row");
  assert.equal(cgReclassify.classAfterAdd,"Debt MF (bought >=1Apr23)","CG add merge must classify by mfCategory/acqDate");
  assert.equal(cgReclassify.rowCountAfterEdit,1,"reclassifying an exported sale must not append a duplicate row");
  assert.equal(cgReclassify.classAfterEdit,"Gold / Gold MF / other","reclassify merge must update the existing row's class");
  assert.equal(cgReclassify.sameRow,true,"the edit merge must update the same sheet row the add merge created");
  socket.close();
  if(update){
    await mkdir(path.dirname(expectedPath),{recursive:true});
    await writeFile(expectedPath,JSON.stringify(actual,null,2)+"\n");
    console.log(`Updated ${path.relative(root,expectedPath)}`);
  }else{
    const expected=JSON.parse(await readFile(expectedPath,"utf8"));
    assert.deepStrictEqual(actual,expected);
    console.log("Golden finance, backup, malformed-workbook, and workbook-merge fixtures passed.");
  }
}finally{
  if(browser){
    browser.kill();
    await Promise.race([
      new Promise(resolve=>browser.once("exit",resolve)),
      new Promise(resolve=>setTimeout(resolve,3000))
    ]);
  }
  if(preview)preview.kill();
  for(let attempt=0;attempt<30;attempt++){
    try{await rm(profile,{recursive:true,force:true});break;}
    catch(error){
      if(error.code!=="EBUSY")throw error;
      if(attempt===29){console.warn(`Temporary browser profile remains locked and will be cleaned by the OS: ${profile}`);break;}
      await new Promise(resolve=>setTimeout(resolve,300));
    }
  }
}
