export interface RunSummary { id:string; status:string; input:{text?:string}; plan?:{summary?:string}|null; error?:string|null; created_at:string; updated_at?:string; }
export interface Attempt { id:string; step_id:string; provider:string; request:unknown; response:unknown; status:string; error:string|null; created_at:string; completed_at:string|null; }
export interface RecurringRun {id:string;text:string;interval_minutes:number;status:string;last_run_id:string|null;last_fired_at:string|null;next_fire_at:string;created_at:string;}
export interface Step { id:string; ordinal:number; kind:string; status:string; result:unknown; error:string|null; }
export interface Approval { id:string; run_id:string; step_id:string; status:"pending"|"approved"|"rejected"; action:{kind:string;input:Record<string,unknown>}; created_at:string; }
export interface AuditEvent { id:number; run_id:string|null; step_id?:string|null; actor:string; event_type:string; data:unknown; created_at:string; }
export interface RunDetail { run:RunSummary; steps:Step[]; attempts:Attempt[]; approvals:Approval[]; audit:AuditEvent[]; }
export interface Dashboard { recurring:RecurringRun[]; counts:Record<string,number>; runs:RunSummary[]; approvals:Approval[]; failures:RunSummary[]; audit:AuditEvent[]; steps:Step[]; }
export interface SystemStatus { planner:{mode:string;live:boolean}; google:{configured:boolean;connected:boolean;accountEmail:string|null;scopes:string[];gmail:boolean;calendar:boolean;docs:false}; provider:string; }
export class ApiClient {
 constructor(private token:string){}
 private async call<T>(path:string,init?:RequestInit):Promise<T>{const res=await fetch(path,{...init,headers:{"content-type":"application/json",authorization:`Bearer ${this.token}`,...(init?.headers??{})}});if(!res.ok)throw new Error(`${res.status}: ${await res.text()}`);return await res.json() as T;}
 chat(text:string,idempotencyKey:string){return this.call<{runId:string;status:string;deduplicated:boolean}>("/v1/chat",{method:"POST",body:JSON.stringify({text,idempotencyKey})});}
 async run(id:string){const d=await this.call<RunDetail>(`/v1/runs/${id}`);return {run:normalizeRun(d.run),steps:(d.steps??[]).map(normalizeStep),attempts:(d.attempts??[]).map(normalizeAttempt),approvals:(d.approvals??[]).map(normalizeApproval),audit:(d.audit??[]).map(normalizeAudit)};}
 deleteRun(id:string){return this.call<{ok:boolean;cancelError:string|null}>(`/v1/runs/${id}`,{method:"DELETE"});}
 async dashboard(){const d=await this.call<Dashboard>("/v1/dashboard");return {...d,runs:(d.runs??[]).map(normalizeRun),failures:(d.failures??[]).map(normalizeRun),approvals:(d.approvals??[]).map(normalizeApproval),steps:(d.steps??[]).map(normalizeStep),audit:(d.audit??[]).map(normalizeAudit)};}
 createRecurring(text:string,intervalMinutes:number){return this.call<{recurring:RecurringRun}>("/v1/recurring",{method:"POST",body:JSON.stringify({text,intervalMinutes})});}
 cancelRecurring(id:string){return this.call<{ok:boolean}>(`/v1/recurring/${id}`,{method:"DELETE"});}
 status(){return this.call<SystemStatus>("/v1/system/status");}
 googleAuthorizationUrl(){return this.call<{authorizationUrl:string}>("/v1/oauth/google/start");}
 async pendingApprovals(){const r=await this.call<{approvals:Approval[]}>("/v1/approvals?status=pending");return {approvals:(r.approvals??[]).map(normalizeApproval)};}
 decide(id:string,approved:boolean){return this.call<{ok:boolean;status:string}>(`/v1/approvals/${id}/decision`,{method:"POST",body:JSON.stringify({approved,decidedBy:"web-user"})});}
}

/** API rows carry jsonb fields as JSON strings (they are stored stringified);
 *  parse them once at the client boundary so cards render real content. */
function parseField<T>(v:unknown):T{ if(typeof v!=="string")return v as T; try{return JSON.parse(v) as T;}catch{return v as T;} }
function normalizeRun(r:RunSummary):RunSummary{ if(!r)return r; return {...r,input:parseField(r.input),plan:r.plan?parseField(r.plan):r.plan}; }
function normalizeStep(s:Step):Step{ return {...s,result:s.result==null?s.result:parseField(s.result)}; }
function normalizeAttempt(a:Attempt):Attempt{ return {...a,request:parseField(a.request),response:a.response==null?a.response:parseField(a.response)}; }
function normalizeApproval(a:Approval):Approval{ return {...a,action:parseField(a.action)}; }
function normalizeAudit(e:AuditEvent):AuditEvent{ return {...e,data:parseField(e.data)}; }

export interface GmailMessageView { messageId?:string; from?:string; subject?:string; snippet?:string; receivedAt?:string; }
/** Step results arrive from the API as JSON strings; parse when possible, else keep the raw text. */
export function parseJsonResult(result:unknown):unknown {
 if(typeof result!=="string")return result;
 try{return JSON.parse(result) as unknown;}catch{return result;}
}
/** Gmail summaries when the result is a gmail.read payload; null for anything else. */
export function gmailMessagesOf(result:unknown):GmailMessageView[]|null {
 const data=parseJsonResult(result);
 if(data&&typeof data==="object"&&Array.isArray((data as {messages?:unknown}).messages))return (data as {messages:GmailMessageView[]}).messages;
 return null;
}

/** Explain a zero-result Gmail search using the query stored with the result. */
export function gmailEmptyMessageOf(result:unknown):string {
 const data=parseJsonResult(result);
 const query=data&&typeof data==="object"&&(data as {query?:unknown}).query;
 return typeof query==="string"&&query.trim() ? `No emails matched '${query}'.` : "No unread messages returned.";
}

export interface LocalCommandView { preview: string; stdout: string; stderr: string; exitCode: number; }
/** Command result when the result is a local.run_command payload; null for anything else. */
export function localCommandOf(result: unknown): LocalCommandView | null {
  const data = parseJsonResult(result);
  if (!data || typeof data !== "object") return null;
  const d = data as { preview?: unknown; stdout?: unknown; stderr?: unknown; exitCode?: unknown };
  if (typeof d.exitCode !== "number" || typeof d.preview !== "string") return null;
  return { preview: d.preview, stdout: typeof d.stdout === "string" ? d.stdout : "", stderr: typeof d.stderr === "string" ? d.stderr : "", exitCode: d.exitCode };
}

/** Duplicate of @wisper/contracts isPrivateHost (web intentionally carries no
 *  contracts dependency; keep in sync). True for loopback/RFC1918/link-local
 *  or name-only hosts - the approval card warns on these. */
export function isPrivateHost(url: string): boolean {
  try {
    const h = new URL(url).hostname.toLowerCase();
    if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return true;
    if (h === "[::1]" || h === "::1") return true;
    if (!h.includes(".")) return true;
    const m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
    if (!m) return false;
    const [a, b] = [Number(m[1]), Number(m[2])];
    return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || a === 0;
  } catch {
    return true;
  }
}
