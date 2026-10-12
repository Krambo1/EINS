import Link from 'next/link';
import {notFound} from 'next/navigation';
import {z} from 'zod';
import {requireAdmin} from '@/auth/admin-guards';
import {supportConversation} from '@/server/support';
import {sqlClient} from '@/db/client';
import {controlSupport} from '../actions';
export const dynamic='force-dynamic';
export default async function AdminConversation({params}:{params:Promise<{id:string}>}){
 await requireAdmin();const {id}=await params;if(!z.string().uuid().safeParse(id).success)notFound();const data=await supportConversation(id);if(!data)notFound();
 const deliveries=await sqlClient`SELECT kind,state,accepted_at,error FROM support.outbox WHERE case_id=${id} ORDER BY created_at DESC LIMIT 30`;
 return <div className="mx-auto max-w-4xl space-y-6"><Link href="/admin/support" className="underline">Alle Vorgänge</Link><h1 className="text-3xl font-semibold">{data.case.practice_name}: {data.case.subject}</h1><p>{data.case.status==='OPEN'?'Offen':'Geklärt'} · {data.case.mode==='manual'?'Persönlich übernommen':'Automatische Antworten'}</p><p>{data.case.summary}</p><p className="whitespace-pre-wrap">{data.case.action}</p>
 <div className="flex flex-wrap gap-3">{(['takeover','resume','reopen'] as const).map((cmd,i)=><form key={cmd} action={controlSupport.bind(null,cmd)}><input type="hidden" name="id" value={id}/><button className="rounded-lg border border-border px-4 py-2">{['Persönlich übernehmen','Automatik fortsetzen','Wieder öffnen'][i]}</button></form>)}</div>
 <ol className="space-y-4">{data.messages.map(m=><li key={m.id} className="rounded-xl border border-border p-5"><strong>{m.direction==='inbound'?'Praxis':m.direction==='manual'?'Karam':'EINS'}</strong><time className="ml-3 text-sm">{new Date(m.received_at).toLocaleString('de-DE',{timeZone:'Europe/Berlin'})}</time><p className="mt-3 whitespace-pre-wrap break-words">{m.body}</p></li>)}</ol>
 <form action={controlSupport.bind(null,'reply')} className="space-y-4"><input type="hidden" name="id" value={id}/><label className="block">Persönliche Antwort oder belegter Abschluss<textarea name="note" required minLength={3} maxLength={12000} rows={6} className="mt-2 w-full rounded-lg border border-border bg-bg-primary p-3"/></label><div className="flex gap-3"><button className="rounded-lg border border-border px-4 py-3">Antwort senden und übernehmen</button><button formAction={controlSupport.bind(null,'close')} className="rounded-lg border border-border px-4 py-3">Mit Begründung abschließen</button></div></form>
 <section><h2 className="text-xl font-semibold">Zustellung</h2>{deliveries.map((d,i)=><p key={i} className="mt-2">{d.kind}: {d.state}{d.error?` (${d.error})`:''}</p>)}</section></div>;
}
