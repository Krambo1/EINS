import { requireAdmin } from "@/auth/admin-guards";
import { clinicLeaderboard } from "@/server/queries/admin";
import { ClinicsBoard } from "./_components/ClinicsBoard";

export const metadata = { title: "Praxen" };

interface PageProps {
  searchParams: Promise<{ hinweis?: string }>;
}

export default async function AdminClinicsPage({ searchParams }: PageProps) {
  await requireAdmin();

  const params = await searchParams;
  // Every Praxis once: ClinicsBoard filters and sorts in the browser.
  const all = await clinicLeaderboard({ periodDays: 30 });

  return (
    <ClinicsBoard
      all={all}
      notice={
        typeof params.hinweis === "string" && (
          <p
            role="status"
            className="rounded-md border border-border bg-bg-secondary px-4 py-3 text-base text-fg-primary"
          >
            {params.hinweis}
          </p>
        )
      }
    />
  );
}
