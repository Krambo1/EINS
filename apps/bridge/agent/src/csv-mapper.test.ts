import { describe, it, expect } from "vitest";
import { aggregateInvoiceRows, invoiceScopeTotal, autoDetectMapping, detectMapping, mapCsvRow, classifyInvoiceStatus, AUTO_MAPPING_VERSION, type CsvMapping } from "./csv-mapper.js";

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
    expect(event.paidAt).toBe("2026-05-19T10:00:00.000Z");
    expect(event.pvsExternalEventId).toBe("csv-local:invoice:RECH-100:35000");
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
    expect(event.pvsExternalEventId).toMatch(/^csv-local:patient:PAT-42:[0-9a-f]{12}$/);
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
    expect(result.events[0].pvsExternalEventId).toMatch(/^csv-local:appointment:TERM-9:[0-9a-f]{12}$/);
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
    expect(result.events[0].pvsExternalEventId).toMatch(/^csv-local:recall:REC-2026-99:[0-9a-f]{12}$/);
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
    expect(result.events[0].pvsExternalEventId).toMatch(/^csv-local:encounter:ENC-7:[0-9a-f]{12}$/);
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
    expect(event.refundedAt).toBe("2026-05-19T10:00:00.000Z");
    // Refund id namespace differs from the paid event id for the same invoice.
    expect(event.pvsExternalEventId).toBe("csv-local:refund:RECH-100:35000");
    expect(event.pvsExternalEventId).not.toBe("csv-local:invoice:RECH-100:35000");
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
    expect(result.events[0].paidAt).toBe("2026-05-19T10:00:00.000Z");
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

describe("csv-mapper: header alias priority + ambiguity", () => {
  const base = ["Patient-Nr.", "Rechnungs-Nr.", "Bezahldatum"];
  function amountOf(extra: string[]): string | undefined {
    const m = autoDetectMapping([...base, ...extra]);
    if (!m || m.stream !== "invoices") return undefined;
    return m.columns.amount;
  }

  it("pass 2: the invoice total beats Honorar (Honorar leaves out Auslagen such as filler or toxin)", () => {
    // Rechnungsbetrag is what the patient pays: Honorar + Auslagen (+ MwSt).
    // It is repeated on every row, so it carries amountScope "invoice" and is
    // counted once per invoice (aggregateInvoiceRows).
    expect(amountOf(["Honorar", "Auslagen", "Rechnungsbetrag"])).toBe("Rechnungsbetrag");
    expect(amountOf(["Rechnungsbetrag", "Auslagen", "Honorar"])).toBe("Rechnungsbetrag");
  });

  it("pass 2: Betrag, MwSt, Gesamtbetrag -> Gesamtbetrag (invoice total, counted once)", () => {
    expect(amountOf(["Betrag", "MwSt", "Gesamtbetrag"])).toBe("Gesamtbetrag");
  });

  it("Brutto beats Betrag beats Honorar/Netto", () => {
    expect(amountOf(["Honorar", "Betrag"])).toBe("Betrag");
    expect(amountOf(["Netto", "Brutto"])).toBe("Brutto");
    expect(amountOf(["Netto"])).toBe("Netto");
  });

  it("new amount aliases", () => {
    for (const h of ["Bruttobetrag", "Betrag (EUR)", "Betrag in EUR", "Betrag €", "Summe brutto"]) {
      expect(amountOf([h])).toBe(h);
    }
  });

  it("two different columns in the best tier are ambiguous: detectMapping says why", () => {
    const headers = [...base, "Rechnungsbetrag", "Gesamtbetrag"];
    expect(autoDetectMapping(headers)).toBeNull();
    const d = detectMapping(headers);
    expect(d.ok).toBe(false);
    if (d.ok) return;
    expect(d.reason).toBe("ambiguous_amount_columns");
    expect(d.columns).toEqual(["Rechnungsbetrag", "Gesamtbetrag"]);
  });

  it("a bare Bezahlt is the status, never the paid date", () => {
    expect(autoDetectMapping(["Patient-Nr.", "Rechnungs-Nr.", "Betrag", "Bezahlt"])).toBeNull();
    const m = autoDetectMapping(["Patient-Nr.", "Rechnungs-Nr.", "Betrag", "Bezahlt am", "Bezahlt"]);
    expect(m!.stream).toBe("invoices");
    if (m!.stream !== "invoices") return;
    expect(m!.columns.paidAt).toBe("Bezahlt am");
    expect(m!.columns.statusColumn).toBe("Bezahlt");
  });

  it.each(["Zahldatum", "Zahlungsdatum", "Bezahldatum", "Eingang", "Zahlungseingang"])(
    "paidAt alias %s",
    (h) => {
      const m = autoDetectMapping(["Patient-Nr.", "Rechnungs-Nr.", "Betrag", h]);
      expect(m?.stream).toBe("invoices");
      if (m?.stream === "invoices") expect(m.columns.paidAt).toBe(h);
    }
  );

  it.each(["Rg.-Nr.", "Rg-Nr", "RgNr", "Re-Nr.", "Re.-Nr.", "Belegnr", "Belegnummer", "Rechnungs-Nr."])(
    "invoice id alias %s",
    (h) => {
      const m = autoDetectMapping(["Patient-Nr.", h, "Betrag", "Bezahldatum"]);
      expect(m?.stream).toBe("invoices");
      if (m?.stream === "invoices") expect(m.columns.pvsInvoiceId).toBe(h);
    }
  );

  it.each(["Patienten-Nr.", "Patientennr.", "Pat-Nr", "PatNr"])("patient id alias %s", (h) => {
    const m = autoDetectMapping([h, "Rechnungs-Nr.", "Betrag", "Bezahldatum"]);
    expect(m?.stream).toBe("invoices");
    if (m?.stream === "invoices") expect(m.columns.pvsPatientId).toBe(h);
  });
});

describe("csv-mapper: aggregateInvoiceRows", () => {
  const mapping = {
    stream: "invoices",
    columns: {
      pvsPatientId: "Pat",
      pvsInvoiceId: "Rg",
      amount: "Betrag",
      paidAt: "Datum",
      statusColumn: "Status",
    },
    dateFormat: "DD.MM.YYYY",
    amountUnit: "eur",
    decimalSeparator: ",",
  } as const satisfies CsvMapping;
  const r = (pat: string, rg: string, betrag: string, datum: string, status = "bezahlt") => ({
    Pat: pat,
    Rg: rg,
    Betrag: betrag,
    Datum: datum,
    Status: status,
  });

  it("sums rows, takes the latest date, skips footers and counts storno/offen", () => {
    const { events, stats } = aggregateInvoiceRows({
      clinicId: CLINIC,
      mapping,
      rows: [
        r("P1", "A", "10,00", "01.10.2026"),
        r("P1", "A", "5,50", "03.10.2026", "Teilzahlung"),
        r("P2", "B", "99,00", "02.10.2026", "Storniert"),
        r("P3", "C", "99,00", "02.10.2026", "offen"),
        r("P4", "D", "12,00", "02.10.2026", "bezahlt (Überweisung)"),
        r("P5", "E", "13,00", "02.10.2026", "bezahlt bar"),
        r("P6", "F", "14,00", "02.10.2026", "Erledigt"),
        r("Summe", "ges", "999,00", "07.10.2026"),
        r("P7", "", "5,00", "07.10.2026"),
      ],
    });
    // Pass 2: B has only a storniert row; it is emitted as 0 € so an amount
    // sent from an earlier export stops counting.
    expect(events.map((e) => [e.pvsInvoiceId, e.amountCents])).toEqual([
      ["A", 1550],
      ["B", 0],
      ["D", 1200],
      ["E", 1300],
      ["F", 1400],
    ]);
    expect(events[0].paidAt).toBe("2026-10-03T10:00:00.000Z");
    expect(stats).toMatchObject({ rows: 9, invoices: 5, skippedStorno: 1, skippedNotPaid: 1, skippedFooter: 2, netZeroInvoices: 1 });
  });

  it("a summary label in the first / invoice-id / patient-id cell marks the row as footer, but names like Summerfield do not", () => {
    const { events, stats } = aggregateInvoiceRows({
      clinicId: CLINIC,
      mapping,
      rows: [r("Summerfield", "A", "10,00", "01.10.2026"), r("P1", "Gesamtsumme", "10,00", "01.10.2026"), r("P1", "Übertrag", "1,00", "01.10.2026")],
    });
    expect(events.map((e) => e.pvsInvoiceId)).toEqual(["A"]);
    expect(stats.skippedFooter).toBe(2);
  });

  it("conflicting patient ids for one invoice number ignore that invoice", () => {
    const { events, stats } = aggregateInvoiceRows({
      clinicId: CLINIC,
      mapping,
      rows: [r("P1", "A", "10,00", "01.10.2026"), r("P2", "A", "10,00", "01.10.2026"), r("P3", "B", "1,00", "01.10.2026")],
    });
    expect(events.map((e) => e.pvsInvoiceId)).toEqual(["B"]);
    expect(stats.conflictingInvoices).toBe(1);
  });

  it("pass 2: an invoice that nets to 0 is emitted as InvoicePaid 0 (storno of an earlier export)", () => {
    const { events, stats } = aggregateInvoiceRows({
      clinicId: CLINIC,
      mapping,
      rows: [r("P1", "A", "100,00", "01.10.2026"), r("P1", "A", "-100,00", "02.10.2026", "Gutschrift")],
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "InvoicePaid", pvsInvoiceId: "A", amountCents: 0, pvsExternalEventId: "csv-local:invoice:A:0" });
    expect(stats.netZeroInvoices).toBe(1);
  });

  it("pass 2: the file revision is carried as sourceRevision on paid and refund events", () => {
    const { events } = aggregateInvoiceRows({
      clinicId: CLINIC,
      mapping,
      sourceRevision: 1_791_000_000_123,
      rows: [r("P1", "A", "10,00", "01.10.2026"), r("P2", "B", "-5,00", "01.10.2026", "Gutschrift")],
    });
    expect(events.map((e) => [e.kind, e.sourceRevision])).toEqual([
      ["InvoicePaid", 1_791_000_000_123],
      ["InvoiceRefunded", 1_791_000_000_123],
    ]);
  });

  it("pass 2: an invoice-level total repeated on every line is counted once (amountScope invoice)", () => {
    const totals = { ...mapping, amountScope: "invoice" } as const satisfies CsvMapping;
    const { events } = aggregateInvoiceRows({
      clinicId: CLINIC,
      mapping: totals,
      rows: [
        r("P1", "A", "450,00", "01.10.2026"),
        r("P1", "A", "450,00", "01.10.2026"),
        r("P1", "A", "450,00", "02.10.2026"),
      ],
    });
    expect(events.map((e) => e.amountCents)).toEqual([45000]);
  });

  it("pass 2: amountScope invoice takes the latest positive total and nets a credit note", () => {
    const totals = { ...mapping, amountScope: "invoice" } as const satisfies CsvMapping;
    const { events } = aggregateInvoiceRows({
      clinicId: CLINIC,
      mapping: totals,
      rows: [
        r("P1", "A", "500,00", "01.10.2026"),
        r("P1", "A", "450,00", "03.10.2026"),
        r("P1", "A", "-50,00", "04.10.2026", "Gutschrift"),
      ],
    });
    expect(events.map((e) => e.amountCents)).toEqual([40000]);
  });

  it("verifier: cancelled and re-issued under the same number is the new total, not a refund", () => {
    const totals = { ...mapping, amountScope: "invoice" } as const satisfies CsvMapping;
    const { events } = aggregateInvoiceRows({
      clinicId: CLINIC,
      mapping: totals,
      rows: [
        r("P1", "A", "1000,00", "01.10.2026"),
        r("P1", "A", "-1000,00", "05.10.2026"),
        r("P1", "A", "800,00", "05.10.2026"),
      ],
    });
    // Before: latest positive 800 + negative -1000 = InvoiceRefunded 200, and
    // without an earlier file for A the 800 € were lost.
    expect(events.map((e) => [e.kind, e.amountCents])).toEqual([["InvoicePaid", 80000]]);
  });

  it("invoiceScopeTotal: storno, repeated lines, re-issue, credit notes", () => {
    const t = (...rows: Array<[number, string]>) => invoiceScopeTotal(rows.map(([cents, at]) => ({ cents, at })));
    expect(t([100000, "a"], [-100000, "b"], [80000, "b"])).toBe(80000);
    expect(t([100000, "a"], [80000, "b"], [-100000, "b"])).toBe(80000); // old storno listed after the re-issue
    expect(t([80000, "a"], [-80000, "b"], [-80000, "b"])).toBe(0); // full storno repeated on two lines
    expect(t([100000, "a"], [-100000, "b"], [100000, "c"])).toBe(100000); // cancelled and re-issued, same amount
    expect(t([100000, "a"], [-20000, "b"], [100000, "c"])).toBe(80000); // total repeated after a credit
    expect(t([100000, "a"], [-20000, "b"], [-20000, "b"])).toBe(80000); // credit shown on two lines
    expect(t([100000, "a"], [-20000, "b"], [20000, "c"])).toBe(100000); // credit reversed
    expect(t([-50000, "a"])).toBe(-50000); // credit only
  });
});

describe("csv-mapper: invoice dates (Berlin) and amount notations", () => {
  const mapping: CsvMapping = {
    stream: "invoices",
    columns: { pvsPatientId: "P", pvsInvoiceId: "R", amount: "B", paidAt: "D" },
    dateFormat: "DD.MM.YYYY",
    amountUnit: "eur",
    decimalSeparator: ",",
  };
  const run = (b: string, d: string) =>
    mapCsvRow({ clinicId: CLINIC, fileHash: "h", rowIndex: 0, row: { P: "1", R: "9", B: b, D: d }, mapping });

  it.each([
    ["19.05.2026", "2026-05-19T10:00:00.000Z"],
    ["9.5.2026", "2026-05-09T10:00:00.000Z"],
    ["19.05.26", "2026-05-19T10:00:00.000Z"],
    ["2026-05-19", "2026-05-19T10:00:00.000Z"],
    ["19.01.2026", "2026-01-19T11:00:00.000Z"],
    ["19.05.2026 14:30", "2026-05-19T12:30:00.000Z"],
    ["19.05.2026 14:30:15", "2026-05-19T12:30:15.000Z"],
    ["2026-05-19 14:30", "2026-05-19T12:30:00.000Z"],
  ])("paidAt %s -> %s", (input, iso) => {
    const res = run("10,00", input);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.events[0].paidAt).toBe(iso);
  });

  it.each(["31.02.2026", "32.01.2026", "19.13.2026", "19.05.2026 25:00", "May 19 2026", "19.05."])(
    "rejects %s",
    (input) => {
      expect(run("10,00", input).ok).toBe(false);
    }
  );

  it.each([
    ["120,00-", -12000],
    ["(120,00)", -12000],
    ["−120,00", -12000],
    ["-120,00", -12000],
    ["EUR 120,00", 12000],
    ["120,00 EUR", 12000],
    ["€ 120,00", 12000],
    ["120,00 €", 12000],
    ["1 234,50", 123450],
    ["1 234,50", 123450],
    ["1 234,50 €", 123450],
    ["1.234,50", 123450],
  ])("amount %j -> %i cents", (input, cents) => {
    const res = run(input, "19.05.2026");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const ev = res.events[0];
    expect(ev.kind).toBe(cents < 0 ? "InvoiceRefunded" : "InvoicePaid");
    expect(Math.abs(cents)).toBe(ev.kind === "InvoiceRefunded" ? ev.refundedAmountCents : ev.amountCents);
  });

  it("rejects non-numeric amounts", () => {
    expect(run("abc", "19.05.2026").ok).toBe(false);
    expect(run("12,34,56x", "19.05.2026").ok).toBe(false);
  });
});

// ---------------------------------------------------------------
// Review findings 3-9
// ---------------------------------------------------------------

describe("csv-mapper review: invoice paidAt notations (finding 3)", () => {
  const mapping: CsvMapping = {
    stream: "invoices",
    columns: { pvsPatientId: "P", pvsInvoiceId: "R", amount: "B", paidAt: "D" },
    dateFormat: "DD.MM.YYYY",
    amountUnit: "eur",
    decimalSeparator: ",",
  };
  const run = (d: string) =>
    mapCsvRow({ clinicId: CLINIC, fileHash: "h", rowIndex: 0, row: { P: "1", R: "9", B: "10,00", D: d }, mapping });

  it.each([
    ["2026-10-07T14:33:00", "2026-10-07T12:33:00.000Z"],
    ["2026-10-07T14:33:00.000", "2026-10-07T12:33:00.000Z"],
    ["2026-10-07T14:33:00+02:00", "2026-10-07T12:33:00.000Z"],
    ["2026-10-07T14:33:00Z", "2026-10-07T14:33:00.000Z"],
    ["2026-10-07T14:33:00.000Z", "2026-10-07T14:33:00.000Z"],
    ["2026-10-07T14:33:00-05:00", "2026-10-07T19:33:00.000Z"],
    ["07.10.2026, 14:33", "2026-10-07T12:33:00.000Z"],
    ["07.10.2026 14:33:12", "2026-10-07T12:33:12.000Z"],
    ["07-10-2026", "2026-10-07T10:00:00.000Z"],
    ["07/10/2026", "2026-10-07T10:00:00.000Z"],
    ["07.10.2026", "2026-10-07T10:00:00.000Z"],
    ["07.10.26", "2026-10-07T10:00:00.000Z"],
  ])("paidAt %s -> %s", (input, iso) => {
    const res = run(input);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.events[0].paidAt).toBe(iso);
  });

  it.each(["07.10-2026", "2026-10-07T25:00:00", "2026-10-07T14:33:00+99", "45206", "07.10.2026 14:33 foo"])(
    "still rejects %s",
    (input) => {
      expect(run(input).ok).toBe(false);
    }
  );
});

describe("csv-mapper review: two-digit years (finding 4)", () => {
  const pat: CsvMapping = {
    stream: "patients",
    columns: { pvsPatientId: "P", dob: "G" },
    dateFormat: "DD.MM.YYYY",
  };
  const dobOf = (g: string) => {
    const r = mapCsvRow({ clinicId: CLINIC, fileHash: "h", rowIndex: 0, row: { P: "1", G: g }, mapping: pat });
    if (!r.ok) throw new Error(r.reason);
    return (r.events[0] as { dob?: string }).dob;
  };
  it("DOB: a 2-digit year above the current year's last two digits is 19YY", () => {
    expect(dobOf("15.03.65")).toBe("1965-03-15");
    expect(dobOf("15.03.99")).toBe("1999-03-15");
  });
  it("DOB: a 2-digit year up to the current year is 20YY", () => {
    const yy = new Date().getFullYear() % 100;
    expect(dobOf("01.02.05")).toBe("2005-02-01");
    expect(dobOf(`01.02.${String(yy).padStart(2, "0")}`)).toBe(`${new Date().getFullYear()}-02-01`);
  });
  it("DOB: 4-digit years are untouched", () => {
    expect(dobOf("15.03.1965")).toBe("1965-03-15");
  });
  it("invoice dates keep 20YY for two-digit years", () => {
    const inv: CsvMapping = {
      stream: "invoices",
      columns: { pvsPatientId: "P", pvsInvoiceId: "R", amount: "B", paidAt: "D" },
      dateFormat: "DD.MM.YYYY",
      amountUnit: "eur",
      decimalSeparator: ",",
    };
    const r = mapCsvRow({ clinicId: CLINIC, fileHash: "h", rowIndex: 0, row: { P: "1", R: "9", B: "1,00", D: "15.03.65" }, mapping: inv });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.events[0].paidAt).toBe("2065-03-15T11:00:00.000Z");
  });
});

describe("csv-mapper review: footer detection only on the first non-empty cell (finding 5)", () => {
  const mapping: CsvMapping = {
    stream: "invoices",
    columns: { pvsPatientId: "P", pvsInvoiceId: "R", amount: "B", paidAt: "D", pvsEncounterId: "T" },
    dateFormat: "DD.MM.YYYY",
    amountUnit: "eur",
    decimalSeparator: ",",
  };
  const run = (row: Record<string, string>) =>
    mapCsvRow({ clinicId: CLINIC, fileHash: "h", rowIndex: 0, row, mapping });

  it("a treatment text starting with Total / Summe in a later cell is not a footer", () => {
    const a = run({ R: "R2", P: "P2", T: "Total Body Lifting", B: "5.000,00", D: "02.10.2026" });
    expect(a.ok).toBe(true);
    const b = run({ R: "R3", P: "P3", T: "Summe aller Teile", B: "10,00", D: "02.10.2026" });
    expect(b.ok).toBe(true);
  });
  it("a Summe line is still a footer, also with leading empty cells", () => {
    expect(run({ R: "Summe", P: "", B: "1.255,50", D: "" }).ok).toBe(false);
    expect(run({ R: "", P: "Gesamt", B: "1.255,50", D: "02.10.2026" }).ok).toBe(false);
  });
});

describe("csv-mapper review: bare Patient column is a name, not an id (finding 6)", () => {
  it("Patient;Rechnungsnummer;Betrag;Zahldatum has no usable mapping", () => {
    const headers = ["Patient", "Rechnungsnummer", "Betrag", "Zahldatum"];
    expect(autoDetectMapping(headers)).toBeNull();
    expect(detectMapping(headers).ok).toBe(false);
  });
});

describe("csv-mapper review: amount scope and payment aliases (finding 7)", () => {
  const scopeOf = (headers: string[]) => {
    const m = autoDetectMapping(headers);
    if (!m || m.stream !== "invoices") return undefined;
    return { amount: m.columns.amount, scope: m.amountScope };
  };
  it("pass 2: the invoice total Rechnungsbetrag beats a line-item Betrag (scope invoice)", () => {
    expect(scopeOf(["Rechnungsnummer", "Patient-Nr.", "Ziffer", "Leistung", "Betrag", "Rechnungsbetrag", "Zahldatum"])).toEqual({
      amount: "Rechnungsbetrag",
      scope: "invoice",
    });
  });
  it("Zahlbetrag beats Rechnungsbetrag", () => {
    expect(scopeOf(["Rechnungsnummer", "Patient-Nr.", "Rechnungsbetrag", "Zahlbetrag", "Zahldatum"])).toEqual({
      amount: "Zahlbetrag",
      scope: "row",
    });
  });
  it("Rechnungsbetrag alone is scope invoice", () => {
    expect(scopeOf(["Rechnungsnummer", "Patient-Nr.", "Rechnungsbetrag", "Zahldatum"])).toEqual({
      amount: "Rechnungsbetrag",
      scope: "invoice",
    });
  });
  it.each(["Gesamtbetrag", "Endbetrag", "Rechnungssumme"])("%s alone is scope invoice", (h) => {
    expect(scopeOf(["Rechnungsnummer", "Patient-Nr.", h, "Zahldatum"])).toEqual({ amount: h, scope: "invoice" });
  });
  it.each(["Zahlbetrag", "Zahlungsbetrag", "Gezahlt", "Zahlung", "Betrag bezahlt", "Einzahlung"])(
    "payment alias %s wins over Betrag and is scope row",
    (h) => {
      expect(scopeOf(["Rechnungsnummer", "Patient-Nr.", "Betrag", h, "Zahldatum"])).toEqual({ amount: h, scope: "row" });
    }
  );
  it("Betrag / Honorar stay scope row", () => {
    expect(scopeOf(["Rechnungsnummer", "Patient-Nr.", "Betrag", "Zahldatum"])?.scope).toBe("row");
    expect(scopeOf(["Rechnungsnummer", "Patient-Nr.", "Honorar", "Zahldatum"])?.scope).toBe("row");
  });
  it("two invoice totals are still ambiguous", () => {
    const d = detectMapping(["Rechnungsnummer", "Patient-Nr.", "Rechnungsbetrag", "Gesamtbetrag", "Zahldatum"]);
    expect(d.ok).toBe(false);
  });
  it("AUTO_MAPPING_VERSION was bumped", () => {
    // Pass 2: 4 = invoice totals ahead of row amounts.
    expect(AUTO_MAPPING_VERSION).toBeGreaterThanOrEqual(4);
  });
});

describe("csv-mapper review: status vocabulary (finding 8)", () => {
  it.each([
    "bezahlt", "komplett bezahlt", "Komplett Bezahlt", "  voll   bezahlt ", "B", "b", "Zahlung eingegangen", "ausgeglichen",
    "erledigt", "beglichen", "teilbezahlt", "teilweise bezahlt", "Teilzahlung", "bezahlt (Überweisung)", "gezahlt", "ja", "paid",
  ])("paid: %j", (s) => {
    expect(classifyInvoiceStatus(s)).toBe("paid");
  });
  it.each([
    "offen", "OFFEN", "unbezahlt", "nicht bezahlt", "Nicht  bezahlt", "noch nicht bezahlt", "nicht beglichen", "O", "o",
    "gemahnt", "Mahnung", "überfällig", "ueberfaellig", "ueberfällig", "uberfallig",
  ])("open: %j", (s) => {
    expect(classifyInvoiceStatus(s)).toBe("open");
  });
  it.each(["storniert", "Storno", "STORNIERUNG", "S", "s", "gutgeschrieben", "Gutschrift"])("storno: %j", (s) => {
    expect(classifyInvoiceStatus(s)).toBe("storno");
  });
  it.each([undefined, "", "   ", "xyz", "Bar", "BB", "Sx", "Ok"])("unknown: %j", (s) => {
    expect(classifyInvoiceStatus(s)).toBe("unknown");
  });
  it("single letters only match as the whole token", () => {
    expect(classifyInvoiceStatus("Bar")).toBe("unknown");
    expect(classifyInvoiceStatus("Offen")).toBe("open");
    expect(classifyInvoiceStatus("Ssss")).toBe("unknown");
  });
  it("rows with these status tokens flow through the status gate", () => {
    const mapping: CsvMapping = {
      stream: "invoices",
      columns: { pvsPatientId: "P", pvsInvoiceId: "R", amount: "B", paidAt: "D", statusColumn: "S" },
      dateFormat: "DD.MM.YYYY",
      amountUnit: "eur",
      decimalSeparator: ",",
    };
    const run = (s: string) =>
      mapCsvRow({ clinicId: CLINIC, fileHash: "h", rowIndex: 0, row: { P: "1", R: "9", B: "10,00", D: "01.10.2026", S: s }, mapping }).ok;
    expect(run("komplett bezahlt")).toBe(true);
    expect(run("B")).toBe(true);
    expect(run("nicht bezahlt")).toBe(false);
    expect(run("unbezahlt")).toBe(false);
    expect(run("Gutschrift")).toBe(false);
    expect(run("S")).toBe(false);
  });
});

describe("csv-mapper review: revisioned ids for non-invoice streams (finding 9)", () => {
  const run = (mapping: CsvMapping, row: Record<string, string>) => {
    const r = mapCsvRow({ clinicId: CLINIC, fileHash: "h", rowIndex: 0, row, mapping, fileModifiedAtIso: "2026-10-01T00:00:00.000Z" });
    if (!r.ok) throw new Error(r.reason);
    return r.events;
  };
  const pat: CsvMapping = {
    stream: "patients",
    columns: { pvsPatientId: "P", email: "E", phone: "T" },
    dateFormat: "DD.MM.YYYY",
  };
  it("same patient row twice -> same id; changed email or phone -> different id", () => {
    const a = run(pat, { P: "42", E: "a@x.de", T: "1" })[0].pvsExternalEventId;
    const b = run(pat, { P: "42", E: "a@x.de", T: "1" })[0].pvsExternalEventId;
    const c = run(pat, { P: "42", E: "b@x.de", T: "1" })[0].pvsExternalEventId;
    const d = run(pat, { P: "42", E: "a@x.de", T: "2" })[0].pvsExternalEventId;
    expect(a).toBe(b);
    expect(a).toMatch(/^csv-local:patient:42:[0-9a-f]{12}$/);
    expect(c).not.toBe(a);
    expect(d).not.toBe(a);
  });
  it("patient id ignores the volatile occurredAt (file mtime)", () => {
    const one = mapCsvRow({ clinicId: CLINIC, fileHash: "h", rowIndex: 0, row: { P: "42", E: "a@x.de" }, mapping: pat, fileModifiedAtIso: "2026-10-01T00:00:00.000Z" });
    const two = mapCsvRow({ clinicId: CLINIC, fileHash: "h", rowIndex: 0, row: { P: "42", E: "a@x.de" }, mapping: pat, fileModifiedAtIso: "2026-10-05T00:00:00.000Z" });
    if (!one.ok || !two.ok) throw new Error("map");
    expect(one.events[0].pvsExternalEventId).toBe(two.events[0].pvsExternalEventId);
  });
  it("appointment id changes when the appointment is rescheduled", () => {
    const m: CsvMapping = {
      stream: "appointments",
      columns: { pvsPatientId: "P", pvsAppointmentId: "A", scheduledAt: "S" },
      dateFormat: "DD.MM.YYYY",
    };
    const a = run(m, { P: "1", A: "7", S: "10.10.2026" })[0].pvsExternalEventId;
    const a2 = run(m, { P: "1", A: "7", S: "10.10.2026" })[0].pvsExternalEventId;
    const b = run(m, { P: "1", A: "7", S: "11.10.2026" })[0].pvsExternalEventId;
    expect(a).toBe(a2);
    expect(a).toMatch(/^csv-local:appointment:7:[0-9a-f]{12}$/);
    expect(b).not.toBe(a);
  });
  it("encounter and recall ids carry a revision too", () => {
    const e: CsvMapping = {
      stream: "encounters",
      columns: { pvsPatientId: "P", pvsEncounterId: "E", completedAt: "C", treatmentLabel: "L" },
      dateFormat: "DD.MM.YYYY",
    };
    const e1 = run(e, { P: "1", E: "5", C: "10.10.2026", L: "Botox" })[0].pvsExternalEventId;
    const e2 = run(e, { P: "1", E: "5", C: "10.10.2026", L: "Filler" })[0].pvsExternalEventId;
    expect(e1).toMatch(/^csv-local:encounter:5:[0-9a-f]{12}$/);
    expect(e2).not.toBe(e1);
    const r: CsvMapping = {
      stream: "recalls",
      columns: { pvsPatientId: "P", pvsRecallId: "R", recallAt: "A" },
      dateFormat: "DD.MM.YYYY",
    };
    const r1 = run(r, { P: "1", R: "3", A: "10.12.2026" })[0].pvsExternalEventId;
    const r2 = run(r, { P: "1", R: "3", A: "11.12.2026" })[0].pvsExternalEventId;
    expect(r1).toMatch(/^csv-local:recall:3:[0-9a-f]{12}$/);
    expect(r2).not.toBe(r1);
  });
  it("ids stay within 200 chars even for very long source ids", () => {
    const long = "X".repeat(400);
    const id = run(pat, { P: long, E: "a@x.de" })[0].pvsExternalEventId;
    expect(id.length).toBeLessThanOrEqual(200);
  });
  it("invoice ids are unchanged", () => {
    const inv: CsvMapping = {
      stream: "invoices",
      columns: { pvsPatientId: "P", pvsInvoiceId: "R", amount: "B", paidAt: "D" },
      dateFormat: "DD.MM.YYYY",
      amountUnit: "eur",
      decimalSeparator: ",",
    };
    expect(run(inv, { P: "1", R: "9", B: "10,00", D: "01.10.2026" })[0].pvsExternalEventId).toBe("csv-local:invoice:9:1000");
  });
});
