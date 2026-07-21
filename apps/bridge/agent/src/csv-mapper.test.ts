import { describe, it, expect } from "vitest";
import { mapCsvRow, autoDetectMapping, type CsvMapping } from "./csv-mapper.js";

const CLINIC = "00000000-0000-0000-0000-000000000001";

describe("csv-mapper: autoDetectMapping — invoices", () => {
  it("detects medatixx-style German Honorar headers", () => {
    const mapping = autoDetectMapping([
      "Patient-Nr.",
      "Rechnungs-Nr.",
      "Termin-Nr.",
      "Betrag",
      "Bezahldatum",
    ]);
    expect(mapping).not.toBeNull();
    expect(mapping!.stream).toBe("invoices");
    if (mapping!.stream !== "invoices") return;
    expect(mapping!.columns.pvsPatientId).toBe("Patient-Nr.");
    expect(mapping!.columns.pvsInvoiceId).toBe("Rechnungs-Nr.");
    expect(mapping!.columns.pvsAppointmentId).toBe("Termin-Nr.");
    expect(mapping!.columns.amount).toBe("Betrag");
    expect(mapping!.columns.paidAt).toBe("Bezahldatum");
    expect(mapping!.dateFormat).toBe("DD.MM.YYYY");
    expect(mapping!.amountUnit).toBe("eur");
    expect(mapping!.decimalSeparator).toBe(",");
  });

  it("detects DURIA-style headers", () => {
    const mapping = autoDetectMapping([
      "Patientennummer",
      "Rechnungsnummer",
      "Endbetrag",
      "Bezahlt am",
    ]);
    expect(mapping).not.toBeNull();
    expect(mapping!.stream).toBe("invoices");
    if (mapping!.stream !== "invoices") return;
    expect(mapping!.columns.pvsPatientId).toBe("Patientennummer");
    expect(mapping!.columns.amount).toBe("Endbetrag");
  });

  it("returns null when an invoice-required column is missing", () => {
    const mapping = autoDetectMapping([
      "Patient-Nr.",
      "Rechnungs-Nr.",
      "Betrag",
      // no paidAt-compatible column
    ]);
    expect(mapping).toBeNull();
  });

  it("returns null on unrecognised headers", () => {
    expect(autoDetectMapping(["foo", "bar", "baz", "qux"])).toBeNull();
  });

  // H2: Rechnungsdatum must NOT auto-map to paidAt. A file of all invoices
  // (offen + bezahlt) keyed only by invoice date would otherwise book every
  // open invoice as paid revenue.
  it("does NOT auto-detect an invoice stream when only Rechnungsdatum is present (no paid-date)", () => {
    const mapping = autoDetectMapping([
      "Patient-Nr.",
      "Rechnungs-Nr.",
      "Betrag",
      "Rechnungsdatum",
    ]);
    expect(mapping).toBeNull();
  });

  it("uses the real Bezahldatum, never Rechnungsdatum, when both are present", () => {
    const mapping = autoDetectMapping([
      "Patient-Nr.",
      "Rechnungs-Nr.",
      "Betrag",
      "Rechnungsdatum",
      "Bezahldatum",
    ]);
    expect(mapping).not.toBeNull();
    expect(mapping!.stream).toBe("invoices");
    if (mapping!.stream !== "invoices") return;
    expect(mapping!.columns.paidAt).toBe("Bezahldatum");
  });

  // H2: a Zahlstatus column is auto-detected onto the invoice mapping.
  it("auto-detects a Zahlstatus column for the invoice stream", () => {
    const mapping = autoDetectMapping([
      "Patient-Nr.",
      "Rechnungs-Nr.",
      "Betrag",
      "Bezahldatum",
      "Zahlstatus",
    ]);
    expect(mapping!.stream).toBe("invoices");
    if (mapping!.stream !== "invoices") return;
    expect(mapping!.columns.statusColumn).toBe("Zahlstatus");
  });
});

describe("csv-mapper: autoDetectMapping — patients (Stammdaten-Voll-Sync)", () => {
  it("detects a medatixx-style patient master CSV", () => {
    const mapping = autoDetectMapping([
      "Patient-Nr.",
      "Vorname",
      "Nachname",
      "Email",
      "Telefon",
      "Geburtsdatum",
      "Geschlecht",
    ]);
    expect(mapping).not.toBeNull();
    expect(mapping!.stream).toBe("patients");
    if (mapping!.stream !== "patients") return;
    expect(mapping!.columns.email).toBe("Email");
    expect(mapping!.columns.phone).toBe("Telefon");
    expect(mapping!.columns.firstName).toBe("Vorname");
    expect(mapping!.columns.lastName).toBe("Nachname");
  });

  it("does not pick patients when invoice / appointment columns are also present", () => {
    const mapping = autoDetectMapping([
      "Patient-Nr.",
      "Email",
      "Rechnungs-Nr.",
      "Betrag",
      "Bezahldatum",
    ]);
    // Both patients and invoices are partially viable; the invoice
    // discriminator wins because patients refuses to claim a row with an
    // invoice number in it.
    expect(mapping!.stream).toBe("invoices");
  });
});

describe("csv-mapper: autoDetectMapping — appointments", () => {
  it("detects a Termin-Export CSV", () => {
    const mapping = autoDetectMapping([
      "Patient-Nr.",
      "Termin-Nr.",
      "Termindatum",
      "Behandler",
      "Standort",
      "Status",
    ]);
    expect(mapping).not.toBeNull();
    expect(mapping!.stream).toBe("appointments");
    if (mapping!.stream !== "appointments") return;
    expect(mapping!.columns.scheduledAt).toBe("Termindatum");
    expect(mapping!.columns.statusColumn).toBe("Status");
  });
});

describe("csv-mapper: autoDetectMapping — recalls", () => {
  it("detects a Recall-Export CSV", () => {
    const mapping = autoDetectMapping([
      "Patient-Nr.",
      "Recall-Nr.",
      "Recall-Datum",
      "Bezeichnung",
    ]);
    expect(mapping).not.toBeNull();
    expect(mapping!.stream).toBe("recalls");
    if (mapping!.stream !== "recalls") return;
    expect(mapping!.columns.pvsRecallId).toBe("Recall-Nr.");
    expect(mapping!.columns.recallAt).toBe("Recall-Datum");
  });

  it("recognises the Nachsorge synonym", () => {
    const mapping = autoDetectMapping([
      "Patient-Nr.",
      "Nachsorge-Nr.",
      "Nachsorge-Datum",
    ]);
    expect(mapping!.stream).toBe("recalls");
  });
});

describe("csv-mapper: mapCsvRow — invoices", () => {
  const mapping: CsvMapping = {
    stream: "invoices",
    columns: {
      pvsPatientId: "Patient-Nr.",
      pvsInvoiceId: "Rechnungs-Nr.",
      pvsAppointmentId: "Termin-Nr.",
      amount: "Betrag",
      paidAt: "Bezahldatum",
    },
    dateFormat: "DD.MM.YYYY",
    amountUnit: "eur",
    decimalSeparator: ",",
  };

  it("maps a medatixx row to InvoicePaid", () => {
    const result = mapCsvRow({
      clinicId: CLINIC,
      fileHash: "abc",
      rowIndex: 0,
      row: {
        "Patient-Nr.": "PAT-1",
        "Rechnungs-Nr.": "RECH-100",
        "Termin-Nr.": "TERM-7",
        Betrag: "350,00",
        Bezahldatum: "19.05.2026",
      },
      mapping,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const event = result.events[0];
    expect(event.kind).toBe("InvoicePaid");
    expect(event.amountCents).toBe(35000);
    expect(event.pvsInvoiceId).toBe("RECH-100");
    expect(event.pvsAppointmentId).toBe("TERM-7");
    expect(event.paidAt).toBe("2026-05-19T00:00:00.000Z");
    expect(event.pvsExternalEventId).toBe("csv-local:invoice:RECH-100");
  });

  it("rejects rows with missing required fields", () => {
    const result = mapCsvRow({
      clinicId: CLINIC,
      fileHash: "abc",
      rowIndex: 1,
      row: {
        "Patient-Nr.": "",
        "Rechnungs-Nr.": "RECH-100",
        Betrag: "350,00",
        Bezahldatum: "19.05.2026",
      },
      mapping,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/pvsPatientId/);
  });

  it("rejects unparseable dates", () => {
    const result = mapCsvRow({
      clinicId: CLINIC,
      fileHash: "abc",
      rowIndex: 2,
      row: {
        "Patient-Nr.": "PAT-1",
        "Rechnungs-Nr.": "RECH-100",
        Betrag: "350,00",
        Bezahldatum: "May 19 2026",
      },
      mapping,
    });
    expect(result.ok).toBe(false);
  });

  it("handles thousands separators in EUR amounts", () => {
    const result = mapCsvRow({
      clinicId: CLINIC,
      fileHash: "abc",
      rowIndex: 3,
      row: {
        "Patient-Nr.": "PAT-1",
        "Rechnungs-Nr.": "RECH-100",
        Betrag: "1.250,75",
        Bezahldatum: "19.05.2026",
      },
      mapping,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.events[0].amountCents).toBe(125075);
  });

  it("handles cents-mode amounts", () => {
    const centsMapping: CsvMapping = {
      ...mapping,
      amountUnit: "cents",
      decimalSeparator: ".",
    };
    const result = mapCsvRow({
      clinicId: CLINIC,
      fileHash: "abc",
      rowIndex: 4,
      row: {
        "Patient-Nr.": "PAT-1",
        "Rechnungs-Nr.": "RECH-100",
        Betrag: "35000",
        Bezahldatum: "19.05.2026",
      },
      mapping: centsMapping,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.events[0].amountCents).toBe(35000);
  });
});

describe("csv-mapper: mapCsvRow — patients (Stammdaten full-sync)", () => {
  const mapping: CsvMapping = {
    stream: "patients",
    columns: {
      pvsPatientId: "Patient-Nr.",
      email: "Email",
      phone: "Telefon",
      firstName: "Vorname",
      lastName: "Nachname",
      dob: "Geburtsdatum",
      gender: "Geschlecht",
    },
    dateFormat: "DD.MM.YYYY",
  };

  it("emits PatientUpserted with stable per-patient dedup key", () => {
    const result = mapCsvRow({
      clinicId: CLINIC,
      fileHash: "abc",
      rowIndex: 0,
      row: {
        "Patient-Nr.": "PAT-42",
        Email: "Maria.Mueller@Example.com",
        Telefon: "+49 171 9999999",
        Vorname: "Maria",
        Nachname: "Müller",
        Geburtsdatum: "15.06.1980",
        Geschlecht: "weiblich",
      },
      mapping,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const event = result.events[0];
    expect(event.kind).toBe("PatientUpserted");
    expect(event.pvsExternalEventId).toBe("csv-local:patient:PAT-42");
    expect(event.fullName).toBe("Maria Müller");
    expect(event.email).toBe("maria.mueller@example.com");
    expect(event.phone).toBe("+49 171 9999999");
    expect(event.dob).toBe("1980-06-15");
    expect(event.gender).toBe("f");
  });

  it("drops invalid email values silently", () => {
    const result = mapCsvRow({
      clinicId: CLINIC,
      fileHash: "abc",
      rowIndex: 1,
      row: {
        "Patient-Nr.": "PAT-1",
        Email: "not-an-email",
      },
      mapping,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.events[0].email).toBeUndefined();
  });

  // H4: the patients stream has no per-row business date, so occurredAt must
  // come from the file mtime (deterministic across re-exports), not the wall
  // clock. Two maps of the same row at different wall-clock times must be
  // byte-identical when ctx.fileModifiedAtIso is supplied.
  it("derives a deterministic occurredAt from ctx.fileModifiedAtIso", () => {
    const MTIME = "2026-07-19T08:30:00.000Z";
    const row = { "Patient-Nr.": "PAT-42", Vorname: "Maria", Nachname: "Müller" };
    const first = mapCsvRow({
      clinicId: CLINIC,
      fileHash: "abc",
      fileModifiedAtIso: MTIME,
      rowIndex: 0,
      row,
      mapping,
    });
    const realNow = Date.now;
    Date.now = () => realNow() + 3_600_000;
    let second;
    try {
      second = mapCsvRow({
        clinicId: CLINIC,
        fileHash: "abc",
        fileModifiedAtIso: MTIME,
        rowIndex: 0,
        row,
        mapping,
      });
    } finally {
      Date.now = realNow;
    }
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.events[0].occurredAt).toBe(MTIME);
    expect(second.events).toEqual(first.events);
  });

  it("without ctx.fileModifiedAtIso, the previous wall-clock fallback still yields a valid ISO occurredAt", () => {
    const result = mapCsvRow({
      clinicId: CLINIC,
      fileHash: "abc",
      rowIndex: 0,
      row: { "Patient-Nr.": "PAT-1" },
      mapping,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.events[0].occurredAt).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
    );
  });
});

describe("csv-mapper: mapCsvRow — appointments", () => {
  const mapping: CsvMapping = {
    stream: "appointments",
    columns: {
      pvsPatientId: "Patient-Nr.",
      pvsAppointmentId: "Termin-Nr.",
      scheduledAt: "Termindatum",
      statusColumn: "Status",
    },
    dateFormat: "DD.MM.YYYY",
  };

  it("emits AppointmentCreated for a future appointment", () => {
    const result = mapCsvRow({
      clinicId: CLINIC,
      fileHash: "abc",
      rowIndex: 0,
      row: {
        "Patient-Nr.": "PAT-1",
        "Termin-Nr.": "TERM-9",
        Termindatum: "25.05.2026",
        Status: "geplant",
      },
      mapping,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.events).toHaveLength(1);
    expect(result.events[0].kind).toBe("AppointmentCreated");
    expect(result.events[0].pvsExternalEventId).toBe(
      "csv-local:appointment:TERM-9"
    );
  });

  it("emits AppointmentCancelled when status is storniert", () => {
    const result = mapCsvRow({
      clinicId: CLINIC,
      fileHash: "abc",
      rowIndex: 1,
      row: {
        "Patient-Nr.": "PAT-1",
        "Termin-Nr.": "TERM-9",
        Termindatum: "25.05.2026",
        Status: "storniert",
      },
      mapping,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.events.map((e) => e.kind)).toEqual([
      "AppointmentCreated",
      "AppointmentCancelled",
    ]);
  });

  it("emits AppointmentStatusChanged for no_show", () => {
    const result = mapCsvRow({
      clinicId: CLINIC,
      fileHash: "abc",
      rowIndex: 2,
      row: {
        "Patient-Nr.": "PAT-1",
        "Termin-Nr.": "TERM-9",
        Termindatum: "25.05.2026",
        Status: "nicht_erschienen",
      },
      mapping,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const status = result.events.find(
      (e) => e.kind === "AppointmentStatusChanged"
    );
    expect(status).toBeDefined();
    expect(status!.newStatus).toBe("no_show");
  });

  it("handles datetime cells with a trailing time component", () => {
    const result = mapCsvRow({
      clinicId: CLINIC,
      fileHash: "abc",
      rowIndex: 3,
      row: {
        "Patient-Nr.": "PAT-1",
        "Termin-Nr.": "TERM-10",
        Termindatum: "25.05.2026 14:30",
        Status: "",
      },
      mapping,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.events[0].scheduledAt).toBe("2026-05-25T00:00:00.000Z");
  });
});

describe("csv-mapper: mapCsvRow — recalls", () => {
  const mapping: CsvMapping = {
    stream: "recalls",
    columns: {
      pvsPatientId: "Patient-Nr.",
      pvsRecallId: "Recall-Nr.",
      recallAt: "Recall-Datum",
      treatmentLabel: "Bezeichnung",
    },
    dateFormat: "DD.MM.YYYY",
  };

  it("emits RecallScheduled with stable dedup key", () => {
    const result = mapCsvRow({
      clinicId: CLINIC,
      fileHash: "abc",
      rowIndex: 0,
      row: {
        "Patient-Nr.": "PAT-1",
        "Recall-Nr.": "REC-2026-99",
        "Recall-Datum": "19.11.2026",
        Bezeichnung: "Botox Nachkontrolle",
      },
      mapping,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.events[0].kind).toBe("RecallScheduled");
    expect(result.events[0].pvsExternalEventId).toBe(
      "csv-local:recall:REC-2026-99"
    );
    expect(result.events[0].recallAt).toBe("2026-11-19T00:00:00.000Z");
    expect(result.events[0].treatmentLabel).toBe("Botox Nachkontrolle");
  });

  it("rejects rows missing pvsRecallId", () => {
    const result = mapCsvRow({
      clinicId: CLINIC,
      fileHash: "abc",
      rowIndex: 1,
      row: {
        "Patient-Nr.": "PAT-1",
        "Recall-Nr.": "",
        "Recall-Datum": "19.11.2026",
      },
      mapping,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/pvsRecallId/);
  });
});

describe("csv-mapper: mapCsvRow — encounters", () => {
  const mapping: CsvMapping = {
    stream: "encounters",
    columns: {
      pvsPatientId: "Patient-Nr.",
      pvsEncounterId: "Behandlungs-Nr.",
      completedAt: "Behandlungsdatum",
      treatmentCode: "GOÄ-Ziffer",
      treatmentLabel: "Bezeichnung",
    },
    dateFormat: "DD.MM.YYYY",
  };

  it("emits EncounterCompleted with stable dedup key", () => {
    const result = mapCsvRow({
      clinicId: CLINIC,
      fileHash: "abc",
      rowIndex: 0,
      row: {
        "Patient-Nr.": "PAT-1",
        "Behandlungs-Nr.": "ENC-7",
        Behandlungsdatum: "19.05.2026",
        "GOÄ-Ziffer": "2382",
        Bezeichnung: "Faltenunterspritzung",
      },
      mapping,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.events[0].kind).toBe("EncounterCompleted");
    expect(result.events[0].pvsExternalEventId).toBe(
      "csv-local:encounter:ENC-7"
    );
  });
});

describe("csv-mapper: mapCsvRow - refunds (H1)", () => {
  const mapping: CsvMapping = {
    stream: "invoices",
    columns: {
      pvsPatientId: "Patient-Nr.",
      pvsInvoiceId: "Rechnungs-Nr.",
      pvsAppointmentId: "Termin-Nr.",
      amount: "Betrag",
      paidAt: "Bezahldatum",
    },
    dateFormat: "DD.MM.YYYY",
    amountUnit: "eur",
    decimalSeparator: ",",
  };

  it("maps a negative-amount row to InvoiceRefunded with abs amount + distinct id", () => {
    const result = mapCsvRow({
      clinicId: CLINIC,
      fileHash: "abc",
      rowIndex: 0,
      row: {
        "Patient-Nr.": "PAT-1",
        "Rechnungs-Nr.": "RECH-100",
        "Termin-Nr.": "TERM-7",
        Betrag: "-350,00",
        Bezahldatum: "19.05.2026",
      },
      mapping,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const event = result.events[0];
    expect(event.kind).toBe("InvoiceRefunded");
    expect(event.refundedAmountCents).toBe(35000);
    expect(event.pvsInvoiceId).toBe("RECH-100");
    expect(event.pvsAppointmentId).toBe("TERM-7");
    expect(event.refundedAt).toBe("2026-05-19T00:00:00.000Z");
    // Refund id namespace differs from the paid event id for the same invoice.
    expect(event.pvsExternalEventId).toBe("csv-local:invoice-refund:RECH-100");
    expect(event.pvsExternalEventId).not.toBe("csv-local:invoice:RECH-100");
  });
});

describe("csv-mapper: mapCsvRow - invoice status gate (H2)", () => {
  const baseColumns = {
    pvsPatientId: "Patient-Nr.",
    pvsInvoiceId: "Rechnungs-Nr.",
    amount: "Betrag",
    paidAt: "Bezahldatum",
  };
  const withStatus: CsvMapping = {
    stream: "invoices",
    columns: { ...baseColumns, statusColumn: "Zahlstatus" },
    dateFormat: "DD.MM.YYYY",
    amountUnit: "eur",
    decimalSeparator: ",",
  };
  const withoutStatus: CsvMapping = {
    stream: "invoices",
    columns: { ...baseColumns },
    dateFormat: "DD.MM.YYYY",
    amountUnit: "eur",
    decimalSeparator: ",",
  };

  function run(mapping: CsvMapping, row: Record<string, string>) {
    return mapCsvRow({ clinicId: CLINIC, fileHash: "abc", rowIndex: 0, row, mapping });
  }

  it("keeps a bezahlt row as InvoicePaid", () => {
    const result = run(withStatus, {
      "Patient-Nr.": "PAT-1",
      "Rechnungs-Nr.": "RECH-1",
      Betrag: "200,00",
      Bezahldatum: "19.05.2026",
      Zahlstatus: "bezahlt",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.events[0].kind).toBe("InvoicePaid");
    expect(result.events[0].amountCents).toBe(20000);
  });

  it("skips an offen row with a distinct, counted reason", () => {
    const result = run(withStatus, {
      "Patient-Nr.": "PAT-1",
      "Rechnungs-Nr.": "RECH-2",
      Betrag: "200,00",
      Bezahldatum: "19.05.2026",
      Zahlstatus: "offen",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/not paid/i);
    expect(result.reason).toContain("offen");
  });

  it("still emits a refund for a storniert row with a negative amount", () => {
    const result = run(withStatus, {
      "Patient-Nr.": "PAT-1",
      "Rechnungs-Nr.": "RECH-3",
      Betrag: "-200,00",
      Bezahldatum: "19.05.2026",
      Zahlstatus: "storniert",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.events[0].kind).toBe("InvoiceRefunded");
    expect(result.events[0].refundedAmountCents).toBe(20000);
  });

  it("without a status column, books the row as paid (unchanged behavior)", () => {
    const result = run(withoutStatus, {
      "Patient-Nr.": "PAT-1",
      "Rechnungs-Nr.": "RECH-4",
      Betrag: "200,00",
      Bezahldatum: "19.05.2026",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.events[0].kind).toBe("InvoicePaid");
  });

  it("supports Rechnungsdatum as paidAt only via explicit operator config", () => {
    // Explicit column mapping (not auto-detection) may point paidAt at an
    // invoice-date column. This path must keep working.
    const explicit: CsvMapping = {
      stream: "invoices",
      columns: { ...baseColumns, paidAt: "Rechnungsdatum" },
      dateFormat: "DD.MM.YYYY",
      amountUnit: "eur",
      decimalSeparator: ",",
    };
    const result = run(explicit, {
      "Patient-Nr.": "PAT-1",
      "Rechnungs-Nr.": "RECH-5",
      Betrag: "200,00",
      Rechnungsdatum: "19.05.2026",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.events[0].kind).toBe("InvoicePaid");
    expect(result.events[0].paidAt).toBe("2026-05-19T00:00:00.000Z");
  });
});

describe("csv-mapper: Vorname/Name recombination (M-P4)", () => {
  it("recombines first + last for the standard German 'Vorname; Name' pair", () => {
    // A bare "Name" header resolves to BOTH fullName and lastName. The old
    // precedence let the fullName alias win and dropped the Vorname; now
    // recombination wins whenever both first and last are present.
    const mapping = autoDetectMapping(["Patient-Nr.", "Vorname", "Name"]);
    expect(mapping).not.toBeNull();
    expect(mapping!.stream).toBe("patients");
    const result = mapCsvRow({
      clinicId: CLINIC,
      fileHash: "abc",
      rowIndex: 0,
      row: { "Patient-Nr.": "PAT-1", Vorname: "Maria", Name: "Müller" },
      mapping: mapping!,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.events[0].fullName).toBe("Maria Müller");
  });

  it("still uses a standalone fullName column when no first name is present", () => {
    const mapping: CsvMapping = {
      stream: "patients",
      columns: { pvsPatientId: "Patient-Nr.", fullName: "Name" },
      dateFormat: "DD.MM.YYYY",
    };
    const result = mapCsvRow({
      clinicId: CLINIC,
      fileHash: "abc",
      rowIndex: 0,
      row: { "Patient-Nr.": "PAT-1", Name: "Maria Müller" },
      mapping,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.events[0].fullName).toBe("Maria Müller");
  });
});

describe("csv-mapper: calendar date validation (M-P5)", () => {
  const mapping: CsvMapping = {
    stream: "invoices",
    columns: {
      pvsPatientId: "Patient-Nr.",
      pvsInvoiceId: "Rechnungs-Nr.",
      amount: "Betrag",
      paidAt: "Bezahldatum",
    },
    dateFormat: "DD.MM.YYYY",
    amountUnit: "eur",
    decimalSeparator: ",",
  };

  it("rejects an impossible day/month (99.99.2026) instead of shipping 2026-99-99", () => {
    const result = mapCsvRow({
      clinicId: CLINIC,
      fileHash: "abc",
      rowIndex: 0,
      row: {
        "Patient-Nr.": "PAT-1",
        "Rechnungs-Nr.": "RECH-1",
        Betrag: "200,00",
        Bezahldatum: "99.99.2026",
      },
      mapping,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/invalid paidAt/i);
  });

  it("rejects a day past the month length (31.02.2026)", () => {
    const patientMapping: CsvMapping = {
      stream: "patients",
      columns: { pvsPatientId: "Patient-Nr.", dob: "Geburtsdatum" },
      dateFormat: "DD.MM.YYYY",
    };
    const result = mapCsvRow({
      clinicId: CLINIC,
      fileHash: "abc",
      rowIndex: 0,
      row: { "Patient-Nr.": "PAT-1", Geburtsdatum: "31.02.2026" },
      mapping: patientMapping,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/invalid dob/i);
  });

  it("accepts a real leap day (29.02.2024)", () => {
    const patientMapping: CsvMapping = {
      stream: "patients",
      columns: { pvsPatientId: "Patient-Nr.", dob: "Geburtsdatum" },
      dateFormat: "DD.MM.YYYY",
    };
    const result = mapCsvRow({
      clinicId: CLINIC,
      fileHash: "abc",
      rowIndex: 0,
      row: { "Patient-Nr.": "PAT-1", Geburtsdatum: "29.02.2024" },
      mapping: patientMapping,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.events[0].dob).toBe("2024-02-29");
  });

  it("rejects a non-leap-year Feb 29 (29.02.2023)", () => {
    const patientMapping: CsvMapping = {
      stream: "patients",
      columns: { pvsPatientId: "Patient-Nr.", dob: "Geburtsdatum" },
      dateFormat: "DD.MM.YYYY",
    };
    const result = mapCsvRow({
      clinicId: CLINIC,
      fileHash: "abc",
      rowIndex: 0,
      row: { "Patient-Nr.": "PAT-1", Geburtsdatum: "29.02.2023" },
      mapping: patientMapping,
    });
    expect(result.ok).toBe(false);
  });
});

describe("csv-mapper: mapCsvRow - amount locale matrix (H3)", () => {
  const mapping: CsvMapping = {
    stream: "invoices",
    columns: {
      pvsPatientId: "Patient-Nr.",
      pvsInvoiceId: "Rechnungs-Nr.",
      amount: "Betrag",
      paidAt: "Bezahldatum",
    },
    dateFormat: "DD.MM.YYYY",
    amountUnit: "eur",
    decimalSeparator: ",",
  };

  it.each([
    ["999", 99900],
    ["1000", 100000],
    ["1.234,50", 123450],
    ["1,250.00", 125000],
    ["1234,5", 123450],
  ] as const)("parses Betrag '%s' as %i cents (last-separator-wins)", (betrag, expected) => {
    const result = mapCsvRow({
      clinicId: CLINIC,
      fileHash: "abc",
      rowIndex: 0,
      row: {
        "Patient-Nr.": "PAT-1",
        "Rechnungs-Nr.": "RECH-1",
        Betrag: betrag,
        Bezahldatum: "19.05.2026",
      },
      mapping,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.events[0].kind).toBe("InvoicePaid");
    expect(result.events[0].amountCents).toBe(expected);
  });
});

describe("csv-mapper: parseDateTime ISO_DATETIME interpretation (L7)", () => {
  const mapping: CsvMapping = {
    stream: "appointments",
    columns: {
      pvsPatientId: "Patient-Nr.",
      pvsAppointmentId: "Termin-Nr.",
      scheduledAt: "Termindatum",
    },
    dateFormat: "ISO_DATETIME",
  };

  function scheduledAt(input: string): string | undefined {
    const result = mapCsvRow({
      clinicId: CLINIC,
      fileHash: "abc",
      rowIndex: 0,
      row: { "Patient-Nr.": "PAT-1", "Termin-Nr.": "TERM-1", Termindatum: input },
      mapping,
    });
    if (!result.ok) return undefined;
    return result.events[0].scheduledAt as string;
  }

  // These assertions are independent of the machine timezone by construction:
  // offset-less datetimes are interpreted as Europe/Berlin, not process-local.

  it("interprets an offset-less SUMMER datetime as Europe/Berlin (CEST, UTC+2)", () => {
    // 14:30 Berlin wall time in May = 12:30 UTC.
    expect(scheduledAt("2026-05-19T14:30:00")).toBe("2026-05-19T12:30:00.000Z");
  });

  it("interprets an offset-less WINTER datetime as Europe/Berlin (CET, UTC+1)", () => {
    // 09:00 Berlin wall time in January = 08:00 UTC.
    expect(scheduledAt("2026-01-15T09:00:00")).toBe("2026-01-15T08:00:00.000Z");
  });

  it("accepts a space separator between date and time", () => {
    expect(scheduledAt("2026-05-19 14:30:00")).toBe("2026-05-19T12:30:00.000Z");
  });

  it("respects an explicit Z (UTC) offset", () => {
    expect(scheduledAt("2026-05-19T14:30:00Z")).toBe("2026-05-19T14:30:00.000Z");
  });

  it("respects an explicit numeric offset", () => {
    expect(scheduledAt("2026-05-19T14:30:00+02:00")).toBe(
      "2026-05-19T12:30:00.000Z"
    );
  });

  it("pins an offset-less date-only value to UTC midnight", () => {
    expect(scheduledAt("2026-05-19")).toBe("2026-05-19T00:00:00.000Z");
  });

  it("rejects an impossible calendar datetime", () => {
    expect(scheduledAt("2026-02-30T10:00:00")).toBeUndefined();
  });
});
