import { describe, expect, it } from "vitest";
import { approvalBatchMail } from "./content-approval";

const base = {
  recipientName: "Dr. Anna Beispiel",
  practiceName: "Praxis Dr. Beispiel",
  dueLabel: "Montag, 12.10.2026",
  dueDate: "12.10.2026",
  portalUrl: "https://portal.eins.ag/beitraege",
  linkTtlDays: 30,
  posts: [
    {
      title: "Lidstraffung erklärt",
      format: "Reel",
      caption: "Was passiert bei einer Lidstraffung? KI-generiert",
      kiLabel: true,
      usesClone: true,
      url: "https://portal.eins.ag/freigabe/abc",
    },
    {
      title: "Team stellt sich vor",
      format: "Bild",
      caption: null,
      kiLabel: false,
      usesClone: false,
      url: "https://portal.eins.ag/freigabe/def",
    },
  ],
};

describe("approvalBatchMail", () => {
  const mail = approvalBatchMail(base);

  it("names the deadline in the subject", () => {
    expect(mail.subject).toBe("Ihre Beiträge zur Freigabe bis 12.10.2026");
  });

  it("says plainly that nothing goes online without approval, with the last day", () => {
    expect(mail.text).toContain("Ohne Ihre Freigabe geht kein Beitrag online.");
    expect(mail.text).toContain("bis Montag, 12.10.2026 frei oder beschreiben Sie, was wir ändern sollen");
  });

  it("lists every post with its link, the label hint and the clone note", () => {
    expect(mail.text).toContain("1. Lidstraffung erklärt (Reel)");
    expect(mail.text).toContain("https://portal.eins.ag/freigabe/abc");
    expect(mail.text).toContain("„KI-generiert“");
    expect(mail.text).toContain("nur die Inhaberin oder der Inhaber");
    expect(mail.text).toContain("2. Team stellt sich vor (Bild)");
  });

  it("never promises an automatic approval and follows the copy rules", () => {
    expect(mail.text.toLowerCase()).not.toMatch(/automatisch|gilt als freigegeben/);
    expect(mail.text).not.toContain("—");
    expect(mail.text).not.toMatch(/Klinik/);
  });
});
