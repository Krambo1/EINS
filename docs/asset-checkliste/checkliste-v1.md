# Asset-Liefer-Checkliste v2 (Portal-Fassung, Stand 30.09.2026)

Quelle: Obsidian `10 EINS/Kunden/Asset-Liefer-Checkliste (Kunden-Onboarding).md` (Vault `D:\Desktop\Claude\Obsidian\Karam`), Blöcke A-F, dazu Block G als Schlusshinweis.
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
- `{{EINS_META_BM_ID}}`: EINS Business-Manager-ID
- `{{EINS_ADS_EMAIL}}`: E-Mail für Google-Einladungen (z. B. ads@eins.ag)
- `{{EINS_UPLOAD_KONTAKT}}`: Rückfragen-Kontakt (z. B. Telefon/E-Mail Karam)

Rollen: `inhaber` = nur Inhaber kann abschließen; `team` = jede Portal-Rolle mit Schreibrecht darf liefern.

---

## Block A: Blocker. Ohne diese Punkte startet nichts

Frist für die Klon-Aufnahme und die Einwilligung: 3 Werktage nach Unterschrift.

### A1 · Unterschriebener Auftragsverarbeitungsvertrag (AVV) · `upload` · Pflicht · Blocker · inhaber
**Anleitung:** Den AVV stellt EINS bereit: Sie finden ihn im Portal unter Dokumente, Kategorie "Auftragsverarbeitungsvertrag". Bitte ausdrucken oder digital signieren, von der vertretungsberechtigten Person unterschreiben lassen und die unterschriebene Fassung hier als PDF hochladen.
**Warum:** Ohne unterschriebenen AVV dürfen wir keine personenbezogenen Daten für Sie verarbeiten; die Leistungserbringung startet erst danach (Hauptvertrag § 3 Abs. 3).

### A2 · Ansprechpartner mit Entscheidungsbefugnis · `angabe` · Pflicht · Blocker · team
**Felder:** Name, Funktion, Handynummer, E-Mail, bevorzugter Kanal (Telefon / E-Mail / WhatsApp).
**Anleitung:** Nennen Sie die Person, die im Alltag Entscheidungen für die Zusammenarbeit treffen darf (Freigaben, Rückfragen). Das kann der Inhaber selbst sein oder eine bevollmächtigte Person.
**Warum:** Jede Rückfrage, die erst durch die Praxis wandern muss, kostet Zeit.

### A3 · Ärztliche Leitung als fachliche Ansprechperson · `angabe` · Pflicht · Blocker · team
**Felder:** Name, Titel, E-Mail, Telefonnummer (optional).
**Anleitung:** Die ärztliche Leitung gibt medizinische Aussagen in Beiträgen, Anzeigen und auf Zielseiten frei (Heilmittelwerbegesetz). Bitte nennen Sie die zuständige Ärztin oder den zuständigen Arzt.
**Warum:** Werbliche Aussagen über Behandlungen dürfen nur mit fachlicher Freigabe live gehen.

### A4 · Termin für das Onboarding-Gespräch bestätigt · `status` · Pflicht · Blocker · team
**Anleitung:** Das Onboarding-Gespräch dauert etwa 90 Minuten und findet per Video statt. Den Termin stimmen Sie direkt mit Ihrem EINS-Ansprechpartner ab. Haken Sie diesen Punkt ab, sobald der Termin in beiden Kalendern steht.

### A5 · Klon-Aufnahme und Einwilligung geliefert · `status` · Pflicht · Blocker · team
**Anleitung:** Sie nehmen einmal wenige Minuten Video und Stimme mit dem Handy auf, nach der Anleitung von EINS. Daraus entsteht Ihr KI-Klon. Dazu gehört Ihre unterschriebene Einwilligung für KI-Abbild und Stimme, die Sie unter Punkt F5 hochladen. Haken Sie ab, sobald beides an EINS übergeben ist. Frist: 3 Werktage nach Unterschrift.
**Warum:** Ohne Klon-Aufnahme und Einwilligung startet die Leistung nicht.
**Hinweis Karam:** `[OFFEN: Übergabeweg der Klon-Aufnahme (Portal-Upload, Link oder Übergabe im Onboarding-Gespräch), hängt an der Wahl des KI-Werkzeugs]`. Der Text nennt bewusst keinen Weg. Die ID A5 bleibt (Speichervertrag), nur Titel und Anleitung sind neu.

---

## Block B: Zugänge zu Werbekonten und Plattformen

Grundsatz, steht über dem Block: **Alle Zugänge per Einladung oder Partnerfreigabe an EINS. Bitte niemals Passwörter per E-Mail oder Telefon weitergeben, wir fragen auch nie danach.** Frist für Instagram, Facebook, Meta Business Manager und die Domain: 3 Werktage nach Unterschrift.

### B1 · Meta Business Manager: Partnerzugriff · `einladung` · Pflicht · team · "nicht vorhanden" erlaubt
**Anleitung:**
1. Öffnen Sie business.facebook.com und melden Sie sich an.
2. Klicken Sie links unten auf das Zahnrad (Einstellungen), dann auf "Unternehmenseinstellungen".
3. Wählen Sie links "Nutzer", dann "Partner".
4. Klicken Sie auf "Hinzufügen" und wählen Sie "Einen Partner einladen, der deine Assets verwaltet" (Wortlaut kann je nach Meta-Version leicht abweichen).
5. Geben Sie die EINS Business-Manager-ID ein: **{{EINS_META_BM_ID}}**
6. Haken Sie hier "Einladung verschickt" ab.

Falls Ihre Praxis keinen Business Manager hat: Wählen Sie "Nicht vorhanden". Wir legen ihn im Onboarding-Gespräch gemeinsam an, das dauert etwa 15 Minuten.

### B2 · Facebook-Seite und Instagram-Konto: Vollzugriff · `einladung` · Pflicht · team
**Anleitung:** Im selben Bereich ("Unternehmenseinstellungen" im Business Manager): Ordnen Sie EINS als Partner Ihre Facebook-Seite und Ihr Instagram-Konto mit voller Kontrolle bzw. Admin-Zugriff zu ("Konten" → "Seiten" / "Instagram-Konten" → Asset auswählen → "Partner zuweisen"). Falls Ihr Instagram-Konto noch nicht mit dem Business Manager verbunden ist, verbinden Sie es dort unter "Konten" → "Instagram-Konten" → "Hinzufügen".

### B3 · Meta-Werbekonto: Zugriff und Zahlungsmittel · `einladung` · Pflicht · team
**Anleitung:**
1. Weisen Sie EINS Ihr Werbekonto als Partner zu ("Konten" → "Werbekonten" → "Partner zuweisen", Zugriff "Werbekonto verwalten").
2. Hinterlegen Sie ein Zahlungsmittel der Praxis (Kreditkarte oder Lastschrift) unter "Abrechnung und Zahlungen". Das Werbebudget zahlen Sie direkt an Meta, nicht an EINS. Zu Beginn brauchen Sie kein Werbebudget, wir starten organisch.
3. Haken Sie ab, wenn beides erledigt ist.

Falls kein Werbekonto existiert: "Nicht vorhanden" wählen, wir legen es gemeinsam an, sobald Anzeigen dazukommen.

### B4 · Google Ads-Konto: Zugriff · `einladung` · Pflicht · team · "nicht vorhanden" erlaubt
**Anleitung:**
1. Öffnen Sie ads.google.com und melden Sie sich an.
2. Klicken Sie oben rechts auf "Verwaltung" (Werkzeug-Symbol), dann "Zugriff und Sicherheit".
3. Klicken Sie auf das Plus und laden Sie diese E-Mail-Adresse mit Zugriffsebene "Administrator" ein: **{{EINS_ADS_EMAIL}}**
4. Haken Sie "Einladung verschickt" ab.

Falls Ihre Praxis kein Google Ads-Konto hat: "Nicht vorhanden" wählen.

### B5 · Google Unternehmensprofil: Verwalterzugriff · `einladung` · Pflicht · team
**Anleitung:**
1. Öffnen Sie business.google.com und wählen Sie Ihr Praxis-Profil.
2. Gehen Sie zu "Einstellungen" → "Nutzer und Zugriffsrechte" (bzw. Menü → "Profilmanager").
3. Fügen Sie **{{EINS_ADS_EMAIL}}** als "Manager" hinzu.
**Warum:** Über das Unternehmensprofil laufen Ihr Bewertungssystem und lokale Anzeigen.

### B6 · Google Analytics / Tag Manager · `einladung` · Optional · team
**Anleitung:** Nur falls vorhanden: Laden Sie **{{EINS_ADS_EMAIL}}** in Google Analytics (Verwaltung → Zugriffsverwaltung des Kontos, Rolle "Administrator") und im Tag Manager (Verwaltung → Nutzerverwaltung, "Veröffentlichen") ein. Falls Sie nicht sicher sind, ob es ein Konto gibt: kurz im Feld vermerken, wir prüfen das gemeinsam.

---

## Block C: Zugänge zu Website und Praxis-Systemen

### C1 · Website: Zugang zum Redaktionssystem · `einladung` · Pflicht · team
**Felder zusätzlich:** Name der betreuenden Agentur / des Webmasters + Kontakt (falls extern betreut).
**Anleitung:** Legen Sie für EINS einen eigenen Benutzer in Ihrem Redaktionssystem an (bei WordPress: Dashboard → "Benutzer" → "Neu hinzufügen", Rolle "Administrator", E-Mail **{{EINS_ADS_EMAIL}}**). Bitte kein bestehendes Passwort weitergeben. Wird Ihre Website extern betreut, reicht der Kontakt zur Agentur, wir klären den Zugang direkt.

### C2 · Domain / DNS · `angabe` · Pflicht · team
**Felder:** Anbieter (z. B. IONOS, Strato), Kontakt der verwaltenden Person/Agentur.
**Anleitung:** Wir brauchen einmalig eine kleine technische Einstellung an Ihrer Domain (für Ihre Zielseiten und die Messung der Anfragen). Tragen Sie ein, wo die Domain liegt und wer sie verwaltet; die Umsetzung übernehmen wir gemeinsam mit dieser Person.

### C3 · Buchungssystem (z. B. Doctolib) · `angabe` · Optional · team
**Felder:** System, Buchungslink, Integration gewünscht (ja/nein).
**Anleitung:** Falls Patienten bei Ihnen online buchen können: Tragen Sie den Buchungslink ein. Wenn Anfragen direkt in Ihren Kalender laufen sollen, vermerken Sie "Integration gewünscht", den Rest klären wir im Onboarding-Gespräch.

### C4 · CRM / Anfragen-Verwaltung · `angabe` · Optional · team
**Felder:** System (falls vorhanden), Kontakt.
**Anleitung:** Nur falls Ihre Praxis bereits ein System zur Verwaltung von Interessenten-Anfragen nutzt. Falls nicht: leer lassen, das EINS-Portal übernimmt das.

### C5 · Praxisverwaltungssystem (PVS) · `angabe` · Pflicht · team
**Felder:** Name (z. B. medatixx, Tomedo, CGM, Dampsoft), Version (falls bekannt), Ansprechperson für IT.
**Anleitung:** Nur Name und Version eintragen, sonst nichts. Den Lesezugang richten wir je nach System gemeinsam mit Ihrem PVS-Support ein; EINS leitet das an und meldet sich dazu bei Ihnen.
**Warum:** So sehen Sie später im Portal, welcher Umsatz aus den Anfragen wirklich entstanden ist.

### C6 · Portal-Zugänge für Ihr Team · `angabe` · Pflicht · team
**Felder:** Pro Person: Name, E-Mail, Rolle (Rezeption / Marketing / Ärztin/Arzt).
**Anleitung:** Wer in Ihrer Praxis soll das EINS-Portal nutzen können (Anfragen sehen, Auswertungen lesen)? Sie können Ihr Team auch direkt unter Einstellungen → Team einladen; dann hier nur abhaken.

---

## Block D: Marke und Bildmaterial

Steht über dem Block: Vorher-Nachher-Bilder laden Sie bitte nicht hoch. Wir zeigen keine Vorher-Nachher-Darstellungen, weder in Beiträgen noch in Anzeigen (§ 3 und § 11 HWG).

### D1 · Logo als Vektordatei · `upload` · Pflicht · team
**Anleitung:** Laden Sie Ihr Logo als SVG-, EPS- oder AI-Datei hoch. Falls Sie nur ein PNG haben: bitte in der höchsten verfügbaren Auflösung. Tipp: Die Vektordatei hat meist die Agentur, die Ihr Logo gestaltet hat; eine kurze E-Mail dorthin genügt in der Regel.
**Warum:** Aus dem Logo bauen wir Beiträge, Zielseiten und Anzeigen; eine Vektordatei bleibt in jeder Größe scharf.

### D2 · Farbwerte und Schriften (CI-Dokument) · `upload` · Optional · team
**Anleitung:** Falls es ein Dokument mit Ihren Praxis-Farben und Schriften gibt (Styleguide, CI-Mappe), laden Sie es hoch. Falls nicht: leer lassen, wir leiten die Werte aus Logo und Website ab.

### D3 · Vorhandene Fotos · `upload_oder_link` · Empfohlen · team
**Anleitung:** Praxis-Räume, Team, Ärztin/Arzt: auch ältere Aufnahmen helfen, wir entscheiden, was nutzbar ist. Einzelne Dateien können Sie direkt hochladen; bei größeren Sammlungen tragen Sie einfach einen Freigabe-Link ein (Google Drive, Dropbox oder WeTransfer: Dateien dort hochladen, Link mit Leserechten erstellen, hier einfügen).

### D4 · Vorhandene Videos · `link` · Optional · team
**Anleitung:** Videodateien sind für den direkten Upload meist zu groß. Laden Sie sie bei Google Drive, Dropbox oder WeTransfer hoch und tragen Sie hier den Freigabe-Link ein.

### D6 · Zertifikate, Facharzt-Urkunden, Mitgliedschaften · `upload` · Empfohlen · team
**Anleitung:** Facharzt-Urkunden, Zertifikate, Mitgliedschaften (z. B. DGÄPC, DGBT) als Scan oder Foto hochladen.
**Warum:** Solche Nachweise machen Ihre Zielseiten glaubwürdig und heben Sie von Anbietern ohne Qualifikation ab.

---

## Block E: Praxis-Informationen

### E1 · Behandlungsliste mit Preisspannen · `upload_oder_link` + `angabe` · Pflicht · team
**Anleitung:** Mindestens für die 1 bis 2 Fokus-Behandlungen: Behandlung und Preisspanne (z. B. "Faltenunterspritzung 250 bis 450 €"). Eine bestehende Preisliste können Sie als PDF hochladen; alternativ tragen Sie die Spannen direkt ein.
**Warum:** Ohne Preisspannen können wir Anfragen nicht nach Wert vorsortieren.

### E2 · Standorte · `angabe` · Pflicht · team
**Felder:** Pro Standort: Adresse, Öffnungszeiten, Telefonnummer; dazu das Einzugsgebiet (Städte/Umkreis).
**Anleitung:** Tragen Sie alle Standorte ein, an denen behandelt wird. Das Einzugsgebiet bestimmt, für welche Region wir Beiträge und Anzeigen ausrichten.

### E3 · Team-Übersicht · `angabe` · Pflicht · team
**Felder:** Wer behandelt was; wer nimmt Anfragen entgegen (Name + Funktion).
**Anleitung:** Eine kurze Liste reicht. Wichtig ist vor allem: Wer ruft neue Interessenten zurück?

### E4 · Impressums- und Rechnungsdaten · `angabe` · Pflicht · team
**Felder:** Vollständiger Praxisname, Rechtsform, Berufsbezeichnung, zuständige Ärztekammer, Rechnungsanschrift.
**Anleitung:** Diese Angaben brauchen wir für das Impressum Ihrer Zielseiten und für die Abrechnung; bitte exakt wie im bestehenden Impressum Ihrer Website.

### E5 · Freie Beratungskapazität · `angabe` · Pflicht · team
**Felder:** Beratungstermine pro Woche für neue Patienten (Zahl oder Spanne).
**Anleitung:** Wie viele Erstberatungen pro Woche sind realistisch frei? Ehrliche Schätzung genügt; danach richten wir aus, wie viele Anfragen wir zu Ihnen leiten, damit keine Anfragen liegen bleiben.

### E6 · Nummer für die Anfragen-Übergabe · `angabe` · Pflicht · team
**Felder:** Telefonnummer und/oder WhatsApp-Nummer, erreichbare Zeiten.
**Anleitung:** Wohin sollen wir hochpreisige Anfragen durchstellen? Diese Nummer sollte werktags verlässlich besetzt sein.

---

## Block F: Rechtliches und Compliance

### F2 · Frühere HWG-Prüfungen oder Abmahnungen · `angabe` + optional `upload` · Pflicht · team
**Felder:** Auswahl "Keine vorhanden" ODER kurze Beschreibung + Unterlagen-Upload.
**Anleitung:** Gab es früher werberechtliche Prüfungen oder Abmahnungen (z. B. durch Kammer oder Wettbewerbszentrale)? Falls ja: kurze Info und, falls vorhanden, die Unterlagen hochladen. Falls nein: "Keine vorhanden" wählen. Beides ist für uns in Ordnung, wir müssen es nur wissen, bevor wir Beiträge veröffentlichen oder werben (Hauptvertrag § 5 Abs. 2 lit. e).

### F3 · Datenschutz-Kontakt der Praxis · `angabe` · Optional · team
**Felder:** Name + E-Mail des Datenschutzbeauftragten, falls bestellt.
**Anleitung:** Nur ausfüllen, falls Ihre Praxis einen Datenschutzbeauftragten hat (Pflicht erst ab einer bestimmten Praxisgröße).

### F4 · Datenschutz-Texte für das Anfrageformular · `status` · Pflicht · inhaber
**Anleitung:** EINS stellt geprüfte Datenschutz-Texte für das Anfrageformular Ihrer Zielseiten. Mit diesem Haken bestätigen Sie, dass diese Texte ungekürzt übernommen werden (Hauptvertrag § 5 Abs. 2 lit. h).

### F5 · Einwilligung KI-Abbild und Stimme · `upload` · Pflicht · inhaber
**Anleitung:** Für Ihren KI-Klon nutzen wir Ihr Gesicht und Ihre Stimme. Dafür brauchen wir Ihre unterschriebene Einwilligung für KI-Abbild und Stimme. Die Vorlage stellt EINS bereit. Bitte unterschreiben Sie sie und laden Sie die unterschriebene Fassung hier als PDF oder Foto hoch. Vor Ihrer unterschriebenen Einwilligung bauen wir weder Ihr Gesicht noch Ihre Stimme nach. Widerrufen Sie die Einwilligung, stoppen wir sofort alle Beiträge mit Ihrem Klon und löschen das Klon-Modell (Hauptvertrag § 5 Abs. 2 lit. g).
**Warum:** Ihr KI-Klon gehört Ihnen. Wir nutzen Ihr Gesicht und Ihre Stimme nur für Ihre Praxis, nie für eigene Werbung ohne Ihre gesonderte schriftliche Einwilligung, und löschen das Klon-Modell spätestens 30 Tage nach Vertragsende.

### F6 · Einwilligungen für vorhandenes Material · `upload_oder_link` · Empfohlen · team · "Keine vorhanden" erlaubt
**Anleitung:** Laden Sie hier die schriftlichen Einwilligungen aller Personen hoch, die in Ihrem vorhandenen Material (Punkt D3 und D4) zu sehen oder zu hören sind: Ihr Team sowie Patientinnen und Patienten, zum Beispiel in Patientenstimmen. Ohne Einwilligung nutzen wir kein Material, auf dem eine Person erkennbar ist. Mehrere Einwilligungen können Sie als ein PDF oder als Freigabe-Link liefern (Google Drive, Dropbox oder WeTransfer: Dateien dort hochladen, Link mit Leserechten erstellen, hier einfügen). Haben Sie kein solches Material oder geben uns keins, wählen Sie "Keine vorhanden".
**Warum:** Wer in Ihrem Material zu sehen oder zu hören ist, muss der Nutzung zugestimmt haben, bevor wir es verwenden. Das schützt die Personen und Ihre Praxis.
[OFFEN: Vorlage für Einwilligungen von Personen in vorhandenem Material (Team, Patientinnen und Patienten). Die Anleitung verspricht keine Vorlage, solange es keine gibt.]

---

## Schlusshinweis auf der Portal-Seite (kein Checklisten-Punkt)

Statischer Kasten "Was danach zählt" mit fünf Punkten aus Block G. Reine Information, nichts zum Abhaken.

1. Beiträge freigeben oder konkret ändern: innerhalb von 2 Werktagen. Wir schicken Ihnen die Beiträge einmal pro Woche gesammelt. Das ist in wenigen Minuten erledigt: ansehen, ja oder nein. Es gibt keine automatische Freigabe, denn kein Beitrag geht ohne Ihre Freigabe raus.
2. Den Profil-Link zur Zielseite und die Tracking-Nummer nicht entfernen. Darüber messen wir, welche Anfragen über EINS kommen.
3. Antwortzeit: Bitte versuchen Sie, jede Anfrage innerhalb von 48 Werkstunden zu kontaktieren. Das ist keine Bedingung der Garantie. Schaffen Sie es nicht, hat das drei Folgen: Sie können bei dieser Anfrage nicht mehr einwenden, die Person sei nicht echt oder nicht erreichbar gewesen. Die Anfrage steht in Ihrer Auswertung als "von der Praxis nicht beantwortet". Und liegen drei oder mehr solcher Anfragen offen, dürfen wir nach einer Warnung die bezahlten Anzeigen pausieren, bis Sie die Anfragen kontaktiert haben.
4. Empfehlung, keine Bedingung: ein benanntes Mitglied Ihres Praxisteams an der Schulung teilnehmen lassen.
5. Jeder Tag, an dem Sie mit einer Mitwirkung in Verzug sind (Lieferung aus dieser Checkliste, Freigabe von Beiträgen), verlängert die 90 Tage um einen Tag. Die Garantie: Sie zahlen nichts, bis die erste qualifizierte Anfrage über EINS in Ihrem Portal liegt. Kommt in 90 Tagen keine, endet die Zusammenarbeit, und Sie haben nichts bezahlt.

---

## Zählung

| Block | Punkte | Pflicht | Blocker |
|---|---|---|---|
| A | 5 | 5 | 5 |
| B | 6 | 5 | 0 |
| C | 6 | 4 | 0 |
| D | 5 | 1 (+2 empfohlen) | 0 |
| E | 6 | 6 | 0 |
| F | 5 | 3 (+1 empfohlen) | 0 |
| **Gesamt** | **33** | **24** | **5** |

Die Zählung ist unverändert (F1 und D5 sind entfallen, F5 und F6 sind neu).

---

## Stand und ID-Vertrag (30.09.2026)

- **A5** behält die ID (Speichervertrag), bleibt Blocker und Pflicht. Nur Titel und Anleitung sind neu.
- **F1** (Patienten-Einwilligungen für den Produktionstag) ist entfallen und wird nie wiederverwendet. Gespeicherte F1-Zeilen und -Dateien bleiben in der Datenbank, Portal und Admin-Tab ignorieren unbekannte IDs.
- **F5** (Einwilligung KI-Abbild und Stimme) ist neu, weil eine bestehende ID keine neue Bedeutung bekommen darf.
- **D5** (Vorher-Nachher-Material) ist entfallen und wird nie wiederverwendet, ohne Nachfolger: Vorher-Nachher-Darstellungen werden nicht verwendet (Kanon Abschnitt 8). Gespeicherte D5-Zeilen und -Dateien bleiben in der Datenbank und werden ignoriert. Ersatz ist der Hinweis über Block D.
- **F6** (Einwilligungen für vorhandenes Material) ist neu: empfohlen, kein Pflichtpunkt, kein Blocker, "Keine vorhanden" erlaubt. Eine neue Pflicht hätte bereits abgeschlossene Onboardings wieder geöffnet.
- Die Portal-Fassung (`apps/portal/src/app/(portal)/onboarding/checkliste/content.ts`), das PDF und die Vault-Notiz tragen denselben Inhalt.
