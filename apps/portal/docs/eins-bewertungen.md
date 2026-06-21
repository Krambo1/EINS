# EINS Bewertungen — internal compliance + architecture note

Last updated: 2026-06-19.

## What it is

A post-visit patient-review program. When the PVS bridge derives an
"encounter completed" event for a patient, the portal schedules a review for
that clinic. Three days later (per clinic setting) we email the patient with
five star buttons. Clicking lands on a
clinic-branded page that surfaces BOTH the public Google/Jameda review CTA and
a private-feedback form. Public clicks flow toward Google/Jameda. Private text
lands in `/bewertungen/feedback` as a triage inbox for the Praxis — and so do
the public-redirect events, persisted as `patient_feedback.source =
'public_redirect'` so the Praxis sees a single unified list of everyone who
engaged with the request.

## Why this design (not "1–4 dead-end / 5 → Google")

The intuitive "filter funnel" — only direct happy patients to Google, dead-end
unhappy ones — is what Karam asked for initially. It's **review gating** and
it's prohibited:

1. **Google GMB review policy** — "Don't discourage or prohibit negative
   reviews or selectively solicit positive reviews from customers." Filtering
   on rating before showing the GMB link is a textbook violation. Grounds for
   profile suspension.

2. **BGH, judgement of 09.08.2022 (VI ZR 1244/20)** and the line of cases on
   Bewertungsportal-Filterung — review systems that systematically expose
   high-rating respondents to a public CTA while hiding it from low-rating
   respondents are misleading under §3 UWG.

3. **Karam's own product spec** (Notion · LÖSUNG Praxis Entlastung Idea #6,
   "EINS Bewertungen"): explicitly "nicht gefiltert, nicht incentiviert".

The compliant pattern (this implementation): **every rating sees both
options**. Visual prominence flips with rating, but neither branch is hidden
from the DOM. Patients self-select. That's what the BGH and Google want.

## Legal basis for sending the mail

- **§7 UWG Abs. 3** — patient is an "existing customer" (Bestandskunde) of
  the Praxis (the appointment is the prior transaction). We may send a
  "Direktwerbung" follow-up if all four conditions hold:
  1. Address was collected in the context of treatment ✓ (PMS).
  2. We use it only for "Werbung für eigene ähnliche Waren oder
     Dienstleistungen" ✓ (asking about the experience of *this clinic*).
  3. Patient did not object ✓ (we check `email_suppression`).
  4. We informed at intake that they can object at any time → **Praxis
     attests this once during onboarding** via the per-clinic
     `clinics.review_consent_attested` flag (signed checklist in `documents`).
     The pvs-status-derive worker only schedules a review when this is true.
- **DSGVO Art. 6 (1)(f)** — legitimate interest. Balancing test: the patient
  loses nothing (no third-party tracking, no resale), the Praxis gains
  diagnostic feedback. Documentation of attestation lives in
  `audit_log.action='patient_event'`.
- **RFC 8058 / §7 UWG Abs. 3 Nr. 2** — every mail carries a one-click
  unsubscribe link (`/r/unsubscribe?token=...`) that takes effect without a
  confirmation step.

## Components by responsibility

| Layer | Files |
|---|---|
| Schema | `src/db/schema.ts` (clinic columns, requestRecalls extensions, patient_feedback, email_suppression), `src/db/migrations/0013_eins_stimme.sql`, `src/db/migrations/0015_feedback_public_redirect.sql` (adds `patient_feedback.source` + `public_platform`) |
| Trigger (PVS → review) | `src/worker/processors/pvs-status-derive.ts` (`maybeScheduleReviewForCompletedEncounter`), `src/server/patient-events.ts` (`scheduleReviewRequest`) |
| Scheduler | `src/lib/queues.ts` (`reviewRequestTick`), `src/worker/schedules.ts` (15-min pg-boss schedule), `src/worker/processors/review-request.ts` |
| Outbound mail | `src/server/email/templates/review-request.ts`, `src/server/email/templates/feedback-alert.ts` |
| Patient-facing | `apps/clinic-landing/app/r/[token]/page.tsx` (compliant funnel), `feedback-form.tsx`, `go/route.ts` (public click redirect), `feedback/route.ts` (form proxy), `apps/clinic-landing/app/r/unsubscribe/page.tsx` |
| Token APIs | `src/app/api/review-tokens/[token]/{route,click,feedback,unsubscribe}.ts`, `src/server/review-tokens.ts` |
| Portal UI | `src/app/(portal)/einstellungen/{page,actions}.ts` (Bewertungen & Reputation), `src/app/(portal)/bewertungen/feedback/*` (inbox) |

## How a review gets scheduled

Per-clinic, no external automation. The PVS bridge syncs encounters into the
portal; the `pvs-status-derive` worker derives "encounter completed" and calls
`maybeScheduleReviewForCompletedEncounter`, which:

  1. gates on `clinics.review_request_enabled` + `clinics.review_consent_attested`,
  2. resolves the patient email from the EINS lead linkage (PVS events are
     pseudonymized and carry no address), and
  3. hands off to `scheduleReviewRequest` with the PVS appointment id as the
     per-appointment idempotency key.

For a PVS we do not support natively, the clinic imports the n8n template
(`/einstellungen/integrationen/setup/n8n`) which POSTs canonical events to
`/api/pvs/events`, signed with the per-clinic `pvs` HMAC secret. Same derive
path from there on.

The legacy Make.com inbound webhook (`POST /api/patients/events`) was removed
once the PVS bridge became the sole review trigger. The per-clinic `intake`
HMAC secret it shared with `/api/leads/intake` lives on for clinic-landing
lead-form submissions; rotating it in the portal UI affects only that flow now.

## Token lifecycle

1. `scheduleReviewRequest` generates `crypto.randomBytes(32).toString("hex")` and
   stores it in `review_email_schedule.review_token`.
2. Patient mail embeds `/r/<token>?rating=N`.
3. Clinic-landing resolves token via portal GET, records click target, then
   either redirects to Google/Jameda (via `/r/<token>/go`) or stays for the
   private form (POST `/r/<token>/feedback`). Both code paths persist a
   `patient_feedback` row — `source='public_redirect'` for the former
   (idempotent per recall), `source='private'` for the latter. Only the
   private path fires the feedback-alert mail to the Praxisinhaber:in;
   public redirects are silently inboxed and the actual public review
   surfaces later via the platform-sync workers.
4. Status transitions: `pending` (scheduled) → `sent` (mail queued) →
   `completed` (private feedback submitted) or `skipped` (suppressed / no URL
   configured / feature disabled).
5. Tokens are not single-use: a patient can revisit the URL on a different
   device. Rating value is COALESCE-locked on first click; subsequent clicks
   refresh `rating_clicked_at` only.

## Anti-spam

- Per-patient: `scheduleReviewRequest` refuses to schedule a second
  `review_request` for the same patient within 90 days. Matches §7 UWG
  ("wiederholt nicht zumutbar").
- Per-appointment: `scheduleReviewRequest` dedupes on `pvs_appointment_id`
  (pre-check + the 0058 unique index) so a re-derived encounter never
  schedules a second email.
- Per-IP rate-limit on all `/api/review-tokens/*` endpoints (60/min GET,
  30/min click, 10/min feedback, 20/10min unsubscribe).

## Out of scope for v1 — track in Notion

- WhatsApp delivery channel (Superchat / 360dialog) — Notion product spec
  mentions it as a future channel.
- Auto-pull of Google/Jameda aggregates into `reviews` snapshot — uses the
  existing GBP sync job slot in cron once OAuth is wired.
- Per-PMS onboarding coverage (Doctolib, Charly, ivoris, Z1, Dampsoft) is
  handled by the PVS bridge adapters + the n8n template, not by this program.
- Marketing copy on eins.de announcing the product — separate copywriting task.

## Manual smoke test

The scheduling logic (consent/feature gating, anti-spam, per-appointment
dedup) is covered by `src/server/patient-events.test.ts` and
`src/worker/processors/pvs-review-schedule.test.ts` — run `pnpm test` for the
fast path. To exercise the patient-facing funnel end-to-end:

See `apps/portal/RUN.md` for the dev boot. After:

```bash
# from apps/portal
pnpm db:migrate                   # ensures 0058 is applied
pnpm dev                          # in one shell
pnpm worker                       # in another
pnpm cron                         # in a third (or just run once; schedules persist)
```

```bash
# Insert a pending review row directly, scheduled for today so the next worker
# tick mails it. (In prod this row is created by the pvs-status-derive worker
# when the PVS bridge reports a completed encounter.)
psql "$DATABASE_URL" -c "
  INSERT INTO review_email_schedule
    (clinic_id, patient_id, kind, status, scheduled_for, review_token,
     review_token_expires_at, review_email, review_patient_name)
  SELECT c.id, p.id, 'review_request', 'pending', CURRENT_DATE,
         encode(gen_random_bytes(32),'hex'), now() + interval '90 days',
         'smoke@eins.test', 'Smoke Test'
  FROM clinics c
  JOIN patients p ON p.clinic_id = c.id
  WHERE c.slug = '_template'
  LIMIT 1;"
```

A console-driver mail will print to the worker log with five
`http://localhost:3002/r/<token>?rating=N` links. Click rating=5 → landing
shows Google/Jameda primary, private form secondary. Click rating=2 → form
is primary, Google/Jameda still present below. Submit form → a private row
appears in `/bewertungen/feedback` and `feedback-alert` mail prints to the
worker log. Click "Bei Google bewerten" → a `source='public_redirect'` row
appears in the same inbox (no alert mail) and the browser 302s to Google.
