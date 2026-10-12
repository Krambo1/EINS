import Link from 'next/link';
import {randomUUID} from 'node:crypto';
import {notFound} from 'next/navigation';
import {z} from 'zod';
import {requirePermissionOrRedirect} from '@/auth/guards';
import {supportConversation} from '@/server/support';
import {MessageForm} from '../MessageForm';
import {Refresh} from '../Refresh';
export const dynamic='force-dynamic';
export default async function Conversation({params}:{params:Promise<{id:string}>}){
 const s=await requirePermissionOrRedirect('feedback.submit');const {id}=await params;if(!z.string().uuid().safeParse(id).success)notFound();
 const data=await supportConversation(id,s.clinicId);if(!data)notFound();
 return <div className="mx-auto max-w-3xl space-y-6"><Refresh/><Link href="/support" className="underline">Alle Nachrichten</Link><header><h1 className="text-3xl font-semibold">{data.case.subject}</h1><p className="mt-2">{data.case.status==='RESOLVED'?'Geklärt':'Offen'}</p></header>
  <ol className="space-y-4">{data.messages.map(m=><li key={m.id} className="rounded-xl border border-border bg-bg-secondary p-5"><div className="flex flex-wrap justify-between gap-2 text-sm"><strong>{m.direction==='inbound'?'Ihre Praxis':'EINS'}</strong><time>{new Date(m.received_at).toLocaleString('de-DE',{timeZone:'Europe/Berlin'})}</time></div><p className="mt-3 whitespace-pre-wrap break-words">{m.body}</p></li>)}</ol>
  <MessageForm nonce={randomUUID()} caseId={id} subject={data.case.subject}/>
 </div>;
}
