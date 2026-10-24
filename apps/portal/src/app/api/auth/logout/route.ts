import { NextRequest, NextResponse } from "next/server";
import { destroySession, getSession } from "@/auth/session";
import { writeAudit } from "@/server/audit";
import { isCrossSiteRequest } from "@/auth/request-origin";

async function handler(req: NextRequest): Promise<NextResponse> {
  // B-15: a foreign page (<img>, link, form) must not be able to log users
  // out. Our own menu link is same-origin, a typed URL is "none"; anything
  // cross-site lands on /login without touching the session.
  if (isCrossSiteRequest(req.headers)) {
    return NextResponse.redirect(new URL("/login", req.nextUrl.origin), {
      status: 303,
    });
  }
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
