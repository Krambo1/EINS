'use server';
import {z} from 'zod';
import {revalidatePath} from 'next/cache';
import {requirePermissionOrRedirect} from '@/auth/guards';
import {supportSubmit,supportIntakeFailure} from '@/server/support';
const Input=z.object({subject:z.string().trim().min(2).max(140),body:z.string().trim().min(2).max(12000),nonce:z.string().uuid(),caseId:z.string().uuid().optional()});
export async function sendSupport(_state:{error:string;caseId?:string}|undefined,form:FormData):Promise<{error:string;caseId?:string}>{
 const s=await requirePermissionOrRedirect('feedback.submit');
 if(s.impersonatedByAdminId)return {error:'Bitte antworten Sie über die persönliche Betreuung in der Verwaltung.'};
 const p=Input.safeParse({subject:form.get('subject'),body:form.get('body'),nonce:form.get('nonce'),caseId:form.get('caseId')||undefined});
 if(!p.success)return {error:'Bitte prüfen Sie Betreff und Nachricht.'};
 let id:string;
 try{id=await supportSubmit({...p.data,clinicId:s.clinicId,userId:s.userId,email:s.email});}
 catch(error){await supportIntakeFailure().catch(()=>{});console.error('support_submit_failed',{code:(error as {code?:string})?.code||'unknown'});return {error:'Ihre Nachricht wurde nicht bestätigt. Bitte versuchen Sie es erneut oder schreiben Sie an team@eins.ag.'};}
 revalidatePath('/support');return {error:'',caseId:id};
}
