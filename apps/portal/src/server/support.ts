import 'server-only';
import { randomUUID } from 'node:crypto';
import { sqlClient, withClinicContext } from '@/db/client';
import { sql } from 'drizzle-orm';

export type SupportCase = {id:string;clinic_id:string;subject:string;channel:string;status:string;mode:string;needs_action:boolean;waiting_for:string;action:string;summary:string;updated_at:Date;practice_name?:string;recipient:string};
export type SupportMessage = {id:string;direction:string;body:string;received_at:Date;sender:string};
export function supportEnabled(){return process.env.SUPPORT_PORTAL_ENABLED==='1';}
export async function supportIntakeFailure() {
 await sqlClient`INSERT INTO support.health(component,ok,detail,checked_at) VALUES('portal-intake',false,'Submission failed',now()) ON CONFLICT(component) DO UPDATE SET ok=false,detail='Submission failed',checked_at=now()`;
}
export async function supportClient(clinicId:string){
 if(!supportEnabled())return null;
 const rows=await withClinicContext(clinicId,null,async tx=>await tx.execute(sql`SELECT clinic_id FROM support.clients WHERE clinic_id=${clinicId} AND active=true`));
 return rows[0]||null;
}
export async function supportCases(clinicId?:string):Promise<SupportCase[]> {
 if(!supportEnabled())return [];
 return (clinicId?await withClinicContext(clinicId,null,async tx=>await tx.execute(sql`SELECT c.* FROM support.cases c WHERE clinic_id=${clinicId} AND channel='portal' ORDER BY updated_at DESC LIMIT 100`)):
 await sqlClient`SELECT c.*,cl.practice_name FROM support.cases c JOIN support.clients cl USING(clinic_id) ORDER BY (status='OPEN') DESC,needs_action DESC,updated_at DESC LIMIT 200`) as unknown as SupportCase[];
}
export async function supportConversation(id:string,clinicId?:string) {
 if(!supportEnabled())return null;
 if(clinicId)return withClinicContext(clinicId,null,async tx=>{
  const rows=await tx.execute(sql`SELECT * FROM support.cases WHERE id=${id} AND clinic_id=${clinicId} AND channel='portal'`);
  if(!rows[0])return null;
  const messages=await tx.execute(sql`SELECT id,direction,body,received_at,sender FROM support.messages WHERE case_id=${id} AND clinic_id=${clinicId} ORDER BY received_at,stored_at,id`);
  return {case:rows[0] as unknown as SupportCase,messages:messages as unknown as SupportMessage[]};
 });
 const rows=await sqlClient`SELECT c.*,cl.practice_name FROM support.cases c JOIN support.clients cl USING(clinic_id) WHERE c.id=${id}`;
 if(!rows[0])return null;
 const messages=await sqlClient`SELECT id,direction,body,received_at,sender FROM support.messages WHERE case_id=${id} AND clinic_id=${rows[0].clinic_id} ORDER BY received_at,stored_at,id`;
 return {case:rows[0] as SupportCase,messages:messages as unknown as SupportMessage[]};
}
export async function supportSubmit(input:{clinicId:string;userId:string;email:string;subject:string;body:string;nonce:string;caseId?:string}) {
 if(!await supportClient(input.clinicId))throw new Error('Support is not activated for this practice');
 return withClinicContext(input.clinicId,input.userId,async transaction=>{
  const tx=(strings:TemplateStringsArray,...values:unknown[])=>transaction.execute(sql(strings,...values));
  // Same lock order and key as the independently hosted processor.
  await tx`SELECT pg_advisory_xact_lock(hashtext(${`ingest:${input.clinicId}`}))`;
  const external=`portal:${input.clinicId}:${input.nonce}`;
  const prior=await tx`SELECT case_id FROM support.messages WHERE external_id=${external}`;
  if(prior[0])return String(prior[0].case_id);
  let id=input.caseId;
  if(id){const c=await tx`SELECT id FROM support.cases WHERE id=${id} AND clinic_id=${input.clinicId} AND channel='portal'`;if(!c[0])throw new Error('Conversation not found');}
  else {const c=await tx`INSERT INTO support.cases(clinic_id,channel,subject,recipient) VALUES(${input.clinicId},'portal',${input.subject},${input.email}) RETURNING id`;id=String(c[0].id);}
  await tx`SELECT pg_advisory_xact_lock(hashtext(${id}))`;
  await tx`INSERT INTO support.messages(case_id,clinic_id,direction,external_id,sender,body,received_at,metadata) VALUES(${id},${input.clinicId},'inbound',${external},${input.email},${input.body},now(),${JSON.stringify({userId:input.userId,authenticated:true})}::jsonb)`;
  const ignored=/^(danke(?:\s+Ihnen)?(?:\s+sehr)?|vielen dank|besten dank|alles klar|verstanden|ok(?:ay)?|perfekt|erledigt)[.!\s]*$/i.test(input.body.trim());
  if(ignored)await tx`UPDATE support.messages SET processed_at=now() WHERE external_id=${external}`;
  else await tx`UPDATE support.cases SET status='OPEN',closed_at=NULL,revision=revision+1,recipient=${input.email},updated_at=now() WHERE id=${id}`;
  await tx`INSERT INTO support.events(kind,case_id,detail) VALUES('portal_received',${id},${JSON.stringify({userId:input.userId})}::jsonb)`;
  await tx`INSERT INTO support.health(component,ok,detail,checked_at) VALUES('portal-intake',true,'',now()) ON CONFLICT(component) DO UPDATE SET ok=true,detail='',checked_at=now()`;
  return id;
 });
}
export async function supportControl(input:{id:string;command:'takeover'|'resume'|'close'|'reopen'|'reply';note:string;actor:string}) {
 if(!supportEnabled())throw new Error('Support disabled');
 await sqlClient.begin(async tx=>{
  await tx`SELECT pg_advisory_xact_lock(hashtext(${input.id}))`;
  const rows=await tx`SELECT * FROM support.cases WHERE id=${input.id} FOR UPDATE`;const c=rows[0];if(!c)throw new Error('Conversation not found');
  if(input.command==='close'&&!input.note.trim())throw new Error('Closure requires verified outcome');
  const mode=input.command==='resume'?'auto':'manual';const status=input.command==='close'?'RESOLVED':'OPEN';
  await tx`UPDATE support.cases SET mode=${mode},status=${status},revision=revision+1,needs_action=${status==='OPEN'&&mode==='manual'},waiting_for=${status==='RESOLVED'?'none':mode==='manual'?'karam':'none'},action=${input.note},closed_at=CASE WHEN ${status}='RESOLVED' THEN now() ELSE NULL END,updated_at=now() WHERE id=${input.id}`;
  await tx`UPDATE support.outbox SET state='cancelled',error='Manual control' WHERE case_id=${input.id} AND kind='reply' AND state='pending'`;
  if(input.command==='resume')await tx`UPDATE support.messages SET processed_at=NULL WHERE case_id=${input.id} AND direction='inbound' AND first_response_at IS NULL`;
  // Closing without a reply is Karam's documented decision; the response alarm must not keep firing for it.
  if(input.command==='close')await tx`UPDATE support.messages SET processed_at=now(),metadata=CASE WHEN first_response_at IS NULL THEN metadata||'{"noResponse":true,"closedWithoutReply":true}'::jsonb ELSE metadata END WHERE case_id=${input.id} AND direction='inbound'`;
  if(input.command==='reply') {
   const messages=await tx`SELECT id,external_id FROM support.messages WHERE case_id=${input.id} AND direction='inbound' ORDER BY received_at DESC`;
   const mid=`<support-manual-${randomUUID()}@eins.ag>`;
   const payload={channel:c.channel,clinicId:c.clinic_id,triggerIds:messages.map(m=>m.id),mail:{from:'team@eins.ag',to:c.recipient,subject:`Re: ${c.subject}`,text:input.note,messageId:mid,inReplyTo:c.channel==='email'?messages[0]?.external_id:undefined,references:messages.map(m=>m.external_id).filter((s:string)=>s.startsWith('<')),internal:false}};
   await tx`INSERT INTO support.outbox(case_id,kind,dedupe_key,payload) VALUES(${input.id},'manual',${mid},${JSON.stringify(payload)}::jsonb)`;
  }
  await tx`INSERT INTO support.events(kind,case_id,detail) VALUES(${`admin_${input.command}`},${input.id},${JSON.stringify({actor:input.actor,note:input.note})}::jsonb)`;
 });
}
