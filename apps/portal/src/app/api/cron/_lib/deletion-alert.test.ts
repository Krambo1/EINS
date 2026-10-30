import { describe, expect, it, vi } from "vitest";
import type { SendEmailInput } from "@/server/email";
import {
  DELETION_ALERT_TO,
  deletionAlertEmail,
  deletionFailures,
  mailDeletionFailures,
  scrubErrorText,
} from "./deletion-alert";
import type { StepResult } from "./run";

const ok = (step: string): StepResult => ({ step, ok: true, ms: 1 });
const failed = (step: string, error: string): StepResult => ({ step, ok: false, ms: 1, error });

function fakeSender() {
  const sent: SendEmailInput[] = [];
  return { sent, sender: { send: vi.fn(async (m: SendEmailInput) => void sent.push(m)) } };
}

const NOW = new Date("2026-10-30T03:00:00Z");

describe("deletionFailures", () => {
  it("keeps only failed deletion steps", () => {
    const results = [
      failed("sync-meta", "token expired"),
      ok("purge-audit"),
      failed("purge-retention", "deadlock detected"),
      { step: "kpi-rebuild", ok: false, ms: 1, clinicsFailed: 1, clinicsTotal: 3 },
    ];
    expect(deletionFailures(results).map((r) => r.step)).toEqual(["purge-retention"]);
  });

  it("counts a purge skipped for lack of time as failed", () => {
    expect(deletionFailures([failed("purge-retention", "skipped: time budget exhausted")])).toHaveLength(1);
  });
});

describe("mailDeletionFailures", () => {
  it("sends nothing when every deletion step worked", async () => {
    const { sender } = fakeSender();
    const result = await mailDeletionFailures([ok("purge-retention"), failed("sync-google", "x")], {
      sender,
      now: NOW,
    });
    expect(result).toBeNull();
    expect(sender.send).not.toHaveBeenCalled();
  });

  it("sends one mail to team@eins.ag for several failed steps", async () => {
    const { sent, sender } = fakeSender();
    const result = await mailDeletionFailures(
      [failed("purge-retention", "deadlock detected"), failed("purge-audit", "statement timeout")],
      { sender, now: NOW }
    );
    expect(sender.send).toHaveBeenCalledTimes(1);
    expect(sent[0]!.to).toBe(DELETION_ALERT_TO);
    expect(DELETION_ALERT_TO).toBe("team@eins.ag");
    expect(sent[0]!.subject).toBe("Löschlauf fehlgeschlagen: 2 Schritte");
    for (const part of ["purge-retention", "deadlock detected", "purge-audit", "statement timeout"]) {
      expect(sent[0]!.text).toContain(part);
      expect(sent[0]!.html).toContain(part);
    }
    expect(sent[0]!.text).toContain("30.10.2026, 04:00 Uhr (Berlin)");
    expect(result).toMatchObject({
      step: "deletion-failure-mail",
      ok: true,
      detail: { steps: ["purge-retention", "purge-audit"] },
    });
  });

  it("names the step in the subject when only one failed", () => {
    expect(deletionAlertEmail([failed("purge-retention", "x")], NOW).subject).toBe(
      "Löschlauf fehlgeschlagen: purge-retention"
    );
  });

  it("reports a failing send instead of throwing", async () => {
    const sender = { send: vi.fn(async () => Promise.reject(new Error("Resend 500"))) };
    const result = await mailDeletionFailures([failed("purge-retention", "x")], { sender, now: NOW });
    expect(result).toMatchObject({ step: "deletion-failure-mail", ok: false, error: "Resend 500" });
  });

  it("keeps patient data out of the mail", async () => {
    const { sent, sender } = fakeSender();
    await mailDeletionFailures(
      [
        failed(
          "purge-retention",
          'duplicate key value violates unique constraint "x" Key (contact_email)=(anna.muster@example.de) for +49 170 1234567, request 1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed'
        ),
      ],
      { sender, now: NOW }
    );
    const mail = `${sent[0]!.subject}\n${sent[0]!.text}\n${sent[0]!.html}`;
    expect(mail).not.toContain("anna.muster");
    expect(mail).not.toContain("1234567");
    expect(mail).toContain("Key (contact_email)=([…])");
    // A request id is not personal data and helps find the row.
    expect(mail).toContain("1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed");
  });
});

describe("scrubErrorText", () => {
  it("removes e-mail addresses, phone numbers and key values", () => {
    expect(scrubErrorText("send to a.b@c.de failed")).toBe("send to [E-Mail] failed");
    expect(scrubErrorText("call 0221 1234567 failed")).toBe("call [Zahl] failed");
    expect(scrubErrorText("Key (id)=(42) is still referenced")).toBe("Key (id)=([…]) is still referenced");
    expect(scrubErrorText("canceling statement due to statement timeout")).toBe(
      "canceling statement due to statement timeout"
    );
  });
});
