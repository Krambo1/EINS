import { describe, expect, it } from "vitest";
import {
  RESPONSE_RULE_START,
  attemptInfo,
  countResponseStates,
  evaluateEnforcement,
  overdueOpenAt,
  responseInfo,
  responseRuleStartFor,
  responseState,
  toDeadlineRow,
  warningEmailText,
  type DeadlineRow,
  type EnforcementEvent,
} from "./response-time";
import { rejectionAllowed, REJECTION_REASONS } from "./guarantee-clock";
import { classifyAttribution } from "./sources";
import { BOOKING_SOURCES } from "@/server/queries/response-time";

const at = (iso: string) => new Date(iso);

// Mon 12.10.2026 10:00 → deadline Mon 19.10.2026 13:00 (Berlin).
const CREATED = at("2026-10-12T10:00:00+02:00");
const DEADLINE = at("2026-10-19T13:00:00+02:00");

describe("responseState", () => {
  it("is offen while the deadline runs without attempt", () => {
    expect(responseState({ createdAt: CREATED, firstAttemptAt: null, status: "neu" }, at("2026-10-19T12:59:00+02:00"))).toBe(
      "offen"
    );
  });

  it("is nicht_beantwortet after the deadline without attempt", () => {
    const info = responseInfo({ createdAt: CREATED, firstAttemptAt: null, status: "neu" }, at("2026-10-19T13:01:00+02:00"));
    expect(info).toEqual({ state: "nicht_beantwortet", deadline: DEADLINE });
  });

  it("an attempt exactly at the deadline is in time", () => {
    expect(responseState({ createdAt: CREATED, firstAttemptAt: DEADLINE, status: "kontaktiert" }, at("2026-11-01T00:00:00Z"))).toBe(
      "rechtzeitig"
    );
  });

  it("an attempt after the deadline is zu_spaet", () => {
    expect(
      responseState(
        { createdAt: CREATED, firstAttemptAt: at("2026-10-19T13:00:01+02:00"), status: "kontaktiert" },
        at("2026-11-01T00:00:00Z")
      )
    ).toBe("zu_spaet");
  });

  it("verloren without attempt is still nicht_beantwortet, spam is ausgenommen", () => {
    const now = at("2026-11-01T00:00:00Z");
    expect(responseState({ createdAt: CREATED, firstAttemptAt: null, status: "verloren" }, now)).toBe("nicht_beantwortet");
    expect(responseState({ createdAt: CREATED, firstAttemptAt: null, status: "spam" }, now)).toBe("ausgenommen");
    // Folge 1 ignores the status: the attempt question stays open for spam.
    expect(attemptInfo({ createdAt: CREATED, firstAttemptAt: null }, now).state).toBe("nicht_beantwortet");
  });

  it("inquiries before the rule started have no deadline", () => {
    expect(
      responseInfo({ createdAt: at("2026-10-05T21:59:59Z"), firstAttemptAt: null, status: "neu" }, at("2026-11-01T00:00:00Z"))
    ).toEqual({ state: "ausgenommen", deadline: null });
    expect(
      responseState({ createdAt: at("2026-10-05T22:00:00Z"), firstAttemptAt: null, status: "neu" }, at("2026-11-01T00:00:00Z"))
    ).toBe("nicht_beantwortet");
  });
});

describe("countResponseStates", () => {
  it("counts each state and leaves spam out", () => {
    const now = at("2026-10-20T12:00:00+02:00");
    const counts = countResponseStates(
      [
        { createdAt: CREATED, firstAttemptAt: at("2026-10-12T11:00:00+02:00"), status: "kontaktiert" },
        { createdAt: CREATED, firstAttemptAt: at("2026-10-20T09:00:00+02:00"), status: "kontaktiert" },
        { createdAt: CREATED, firstAttemptAt: null, status: "neu" },
        { createdAt: CREATED, firstAttemptAt: null, status: "spam" },
        { createdAt: at("2026-10-20T10:00:00+02:00"), firstAttemptAt: null, status: "neu" },
        { createdAt: at("2026-10-01T10:00:00+02:00"), firstAttemptAt: null, status: "neu" },
      ],
      now
    );
    expect(counts).toEqual({ total: 4, rechtzeitig: 1, zuSpaet: 1, nichtBeantwortet: 1, offen: 1, vorRegel: 1 });
  });
});

describe("rejectionAllowed (Folge 1)", () => {
  it("other reasons are always allowed", () => {
    for (const reason of REJECTION_REASONS.filter((r) => r !== "keine_kontaktdaten")) {
      expect(rejectionAllowed(reason, { hasContactData: true, responseState: "nicht_beantwortet" })).toEqual({ ok: true });
      expect(rejectionAllowed(reason, { hasContactData: true, responseState: "offen" })).toEqual({ ok: true });
    }
  });

  it("keine_kontaktdaten is fine without phone and e-mail", () => {
    expect(rejectionAllowed("keine_kontaktdaten", { hasContactData: false, responseState: "nicht_beantwortet" })).toEqual({
      ok: true,
    });
  });

  it("keine_kontaktdaten needs a timely attempt", () => {
    expect(rejectionAllowed("keine_kontaktdaten", { hasContactData: true, responseState: "rechtzeitig" })).toEqual({ ok: true });
    expect(rejectionAllowed("keine_kontaktdaten", { hasContactData: true, responseState: "offen" })).toEqual({
      ok: false,
      reason: "Einwand erst nach einem Kontaktversuch der Praxis möglich.",
    });
    for (const state of ["zu_spaet", "nicht_beantwortet"] as const) {
      const r = rejectionAllowed("keine_kontaktdaten", { hasContactData: true, responseState: state });
      expect(r.ok).toBe(false);
    }
  });

  it("other proof of an earlier attempt unlocks it, and pre-rule inquiries are not affected", () => {
    expect(
      rejectionAllowed("keine_kontaktdaten", { hasContactData: true, responseState: "nicht_beantwortet", otherProof: true })
    ).toEqual({ ok: true });
    expect(rejectionAllowed("keine_kontaktdaten", { hasContactData: true, responseState: "ausgenommen" })).toEqual({ ok: true });
  });
});

describe("Folge 3 evaluator", () => {
  const row = (id: string, deadline: string, attempt: string | null = null): DeadlineRow => ({
    id,
    deadline: at(deadline),
    firstAttemptAt: attempt ? at(attempt) : null,
  });
  // Three inquiries overdue since Monday 19.10.2026.
  const rows = [
    row("a", "2026-10-19T11:00:00+02:00"),
    row("b", "2026-10-19T12:00:00+02:00"),
    row("c", "2026-10-19T13:00:00+02:00"),
    row("d", "2026-10-30T13:00:00+01:00"), // not yet due
  ];
  const warn = (iso: string): EnforcementEvent => ({ kind: "warnung", occurredAt: at(iso), requestIds: [] });

  it("overdueOpenAt counts attempts made after the moment as still open", () => {
    const late = [row("x", "2026-10-19T11:00:00+02:00", "2026-10-21T10:00:00+02:00")];
    expect(overdueOpenAt(late, at("2026-10-20T10:00:00+02:00"))).toHaveLength(1);
    expect(overdueOpenAt(late, at("2026-10-22T10:00:00+02:00"))).toHaveLength(0);
  });

  it("toDeadlineRow drops spam and pre-rule inquiries", () => {
    expect(toDeadlineRow({ id: "s", createdAt: CREATED, firstAttemptAt: null, status: "spam" })).toBeNull();
    expect(toDeadlineRow({ id: "o", createdAt: at("2026-10-01T10:00:00Z"), firstAttemptAt: null, status: "neu" })).toBeNull();
    expect(toDeadlineRow({ id: "n", createdAt: CREATED, firstAttemptAt: null, status: "neu" })?.deadline).toEqual(DEADLINE);
  });

  it("three overdue allow a warning, not yet a pause", () => {
    const s = evaluateEnforcement({ rows, events: [], now: at("2026-10-20T10:00:00+02:00") });
    expect(s.overdueOpen.map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(s.canWarn).toBe(true);
    expect(s.canPause).toBe(false);
    expect(s.pauseBlockedReason).toBe("Erst eine Warnung vermerken.");
  });

  it("two overdue allow nothing", () => {
    const s = evaluateEnforcement({ rows: rows.slice(1), events: [], now: at("2026-10-20T10:00:00+02:00") });
    expect(s.canWarn).toBe(false);
  });

  it("pause only after the end of the next Werktag, if still three open then and now", () => {
    const events = [warn("2026-10-20T10:00:00+02:00")]; // Tue → cure until end of Wed 21.10
    const during = evaluateEnforcement({ rows, events, now: at("2026-10-21T23:59:00+02:00") });
    expect(during.canPause).toBe(false);
    expect(during.canWarn).toBe(false);
    expect(during.cureDeadline).toEqual(at("2026-10-22T00:00:00+02:00"));

    const after = evaluateEnforcement({ rows, events, now: at("2026-10-22T08:00:00+02:00") });
    expect(after.overdueAtCureDeadline).toBe(3);
    expect(after.canPause).toBe(true);
  });

  it("a warning is spent when fewer than three were open at the cure deadline", () => {
    const cured = [
      row("a", "2026-10-19T11:00:00+02:00", "2026-10-21T15:00:00+02:00"),
      row("b", "2026-10-19T12:00:00+02:00"),
      row("c", "2026-10-19T13:00:00+02:00"),
      row("e", "2026-10-22T09:00:00+02:00"), // overdue only after the cure deadline
    ];
    const s = evaluateEnforcement({
      rows: cured,
      events: [warn("2026-10-20T10:00:00+02:00")],
      now: at("2026-10-23T10:00:00+02:00"),
    });
    expect(s.overdueOpen).toHaveLength(3);
    expect(s.overdueAtCureDeadline).toBe(2);
    expect(s.canPause).toBe(false);
    expect(s.canWarn).toBe(true);
  });

  it("resume is due once every inquiry of the pause snapshot has an attempt", () => {
    const pause: EnforcementEvent = {
      kind: "pause",
      occurredAt: at("2026-10-22T08:00:00+02:00"),
      requestIds: ["a", "b", "c"],
    };
    const events = [warn("2026-10-20T10:00:00+02:00"), pause];
    const stillOpen = evaluateEnforcement({ rows, events, now: at("2026-10-23T08:00:00+02:00") });
    expect(stillOpen.paused).toBe(true);
    expect(stillOpen.resumeDue).toBe(false);
    expect(stillOpen.stillOpenFromPause).toEqual(["a", "b", "c"]);

    const contacted = [
      row("a", "2026-10-19T11:00:00+02:00", "2026-10-23T09:00:00+02:00"),
      row("b", "2026-10-19T12:00:00+02:00", "2026-10-23T09:05:00+02:00"),
      row("c", "2026-10-19T13:00:00+02:00", "2026-10-23T09:10:00+02:00"),
      // A new overdue inquiry after the pause does not block the resume.
      row("f", "2026-10-22T13:00:00+02:00"),
    ];
    const s = evaluateEnforcement({ rows: contacted, events, now: at("2026-10-23T10:00:00+02:00") });
    expect(s.resumeDue).toBe(true);
    expect(s.canWarn).toBe(false);

    const resumed = evaluateEnforcement({
      rows: contacted,
      events: [...events, { kind: "fortgesetzt", occurredAt: at("2026-10-23T11:00:00+02:00"), requestIds: [] }],
      now: at("2026-10-23T12:00:00+02:00"),
    });
    expect(resumed.paused).toBe(false);
    expect(resumed.activeWarning).toBeNull();
    expect(resumed.pauseBlockedReason).toBe("Erst eine Warnung vermerken.");
  });
});

describe("warningEmailText", () => {
  it("names count, cure deadline, contract clause and what stays unaffected", () => {
    const { subject, body } = warningEmailText({ count: 4, cureDeadline: at("2026-10-22T00:00:00+02:00") });
    expect(subject).toBe("Offene Anfragen ohne Kontaktversuch");
    expect(body).toContain("4 Anfragen");
    expect(body).toContain("Mittwoch, 21.10.2026");
    expect(body).toContain("§ 6 Abs. (5) lit. c des Garantie-Anhangs");
    expect(body).toContain("organischen Beiträge laufen in jedem Fall weiter");
    expect(body).toContain("Garantie bleibt davon unberührt");
    expect(body).not.toMatch(/[–—]/);
  });
});

describe("BOOKING_SOURCES", () => {
  it("are exactly sources that classify as the booking-link Messweg", () => {
    for (const source of BOOKING_SOURCES) {
      expect(classifyAttribution({ source, utm: null }).messweg).toBe("buchung");
    }
  });
});

// ---------------------------------------------------------------------------
// K-3: the 48 Werkstunden start with the contract of the Praxis
// ---------------------------------------------------------------------------

describe("rule start per Praxis (K-3)", () => {
  it("uses Berlin midnight of the signing day, never before 06.10.2026", () => {
    expect(responseRuleStartFor(null)).toEqual(RESPONSE_RULE_START);
    expect(responseRuleStartFor("2026-10-01")).toEqual(RESPONSE_RULE_START);
    expect(responseRuleStartFor("2026-11-02").toISOString()).toBe("2026-11-01T23:00:00.000Z");
  });

  it("gives an inquiry before the signing no deadline, one after it a deadline", () => {
    const ruleStart = responseRuleStartFor("2026-11-02");
    const now = at("2026-12-01T12:00:00Z");
    const before = { createdAt: at("2026-11-01T22:59:59Z"), firstAttemptAt: null, status: "neu", ruleStart };
    const after = { createdAt: at("2026-11-01T23:00:00Z"), firstAttemptAt: null, status: "neu", ruleStart };
    expect(responseInfo(before, now).state).toBe("ausgenommen");
    expect(responseInfo(after, now).state).toBe("nicht_beantwortet");
    expect(toDeadlineRow({ ...before, id: "b" })).toBeNull();
    expect(toDeadlineRow({ ...after, id: "a" })).not.toBeNull();
    const counts = countResponseStates([before, after], now);
    expect(counts).toMatchObject({ total: 1, nichtBeantwortet: 1, vorRegel: 1 });
  });

  it("keeps the global start without a signing date", () => {
    const now = at("2026-12-01T12:00:00Z");
    expect(attemptInfo({ createdAt: at("2026-10-05T21:59:59Z"), firstAttemptAt: null }, now).state).toBe("ausgenommen");
    expect(attemptInfo({ createdAt: at("2026-10-05T22:00:00Z"), firstAttemptAt: null }, now).deadline).not.toBeNull();
  });
});

describe("Folge 3 across the DST change", () => {
  it("counts the overdue inquiries at the cure deadline after the 25-hour day", () => {
    const rows: DeadlineRow[] = [
      { id: "a", deadline: at("2026-10-21T10:00:00Z"), firstAttemptAt: at("2026-10-26T22:59:59Z") },
      { id: "b", deadline: at("2026-10-21T11:00:00Z"), firstAttemptAt: at("2026-10-26T22:59:59Z") },
      { id: "c", deadline: at("2026-10-21T12:00:00Z"), firstAttemptAt: null },
    ];
    const warning: EnforcementEvent = { kind: "warnung", occurredAt: at("2026-10-23T14:00:00Z"), requestIds: ["a", "b", "c"] };
    expect(overdueOpenAt(rows, warning.occurredAt)).toHaveLength(3);
    const s = evaluateEnforcement({ rows, events: [warning], now: at("2026-10-27T08:00:00Z") });
    expect(s.cureDeadline?.toISOString()).toBe("2026-10-26T23:00:00.000Z");
    expect(s.overdueAtCureDeadline).toBe(1);
    expect(s.canPause).toBe(false);
  });
});

describe("warning mail wording (K-14)", () => {
  it("names the KANON wording", () => {
    const { body } = warningEmailText({ count: 3, cureDeadline: at("2026-10-27T00:00:00+01:00") });
    expect(body).toContain("keine Bedingung der Garantie.");
  });
});
