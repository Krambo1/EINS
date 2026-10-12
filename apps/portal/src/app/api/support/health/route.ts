import {timingSafeEqual} from 'node:crypto';
import {sqlClient} from '@/db/client';
import {supportEnabled} from '@/server/support';
export const dynamic='force-dynamic';
export async function GET(request:Request) {
 const secret=process.env.SUPPORT_HEALTH_TOKEN;
 const expected=Buffer.from(`Bearer ${secret||''}`),actual=Buffer.from(request.headers.get('authorization')||'');
 if(!secret||expected.length!==actual.length||!timingSafeEqual(expected,actual))return Response.json({ok:false},{status:401});
 try {if(!supportEnabled())throw new Error();await sqlClient`SELECT id FROM support.cases LIMIT 1`;const state=await sqlClient`SELECT ok FROM support.health WHERE component='portal-intake'`;if(state[0]?.ok===false)throw new Error();return Response.json({ok:true},{headers:{'Cache-Control':'no-store'}});}
 catch {return Response.json({ok:false},{status:503,headers:{'Cache-Control':'no-store'}});}
}
