# EINS Stimme — internal compliance + architecture note

Last updated: 2026-05-16.

## What it is

A post-visit patient-review program. After every appointment, Make.com pushes
an "appointment completed" webhook to the portal. Three days later (per clinic
setting) we email the patient with five star buttons. Clicking lands on a
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
   "EINS Stimme"): explicitly "nicht gefiltert, nicht incentiviert".

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
     attests this in the Make scenario** via `reviewConsent: true`. Without
     it the portal rejects the event.
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
| Inbound (PMS → portal) | `src/app/api/patients/events/route.ts`, `src/server/patient-events.ts`, `src/server/clinic-signature.ts` (HMAC shared with /api/leads/intake) |
| Scheduler | `src/lib/queues.ts` (`reviewRequestTick`), `src/worker/cron.ts` (15-min schedule), `src/worker/processors/review-request.ts` |
| Outbound mail | `src/server/email/templates/review-request.ts`, `src/server/email/templates/feedback-alert.ts` |
| Patient-facing | `apps/clinic-landing/app/r/[token]/page.tsx` (compliant funnel), `feedback-form.tsx`, `go/route.ts` (public click redirect), `feedback/route.ts` (form proxy), `apps/clinic-landing/app/r/unsubscribe/page.tsx` |
| Token APIs | `src/app/api/review-tokens/[token]/{route,click,feedback,unsubscribe}.ts`, `src/server/review-tokens.ts` |
| Portal UI | `src/app/(portal)/einstellungen/{page,actions}.ts` (Bewertungen & Reputation), `src/app/(portal)/stimme/*` (inbox) |

## Make.com scenario shape

Per-clinic. Trigger = PMS appointment marked `completed`. HTTP module:

```
POST {APP_ORIGIN}/api/patients/events
Headers:
  Content-Type: application/json
  X-EINS-Signature: sha256={hmac-sha256(body, clinic-secret)}
Body:
  {
    "clinicId":           "<uuid>",
    "eventKind":          "appointment_completed",
    "patient": {
      "email":            "<patient mail>",
      "fullName":         "<optional>",
      "phone":            "<optional>",
      "externalId":       "<PMS patient id, optional>"
    },
    "appointmentCompletedAt": "2026-05-12T14:30:00Z",
    "locationId":         null,
    "treatmentLabel":     "<optional>",
    "reviewConsent":      true
  }
```

`reviewConsent` is a hard precondition. The Praxis attests once during
onboarding (signed checklist in `documents`) that every patient is informed
at intake; the Make scenario hard-codes `true` on that basis. Without it the
portal returns `400 {code: "consent_missing"}`.

The same secret is reused for `/api/leads/intake` — one `intake` row per
clinic in `platform_credentials`. Rotating in the portal UI rotates BOTH
flows.

## Token lifecycle

1. `applyPatientEvent` generates `crypto.randomBytes(32).toString("hex")` and
   stores it in `request_recalls.review_token`.
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

- Per-patient: `applyPatientEvent` refuses to schedule a second
  `review_request` for the same patient within 90 days. Matches §7 UWG
  ("wiederholt nicht zumutbar").
- Per-clinic rate-limit on the Make webhook: 240/10min.
- Per-IP rate-limit on all `/api/review-tokens/*` endpoints (60/min GET,
  30/min click, 10/min feedback, 20/10min unsubscribe).

## Out of scope for v1 — track in Notion

- WhatsApp delivery channel (Superchat / 360dialog) — Notion product spec
  mentions it as a future channel.
- Auto-pull of Google/Jameda aggregates into `reviews` snapshot — uses the
  existing GBP sync job slot in cron once OAuth is wired.
- Per-PMS Make scenario templates (Doctolib, Charly, ivoris, Z1, Dampsoft) —
  operations team handles per-clinic onboarding from a template Workbook.
- Marketing copy on eins.de announcing the product — separate copywriting task.

## Manual smoke test

See `apps/portal/RUN.md` for the dev boot. After:

```bash
# from apps/portal
pnpm setup:intake _template       # ensures a clinic + secret exists
pnpm db:migrate                   # plays 0013_eins_stimme.sql
pnpm dev                          # in one shell
pnpm worker                       # in another
pnpm cron                         # in a third (or just run once; schedules persist)
```

```bash
# Mint a payload + signature
CLINIC=$(psql -tA "$DATABASE_URL" -c "SELECT id FROM clinics WHERE slug='_template';")
SECRET=$(grep PORTAL_INTAKE_SECRET_TEMPLATE apps/clinic-landing/.env.local | cut -d= -f2)
BODY=$(jq -nc \
  --arg cid "$CLINIC" \
  '{clinicId:$cid,
    eventKind:"appointment_completed",
    patient:{email:"smoke@eins.test", fullName:"Smoke Test"},
    appointmentCompletedAt:"2026-05-12T10:00:00Z",
    reviewConsent:true}')
SIG="sha256=$(printf %s "$BODY" | openssl dgst -sha256 -hmac "$SECRET" | awk '{print $2}')"

curl -i -X POST http://localhost:3001/api/patients/events \
  -H "Content-Type: application/json" \
  -H "X-EINS-Signature: $SIG" \
  -d "$BODY"

# Force the scheduled_for to today so the next worker tick picks it up.
psql "$DATABASE_URL" -c "UPDATE request_recalls
                           SET scheduled_for = CURRENT_DATE
                         WHERE kind = 'review_request'
                           AND status = 'pending';"
```

A console-driver mail will print to the worker log with five
`http://localhost:3002/r/<token>?rating=N` links. Click rating=5 → landing
shows Google/Jameda primary, private form secondary. Click rating=2 → form
is primary, Google/Jameda still present below. Submit form → a private row
appears in `/bewertungen/feedback` and `feedback-alert` mail prints to the
worker log. Click "Bei Google bewerten" → a `source='public_redirect'` row
appears in the same inbox (no alert mail) and the browser 302s to Google.
