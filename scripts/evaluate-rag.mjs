import { readFile,readdir } from "node:fs/promises";
import { retrievalMode, embeddingModel } from "../src/lib/knowledge/config.ts";
import { createDatabase,asUser,asWorker,rpc } from "../tests/database.mjs";
import { extractDocument } from "../src/lib/knowledge/extraction.ts";
import { chunkPassages } from "../src/lib/knowledge/chunking.ts";
import { answerQuestion } from "../src/lib/knowledge/rag.ts";
// Explicit deterministic fixture embeddings. This is a retrieval/grounding plumbing
// evaluation, not a measurement of live semantic recall or live model accuracy.
function fixtureEmbedding(text) {
  const vector=Array(768).fill(0);
  if (/auth|jwt|refresh|token/i.test(text)) vector[0]=1;
  if (/database|postgres|stores|records/i.test(text)) vector[1]=1;
  if (/deploy|production|releases/i.test(text)) vector[2]=1;
  if (!vector.some(Boolean)) vector[3]=1;
  return vector;
}
const db=await createDatabase();
const user="f7100000-0000-4000-8000-000000000001";
let hits=0,supported=0,validCitations=0,correctSource=0,abstained=0,abstentionCases=0;
try {
  await db.query("insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values($1,'eval@rag.test',now(),'{}')",[user]);await asUser(db,user);
  const workspace=await rpc(db,"create_workspace",["Evaluation"]);
  const project=(await db.query("insert into public.projects(workspace_id,name) values($1,'Evaluation') returning id",[workspace])).rows[0].id;
  for(const name of await readdir("evaluation/documents")) {
    const bytes=await readFile("evaluation/documents/"+name);
    const doc=await rpc(db,"reserve_document",[project,name,"text/markdown",bytes.length]);
    await db.query("insert into storage.objects(bucket_id,name) values('project-documents',$1)",[doc.storage_path]);await rpc(db,"queue_document",[doc.id]);
    await asWorker(db);const {job}=await rpc(db,"claim_document_job");
    const chunks=chunkPassages(await extractDocument(bytes,"text/markdown")).map(chunk=>({...chunk,embedding:retrievalMode()==="semantic"?fixtureEmbedding(chunk.content):null,embedding_model:retrievalMode()==="semantic"?embeddingModel:null}));
    await rpc(db,"finish_document_job",[job.id,job.lease_token,chunks,"fixture-hash"]);await asUser(db,user);
  }
  const questions=JSON.parse(await readFile("evaluation/questions.json","utf8"));
  for(const row of questions) {
    let retrieved=[];
    const result=await answerQuestion({question:row.question},{
      authorize:async()=>{},reserve:async()=>{},rewrite:async(q)=>q,
      embed:async(texts)=>texts.map(fixtureEmbedding),
      searchText:async(question)=>{retrieved=(await db.query("select * from public.search_project_documents_text($1,$2,5)",[project,question])).rows;return retrieved;},
      search:async(vector)=>{retrieved=(await db.query("select * from public.search_project_documents($1,$2::extensions.vector,5,0.25)",[project,JSON.stringify(vector)])).rows;return retrieved;},
      answer:async()=>{
        const index=retrieved.findIndex(source=>row.quote && source.content.includes(row.quote));
        return index<0?{supported:false,claims:[]}:{supported:true,claims:[{text:row.quote,evidence:[{source:index+1,quote:row.quote}]}]};
      },stillAvailable:async(ids)=>ids,
    });
    if(row.expected_file) {
      supported++;if(retrieved.some(source=>source.filename===row.expected_file))hits++;
      if(result.citations.some(source=>source.filename===row.expected_file))correctSource++;
      if(!result.abstained && result.citations.every(source=>retrieved.some(found=>found.id===source.id)))validCitations++;
    } else {abstentionCases++;if(result.abstained)abstained++;}
  }
  const metrics={mode:retrievalMode()==="semantic"?"deterministic mock embeddings and mock answers; real pgvector search":"real PostgreSQL full-text search; mock answers (no embeddings)",answerable:supported,hitAt5:hits/supported,correctSource:correctSource/supported,citationValidity:validCitations/supported,abstentionAccuracy:abstained/abstentionCases};
  console.log(JSON.stringify(metrics,null,2));
  if(hits!==supported||validCitations!==supported||abstained!==abstentionCases)process.exitCode=1;
}finally{await db.close();}
