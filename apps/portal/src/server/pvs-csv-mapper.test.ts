import { describe, it, expect } from "vitest";
import { mapCsvRow, CsvMappingSchema } from "./pvs-csv-mapper";

const CLINIC = "11111111-2222-3333-4444-555555555555";
const UPLOAD = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

describe("pvs-csv-mapper", () => {
  describe("patients stream", () => {
    it("emits PatientUpserted with mapped columns", () => {
      const mapping = CsvMappingSchema.parse({
        stream: "patients",
        columns: {
          pvsPatientId: "PAT_ID",
          email: "E-Mail",
          fullName: "Name",
          dob: "Geburtstag",
        },
        dateFormat: "DD.MM.YYYY",
      });
      const out = mapCsvRow({
        clinicId: CLINIC,
        uploadId: UPLOAD,
        rowIndex: 0,
        row: {
          PAT_ID: "P-42",
          "E-Mail": "maria@example.de",
          Name: "Maria Müller",
          Geburtstag: "15.06.1980",
        },
        mapping,
      });
      expect(out.ok).toBe(true);
      if (!out.ok) return;
      expect(out.events).toHaveLength(1);
      const e = out.events[0]!;
      expect(e.kind).toBe("PatientUpserted");
      if (e.kind !== "PatientUpserted") return;
      expect(e.pvsPatientId).toBe("P-42");
      expect(e.email).toBe("maria@example.de");
      expect(e.fullName).toBe("Maria Müller");
      expect(e.dob).toBe("1980-06-15");
    });

    it("rejects rows missing pvsPatientId", () => {
      const mapping = CsvMappingSchema.parse({
        stream: "patients",
        columns: { pvsPatientId: "PAT_ID" },
        dateFormat: "YYYY-MM-DD",
      });
      const out = mapCsvRow({
        clinicId: CLINIC,
        uploadId: UPLOAD,
        rowIndex: 1,
        row: { PAT_ID: "" },
        mapping,
      });
      expect(out.ok).toBe(false);
    });
  });

  describe("invoices stream", () => {
    it("converts German EUR format to cents", () => {
      const mapping = CsvMappingSchema.parse({
        stream: "invoices",
        columns: {
          pvsPatientId: "PAT",
          pvsInvoiceId: "INV",
          amount: "Betrag",
          paidAt: "Bezahlt",
        },
        dateFormat: "ISO_DATETIME",
        amountUnit: "eur",
        decimalSeparator: ",",
      });
      const out = mapCsvRow({
        clinicId: CLINIC,
        uploadId: UPLOAD,
        rowIndex: 0,
        row: {
          PAT: "P-1",
          INV: "I-9",
          Betrag: "1.234,56 €",
          Bezahlt: "2026-05-18T10:30:00Z",
        },
        mapping,
      });
      expect(out.ok).toBe(true);
      if (!out.ok) return;
      const e = out.events[0]!;
      if (e.kind !== "InvoicePaid") throw new Error("wrong kind");
      expect(e.amountCents).toBe(123456);
    });

    it("converts US format with point decimal", () => {
      const mapping = CsvMappingSchema.parse({
        stream: "invoices",
        columns: {
          pvsPatientId: "PAT",
          pvsInvoiceId: "INV",
          amount: "Betrag",
          paidAt: "Bezahlt",
        },
        dateFormat: "ISO_DATETIME",
        amountUnit: "eur",
        decimalSeparator: ".",
      });
      const out = mapCsvRow({
        clinicId: CLINIC,
        uploadId: UPLOAD,
        rowIndex: 0,
        row: {
          PAT: "P-1",
          INV: "I-9",
          Betrag: "1,234.56",
          Bezahlt: "2026-05-18T10:30:00Z",
        },
        mapping,
      });
      expect(out.ok).toBe(true);
      if (!out.ok) return;
      const e = out.events[0]!;
      if (e.kind !== "InvoicePaid") throw new Error("wrong kind");
      expect(e.amountCents).toBe(123456);
    });

    it("rejects negative amounts", () => {
      const mapping = CsvMappingSchema.parse({
        stream: "invoices",
        columns: {
          pvsPatientId: "PAT",
          pvsInvoiceId: "INV",
          amount: "Betrag",
          paidAt: "Bezahlt",
        },
        dateFormat: "ISO_DATETIME",
        amountUnit: "eur",
        decimalSeparator: ",",
      });
      const out = mapCsvRow({
        clinicId: CLINIC,
        uploadId: UPLOAD,
        rowIndex: 0,
        row: {
          PAT: "P-1",
          INV: "I-9",
          Betrag: "-10,00",
          Bezahlt: "2026-05-18T10:30:00Z",
        },
        mapping,
      });
      expect(out.ok).toBe(false);
    });
  });

  describe("appointments stream", () => {
    it("emits both AppointmentCreated and StatusChanged when statusColumn maps", () => {
      const mapping = CsvMappingSchema.parse({
        stream: "appointments",
        columns: {
          pvsPatientId: "PAT",
          pvsAppointmentId: "APPT",
          scheduledAt: "Datum",
          statusColumn: "Status",
        },
        dateFormat: "ISO_DATETIME",
      });
      const out = mapCsvRow({
        clinicId: CLINIC,
        uploadId: UPLOAD,
        rowIndex: 0,
        row: {
          PAT: "P-1",
          APPT: "A-9",
          Datum: "2026-05-18T10:30:00Z",
          Status: "nicht_erschienen",
        },
        mapping,
      });
      expect(out.ok).toBe(true);
      if (!out.ok) return;
      expect(out.events).toHaveLength(2);
      expect(out.events[0]!.kind).toBe("AppointmentCreated");
      expect(out.events[1]!.kind).toBe("AppointmentStatusChanged");
      const status = out.events[1]!;
      if (status.kind !== "AppointmentStatusChanged") return;
      expect(status.newStatus).toBe("no_show");
    });

    it("emits only AppointmentCreated when statusColumn says 'scheduled'", () => {
      const mapping = CsvMappingSchema.parse({
        stream: "appointments",
        columns: {
          pvsPatientId: "PAT",
          pvsAppointmentId: "APPT",
          scheduledAt: "Datum",
          statusColumn: "Status",
        },
        dateFormat: "ISO_DATETIME",
      });
      const out = mapCsvRow({
        clinicId: CLINIC,
        uploadId: UPLOAD,
        rowIndex: 0,
        row: {
          PAT: "P-1",
          APPT: "A-9",
          Datum: "2026-05-18T10:30:00Z",
          Status: "geplant",
        },
        mapping,
      });
      expect(out.ok).toBe(true);
      if (!out.ok) return;
      expect(out.events).toHaveLength(1);
      expect(out.events[0]!.kind).toBe("AppointmentCreated");
    });
  });
});
