"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { primaryLinkClass } from "@/components/workspaces/styles";
export function SourceProposalButton({projectId,riskId,meetingId,analysisId,revision}:{projectId:string;riskId?:string;meetingId?:string;analysisId?:string;revision?:number}){
 const [busy,setBusy]=useState(false),[error,setError]=useState("");const router=useRouter();
 async function submit(){setBusy(true);setError("");try{const path=riskId?`/api/projects/${projectId}/risks/${riskId}/propose`:`/api/projects/${projectId}/meetings/${meetingId}/proposals`;const response=await fetch(path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({analysisId,revision})});const result=await response.json();if(!response.ok)throw new Error(result.error);router.push(`/approvals?project=${projectId}`);router.refresh();}catch(err){setError((err as Error).message);}finally{setBusy(false);}}
 return <div className="space-y-2"><button type="button" disabled={busy} onClick={()=>void submit()} className={`${primaryLinkClass} disabled:opacity-50`}>{busy?"Preparing…":riskId?"Propose follow-up":"Send reviewed actions for approval"}</button>{error&&<p role="alert" className="text-sm text-destructive">{error}</p>}</div>;
}
