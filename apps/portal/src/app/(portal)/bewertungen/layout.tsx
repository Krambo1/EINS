import { requireSession } from "@/auth/guards";
import { can } from "@/lib/roles";
import { BewertungenTabs } from "./_components/BewertungenTabs";

export default async function BewertungenLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireSession();

  const tabs = [
    { href: "/bewertungen", label: "Plattformen" },
    ...(can(session.role, "patient_feedback.view")
      ? [{ href: "/bewertungen/feedback", label: "Patientenfeedback" }]
      : []),
  ];

  return (
    <div className="space-y-6">
      {tabs.length > 1 && <BewertungenTabs tabs={tabs} />}
      {children}
    </div>
  );
}
