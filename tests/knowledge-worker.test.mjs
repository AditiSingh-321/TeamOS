import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";

test("standalone worker boots and completes private storage cleanup through the SDK",async()=>{
  const requests=[];
  const server=createServer(async(req,res)=>{
    const parts=[];for await(const part of req)parts.push(part);
    const body=JSON.parse(Buffer.concat(parts).toString()||"{}");requests.push({url:req.url,body});
    assert.equal(req.headers.apikey,"test-worker-only-key");
    res.setHeader("Content-Type","application/json");
    if(req.url==="/rest/v1/rpc/claim_document_job")res.end(JSON.stringify({job:{id:"f7200000-0000-4000-8000-000000000001",kind:"cleanup",lease_token:"f7200000-0000-4000-8000-000000000002",storage_path:"workspace/project/document/source.txt"},document:null}));
    else if(req.url==="/storage/v1/object/project-documents")res.end("[]");
    else if(req.url==="/rest/v1/rpc/finish_document_job")res.end("true");
    else {res.statusCode=500;res.end('{}');}
  });
  server.listen(0,"127.0.0.1");await once(server,"listening");
  try{
    const child=spawn(process.execPath,["--conditions=react-server","--experimental-strip-types","--import","./scripts/register.mjs","scripts/document-worker.mjs","--once"],{env:{...process.env,NEXT_PUBLIC_SUPABASE_URL:`http://127.0.0.1:${server.address().port}`,SUPABASE_SERVICE_ROLE_KEY:"test-worker-only-key"},signal:AbortSignal.timeout(30000)});
    let output="";child.stdout.on("data",chunk=>output+=chunk);child.stderr.on("data",chunk=>output+=chunk);
    const [code]=await once(child,"close");assert.equal(code,0,output);assert.match(output,/Completed cleanup job/);
    assert.deepEqual(requests.map(row=>row.url),["/rest/v1/rpc/claim_document_job","/storage/v1/object/project-documents","/rest/v1/rpc/finish_document_job"]);
    assert.equal(requests[2].body.token,"f7200000-0000-4000-8000-000000000002");
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
