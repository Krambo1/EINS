import { NextResponse, type NextRequest } from "next/server";
import { destroyAdminSession } from "@/auth/admin";
import { writeAudit } from "@/server/audit";
import { env } from "@/lib/env";

export async function POST(_request: NextRequest) {
  await destroyAdminSession();
  await writeAudit({ action: "logout", entityKind: "admin_login" });
  return NextResponse.redirect(new URL("/admin/login", env.APP_ORIGIN), { status: 303 });
}
