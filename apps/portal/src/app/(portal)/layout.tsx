import type { ReactNode } from "react";
import { requireSession } from "@/auth/guards";
import { PortalShell } from "./_components/PortalShell";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db/client";

export default async function PortalLayout({ children }: { children: ReactNode }) {
  const session = await requireSession();

  // Clinic data for the header — small, cached-per-request.
  const [clinic] = await db
    .select({
      id: schema.clinics.id,
      displayName: schema.clinics.displayName,
      plan: schema.clinics.plan,
      logoUrl: schema.clinics.logoUrl,
    })
    .from(schema.clinics)
    .where(eq(schema.clinics.id, session.clinicId))
    .limit(1);

  return (
    <PortalShell
      user={{
        email: session.email,
        fullName: session.fullName,
        role: session.role,
        uiMode: session.uiMode,
      }}
      clinic={clinic ?? { id: session.clinicId, displayName: "", plan: "standard", logoUrl: null }}
      impersonating={session.impersonatedByAdminId !== null}
    >
      {children}
    </PortalShell>
  );
}
