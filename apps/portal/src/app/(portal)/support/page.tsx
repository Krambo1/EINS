import Link from 'next/link';
import {randomUUID} from 'node:crypto';
import {requirePermissionOrRedirect} from '@/auth/guards';
import {supportCases,supportClient} from '@/server/support';
import {MessageForm} from './MessageForm';
export const metadata={title:'Nachrichten an EINS'};
export const dynamic='force-dynamic';
export default async function SupportPage(){
 const s=await requirePermissionOrRedirect('feedback.submit');
 const [client,cases]=await Promise.all([supportClient(s.clinicId),supportCases(s.clinicId)]);
 return <div className="space-y-8"><header><h1 className="text-3xl font-semibold md:text-4xl">Nachrichten an EINS.</h1><p className="mt-2 text-base text-fg-primary md:text-lg">Hier können Sie uns schreiben und Ihre Antworten nachlesen.</p></header>
  {client?<><section className="rounded-lg border border-border bg-bg-primary p-6"><h2 className="mb-5 text-lg font-semibold">Neue Nachricht</h2><MessageForm nonce={randomUUID()}/></section>
  <section className="space-y-3"><h2 className="text-xl font-semibold">Bisherige Nachrichten</h2>{cases.length===0?<p className="text-base text-fg-secondary">Noch keine Nachrichten.</p>:cases.map(c=><Link key={c.id} href={`/support/${c.id}`} className="block rounded-lg border border-border p-4 hover:bg-bg-secondary"><span className="font-medium">{c.subject}</span><p className="mt-1 text-sm text-fg-secondary">{c.status==='RESOLVED'?'Geklärt':'Offen'} · {new Date(c.updated_at).toLocaleString('de-DE',{timeZone:'Europe/Berlin'})}</p></Link>)}</section></>:<p className="text-base text-fg-primary">Nachrichten im Portal sind für Ihre Praxis noch nicht eingerichtet. Sie erreichen uns unter <a className="underline" href="mailto:team@eins.ag">team@eins.ag</a>.</p>}
 </div>;
}
