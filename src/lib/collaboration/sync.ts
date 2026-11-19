// Signals are hints only. Even late events refetch current state, never apply row patches.
export function createInvalidator(refresh:()=>void,delay=350){
 const seen=new Set<string>();let timer:ReturnType<typeof setTimeout>|undefined;let disposed=false;
 function schedule(){if(disposed||timer)return;timer=setTimeout(()=>{timer=undefined;if(!disposed)refresh();},delay);}
 return {event(scope:string,id:string){if(disposed||seen.has(scope+id))return;seen.add(scope+id);if(seen.size>512)seen.delete(seen.values().next().value!);schedule();},reconnect:schedule,dispose(){disposed=true;if(timer)clearTimeout(timer);seen.clear();}};
}
export function signalVersion(scopes:string[],signals:{scope_key:string;event_id:string}[]){return scopes.map(scope=>`${scope}:${signals.find(s=>s.scope_key===scope)?.event_id??"none"}`).sort().join("|");}
