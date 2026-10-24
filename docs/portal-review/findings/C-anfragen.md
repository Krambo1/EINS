# Befunde Bereich C: Anfragen (Kernfluss)

Geprüft: Zielseite (clinic-landing) bis Portal-Zeile, Meta-Webhook, Benachrichtigung, KI-Bewertung, Garantie-Uhr, 48 Werkstunden, Liste und Detail-Cockpit. Nur gelesen, nichts geändert, nichts ausgeführt. Pfade relativ zu `apps/portal/` bzw. `apps/clinic-landing/`.

---

### C-1: Anfrage geht still verloren, wenn die Zielseite das Portal nicht erreicht (kein Wiederholen, kein Alarm)
- Schwere: P0
- Art: robustness
- Sicherheit: hoch
- Ort: `apps/clinic-landing/lib/portal-intake.ts:195-223`, `apps/clinic-landing/app/api/lead/route.ts:282-289, 333-343`
- Beleg: `sendToPortal` kehrt bei fehlendem `PORTAL_URL`, fehlender `portalClinicId` oder fehlender Secret-Umgebungsvariable mit `return` zurück (Zeilen 195-200), ohne Fehler. Bei Nicht-2xx nur `console.warn` (Zeile 220). Der `fetch` hat kein Timeout, keine Wiederholung, keinen `Idempotency-Key`, keinen Ausgangskorb. Die Route fängt alles mit `.catch(() => undefined)` und antwortet immer `{ ok: true }` (Zeile 335). `scripts/validate-clinics.ts` prüft `portalClinicId`/`portalIntakeSecretEnv` nicht gegen die Umgebung.
- Szenario: Neue Praxis, Karam vergisst `PORTAL_INTAKE_SECRET_<PRAXIS>` oder `PORTAL_URL` in Vercel zu setzen (oder falsche Variable, Tippfehler im Namen). Jede Anfrage von der Zielseite wird freundlich bestätigt, landet aber nirgends im Portal. Das Portal sieht nichts (nicht einmal einen `lead_intake_reject`-Audit, weil die Anfrage nie ankommt). Gleiches bei Portal-Ausfall, 429, 400 (siehe C-3) oder 500. Die Praxis wartet auf Anfragen, die 90 Tage laufen, ohne dass irgendein Mensch merkt, dass die Anbindung tot ist. Wegen Garantie "Keine Anfrage, keine Rechnung" läuft EINS am Ende ohne Umsatz aus, obwohl Anfragen da waren.
- Fix-Vorschlag: In `portal-intake.ts` (1) fehlende Konfiguration als Fehler behandeln und laut loggen/an Karam melden; (2) `AbortSignal.timeout(8000)` und 2 Wiederholungen mit Backoff; (3) bei endgültigem Fehlschlag Anfrage in eine dauerhafte Ablage schreiben (z. B. Tabelle oder Resend-Mail an Karam mit den Rohdaten), nie nur `console.warn`; (4) `validate-clinics.ts` um Prüfung der Umgebungsvariablen erweitern; (5) im Portal Einstellungen/Admin "Letzte Anfrage über die Zielseite" anzeigen.

### C-2: Wiederholte Absendung wird von der Zielseite verworfen, auch wenn die erste nie im Portal ankam
- Schwere: P1
- Art: data-correctness
- Sicherheit: hoch
- Ort: `apps/clinic-landing/app/api/lead/route.ts:85-96, 228-229, 282`, `apps/clinic-landing/lib/idempotency.ts`
- Beleg: `rememberKey()` setzt den Schlüssel (E-Mail + Behandlung + Tag) vor dem Senden und löscht ihn bei Fehlschlag nicht. Mit `fresh === false` wird weder Portal noch CRM aufgerufen, Antwort trotzdem `ok: true, duplicate: true`. Der Speicher ist pro Lambda-Instanz (`SEEN_KEYS = new Map`).
- Szenario: (a) Portal kurz down oder 400 wegen C-3, Patient gibt die Anfrage später erneut ab, sie wird als Duplikat verworfen, Anfrage endgültig weg. (b) Umgekehrt: zwei warme Instanzen kennen den Schlüssel des anderen nicht, derselbe Mensch erzeugt mehrere Zeilen im Portal. Kein `Idempotency-Key` an das Portal (das Portal unterstützt ihn, `server/leads.ts:105`, aber `portal-intake.ts` sendet ihn nie), also ist die vorhandene DB-Deduplizierung ungenutzt.
- Fix-Vorschlag: `rememberKey` nur bei erfolgreichem Portal-Erfolg setzen oder ganz entfernen. In `sendToPortal` `Idempotency-Key: <meta.eventId>` mitsenden (`eventId` kommt aus dem Browser und ist pro Formular stabil). Dadurch dedupliziert die DB über alle Instanzen.

### C-3: Zu lange `sourceUrl` oder andere Feldlängen lassen das Portal die ganze Anfrage mit 400 ablehnen
- Schwere: P1
- Art: robustness
- Sicherheit: mittel
- Ort: `src/app/api/leads/intake/route.ts:27-59 (sourceUrl max 500 Zeile 56, fbc max 200, treatmentSelection max 120), 149-155`, `apps/clinic-landing/app/api/lead/route.ts:68-75`, `apps/clinic-landing/components/sections/pre-qualifier/index.tsx:282`
- Beleg: Die Zielseite sendet `sourceUrl: window.location.href` (nur `min(1)`, keine Obergrenze) und `treatment` (nur `min(1)`). Das Portal erlaubt `sourceUrl` max. 500, `treatmentSelection` max. 120, `quiz.fbc` max. 200 und antwortet bei jedem Verstoß mit dem allgemeinen 400 `invalid_request`, ohne Audit und ohne Hinweis, welches Feld.
- Szenario: Meta-Anzeigen-Links mit `fbclid`, `gclid` und mehreren UTM-Parametern (Meta hängt oft 100+ Zeichen an) überschreiten leicht 500 Zeichen. Die gesamte Anfrage wird abgelehnt, die Zielseite loggt nur eine Warnung und bestätigt dem Patienten. Gerade bezahlte Besucher, also die wertvollsten, gehen verloren.
- Fix-Vorschlag: Im Portal-Schema Längen per `.transform(s => s.slice(0, N))` kürzen statt ablehnen (wie bei `treatmentWish`). Zusätzlich in `mapToIntake` (Zielseite) die Felder vor dem Senden kürzen. Bei 400 vom Portal im Audit den Fehlergrund (Pfad des Zod-Fehlers, ohne Inhalte) festhalten.

### C-4: Zielseite wartet ohne Timeout auf das Portal, Antwortzeit für den Patienten hängt an Cold Start, pg-boss und Audit
- Schwere: P2
- Art: performance
- Sicherheit: mittel
- Ort: `apps/clinic-landing/lib/portal-intake.ts:208`, `apps/clinic-landing/app/api/lead/route.ts:333`, `src/app/api/leads/intake/route.ts:178-313`, `src/server/jobs.ts:66-92`
- Beleg: `await Promise.allSettled(tasks)` blockiert die Antwort an den Browser, bis `fetch` zum Portal fertig ist. Das Portal macht: 2 Rate-Limit-Upserts, Signaturprüfung (DB), Klinik-Select, Insert, synchroner Audit-Insert, dann zweimal `ready()` (`boss.start()` über eine frische Verbindung bei Kaltstart), erst dann Antwort.
- Szenario: Kalte Instanzen auf beiden Seiten, Neon-Aufwachen und `boss.start()` (bei fehlendem `pgboss`-Schema wirft es erst nach Verbindungsversuch): mehrere Sekunden Wartezeit am Absende-Button, Abbrüche durch Patienten, doppeltes Absenden (siehe C-2).
- Fix-Vorschlag: Im Portal die Queue-Enqueues nach der Antwort (`after()`), den Audit ebenso; auf der Zielseite `AbortSignal.timeout`. Besser: Zielseite schreibt zuerst in einen Ausgangskorb und liefert asynchron aus (siehe C-1).

### C-5: Die Praxis erfährt von einer neuen Anfrage nur, wenn sie das Portal öffnet (keine E-Mail, keine Glocke, kein Push)
- Schwere: P0
- Art: missing-feature
- Sicherheit: hoch
- Ort: `src/app/api/leads/intake/route.ts:286-313`, `src/server/leads.ts:132-216`, `src/server/queries/navBadgesCache.ts:40`, `src/app/(portal)/layout.tsx:82-138`, `src/worker/processors/sla-check.ts:132-195`
- Beleg: Weder `persistLead` noch die Intake-Route erzeugen eine Benachrichtigung oder E-Mail an die Praxis (Suche nach `enqueueEmail`/`notifications`-Inserts: nur `sla-check.ts`, `refresh-oauth.ts`, Anomalie-Regeln; `'new_lead'` kommt nur im Seed vor, `db/seed.ts:627`). Das einzige Signal ist der Zähler "neu und noch nicht geöffnet" in der Seitenleiste, der nur beim Seitenwechsel neu berechnet wird (30 s Cache). Die Glocke zeigt nur `sla_breach` (Worker, bei Skalierung 0 gar nichts).
- Szenario: Eine Inhaberin (40-65, am Handy) bekommt freitags 17:30 eine Anfrage von jemandem, der 3.900-€-Geld ausgeben will. Niemand sieht sie bis Montag, oder bis jemand zufällig das Portal öffnet. Die 48 Werkstunden laufen, "von der Praxis nicht beantwortet" entsteht, die Praxis verliert den Einwand und darf in der Folge Anzeigen pausiert bekommen, ohne je gewarnt worden zu sein. Das ist der Kernwert des Produkts und funktioniert bei Worker auf 0 sowie auch mit laufendem Worker nicht, weil es die Funktion gar nicht gibt.
- Fix-Vorschlag: In der Intake-Route nach dem Insert direkt (ohne Queue) per Resend eine E-Mail "Neue Anfrage" an alle Inhaber/Frontdesk-Nutzer senden (nur Behandlung und Link, keine Patientendaten im Text), im `after()`-Block mit Fehlerprotokoll; zusätzlich eine `notifications`-Zeile `new_request`. E-Mail muss ohne Worker funktionieren. Gleiches für den Meta-Webhook.

### C-6: Karam wird nicht benachrichtigt, wenn die erste qualifizierte Anfrage eingeht (Rechnung wird vergessen)
- Schwere: P1
- Art: missing-feature
- Sicherheit: hoch
- Ort: `src/server/guarantee-clock.ts:202-232`, `src/app/admin/garantie/page.tsx:85`, `src/lib/guarantee-clock.ts:313-331`
- Beleg: Ein Kandidat wird nur als Badge "Kandidat prüfen" in `/admin/garantie` berechnet, wenn Karam die Seite öffnet. Es gibt keinen Mailversand, keine Admin-Benachrichtigung, keinen geplanten Scan (Suche nach `hasCandidate`/"erste qualifizierte" ergibt nur diese Anzeige).
- Szenario: Bei mehreren Praxen mit parallel laufenden 90-Tage-Uhren ist die erste Rechnung (1.900 €) davon abhängig, dass Karam täglich die Garantie-Seite ansieht. Das Ereignis löst zugleich den ersten bezahlten Monat aus; ein verspätetes Bestätigen verschiebt Rechnung und Verzugs-/Fristlogik. Am Fristtag 90 ist es für Karam wichtig, rechtzeitig zu sehen, dass eine Anfrage am letzten Tag kam.
- Fix-Vorschlag: In der Intake-Route (nach Insert, nur für Messweg-Quellen innerhalb des Fensters, das sich billig über `guarantee_clocks` prüfen lässt) eine Mail an Karam "Kandidat für erste qualifizierte Anfrage: Praxis X". Alternativ Admin-Startseite mit dieser Liste fest oben.

### C-7: "Beim ersten Start reinkommende" KI-Bewertung und Wiedervorlage-/SLA-Benachrichtigungen hängen komplett am Worker
- Schwere: P1
- Art: robustness
- Sicherheit: hoch
- Ort: `src/app/api/leads/intake/route.ts:300-311`, `src/server/leads.ts:213`, `src/worker/processors/ai-score.ts:53-110`, `src/worker/processors/sla-check.ts`, `src/lib/queues.ts:124-129`
- Beleg: `enqueueAiScore`, `enqueuePvsLeadTokenWrite` und `sla-check` laufen nur über pg-boss. Es gibt keinen Rückfüllschritt für unbewertete Anfragen (kein Treffer für `ai_score IS NULL` im Worker).
- Szenario (Worker auf 0): Anfragen erscheinen ohne Bewertung, die Sortierung "Höchste KI-Bewertung" zeigt sie alle gleich (`nulls last`), der Filter "Sehr heiß/Warm/Kalt" ist leer (`aiCategoryCounts` liefert `{}`), die Anrufliste ordnet nur nach Alter (siehe C-17). Ohne Worker gibt es keine SLA-Glocke und keinen EINS-Lead-Token. Die Anfrage selbst bleibt korrekt sichtbar: Name, Kontakt, Status, Frist. Das ist akzeptabel für den Start, aber die Seite sagt nicht, warum die Bewertung fehlt. Wenn der Worker später startet, werden Jobs aus der Zeit davor nur bis zum pg-boss-Aufbewahrungslimit (Sicherheit niedrig, Standard bei v10 etwa 14 Tage für wartende Jobs) abgearbeitet; ältere bleiben unbewertet.
- Fix-Vorschlag: UI: Filter-Chip und Spalte "Bewertung" nur zeigen, wenn mindestens eine Anfrage bewertet ist. Worker: beim Start einmaliger Scan `ai_score IS NULL AND created_at > now() - 30 days` und Nachfüllen.

### C-8: KI-Bewertung entscheidet nicht über das Zählen einer Anfrage (bestätigt), aber die Meta-Anfragen werden nie bewertet
- Schwere: P2
- Art: bug
- Sicherheit: hoch
- Ort: `src/app/api/webhooks/meta/leadgen/route.ts:198-224`, `src/server/leads.ts:132-216`, `src/lib/guarantee-clock.ts:313-331`
- Beleg: Die Garantie-Logik (`eligibleInquiries`, `classifyAttribution`, `checkConfirmable`) verwendet `aiScore`/`aiCategory` nirgends (Suche in `lib/guarantee-clock.ts`, `server/guarantee-clock.ts`, `admin/garantie`: kein Treffer). Das entspricht KANON. Aber: `enqueueAiScore` wird nur in der Intake-Route aufgerufen, nicht in `persistLead` oder dem Meta-Webhook. Meta-Anfragen bleiben dauerhaft ohne Score und Kategorie, auch mit laufendem Worker.
- Szenario: Sobald Meta-Sofortformulare laufen, stehen diese Anfragen unbewertet in der Liste und in der Anrufliste hinter bewerteten.
- Fix-Vorschlag: `enqueueAiScore(result.id)` in `persistLead` nach dem Insert verschieben (innerhalb von `status === "inserted"`).

### C-9: Meta-Webhook bestätigt mit 200, auch wenn die Anfrage nicht gespeichert wurde (Meta wiederholt nie)
- Schwere: P1
- Art: robustness
- Sicherheit: hoch
- Ort: `src/app/api/webhooks/meta/leadgen/route.ts:139-161, 185-192, 244-266`
- Beleg: Fehler pro Eintrag werden gefangen (`status: "error"`), Rate-Limit gibt `"rate_limited"`, ein Graph-Fehler 400/404 gibt `null` (`missing_lead`); die Antwort ist in allen Fällen 200. Der Kommentar begründet das mit Duplikaten, die es durch den Unique-Index `(clinic_id, meta_lead_id)` aber nicht gäbe.
- Szenario: Die häufigste echte Störung ist ein abgelaufenes oder widerrufenes Seiten-Token. Die Graph-API antwortet dann mit HTTP 400 (Fehlercode 190), das Portal behandelt es als "Lead abgelaufen, Bestätigen" und wirft die Anfrage still weg. Gleiches bei kurzer DB-Störung oder 5xx der Graph-API. Meta hält die Anfrage nur ~90 Tage vor, niemand weiß, dass sie fehlt.
- Fix-Vorschlag: Bei `error`, `rate_limited` und Graph-5xx/Token-Fehlern (Code 190, 4xx außer "nicht gefunden") HTTP 500 zurückgeben, damit Meta wiederholt (idempotent). Token-Fehler zusätzlich als Benachrichtigung für Karam und die Praxis markieren (`refresh-oauth` hat die Struktur dafür).

### C-10: Rate-Limit pro Praxis (60 pro 10 Minuten) blockiert echte Anfragen bei Spam, ohne Wiederholen
- Schwere: P2
- Art: robustness
- Sicherheit: mittel
- Ort: `src/app/api/leads/intake/route.ts:169-204`, `apps/clinic-landing/app/api/lead/route.ts:121-154`
- Beleg: Die Spam-Bremse der Zielseite (`ipBuckets`, `SEEN_KEYS`) ist pro Lambda-Instanz und laut eigenem Kommentar wirkungslos bei Streuung. Der einzige verlässliche Schutz ist das Portal-Limit pro Praxis. Wird es überschritten, antwortet das Portal 429, die Zielseite loggt und bestätigt dem Patienten. Das IP-Limit im Portal (600 pro 10 Minuten) zählt außerdem die Vercel-Ausgangs-IP der Zielseite, also alle Patienten aller Praxen zusammen.
- Szenario: Ein Bot (oder ein erfolgreicher Werbetag) schickt 60 Einträge, danach sind 10 Minuten lang alle echten Anfragen verloren (siehe C-1: kein Wiederholen).
- Fix-Vorschlag: Mit C-1 Ausgangskorb lösen; zusätzlich Honeypot-Treffer und doppelte Absender vor das Limit stellen und das Praxis-Limit pro Quelle (IP aus `clientIpAnon`) statt global führen.

### C-11: DSGVO-Nachweis-IP ist die IP der Zielseiten-Lambda, nicht die des Patienten; ungültige IP-Zeichenkette lässt die Anfrage mit 500 scheitern
- Schwere: P2
- Art: data-correctness
- Sicherheit: mittel
- Ort: `src/app/api/leads/intake/route.ts:206-209, 274`, `src/server/leads.ts:167`, `src/db/schema.ts:672`, `src/app/(portal)/anfragen/[id]/page.tsx:599-602`
- Beleg: `dsgvoConsentIp` kommt aus `x-forwarded-for` der Anfrage an das Portal. Diese Anfrage stellt die Zielseite serverseitig (`fetch` in `portal-intake.ts`), also steht dort die Ausgangs-IP von Vercel. Die Patienten-IP wird nur anonymisiert als `clickIpAnon` mitgegeben. Die Spalte ist vom Typ `inet`; ein XFF-Wert mit Port (`1.2.3.4:5678`), `unknown` oder Klammern lässt das Insert mit Fehler abbrechen (500, Lead weg, siehe C-1).
- Szenario: Der "DSGVO IP"-Eintrag im Cockpit ist als Nachweis wertlos und für alle Anfragen gleich. Ein Proxy-Header mit Port verursacht Verlust einzelner Anfragen.
- Fix-Vorschlag: Zielseite sendet die echte Client-IP als eigenes Feld (nicht im XFF), Portal validiert per `net.isIP` und setzt sonst `null`. Das Feld wird dann auch nur noch bei Bedarf angezeigt (siehe C-26).

### C-12: Meta-Sofortformulare zählen nicht als EINS-Messweg (korrekt), aber jede signierte Quelle "formular" zählt, auch fremde Formulare
- Schwere: P2
- Art: data-correctness
- Sicherheit: mittel
- Ort: `src/lib/sources.ts:121-124, 237-242`, `src/app/api/leads/intake/route.ts:69-75, 281-284`, `src/app/(portal)/einstellungen/page.tsx:575-585`
- Beleg: `meta`/`meta_lead_form` und `google*` ergeben `messweg: null, plattform_formular`. Richtig und KANON-konform. `ENTRY_FORMULAR` enthält aber `formular, intake, landing, landing_form, zielseite`; die Intake-Route nimmt jede Quelle aus der Aufzählung `REQUEST_SOURCES` von jedem Hersteller des HMAC-Geheimnisses an, und das Geheimnis wird der Praxis in den Einstellungen offen gezeigt. Eine Praxis (oder ein Dienstleister) kann damit das eigene Website-Formular, n8n oder WhatsApp-Zapier mit `source: "formular"` anbinden. Die Anfrage zählt dann als EINS-Messweg, obwohl sie nicht über eine EINS-Zielseite kam.
- Szenario: Falsch ausgelöste erste Rechnung oder strittige Rechnung ("Anfrage kam nicht über Ihre Zielseite"). Die Anfragen ohne `quiz` und ohne `sourceUrl` sind zumindest erkennbar.
- Fix-Vorschlag: Für `source: "formular"` im Portal `quiz` und `sourceUrl` mit dem Host der Zielseite verlangen oder ein getrenntes Geheimnis nur für EINS-Zielseiten führen. Zusätzlich im Admin-Kandidaten die `sourceUrl` anzeigen.

### C-13: Garantie-Uhr: Rechenregeln stimmen mit KANON überein; offene Randpunkte
- Schwere: P3
- Art: data-correctness
- Sicherheit: hoch
- Ort: `src/lib/guarantee-clock.ts:154-173, 266-289, 313-331`, `src/lib/guarantee-clock.ts:53-63`
- Beleg: Geprüft und in Ordnung: Fristende = Unterschrift + 90 Tage (Tag 0 zählt nicht), Anfrage am Tag 90 zählt (`day > deadline` wird abgelehnt, `==` nicht), Verzug nur mit `notifiedOn`, Berliner Datum über `Intl` mit `en-CA` (kein UTC-Fehler um Mitternacht), Scan-Fenster mit einem Tag Spielraum, Messweg nur aus `source` (Selbstauskunft und UTM entscheiden nie), `meta`-Sofortformulare ausgeschlossen. Offen: (1) eine Anfrage am Unterschriftstag selbst zählt (`day < from` verwirft nur davor), KANON lässt das offen; Testeinsendungen am Unterschriftstag werden Kandidaten. (2) Die "dieselbe Person binnen 30 Tagen"-Regel hat keine Datenbasis (kein normalisierter Telefon/E-Mail-Schlüssel), Karam muss Dubletten von Hand erkennen. (3) Es gibt keine Möglichkeit, interne Testanfragen von Karam zu markieren.
- Szenario: Karam testet nach Vertragsschluss am selben Tag die Zielseite, die Testanfrage ist Kandidat Nr. 1.
- Fix-Vorschlag: Im Kandidaten-Dialog Hinweise anzeigen: gleiche E-Mail/Telefon wie eine frühere Anfrage; Anfragen vom Unterschriftstag kennzeichnen.

### C-14: Zwei widersprüchliche "Überfällig"-Anzeigen: 2-Stunden-SLA in Rot neben der 48-Werkstunden-Frist
- Schwere: P1
- Art: ux-flow
- Sicherheit: hoch
- Ort: `src/app/(portal)/anfragen/page.tsx:214-217, 319-327`, `src/app/(portal)/anfragen/[id]/page.tsx:171-174, 248-253`, `src/lib/constants.ts:138`, `src/server/queries/requests.ts:57-72`
- Beleg: `slaRespondBy = now + 2 h` (`server/leads.ts:143`), unabhängig von Werkstunden und Wochenende. Liste und Detail zeigen daraus rot "Überfällig" bzw. "Frist: ... (überschritten)". Daneben steht auf der Detailseite zusätzlich die 48-Werkstunden-Frist. Der Kommentar im Code spricht von "3-hour SLA", die Konstante ist 2.
- Szenario: Eine Anfrage am Samstag 22:00 ist ab 00:00 "Überfällig" in Rot, in der Dashboard-Kachel und in `Dringlichkeit`-Sortierung. Montag früh steht für die Inhaberin jede Wochenendanfrage rot "überschritten", obwohl der Vertrag 48 Werkstunden (Fristende erst Montag eine Woche später) vorsieht. Die Praxis kann nicht unterscheiden, was vertragsrelevant ist, und fühlt sich vor dem Start der Zusammenarbeit überführt.
- Fix-Vorschlag: Rote Markierung nur an die 48-Werkstunden-Regel koppeln (vor Fristende z. B. gelb "Noch X Werkstunden"), die 2-h-SLA entweder nur intern (Anrufliste-Reihenfolge) verwenden oder auf Werkstunden umstellen (`addWorkingHours(createdAt, 2)` in `persistLead`).

### C-15: Die Praxis wird vor Ablauf der 48 Werkstunden nicht gewarnt
- Schwere: P1
- Art: missing-feature
- Sicherheit: hoch
- Ort: `src/lib/response-time.ts:88-92`, `src/app/(portal)/anfragen/_components/ResponseFlagBadge.tsx:16-27`, `src/lib/response-time.ts:295-324`
- Beleg: `ResponseFlagBadge` zeigt erst nach Fristende "nicht beantwortet" oder "zu spät". Vorher gibt es keine Restzeit in der Liste. Die Warn-E-Mail für Folge 3 wird von Karam von Hand kopiert (`warningEmailText`, "Karam copies and sends it himself"). Ein automatischer Hinweis vor Fristende existiert nicht.
- Szenario: Die Folge 1 (Einwand ausgeschlossen) tritt für die Praxis ohne jede Vorwarnung ein, mit Worker auf 0 sowieso (kein Scan). Das ist vertraglich zulässig, aber die Praxis erfährt die Konsequenz erst, wenn Karam sie später anmahnt.
- Fix-Vorschlag: Restzeit in der Liste ("noch 11 Werkstunden", ab unter 12 gelb) und eine E-Mail an Inhaber/Frontdesk ungefähr 12 Werkstunden vor Fristende (Aufruf aus einem Cron, der auch ohne pg-boss funktionieren kann, z. B. Vercel Cron).

### C-16: Wiedervorlage wird in falscher Zeitzone gespeichert (Eingabe Berlin, Interpretation UTC)
- Schwere: P1
- Art: bug
- Sicherheit: hoch
- Ort: `src/app/(portal)/anfragen/[id]/_lead-cockpit.tsx:178-181, 456-459`, `src/app/(portal)/anfragen/[id]/actions.ts:69, 316`
- Beleg: Das `datetime-local`-Feld liefert `"2026-10-08T14:00"` ohne Zone; die Server-Action macht `z.coerce.date()`. Auf Vercel (UTC) wird das als 14:00 UTC, also 16:00 (Sommerzeit) in Berlin gespeichert.
- Szenario: Die MFA plant einen Rückruf "morgen 14:00". Die Wiedervorlage wird erst um 16:00 fällig und erscheint zwei Stunden zu spät in der Anrufliste (`dueFollowups`, `due_at <= now()`). Im Verlauf steht serverseitig formatiert "14:00" (UTC-Format, siehe C-19), in der Wiedervorlagen-Karte (Client-Komponente) im Browser 16:00. Zeiten widersprechen sich.
- Fix-Vorschlag: In `actions.ts` den String als Berliner Wandzeit parsen (`instantFromBerlinWall` aus `lib/werkstunden.ts` existiert bereits) statt `z.coerce.date()`.

### C-17: Anrufliste lässt schwach bewertete Anfragen verhungern
- Schwere: P2
- Art: ux-flow
- Sicherheit: mittel
- Ort: `src/server/queries/requests.ts:394-405, 408-412`
- Beleg: Reihenfolge: fällige Wiedervorlage, 2-h-SLA-überfällig, dann Kategorie hot, warm, cold/unbekannt, dann "neu" vor angefasst, dann Alter, `limit 6`. Nach 2 Stunden sind alle unbearbeiteten Anfragen "überfällig", es entscheidet die Kategorie. Neue heiße Anfragen schieben ältere kalte immer wieder nach hinten.
- Szenario: Eine kalte Anfrage ("Info only") rutscht nie in die Top 6, die 48 Werkstunden laufen ab, die Praxis verliert bei dieser Anfrage den Einwand und sie erscheint als "von der Praxis nicht beantwortet". Zusätzlich steht die Anrufliste nur Rolle `frontdesk` zur Verfügung (siehe C-20).
- Fix-Vorschlag: Primär nach 48-Werkstunden-Frist (nächste Frist zuerst) sortieren, KI-Kategorie nur als Tiebreaker.

### C-18: Datum und Uhrzeit werden in UTC statt Berlin angezeigt
- Schwere: P1
- Art: data-correctness
- Sicherheit: hoch
- Ort: `src/lib/formatting.ts:41-53, 122-127`, `src/app/(portal)/anfragen/[id]/page.tsx:247-256, 486, 597`, `src/app/(portal)/anfragen/[id]/_followups.tsx` (Client-Komponente)
- Beleg: `Intl.DateTimeFormat("de-DE", {...})` ohne `timeZone`. Serverseitiges Rendering auf Vercel läuft in UTC. Die 48-Werkstunden-Zeile auf derselben Seite benutzt dagegen `formatBerlinDateTime` (Berlin).
- Szenario: Eine Anfrage um 23:30 Berliner Zeit steht als "Eingegangen: 21:30" im Cockpit, die Fristzeile direkt darunter korrekt in Berlin. Verlauf-Einträge, Erstkontakt, Wiedervorlagen sind 1 bis 2 Stunden falsch. In Client-Komponenten (`_followups.tsx`) rendert die erste Server-Ausgabe UTC, danach schaltet der Browser auf lokale Zeit, es gibt Hydration-Warnungen. Eine Anfrage nach Mitternacht erscheint am falschen Tag. Zusätzlich im Streitfall (Garantie-Nachweis "im Portal gespeicherter Zeitpunkt") mit sichtbar falschen Zeiten.
- Fix-Vorschlag: `timeZone: "Europe/Berlin"` in `dateFormatter`, `dateTimeFormatter` und in `formatRelative` für den Datums-Fallback setzen.

### C-19: Ausgetauschte Wiedervorlage-Notiz wird mit UTC-Zeit fest in den Verlauf geschrieben
- Schwere: P2
- Art: data-correctness
- Sicherheit: hoch
- Ort: `src/app/(portal)/anfragen/[id]/actions.ts:157-164, 346-353`
- Beleg: `body: "Wiedervorlage für ${formatDateTime(input.followupAt)}"`, serverseitig in UTC formatiert, dauerhaft gespeichert.
- Szenario: Der gespeicherte Text bleibt für immer um 1-2 Stunden daneben; auch nach Behebung von C-18 für alte Einträge.
- Fix-Vorschlag: Gemeinsam mit C-16/C-18 beheben; alternativ nur den Verweis speichern und das Datum aus `request_followups` rendern.

### C-20: Fällige Wiedervorlagen sehen nur Frontdesk-Nutzer; Inhaberin sieht sie nirgends
- Schwere: P1
- Art: missing-feature
- Sicherheit: hoch
- Ort: `src/app/(portal)/anfragen/page.tsx:144-153, 170-176`, `src/server/queries/followups.ts:84-110`
- Beleg: `showCallQueue` verlangt `session.role === "frontdesk"`; nur dort wird `dueFollowups` geladen. Es gibt keine Verwendung außerhalb dieser Seite (Suche nach `dueFollowups`).
- Szenario: In den meisten kleinen Praxen ruft die Inhaberin selbst an und hat keinen Frontdesk-Nutzer angelegt. Ihre geplanten Rückrufe tauchen nie auf, es gibt weder Dashboard-Hinweis noch Mail. Wiedervorlagen sind für sie wirkungslos.
- Fix-Vorschlag: Anrufliste und fällige Wiedervorlagen für alle Rollen mit `requests.update` zeigen; "Fällig"-Zähler zusätzlich in Dashboard und Seitenleiste.

### C-21: Pagination verwirft alle Filter, Suche und Sortierung
- Schwere: P1
- Art: bug
- Sicherheit: hoch
- Ort: `src/app/(portal)/anfragen/page.tsx:345-354`
- Beleg: `href={\`/anfragen?page=${page - 1}\`}` und `?page=${page + 1}` ohne die übrigen Parameter.
- Szenario: Die Praxis filtert auf "Neu" (oder sucht "Müller"), klickt "Weiter", und sieht plötzlich alle Anfragen aller Status ungefiltert ab Seite 2. Wer nach "Neu" filtert, um offene Anfragen abzuarbeiten, landet in der falschen Menge.
- Fix-Vorschlag: Link aus den aktuellen `searchParams` bauen (`new URLSearchParams(params)`, nur `page` überschreiben).

### C-22: Ungültiger `page`-Parameter und freie Filterwerte führen zur Fehlerseite
- Schwere: P3
- Art: robustness
- Sicherheit: hoch
- Ort: `src/app/(portal)/anfragen/page.tsx:129-133`
- Beleg: `Math.max(1, Number(params.page ?? 1))` ergibt bei `?page=abc` `NaN`, `offset` wird `NaN`. `treatment` wird nicht als UUID geprüft, `status`/`aiCategory`/`source` nur per Typ-Cast; der Datenbank-Check `requests_status_check` oder `uuid`-Cast wirft.
- Szenario: Ein zerstörter oder von Hand editierter Lesezeichen-Link zeigt "Die Anfragen konnten nicht geladen werden". (`/api/requests` validiert dagegen korrekt.)
- Fix-Vorschlag: Parameter wie in `api/requests/route.ts` mit `splitCsv`/Zod validieren und `page` mit `Number.isFinite` und `Math.floor` absichern.

### C-23: Suche: Platzhalter nicht escaped, Telefonnummern nicht vergleichbar
- Schwere: P2
- Art: data-correctness
- Sicherheit: hoch
- Ort: `src/server/queries/requests.ts:130-141`
- Beleg: `ilike(..., "%" + search + "%")` ohne Escape von `%` und `_`; Telefon wird im Rohformat gesucht.
- Szenario: Suche nach `+49 170 123` findet keine Anfrage, die als `0170 123...` oder `0049170...` gespeichert ist; eine Telefonnummer, die am Empfang diktiert wird ("0170 1234567"), trifft nur bei identischer Schreibweise. Ein `_` in der Suche trifft jedes Zeichen. Zusätzlich liegen Suchbegriffe (Namen, Nummern) in der URL (`?search=`, `/api/search/leads?q=`) und damit in Server-Logs.
- Fix-Vorschlag: Escape von `\`, `%`, `_`. Telefonsuche über normalisierte Ziffern (`regexp_replace(contact_phone,'\D','','g')`). Suchbegriff bei der Befehlsleiste per POST oder zumindest nicht in der Seiten-URL.

### C-24: Statuswechsel ohne Zeilensperre, parallele Änderungen überschreiben sich
- Schwere: P2
- Art: robustness
- Sicherheit: mittel
- Ort: `src/app/(portal)/anfragen/[id]/actions.ts:83-145, 244-292`
- Beleg: Lesen des alten Status und Schreiben in einer Transaktion, aber ohne `FOR UPDATE` und ohne `WHERE status = alter Status`. Zwei Nutzer, die gleichzeitig "Kontaktiert" und "Spam" setzen, schreiben beide von `neu` aus; beide `status_change`-Aktivitäten stehen im Verlauf, der letzte gewinnt. Die Seite zeigt nach Mutation `revalidatePath`, aber ein zweiter geöffneter Tab bleibt auf dem alten Status stehen und bietet ungültige Übergänge an.
- Szenario: Zwei MFAs rufen dieselbe Anfrage an, eine markiert "Termin vereinbart", die andere (vom alten Stand) "Nicht erreicht" und überschreibt den Termin. Der Erstkontakt-Zeitpunkt bleibt richtig, der Status nicht.
- Fix-Vorschlag: `select ... for update` im Cockpit-Pfad oder `UPDATE ... WHERE status = $erwartet` mit Rückmeldung "wurde zwischenzeitlich geändert".

### C-25: Server-Action-Fehlermeldungen erscheinen in Produktion als generischer englischer Text
- Schwere: P2
- Art: ux-flow
- Sicherheit: hoch
- Ort: `src/app/(portal)/anfragen/[id]/_lead-cockpit.tsx:88-98`, `src/app/(portal)/anfragen/_components/CallOutcomeActions.tsx:75-80`, `src/app/(portal)/anfragen/[id]/actions.ts:98, 117-120, 262-266`, `src/app/(portal)/anfragen/[id]/_followups.tsx:90-96`
- Beleg: Die Actions werfen `new Error("Statuswechsel neu → x nicht erlaubt.")` und `"Anfrage nicht gefunden."`; im Browser kommt in Produktion nur "An error occurred in the Server Components render. The specific message is omitted in production builds" an, und dieser Text wird als `error.message` angezeigt. Die Fehler beim Erledigen/Abbrechen einer Wiedervorlage werden still verschluckt (`catch {}`).
- Szenario: Veralteter Tab (siehe C-24) oder PVS-gesperrter Status: die MFA sieht eine englische Technikmeldung oder gar nichts, weiß nicht, ob der Anruf gespeichert wurde, und klickt erneut (doppelte Anruf-Einträge).
- Fix-Vorschlag: Actions geben ein Ergebnisobjekt `{ ok: false, message }` zurück statt zu werfen; Client zeigt die deutsche Meldung.

### C-26: Die Antworten des Patienten (Zeitrahmen, Ort, Entfernung, Vorerfahrung, Branch) sind in der Anfrage nicht sichtbar
- Schwere: P1
- Art: missing-feature
- Sicherheit: hoch
- Ort: `src/app/(portal)/anfragen/[id]/page.tsx:376-391`, `src/server/leads.ts:145`, `apps/clinic-landing/lib/portal-intake.ts:150-169`
- Beleg: Zeitrahmen (`asap` ... `info-only`), Stadt, Entfernung und Vorerfahrung stehen nur in `ai_signals.quiz`. Die Detailseite überspringt verschachtelte Objekte ausdrücklich ("Skip nested objects ... quiz", Zeile 382-386) und zeigt nur `message`, `treatmentWish` und `budgetIndication` (im eingeklappten Block "Technische Details"). Die Zielseite sendet seit Quiz v2 keine Notizen mehr (`aiProcessing` immer false), `message` ist also meist leer.
- Szenario: Die MFA ruft "Maria M." an und sieht weder "möchte sofort", noch die Stadt, noch ob sie nur informieren möchte. Der wichtigste Gesprächseinstieg liegt nur im JSON der "Rohdaten".
- Fix-Vorschlag: In der Kontaktzeile bzw. im Kopf der Detailseite und auf der Anrufkarte aus `aiSignals.quiz` anzeigen: Zeitrahmen, Stadt/Entfernung, Budget-Antwort, "Nur Information" (`branch`).

### C-27: Patientendaten und Auditspur sind für alle Rollen sichtbar, `audit.view` wird umgangen
- Schwere: P2
- Art: security
- Sicherheit: mittel
- Ort: `src/app/(portal)/anfragen/[id]/page.tsx:115-131, 596-602, 621-661`, `src/lib/roles.ts:30-33`
- Beleg: Der Audit-Trail (Aktion, Nutzer-E-Mail, Diff) und die Rohdaten (komplettes Formular inkl. `fbp`, `fbc`, User-Agent) werden jeder Rolle angezeigt; `audit.view` ist laut Rollenmatrix nur `inhaber`. Die Abfrage läuft über `db` (ohne RLS) und filtert nur auf `entity_id`; durch die vorherige RLS-Prüfung der Anfrage ist das mandantensicher, es umgeht aber die Rollenprüfung. "DSGVO IP" zeigt eine vollständige IP-Adresse der Patientin allen Rollen.
- Szenario: Eine externe Marketing-Rolle sieht damit Mitarbeiter-E-Mails, Karams Admin-Zugriffe (View-Audit) und technische Patientenkennungen.
- Fix-Vorschlag: Audit-Trail und Rohdaten hinter `can(role, "audit.view")`; IP nicht anzeigen oder auf anonymisierte Form kürzen.

### C-28: `treatment_id` und `patient_id` werden bei neuen Anfragen nie gesetzt
- Schwere: P2
- Art: data-correctness
- Sicherheit: mittel
- Ort: `src/server/leads.ts:149-183`, `src/app/(portal)/anfragen/page.tsx:155-169`, `src/server/queries/requests.ts:121-123`
- Beleg: Der Insert setzt weder `treatmentId` noch `patientId` (Suche nach Schreibzugriffen auf `requests.treatmentId`: keine in App-Code, nur `patientId` im PVS-Worker). Der Filter "Behandlung" in der Liste filtert nach `treatment_id`.
- Szenario: Für Formular-Anfragen trifft der Behandlungs-Filter nie, die Behandlungsliste der Prognose (`forecast`) schließt Anfragen ohne `treatment_id` aus. "Andere Anfragen dieses Patienten" bleibt leer, solange die PVS-Bridge nicht verknüpft; Dubletten (C-13) werden nicht gezeigt.
- Fix-Vorschlag: Beim Insert `treatmentSlug`/`treatmentSelection` gegen `treatments` der Praxis abgleichen; Dubletten-Hinweis über gleiche E-Mail oder normalisierte Telefonnummer in den letzten 30 Tagen.

### C-29: Fehlende Praxis-Funktionen im ersten Monat
- Schwere: P1
- Art: missing-feature
- Sicherheit: hoch
- Ort: `src/app/(portal)/anfragen/` (kein Treffer für manuelle Anlage, Zuweisung oder Export), `src/server/leads.ts` (nur zwei Aufrufer von `persistLead`)
- Beleg (geprüft, wirklich nicht vorhanden): (1) Keine Möglichkeit, eine Anfrage von Hand anzulegen (Telefon, Instagram-DM, Empfang); `persistLead` hat nur zwei Aufrufer, Intake und Meta-Webhook. (2) `assigned_to` existiert in Schema und API-Filter, aber keine Oberfläche zum Zuweisen. (3) Kein Export (CSV) der Anfragen. (4) Kein Verlaufseintrag "E-Mail gesendet"/"WhatsApp" (die Art `email`/`whatsapp` hat laut `queries/response-time.ts` keinen Schreiber), E-Mail-Kontakt zählt nur über den Status. (5) Kein Hinweis in der Liste, ob die Zielseite angebunden ist: eine neue Praxis sieht nur "Sobald neue Anfragen eingehen, erscheinen sie hier" (`anfragen/page.tsx:195-198`), ob die Anbindung tot ist, weiß niemand (siehe C-1). (6) Der Statusfilter hat keinen Eintrag für Spam, `no_show`, `behandelt` (`AnfragenFilters.tsx` `STATUSES`), Spam-markierte Anfragen lassen sich nicht gezielt wiederfinden; `spam` ist nur aus `neu` erreichbar, eine nach Erstgespräch als Spam erkannte Anfrage kann nicht mehr als Spam markiert werden (`lib/constants.ts:35-44`).
- Szenario: Die Praxis verliert Anfragen, die nicht über die Zielseite kommen, im Alltag; Spam lässt sich nicht aufräumen.
- Fix-Vorschlag: Priorität: manuelle Anfrage (Quelle `manuell`, zählt nie als Messweg), Zuweisung, CSV-Export, Statusfilter vollständig, Anbindungs-Status "Letzte Anfrage vor X Tagen" in Anfragen-Leerzustand.

### C-30: "Anruf festhalten"-Knöpfe sind ohne Rückfrage und Rückgängig als Kontaktversuch wirksam
- Schwere: P2
- Art: ux-flow
- Sicherheit: mittel
- Ort: `src/app/(portal)/anfragen/_components/CallOutcomeActions.tsx:64-85`, `src/server/queries/response-time.ts:381-397`
- Beleg: Ein Klick auf "Nicht erreicht" oder "Termin vereinbart" ruft `logCall` sofort auf und schreibt `call`-Eintrag plus Status. Jeder Eintrag zählt als Kontaktversuch (Vertrag: jedes Ergebnis zählt). Rückgängig gibt es nicht, der Status "neu" lässt sich per Rücksprung zwar setzen, der Anrufeintrag bleibt aber und beendet die Frist.
- Szenario: Fehlklick auf dem Handy: der Lead fällt aus der Anrufliste und gilt als rechtzeitig kontaktiert, obwohl niemand angerufen hat. Das ist ein stiller Fehler in beide Richtungen (Praxis verliert Frist-Schutz in der Anrufliste, Nachweis im Streitfall wird dünn).
- Fix-Vorschlag: Zweistufige Bestätigung oder "Rückgängig" für 10 Sekunden; gelöschte Einträge nur als Gegen-Aktivität.

### C-31: Dashboard-Tageszahlen nach UTC-Tag gruppiert
- Schwere: P2
- Art: data-correctness
- Sicherheit: hoch
- Ort: `src/server/queries/requests.ts:511, 521, 799, 810, 926, 937, 1009-1010`
- Beleg: `to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD')` und `generate_series` über UTC-Tage.
- Szenario: Anfragen zwischen 00:00 und 02:00 Berliner Zeit zählen für den Vortag. "Anfragen heute" und die Tagessäulen weichen in den Nachtstunden von der Wahrnehmung der Praxis ab.
- Fix-Vorschlag: `AT TIME ZONE 'Europe/Berlin'` verwenden.

### C-32: Sprachregeln und kleine Anzeigefehler
- Schwere: P3
- Art: copy
- Sicherheit: hoch
- Ort: `src/app/(portal)/anfragen/page.tsx:76, 203`, `src/app/(portal)/anfragen/[id]/page.tsx:357, 368, 479, 532, 604`, `src/app/(portal)/anfragen/_components/CallQueue.tsx:115`, `src/worker/processors/ai-score.ts:107`, `src/worker/processors/score-rules.ts:222-229`
- Beleg: "Anfragen behandeln, anrufen und closen." (Anglizismus); `uppercase tracking-wide` an Tabellenköpfen und Etiketten (Versalien-Regel); "AI-Prompt", "Audit-Trail", "Rohdaten" im Cockpit; Frist-Zeile "Frist:" für die interne 2-Stunden-Zielgröße; die KI-Begründung wird mit englischen Rohbegriffen ausgegeben ("asap", "info-only", "hot", `= 74 (hot)`), in `aiReasoning` fest gespeichert. WhatsApp-Link: `waMeHref` (`CallQueue.tsx:369-377`) macht aus `+49 (0) 170 ...` die Nummer `490170...` und hängt bei österreichischen/Schweizer Nummern mit führender 0 fest die Vorwahl 49 an (DACH).
- Szenario: Falsche WhatsApp-Links für Praxen in AT/CH oder bei der üblichen Schreibweise "+49 (0)".
- Fix-Vorschlag: Texte angleichen; `waMeHref` die Klammer-Null entfernen (`replace(/\(0\)/,"")`) und das Land aus dem Praxis-Standort nehmen.

### C-33: SLA-Scan lädt alle bisherigen Benachrichtigungen aller Praxen und verfährt N+1
- Schwere: P3
- Art: performance
- Sicherheit: hoch
- Ort: `src/worker/processors/sla-check.ts:152-195`
- Beleg: `select link from notifications where kind='sla_breach'` ohne Praxis- oder Zeitfilter, danach pro verletzter Anfrage ein Nutzer-Select und ein Insert. Beim ersten Worker-Start nach längerer Pause erzeugt jede alte `neu`-Anfrage eine Benachrichtigung.
- Szenario: Skaliert schlecht mit Praxen und Zeit; nach dem ersten Start des Workers (aktuell auf 0) zeigt die Glocke eine Welle von "Reaktionszeit überschritten" für alle Anfragen, auch für Wochenenden (siehe C-14).
- Fix-Vorschlag: Bestehende Abfrage auf `link in (…)` der aktuellen Treffer begrenzen, `not exists`-Insert in einer Anweisung; Fenster auf z. B. 7 Tage begrenzen.

### C-34: Eine Inhaberin kann mit einem Klick die Zielseiten-Anbindung töten
- Schwere: P1
- Art: robustness
- Sicherheit: hoch
- Ort: `src/app/(portal)/einstellungen/page.tsx:595-610`, `src/app/(portal)/einstellungen/actions.ts:690-725`
- Beleg: Der Knopf "Geheimnis rotieren" ist ein einfaches Formular ohne Rückfrage für die Rolle `inhaber`; die neue Prüfsumme gilt sofort, das neue Geheimnis liegt aber in der Umgebung der Zielseite (Vercel), die nur Karam ändern kann. Bis dahin lehnt das Portal alle Anfragen mit 400 ab (`bad_signature`), ohne dass Zielseite oder Praxis es sehen (siehe C-1).
- Szenario: Neugierige Inhaberin klickt "rotieren". Alle Anfragen ab diesem Moment gehen verloren, Karam erfährt es nicht.
- Fix-Vorschlag: Aktion nur Admin; mindestens Bestätigungsdialog. Zusätzlich Alarm an Karam bei `lead_intake_reject` mit Grund `bad_signature` (z. B. ab 3 Einträgen in 10 Minuten).

### C-35: Intake-Quelle `formular` vs. Beschreibungstext, kleine Daten-/Robustheitspunkte
- Schwere: P3
- Art: robustness
- Sicherheit: niedrig
- Ort: `src/server/leads.ts:166`, `src/app/api/leads/intake/route.ts:146-155, 275`, `src/server/leads.ts:136-141`
- Beleg: (1) `dsgvoConsentAt: input.dsgvoConsent ? new Date() : new Date()` (beide Zweige gleich, bedeutungslos). (2) `persistLead` prüft nicht `archived_at` der Praxis, Anfragen an eine archivierte Praxis werden still angenommen. (3) Der Body wird vor Signaturprüfung vollständig gelesen und geparst (bis ~4,5 MB, ungeprüft). (4) `JSON.parse(raw)` wird zweimal ausgeführt.
- Szenario: Randfälle ohne akuten Schmerz.
- Fix-Vorschlag: Kleinigkeiten aufräumen; Größenlimit (z. B. 64 KB) vor Parsen.

---

## Design-Kritik (nur Kritik)

- Anfrage-Detailseite: Kopf, Kontaktzeile, Einwilligungszeile, Nachricht, Nachweis-Kacheln und Verlauf stehen in vielen kleinen Karten untereinander; die wichtigste Handlung (Anrufen, Ergebnis festhalten) liegt zweimal vor (Kontaktzeile "Anrufen" und Cockpit "Anruf protokollieren") und ist am Handy weit unten.
- Tabellen- und Etikettentexte in Versalien mit 12-Pixel-Schrift, grauer Ton (`fg-secondary`/`fg-tertiary`) auf hellem Grund; für Anwender zwischen 40 und 65 Jahren schwer lesbar.
- Die Bewertungsspalte zeigt dreimal dasselbe Funkeln-Symbol (Badge, Spalte, Kopf), ein bloßer Score "74" ohne Skala ist ohne Erklärung für die Praxis nicht aussagekräftig.
- Rote Markierungen ("Überfällig", "Von der Praxis nicht beantwortet") liegen neben normalen Zeitangaben ohne Erklärung, was daraus folgt.
- Die Wiedervorlagen-Karte erscheint erst nach der ersten Wiedervorlage, im Leerzustand gibt es keinen Hinweis, dass es sie gibt.

---

## Zusammenfassung

Anzahl: 35 Befunde. P0 = 2 (C-1, C-5), P1 = 14, P2 = 14, P3 = 5.

Die drei dringendsten Punkte:
1. C-1: Fehlt `PORTAL_URL` oder das Praxis-Geheimnis in der Zielseite oder ist das Portal nicht erreichbar, verschwindet jede Anfrage lautlos (Patient sieht Erfolg, niemand wird alarmiert, nichts wird wiederholt), und C-2 verwirft die Wiederholung des Patienten zusätzlich.
2. C-5: Es gibt weder E-Mail noch Glocke noch Push bei einer neuen Anfrage, die Praxis merkt sie nur beim Öffnen des Portals, und damit laufen die 48 Werkstunden ohne Vorwarnung ab (C-15).
3. C-18/C-16/C-14: Zeiten im Cockpit sind in UTC statt Berlin, Wiedervorlagen werden 1 bis 2 Stunden falsch gespeichert, und eine rote 2-Stunden-"Überfällig"-Anzeige widerspricht der vertraglichen 48-Werkstunden-Frist.
