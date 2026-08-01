#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, http, keccak256 } from "viem";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const required = (name) => { const value=process.env[name]; if (!value) throw new Error(`${name} is required`); return value; };
const sourcePath=path.resolve(required("ROBYN_SCHEMA18_GATE1_LIFECYCLE_MANIFEST"));
const gate1Path=path.resolve(required("ROBYN_SCHEMA18_GATE1_AUTHORIZED_MANIFEST"));
const output=path.resolve(required("ROBYN_SCHEMA18_MAINNET_CANARY_REHEARSAL"));
const gateway=process.env.ROBYN_MAINNET_GATEWAY_RPC_URL ?? "http://127.0.0.1:18549";
const anvilRpc="http://127.0.0.1:28618";
const json=(v)=>JSON.stringify(v,(_,x)=>typeof x==="bigint"?x.toString():x,2);
const sha256=(v)=>createHash("sha256").update(v).digest("hex");
const source=JSON.parse(await readFile(sourcePath,"utf8"));
const gate1=JSON.parse(await readFile(gate1Path,"utf8"));
if (source.schemaVersion!==18 || source.chainId!==4663 || gate1.contractReleaseSha!==source.releaseSha) throw new Error("Gate 1 evidence mismatch");
const live=createPublicClient({transport:http(gateway,{timeout:30000,retryCount:0})});
if ((await live.getChainId())!==4663 || (await live.request({method:"eth_syncing",params:[]}))!==false) throw new Error("LAN gateway unavailable, wrong-chain, or syncing");
const health=await fetch(new URL("/health",gateway)).then((r)=>r.json());
if (health.status!=="ok" || health.activeProvider!=="primary" || health.providerSelection!=="operator" || health.fallbackTrafficAuthorized!==false) throw new Error("LAN-only gateway policy failed");
const forkBlock=await live.getBlockNumber();
await mkdir(output,{recursive:true,mode:0o700});
const toolingSha=execFileSync("git",["-C",repoRoot,"rev-parse","HEAD"],{encoding:"utf8"}).trim();
const runtimeIdentities=await Promise.all(gate1.runtimeIdentities.map(async (identity)=>{const code=await live.getCode({address:identity.address});if(!code||code==="0x")throw new Error(`missing live runtime ${identity.name}`);return {...identity,qualifiedRuntimeCodeHash:identity.runtimeCodeHash,runtimeCodeHash:keccak256(code)};}));
const manifest={schemaVersion:18,chainId:4663,contractReleaseSha:source.releaseSha,applicationReleaseSha:source.applicationReleaseSha,operationalToolingSha:toolingSha,deployer:source.deployer,guardianSafe:source.guardianSafe,contracts:source.contracts,bootstrap:source.bootstrap,routes:source.routes,runtimeIdentities,gas:{phaseCeilings:Object.fromEntries(["bootstrap","routes","launch","settle","claims","unwind","post-settle","shutdown"].map((p)=>[p,"30000000"])),maxFeePerGasWei:"1000000000000"},authorization:{additionalBridgeAuthorized:false,bootstrapStepOneAuthorized:false,canaryTransactionsAuthorized:false,publicActivationAuthorized:false,applicationWritesAuthorized:false}};
const manifestPath=path.join(output,"rehearsal-input-manifest.json"); const raw=`${json(manifest)}\n`; await writeFile(manifestPath,raw,{mode:0o600});
const env={...process.env,ROBYN_SCHEMA18_MAINNET_CANARY_LOCAL_REHEARSAL:"true",ROBYN_SCHEMA18_MAINNET_CANARY_MANIFEST:manifestPath,ROBYN_SCHEMA18_MAINNET_CANARY_MANIFEST_SHA256:sha256(raw),ROBYN_SCHEMA18_MAINNET_CANARY_EVIDENCE:output,ROBYN_MAINNET_GATEWAY_RPC_URL:anvilRpc};
const anvil=spawn(path.join(process.env.HOME??"/home/hendo420",".foundry/bin/anvil"),["--fork-url",gateway,"--fork-block-number",forkBlock.toString(),"--chain-id","4663","--port","28618","--silent"],{stdio:["ignore","pipe","pipe"]});
const rpc=async(method,params=[])=>{const response=await fetch(anvilRpc,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method,params})});const body=await response.json();if(body.error)throw new Error(`${method}: ${body.error.message}`);return body.result;};
const wait=async()=>{for(let i=0;i<100;i++){try{if(await rpc("eth_chainId")==="0x1237" && BigInt(await rpc("eth_blockNumber"))===forkBlock)return;}catch{} await new Promise((r)=>setTimeout(r,100));}throw new Error("Anvil did not start at the exact pinned fork block");};
const run=(stage)=>execFileSync(process.execPath,[path.join(repoRoot,"scripts/run-schema18-mainnet-canary-live.mjs"),stage],{cwd:repoRoot,env,encoding:"utf8",stdio:["ignore","pipe","pipe"]});
try {
  await wait(); await rpc("anvil_setBalance",[source.deployer,"0xde0b6b3a7640000"]); await rpc("anvil_impersonateAccount",[source.deployer]);
  run("verify"); run("bootstrap1"); run("routes"); run("launch");
  await rpc("evm_increaseTime",[301]); await rpc("evm_mine"); run("settle");
  await rpc("evm_increaseTime",[3601]); await rpc("evm_mine"); run("claims"); run("unwind");
  await rpc("evm_increaseTime",[301]); await rpc("evm_mine"); run("post-settle"); run("shutdown"); run("reconcile");
  const statePath=path.join(output,"state.json"); const state=JSON.parse(await readFile(statePath,"utf8")); state.forkBlock=forkBlock.toString(); await writeFile(statePath,`${json(state)}\n`,{mode:0o600});
  const journal=await readFile(path.join(output,"transactions.jsonl"),"utf8");
  const report={schemaVersion:18,status:"passed",executionMode:"local-fork-broadcast",forkBlock:forkBlock.toString(),contractReleaseSha:source.releaseSha,applicationReleaseSha:source.applicationReleaseSha,receiptCount:journal.trim().split("\n").map(JSON.parse).filter((x)=>x.type==="receipt").length,recoveryBps:state.recoveryBps,completedStages:state.completedStages,mainnetTransactionsBroadcast:0};
  const reportRaw=`${json(report)}\n`; await writeFile(path.join(output,"rehearsal-report.json"),reportRaw,{mode:0o600});
  const sums=[[`rehearsal-input-manifest.json`,sha256(raw)],[`state.json`,sha256(await readFile(statePath))],[`transactions.jsonl`,sha256(journal)],[`rehearsal-report.json`,sha256(reportRaw)]];
  await writeFile(path.join(output,"SHA256SUMS"),sums.map(([f,h])=>`${h}  ${f}`).join("\n")+"\n",{mode:0o600});
  process.stdout.write(`${json(report)}\n`);
} finally { anvil.kill("SIGTERM"); }
