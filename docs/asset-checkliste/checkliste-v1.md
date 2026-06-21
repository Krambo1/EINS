# Asset-Liefer-Checkliste v1 (Portal-Fassung)

Quelle: Notion "Asset-Liefer-Checkliste (Kunden-Onboarding)" (37be7fc8), Blöcke A-F.
Dieses Dokument ist der Vertrag für DB-Schema, Portal-Seite, Admin-Tab und PDF.

## Lieferweg-Typen

| Typ | Bedeutung | "geliefert" wird gesetzt durch |
|---|---|---|
| `einladung` | Zugang per Einladung/Partnerfreigabe an EINS, Schritt-für-Schritt-Anleitung | Selbst-Haken "Einladung verschickt" (oder "nicht vorhanden", wo erlaubt) |
| `upload` | Datei(en) direkt im Portal hochladen | Upload automatisch |
| `link` | Link zu großem Set (Drive, WeTransfer, Dropbox) eintragen | Link-Eintrag automatisch |
| `upload_oder_link` | Datei hochladen ODER Link eintragen | eines von beidem |
| `angabe` | Strukturierte Texteingabe im Portal | Speichern der Angabe |
| `status` | Reiner Bestätigungs-Haken (Termin, Zusage) | Selbst-Haken |

Zweistufig überall: Praxis-Aktion setzt **geliefert**, EINS bestätigt im Admin **geprüft**. Blocker-Punkte (Block A) zählen für den Leistungsstart erst geprüft.

**Platzhalter (von Karam zu liefern, vor Go-live ersetzen):**
- `{{EINS_META_BM_ID}}` — EINS Business-Manager-ID
- `{{EINS_ADS_EMAIL}}` — E-Mail für Google-Einladungen (z. B. ads@eins.ag)
- `{{EINS_UPLOAD_KONTAKT}}` — Rückfragen-Kontakt (z. B. Telefon/E-Mail Karam)

Rollen: `inhaber` = nur Inhaber kann abschließen; `team` = jede Portal-Rolle mit Schreibrecht darf liefern.

---

## Block A: Blocker. Ohne diese Punkte startet nichts (Tag 0 bis 3)

### A1 · Unterschriebener Auftragsverarbeitungsvertrag (AVV) — `upload` · Pflicht · Blocker · inhaber
**Anleitung:** Den AVV stellt EINS bereit: Sie finden ihn im Portal unter Dokumente, Kategorie "Auftragsverarbeitungsvertrag". Bitte ausdrucken oder digital signieren, von der vertretungsberechtigten Person unterschreiben lassen und die unterschriebene Fassung hier als PDF hochladen.
**Warum:** Ohne unterschriebenen AVV dürfen wir keine personenbezogenen Daten für Sie verarbeiten; die Leistungserbringung startet erst danach (Hauptvertrag § 3 Abs. 3).

### A2 · Ansprechpartner mit Entscheidungsbefugnis — `angabe` · Pflicht · Blocker · team
**Felder:** Name, Funktion, Handynummer, E-Mail, bevorzugter Kanal (Telefon / E-Mail / WhatsApp).
**Anleitung:** Nennen Sie die Person, die im Alltag Entscheidungen für die Zusammenarbeit treffen darf (Freigaben, Rückfragen). Das kann der Inhaber selbst sein oder eine bevollmächtigte Person.
**Warum:** Jede Rückfrage, die erst durch die Praxis wandern muss, kostet Kampagnen-Tage.

### A3 · Ärztliche Leitung als fachliche Ansprechperson — `angabe` · Pflicht · Blocker · team
**Felder:** Name, Titel, E-Mail, Telefonnummer (optional).
**Anleitung:** Die ärztliche Leitung gibt medizinische Aussagen in Anzeigen und auf Zielseiten frei (Heilmittelwerbegesetz). Bitte nennen Sie die zuständige Ärztin oder den zuständigen Arzt.
**Warum:** Werbliche Aussagen über Behandlungen dürfen nur mit fachlicher Freigabe live gehen.

### A4 · Termin für das Onboarding-Meeting bestätigt — `status` · Pflicht · Blocker · team
**Anleitung:** Das Onboarding-Meeting dauert etwa 90 Minuten und findet per Video oder vor Ort statt. Den Termin stimmen Sie direkt mit Ihrem EINS-Ansprechpartner ab. Haken Sie diesen Punkt ab, sobald der Termin in beiden Kalendern steht.

### A5 · Termin für den Produktionstag fixiert — `status` · Pflicht · Blocker · team
**Anleitung:** Der Produktionstag (Video und Fotos in Ihrer Praxis) dauert 4 bis 6 Stunden. Planen Sie einen Tag mit ruhigem Praxisbetrieb. Haken Sie ab, sobald der Termin fixiert ist.

---

## Block B: Zugänge zu Werbekonten und Plattformen

Grundsatz, steht über dem Block: **Alle Zugänge per Einladung oder Partnerfreigabe an EINS. Bitte niemals Passwörter per E-Mail oder Telefon weitergeben, wir fragen auch nie danach.**

### B1 · Meta Business Manager: Partnerzugriff — `einladung` · Pflicht · team · "nicht vorhanden" erlaubt
**Anleitung:**
1. Öffnen Sie business.facebook.com und melden Sie sich an.
2. Klicken Sie links unten auf das Zahnrad (Einstellungen), dann auf "Unternehmenseinstellungen".
3. Wählen Sie links "Nutzer", dann "Partner".
4. Klicken Sie auf "Hinzufügen" und wählen Sie "Einen Partner einladen, der deine Assets verwaltet" (Wortlaut kann je nach Meta-Version leicht abweichen).
5. Geben Sie die EINS Business-Manager-ID ein: **{{EINS_META_BM_ID}}**
6. Haken Sie hier "Einladung verschickt" ab.

Falls Ihre Praxis keinen Business Manager hat: Wählen Sie "Nicht vorhanden". Wir legen ihn im Onboarding-Meeting gemeinsam an, das dauert etwa 15 Minuten.

### B2 · Facebook-Seite und Instagram-Konto: Vollzugriff — `einladung` · Pflicht · team
**Anleitung:** Im selben Bereich ("Unternehmenseinstellungen" im Business Manager): Ordnen Sie EINS als Partner Ihre Facebook-Seite und Ihr Instagram-Konto mit voller Kontrolle bzw. Admin-Zugriff zu ("Konten" → "Seiten" / "Instagram-Konten" → Asset auswählen → "Partner zuweisen"). Falls Ihr Instagram-Konto noch nicht mit dem Business Manager verbunden ist, verbinden Sie es dort unter "Konten" → "Instagram-Konten" → "Hinzufügen".

### B3 · Meta-Werbekonto: Zugriff und Zahlungsmittel — `einladung` · Pflicht · team
**Anleitung:**
1. Weisen Sie EINS Ihr Werbekonto als Partner zu ("Konten" → "Werbekonten" → "Partner zuweisen", Zugriff "Werbekonto verwalten").
2. Hinterlegen Sie ein Zahlungsmittel der Praxis (Kreditkarte oder Lastschrift) unter "Abrechnung und Zahlungen". Das Werbebudget läuft direkt über die Praxis, nicht über EINS.
3. Haken Sie ab, wenn beides erledigt ist.

Falls kein Werbekonto existiert: "Nicht vorhanden" wählen, wir legen es gemeinsam an.

### B4 · Google Ads-Konto: Zugriff — `einladung` · Pflicht · team · "nicht vorhanden" erlaubt
**Anleitung:**
1. Öffnen Sie ads.google.com und melden Sie sich an.
2. Klicken Sie oben rechts auf "Verwaltung" (Werkzeug-Symbol), dann "Zugriff und Sicherheit".
3. Klicken Sie auf das Plus und laden Sie diese E-Mail-Adresse mit Zugriffsebene "Administrator" ein: **{{EINS_ADS_EMAIL}}**
4. Haken Sie "Einladung verschickt" ab.

Falls Ihre Praxis kein Google Ads-Konto hat: "Nicht vorhanden" wählen.

### B5 · Google Unternehmensprofil: Verwalterzugriff — `einladung` · Pflicht · team
**Anleitung:**
1. Öffnen Sie business.google.com und wählen Sie Ihr Praxis-Profil.
2. Gehen Sie zu "Einstellungen" → "Nutzer und Zugriffsrechte" (bzw. Menü → "Profilmanager").
3. Fügen Sie **{{EINS_ADS_EMAIL}}** als "Manager" hinzu.
**Warum:** Über das Unternehmensprofil laufen Ihr Bewertungssystem und lokale Anzeigen.

### B6 · Google Analytics / Tag Manager — `einladung` · Optional · team
**Anleitung:** Nur falls vorhanden: Laden Sie **{{EINS_ADS_EMAIL}}** in Google Analytics (Verwaltung → Zugriffsverwaltung des Kontos, Rolle "Administrator") und im Tag Manager (Verwaltung → Nutzerverwaltung, "Veröffentlichen") ein. Falls Sie nicht sicher sind, ob es ein Konto gibt: kurz im Feld vermerken, wir prüfen das gemeinsam.

---

## Block C: Zugänge zu Website und Praxis-Systemen

### C1 · Website: Zugang zum Redaktionssystem — `einladung` · Pflicht · team
**Felder zusätzlich:** Name der betreuenden Agentur / des Webmasters + Kontakt (falls extern betreut).
**Anleitung:** Legen Sie für EINS einen eigenen Benutzer in Ihrem Redaktionssystem an (bei WordPress: Dashboard → "Benutzer" → "Neu hinzufügen", Rolle "Administrator", E-Mail **{{EINS_ADS_EMAIL}}**). Bitte kein bestehendes Passwort weitergeben. Wird Ihre Website extern betreut, reicht der Kontakt zur Agentur, wir klären den Zugang direkt.

### C2 · Domain / DNS — `angabe` · Pflicht · team
**Felder:** Anbieter (z. B. IONOS, Strato), Kontakt der verwaltenden Person/Agentur.
**Anleitung:** Wir brauchen einmalig eine kleine technische Einstellung an Ihrer Domain (für Ihre Zielseiten und die Messung der Anfragen). Tragen Sie ein, wo die Domain liegt und wer sie verwaltet; die Umsetzung übernehmen wir gemeinsam mit dieser Person.

### C3 · Buchungssystem (z. B. Doctolib) — `angabe` · Optional · team
**Felder:** System, Buchungslink, Integration gewünscht (ja/nein).
**Anleitung:** Falls Patienten bei Ihnen online buchen können: Tragen Sie den Buchungslink ein. Wenn Anfragen direkt in Ihren Kalender laufen sollen, vermerken Sie "Integration gewünscht", den Rest klären wir im Onboarding-Meeting.

### C4 · CRM / Anfragen-Verwaltung — `angabe` · Optional · team
**Felder:** System (falls vorhanden), Kontakt.
**Anleitung:** Nur falls Ihre Praxis bereits ein System zur Verwaltung von Interessenten-Anfragen nutzt. Falls nicht: leer lassen, das EINS-Portal übernimmt das.

### C5 · Praxisverwaltungssystem (PVS) — `angabe` · Pflicht · team
**Felder:** Name (z. B. medatixx, Tomedo, CGM, Dampsoft), Version (falls bekannt), Ansprechperson für IT.
**Anleitung:** Nur Name und Version eintragen, sonst nichts. Den Lesezugang richten wir je nach System gemeinsam mit Ihrem PVS-Support ein; EINS leitet das an und meldet sich dazu bei Ihnen.
**Warum:** So sehen Sie später im Portal, welcher Umsatz aus den Anfragen wirklich entstanden ist.

### C6 · Portal-Zugänge für Ihr Team — `angabe` · Pflicht · team
**Felder:** Pro Person: Name, E-Mail, Rolle (Rezeption / Marketing / Ärztin/Arzt).
**Anleitung:** Wer in Ihrer Praxis soll das EINS-Portal nutzen können (Anfragen sehen, Auswertungen lesen)? Sie können Ihr Team auch direkt unter Einstellungen → Team einladen; dann hier nur abhaken.

---

## Block D: Marke und Bildmaterial

### D1 · Logo als Vektordatei — `upload` · Pflicht · team
**Anleitung:** Laden Sie Ihr Logo als SVG-, EPS- oder AI-Datei hoch. Falls Sie nur ein PNG haben: bitte in der höchsten verfügbaren Auflösung. Tipp: Die Vektordatei hat meist die Agentur, die Ihr Logo gestaltet hat; eine kurze E-Mail dorthin genügt in der Regel.
**Warum:** Aus dem Logo bauen wir Anzeigen, Zielseiten und Video-Einblendungen; eine Vektordatei bleibt in jeder Größe scharf.

### D2 · Farbwerte und Schriften (CI-Dokument) — `upload` · Optional · team
**Anleitung:** Falls es ein Dokument mit Ihren Praxis-Farben und Schriften gibt (Styleguide, CI-Mappe), laden Sie es hoch. Falls nicht: leer lassen, wir leiten die Werte aus Logo und Website ab.

### D3 · Vorhandene Fotos — `upload_oder_link` · Empfohlen · team
**Anleitung:** Praxis-Räume, Team, Ärztin/Arzt: auch ältere Aufnahmen helfen, wir entscheiden, was nutzbar ist. Einzelne Dateien können Sie direkt hochladen; bei größeren Sammlungen tragen Sie einfach einen Freigabe-Link ein (Google Drive, Dropbox oder WeTransfer: Dateien dort hochladen, Link mit Leserechten erstellen, hier einfügen).

### D4 · Vorhandene Videos — `link` · Optional · team
**Anleitung:** Videodateien sind für den direkten Upload meist zu groß. Laden Sie sie bei Google Drive, Dropbox oder WeTransfer hoch und tragen Sie hier den Freigabe-Link ein.

### D5 · Vorher-Nachher-Material — `upload_oder_link` · Optional · team
**Anleitung:** Nur Material, für das eine dokumentierte Einwilligung der Patientin oder des Patienten vorliegt. Die Einwilligungs-Vorlage stellt EINS (siehe Punkt F1). Ohne Einwilligung verwenden wir nichts, laden Sie es in dem Fall bitte auch nicht hoch.

### D6 · Zertifikate, Facharzt-Urkunden, Mitgliedschaften — `upload` · Empfohlen · team
**Anleitung:** Facharzt-Urkunden, Zertifikate, Mitgliedschaften (z. B. DGÄPC, DGBT) als Scan oder Foto hochladen.
**Warum:** Solche Nachweise machen Ihre Zielseiten glaubwürdig und heben Sie von Anbietern ohne Qualifikation ab.

---

## Block E: Praxis-Informationen

### E1 · Behandlungsliste mit Preisspannen — `upload_oder_link` + `angabe` · Pflicht · team
**Anleitung:** Mindestens für die 1 bis 2 Fokus-Behandlungen: Behandlung und Preisspanne (z. B. "Faltenunterspritzung 250 bis 450 €"). Eine bestehende Preisliste können Sie als PDF hochladen; alternativ tragen Sie die Spannen direkt ein.
**Warum:** Ohne Preisspannen können wir Anfragen nicht nach Wert vorsortieren.

### E2 · Standorte — `angabe` · Pflicht · team
**Felder:** Pro Standort: Adresse, Öffnungszeiten, Telefonnummer; dazu das Einzugsgebiet (Städte/Umkreis).
**Anleitung:** Tragen Sie alle Standorte ein, an denen behandelt wird. Das Einzugsgebiet bestimmt, wo Ihre Anzeigen ausgespielt werden.

### E3 · Team-Übersicht — `angabe` · Pflicht · team
**Felder:** Wer behandelt was; wer nimmt Anfragen entgegen (Name + Funktion).
**Anleitung:** Eine kurze Liste reicht. Wichtig ist vor allem: Wer ruft neue Interessenten zurück?

### E4 · Impressums- und Rechnungsdaten — `angabe` · Pflicht · team
**Felder:** Vollständiger Praxisname, Rechtsform, Berufsbezeichnung, zuständige Ärztekammer, Rechnungsanschrift.
**Anleitung:** Diese Angaben brauchen wir für das Impressum Ihrer Zielseiten und für die Abrechnung; bitte exakt wie im bestehenden Impressum Ihrer Website.

### E5 · Freie Beratungskapazität — `angabe` · Pflicht · team
**Felder:** Beratungstermine pro Woche für neue Patienten (Zahl oder Spanne).
**Anleitung:** Wie viele Erstberatungen pro Woche sind realistisch frei? Ehrliche Schätzung genügt; danach richten wir das Anzeigen-Tempo aus, damit keine Anfragen liegen bleiben.

### E6 · Nummer für die Anfragen-Übergabe — `angabe` · Pflicht · team
**Felder:** Telefonnummer und/oder WhatsApp-Nummer, erreichbare Zeiten.
**Anleitung:** Wohin sollen wir hochpreisige Anfragen durchstellen? Diese Nummer sollte werktags verlässlich besetzt sein.

---

## Block F: Rechtliches und Compliance

### F1 · Patienten-Einwilligungen (Foto/Video) — `upload` · Pflicht vor dem Produktionstag · team
**Anleitung:** Jede Person, die am Produktionstag oder in Bestandsmaterial zu sehen ist, braucht eine unterschriebene Einwilligung (Recht am eigenen Bild + Datenschutz). Die Vorlage stellt EINS im Dokumente-Tab bereit; die Praxis holt die Unterschriften ein und lädt die unterschriebenen Einwilligungen hier hoch (Hauptvertrag § 5 Abs. 2 lit. g).

### F2 · Frühere HWG-Prüfungen oder Abmahnungen — `angabe` + optional `upload` · Pflicht · team
**Felder:** Auswahl "Keine vorhanden" ODER kurze Beschreibung + Unterlagen-Upload.
**Anleitung:** Gab es früher werberechtliche Prüfungen oder Abmahnungen (z. B. durch Kammer oder Wettbewerbszentrale)? Falls ja: kurze Info und, falls vorhanden, die Unterlagen hochladen. Falls nein: "Keine vorhanden" wählen. Beides ist für uns in Ordnung, wir müssen es nur wissen, bevor wir werben (Hauptvertrag § 5 Abs. 2 lit. e).

### F3 · Datenschutz-Kontakt der Praxis — `angabe` · Optional · team
**Felder:** Name + E-Mail des Datenschutzbeauftragten, falls bestellt.
**Anleitung:** Nur ausfüllen, falls Ihre Praxis einen Datenschutzbeauftragten hat (Pflicht erst ab einer bestimmten Praxisgröße).

### F4 · Datenschutz-Texte für das Anfrageformular — `status` · Pflicht · inhaber
**Anleitung:** EINS stellt geprüfte Datenschutz-Texte für das Anfrageformular Ihrer Zielseiten. Mit diesem Haken bestätigen Sie, dass diese Texte ungekürzt übernommen werden (Hauptvertrag § 5 Abs. 2 lit. h).

---

## Schlusshinweis auf der Portal-Seite (kein Checklisten-Punkt)

Statischer Kasten "Was danach zählt" mit den vier laufenden Mitwirkungspunkten aus Block G (48 Werkstunden Kontaktaufnahme, Werbebudget ohne Unterbrechung, Freigaben binnen 10 Werktagen, benannte MFA bei Einweisung und Quartals-Reviews). Reine Information, nichts zum Abhaken.

---

## Zählung

| Block | Punkte | Pflicht | Blocker |
|---|---|---|---|
| A | 5 | 5 | 5 |
| B | 6 | 5 | 0 |
| C | 6 | 4 | 0 |
| D | 6 | 1 (+2 empfohlen) | 0 |
| E | 6 | 6 | 0 |
| F | 4 | 3 | 0 |
| **Gesamt** | **33** | **24** | **5** |
