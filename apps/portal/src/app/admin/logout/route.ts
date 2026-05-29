import { NextResponse, type NextRequest } from "next/server";
import { destroyAdminSession } from "@/auth/admin";
import { writeAudit } from "@/server/audit";
import { adminOrigin } from "@/lib/env";

export async function POST(_request: NextRequest) {
  await destroyAdminSession();
  await writeAudit({ action: "logout", entityKind: "admin_login" });
  return NextResponse.redirect(new URL("/admin/login", adminOrigin()), { status: 303 });
}
