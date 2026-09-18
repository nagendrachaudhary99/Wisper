export interface RunSummary { id:string; status:string; input:{text?:string}; plan?:{summary?:string}|null; error?:string|null; created_at:string; updated_at?:string; }
export interface Step { id:string; ordinal:number; kind:string; status:string; result:unknown; error:string|null; }
export interface Approval { id:string; run_id:string; step_id:string; status:"pending"|"approved"|"rejected"; action:{kind:string;input:Record<string,unknown>}; created_at:string; }
export interface AuditEvent { id:number; run_id:string|null; actor:string; event_type:string; data:unknown; created_at:string; }
export interface RunDetail { run:RunSummary; steps:Step[]; approvals:Approval[]; audit:AuditEvent[]; }
export interface Dashboard { counts:Record<string,number>; runs:RunSummary[]; approvals:Approval[]; failures:RunSummary[]; audit:AuditEvent[]; }
export class ApiClient {
 constructor(private token:string){}
 private async call<T>(path:string,init?:RequestInit):Promise<T>{const res=await fetch(path,{...init,headers:{"content-type":"application/json",authorization:`Bearer ${this.token}`,...(init?.headers??{})}});if(!res.ok)throw new Error(`${res.status}: ${await res.text()}`);return await res.json() as T;}
 chat(text:string,idempotencyKey:string){return this.call<{runId:string;status:string;deduplicated:boolean}>("/v1/chat",{method:"POST",body:JSON.stringify({text,idempotencyKey})});}
 run(id:string){return this.call<RunDetail>(`/v1/runs/${id}`);} dashboard(){return this.call<Dashboard>("/v1/dashboard");}
 googleAuthorizationUrl(){return this.call<{authorizationUrl:string}>("/v1/oauth/google/start");}
 pendingApprovals(){return this.call<{approvals:Approval[]}>("/v1/approvals?status=pending");}
 decide(id:string,approved:boolean){return this.call<{ok:boolean;status:string}>(`/v1/approvals/${id}/decision`,{method:"POST",body:JSON.stringify({approved,decidedBy:"web-user"})});}
}
