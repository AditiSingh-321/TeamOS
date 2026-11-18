import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { actionSchema,actionRegistry } from "../intelligence/registry";
import { intelligenceRpc } from "../intelligence/db";
/** Entry to the atomic database task handlers. Never executes an unapproved payload. */
export async function executeApprovedProposal(db:SupabaseClient,proposal:{id:string;action_type:string;payload:unknown;revision:number}){
 const action=actionSchema.parse({type:proposal.action_type,payload:proposal.payload});
 if(actionRegistry[action.type].permission!=="manager")throw new Error("Unsupported approval permission.");
 return intelligenceRpc(db,"review_action_proposal",{target_proposal:proposal.id,expected_revision:proposal.revision,operation:"approve"});
}
