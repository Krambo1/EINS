'use server';
import {z} from 'zod';
import {revalidatePath} from 'next/cache';
import {requireAdmin} from '@/auth/admin-guards';
import {supportControl} from '@/server/support';
export async function controlSupport(command:string,form:FormData){
 const admin=await requireAdmin();
 const input=z.object({id:z.string().uuid(),command:z.enum(['takeover','resume','close','reopen','reply']),note:z.string().max(12000)}).parse({id:form.get('id'),command,note:form.get('note')||''});
 if(['close','reply'].includes(input.command)&&input.note.trim().length<3)throw new Error('Bitte Antwort oder Grund für den Abschluss angeben.');
 await supportControl({...input,actor:admin.email});revalidatePath('/admin/support');revalidatePath(`/admin/support/${input.id}`);
}
