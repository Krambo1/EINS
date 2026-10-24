import { requireSession } from "@/auth/guards";
import { can } from "@/lib/roles";
import { BewertungenTabs } from "./BewertungenTabs";

/** In-page tabs (phones have no sidebar). Rendered under the page header. */
export async function BewertungenSectionTabs() {
  const session = await requireSession();
  const tabs = [
    { href: "/bewertungen", label: "Plattformen" },
    ...(can(session.role, "patient_feedback.view")
      ? [{ href: "/bewertungen/feedback", label: "Patientenfeedback" }]
      : []),
  ];
  if (tabs.length < 2) return null;
  return <BewertungenTabs tabs={tabs} />;
}
