'use client';
import {useActionState,useState,useEffect} from 'react';
import {useRouter} from 'next/navigation';
import {sendSupport} from './actions';
export function MessageForm({nonce,caseId,subject}:{nonce:string;caseId?:string;subject?:string}) {
 const [state,action,pending]=useActionState(sendSupport,{error:''});
 const [text,setText]=useState('');
 const [title,setTitle]=useState('');
 const [submissionId,setSubmissionId]=useState(nonce);
 const router=useRouter();
 useEffect(()=>{if(state.caseId){setText('');setTitle('');setSubmissionId(crypto.randomUUID());router.push(`/support/${state.caseId}`);router.refresh();}},[state,router]);
 return <form action={action} className="space-y-4">
  <input type="hidden" name="nonce" value={submissionId}/>{caseId&&<input type="hidden" name="caseId" value={caseId}/>}
  {subject?<input type="hidden" name="subject" value={subject}/>:<label className="block">Betreff<input name="subject" value={title} onChange={e=>setTitle(e.target.value)} required minLength={2} maxLength={140} className="mt-2 w-full rounded-lg border border-border bg-bg-primary p-3"/></label>}
  <label className="block">Ihre Nachricht<textarea name="body" required minLength={2} maxLength={12000} rows={5} value={text} onChange={e=>setText(e.target.value)} className="mt-2 w-full rounded-lg border border-border bg-bg-primary p-3"/></label>
  <p className="text-sm text-fg-secondary">Bitte nennen Sie keine Patientennamen, Gesundheitsdaten oder Passwörter.</p>
  <p className="text-sm text-fg-secondary">Unsere KI-gestützte Kundenbetreuung beantwortet Fragen. Karam übernimmt Anliegen, die eine persönliche Entscheidung brauchen.</p>
  {state.error&&<p role="alert" className="text-red-600">{state.error}</p>}
  <button disabled={pending||text.trim().length<2} className="rounded-lg bg-fg-primary px-5 py-3 text-bg-primary disabled:opacity-50">{pending?'Wird gesendet …':'Nachricht senden'}</button>
 </form>;
}
