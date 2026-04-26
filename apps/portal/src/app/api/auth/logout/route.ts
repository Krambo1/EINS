import { NextRequest, NextResponse } from "next/server";
import { destroySession, getSession } from "@/auth/session";
import { writeAudit } from "@/server/audit";

async function handler(req: NextRequest): Promise<NextResponse> {
  const session = await getSession();
  if (session) {
    await writeAudit({
      clinicId: session.clinicId,
      actorId: session.userId,
      actorEmail: session.email,
      action: "logout",
      entityKind: "login",
    });
  }
  await destroySession();
  return NextResponse.redirect(new URL("/login", req.nextUrl.origin), {
    status: 303, // "See Other" so POST→GET redirect on the new URL
  });
}

// Accept GET (for simple <a href> links) and POST (for CSRF-safe form submits).
export { handler as GET, handler as POST };
