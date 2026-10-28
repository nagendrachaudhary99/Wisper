import { newId } from "@wisper/contracts";
import type { Queryable } from "../client.js";
import { createRunOnce, type RunRow } from "./runs.js";

export interface RecurringRunRow { id:string; tenant_id:string; text:string; interval_minutes:number; status:"active"|"paused"|"cancelled"; workflow_id:string; last_run_id:string|null; last_fired_at:string|null; next_fire_at:string; created_at:string; updated_at:string; }
export async function createRecurringRun(db:Queryable,args:{tenantId:string;text:string;intervalMinutes:number}){
 const id=newId("rec"); const workflowId=`recurring-${id}`;
 const {rows}=await db.query<RecurringRunRow>(`INSERT INTO recurring_runs(id,tenant_id,text,interval_minutes,workflow_id,next_fire_at) VALUES($1,$2,$3,$4,$5,now()+make_interval(mins => $4)) RETURNING *`,[id,args.tenantId,args.text,args.intervalMinutes,workflowId]);
 return rows[0]!;
}
export async function getRecurringRun(db:Queryable,tenantId:string,id:string){const {rows}=await db.query<RecurringRunRow>("SELECT * FROM recurring_runs WHERE tenant_id=$1 AND id=$2",[tenantId,id]);return rows[0]??null;}
export async function listRecurringRuns(db:Queryable,tenantId:string){const {rows}=await db.query<RecurringRunRow>("SELECT * FROM recurring_runs WHERE tenant_id=$1 ORDER BY created_at DESC",[tenantId]);return rows;}
export async function cancelRecurringRun(db:Queryable,tenantId:string,id:string){const {rows}=await db.query<RecurringRunRow>("UPDATE recurring_runs SET status='cancelled',updated_at=now() WHERE tenant_id=$1 AND id=$2 AND status<>'cancelled' RETURNING *",[tenantId,id]);return rows[0]??null;}
export async function createRecurringOccurrence(db:Queryable,args:{tenantId:string;recurringRunId:string;fireKey:string;text:string;intervalMinutes:number}):Promise<RunRow>{
 const {run}=await createRunOnce(db,{tenantId:args.tenantId,idempotencyKey:`recurring:${args.recurringRunId}:${args.fireKey}`,kind:"recurring",input:{text:args.text,recurringRunId:args.recurringRunId}});
 await db.query("UPDATE runs SET recurring_run_id=$2 WHERE id=$1",[run.id,args.recurringRunId]);
 await db.query(`UPDATE recurring_runs SET last_run_id=$2,last_fired_at=now(),next_fire_at=now()+make_interval(mins => $3),updated_at=now() WHERE tenant_id=$1 AND id=$4`,[args.tenantId,run.id,args.intervalMinutes,args.recurringRunId]);
 return run;
}
