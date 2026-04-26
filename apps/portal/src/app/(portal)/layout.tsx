import type { ReactNode } from "react";
import { requireSession } from "@/auth/guards";
import { PortalShell } from "./_components/PortalShell";
import { getClinicHeader } from "@/server/queries/clinic";

export default async function PortalLayout({ children }: { children: ReactNode }) {
  const session = await requireSession();
  const clinic = await getClinicHeader(session.clinicId);

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
