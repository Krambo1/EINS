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
