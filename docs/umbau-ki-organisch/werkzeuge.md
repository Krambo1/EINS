# Werkzeuge für die KI-Lieferung: Entscheidungsvorlage

**Stand:** 30.09.2026 (alle Abrufe am selben Tag) · **Grundlage:** `KANON.md` Abschnitte 7, 8, 9 · **Art:** reine Recherche. Es wurde kein Konto angelegt, nichts angemeldet, nichts eingegeben.

**Wie gelesen wurde**
- Preis-, Hilfe- und Rechtsseiten der Anbieter teils als Rohtext, teils über Zusammenfassungen gelesen. Blogs, Vergleichsberichte und Suchtreffer sind unten als **Drittquelle** markiert und gelten nicht als Beleg.
- **nicht belegt** heißt: auf der Anbieterseite nicht auffindbar oder Seite nicht lesbar. Nichts davon wurde geschätzt.
- Rechenbeispiele sind **eigene Rechnung** aus veröffentlichten Preisen, keine Anbieterzusage.

---

## 1. Empfehlung in 5 Sätzen

1. **Vorschau-Anzeigen:** Remotion, das EINS schon nutzt, als Baukasten. Textaufhänger, Erklär-Animation und Musik kommen aus einer Vorlage, die pro Praxis nur Daten bekommt (Behandlung, Ort, Aufhänger). Die Lizenz ist bis 3 Personen kostenlos, auch für Automatisierung und kommerzielle Nutzung.
2. **Bildmaterial dazu (optional):** Veo 3.1 über die bezahlte Gemini API von Google. Dort nutzt Google Eingaben und Ergebnisse nicht zum Training, ein Auftragsverarbeitungs-Zusatz gilt, und die Videos tragen ein SynthID-Wasserzeichen. Es kostet 0,05 bis 0,12 $ pro Sekunde laut Preisseite. Runway ist der Ersatz, Kling scheidet aus.
3. **Klon des Inhabers:** Synthesia im Tarif Creator (89 $ im Monat), **unter dem Vorbehalt eines Vergleichs der deutschen Stimme und Lippenbewegung**. Synthesia ist bei den Pflichten aus Kanon Abschnitt 7 und bei der Kennzeichnung mit Abstand am weitesten: Daten in der EU (Irland), Auftragsverarbeitungs-Zusatz zum Selbstunterschreiben, kein Vortraining mit Kundendaten, Einwilligung nur per Live-Aufnahme, C2PA-Signal automatisch.
4. **Zweitwahl Klon:** HeyGen. Deutsch wird in Drittquellen besser bewertet, aber die Daten liegen nur in den USA, die Nutzungsbedingungen erlauben Training ohne Widerruf (Ausstieg nur per E-Mail-Bitte), und die angekündigte Kennzeichnung der Ausgaben soll erst bis 02.12.2026 stehen.
5. **Stimme:** nicht getrennt kaufen. Die Klon-Stimme kommt aus Synthesia (Stimmaufnahme im selben Ablauf). ElevenLabs (Starter 6 $ im Monat, Training abschaltbar) ist nur Ergänzung für reine Sprachspuren. Cartesia wird zwar in einer Drittquelle für Deutsch vorn geführt, lässt sich im normalen Tarif aber nicht vom Training ausnehmen.

**Was daraus folgt:** Die Wahl des Klon-Werkzeugs steht erst nach dem Deutsch-Vergleich aus Abschnitt 4 (Punkt 1). Für alles andere kann sofort gebaut werden.

---

## 2. Vergleichstabelle

Prüfung nach Kanon Abschnitt 7: **kommerzielle Nutzung erlaubt / Anbieter hält keine Rechte am Ergebnis / Klon-Daten nicht zum Training**. Bewertung: ja, teils, nein, n. b.

| Werkzeug | Rolle | Deutsch (Beleg) | Abschnitt-7-Prüfung | Training, Opt-out | Einwilligung Klon | EU, AVV | Kennzeichnung | API und Preis klein |
|---|---|---|---|---|---|---|---|---|
| **Synthesia** | Klon | nur Drittquellen, uneinheitlich | **ja**, Kunde besitzt Daten, Lizenz nur "provide, maintain, improve"; Avatar nicht exportierbar | kein Vortraining mit Kundendaten (Vertrag) | Live-Aufnahme Pflicht, nicht hochladbar | **Irland, Backup Frankfurt**; AVV zum Selbstunterschreiben; US-Unterauftragnehmer | **C2PA automatisch**, sichtbares Label im Editor | API ab Creator 89 $/Monat, 3.600 Credits (etwa 30 Min) |
| **HeyGen** | Klon (Zweitwahl) | nur Drittquellen, eher gut | **teils**, Besitz ja, aber unwiderrufliche Lizenz inkl. Training | Ausstieg nur auf Anfrage per E-Mail, Enterprise standardmäßig ausgenommen | Consent-Video, Identitätsabgleich | **nur USA**; AVV nur Enterprise auf Anfrage | Wasserzeichen und Metadaten erst **bis 02.12.2026** angekündigt | Creator 29 $/Monat (600 Credits); API ab 4,83 $/Min, Klon-Anlage per API nur Enterprise |
| **Argil** | Klon | n. b. | **teils**, Skripte dürfen zum Training dienen | Video nicht für Allgemeinmodelle; Skripte ja | Pflicht liegt beim Kunden | Argil, Inc. (Delaware), AWS und Google Cloud; Region n. b.; AVV n. b. | n. b. | API ab Plan Classic (39 $/Monat), Preisseite dynamisch |
| **Arcads** | Klon, Werbe-Videos | n. b. | **nein**, nicht übertragbare Lizenz, Änderungen eng begrenzt | Trainingsrecht an Skript und Eingaben | Kunde garantiert Rechte | FRESHR SAS (Frankreich), AVV n. b. | n. b. | API nur mit Sonderangebot; Preise n. b. |
| **Creatify** | Werbe-Videos, Klon | n. b. | **teils**, Bedingungen von 2024 | Assets dürfen nicht zum Training Dritter dienen, Anbieter-Lizenz breit | n. b. | n. b. | n. b. | Starter 39 $, Pro 99 $ (3 eigene Avatare); API eigener Tarif |
| **Captions (Mirage)** | Kurzvideo, Zwilling | n. b. | **teils**, Ausgabe gehört dem Kunden, Lizenz breit | kein Opt-out beschrieben | Kunde versichert schriftliche Einwilligung | Mirage US LLC, New York, AVV n. b. | n. b. | ab 24,99 $/Monat (500 Credits); API-Preise n. b. |
| **D-ID** | Klon (schwach) | n. b. | **teils**, Lite nur nicht kommerziell | laut Datenschutz 2024 kein Training | keine Prüfung beschrieben | **nur USA** (Oregon); AVV n. b. | Wasserzeichen nur in Trial und Lite | Preise nur aus Drittquellen |
| **ElevenLabs** | Stimme | Modell v3 mit 70+ Sprachen; Deutsch-Rangfolge nur aus Drittquelle | **ja** ab Starter; Ausgabe beim Kunden | **abschaltbar** im Menü "Data use" (nicht rückwirkend) | Eigene Stimme: Professional Cloning mit Stimm-Prüfung; Instant: n. b. | AVV öffentlich; **EU-Speicherung nur Enterprise**; Vertragspartei US-Firma | n. b. | API in allen Tarifen; 0,08 $ je 1.000 Zeichen (v3) |
| **Cartesia** | Stimme | Drittquelle: Platz 1 im deutschen Hörvergleich | **nein** im normalen Tarif | Training "sofern nicht anders vereinbart", nicht abschaltbar | n. b. | AVV nur Enterprise | n. b. | Pro 5 $/Monat inkl. Klonen und kommerzieller Lizenz |
| **Veo 3.1 (Gemini API)** | Bildmaterial | n. b. (Deutsch bei Sprache "nicht bewertet") | **ja** (Bezahlprodukt: kein Training, Google beansprucht kein Eigentum) | Bezahlprodukt: kein Training | nicht nötig | AVV; EU-Region für Veo n. b. | **SynthID** im Bild | 0,05 bis 0,40 $/Sekunde je Modell |
| **Runway** | Bildmaterial (Ersatz) | nicht nötig | **teils**, gehört dem Kunden, aber Training | im Standardvertrag **kein Opt-out** | nicht nötig | US-Firma, AVV n. b. | n. b. | 0,05 bis 0,12 $/Sekunde |
| **Kling** | Bildmaterial | nicht nötig | **n. b.** | Drittquelle: Training, Verarbeitung ggf. in China | nicht nötig | n. b. | n. b. | Preise n. b. |
| **Remotion** | Vorlagen, Automatik | nicht nötig | **ja**, eigener Code, kein Drittanbieter | keiner | nicht nötig | läuft bei EINS, Lambda in Frankfurt möglich | selbst gesetzt | frei bis 3 Personen; Lambda etwa 0,02 $ je Minute Video |
| **Creatomate** | Vorlagen (Cloud) | nicht nötig | n. b. | n. b. | nicht nötig | Firma in den Niederlanden, AVV n. b. | selbst gesetzt | API in allen Tarifen; Preise n. b. |
| **Shotstack** | Vorlagen (Cloud) | nicht nötig | n. b. | n. b. | nicht nötig | australische Firma, EU-Region n. b. | selbst gesetzt | 0,20 bis 0,30 $/Min (Seite von 2025) |

n. b. = nicht belegt.

**Rechenbeispiele (eigene Rechnung, Annahmen offen genannt)**
- **Vorschau-Anzeigen je Praxis**, 3 Anzeigen à 15 Sekunden: Rendern über Remotion Lambda etwa 0,02 $ (Beispielseite von Remotion: 1 Minute Video etwa 0,017 bis 0,021 $, Region us-east-1). Optionales Bildmaterial, 6 Clips à 8 Sekunden = 48 Sekunden: Veo Lite 720p 2,40 $, Veo Fast 720p 4,80 $, ohne verworfene Versuche. Optionale Stimme über ElevenLabs: rund 0,07 $ bei 900 Zeichen. **Unter 6 $ je Praxis**, also unter 60 $ bei 10 Praxen.
- **Klon**, Annahme 3 Praxen, je 8 Reels à 45 Sekunden = 18 Minuten im Monat (nur Rechenannahme, keine Stückzahl-Zusage): Synthesia Creator 89 $ (enthält etwa 30 Minuten), HeyGen Creator 29 $ (600 Credits, Avatar IV mit Video-Look 31 Credits je Minute, also etwa 19 Minuten). Bei 60 Minuten im Monat: HeyGen per API 290 $ (Avatar IV, 4,83 $ je Minute) bis 432 $ (Avatar V, 7,20 $). **Zusatz-Credits bei Synthesia: nicht belegt.**

---

## 3. Belege je Werkzeug

### 3.0 Rahmen aus Recht, nur soweit er die Wahl einschränkt (keine Rechtsberatung)

- **§ 22 KUG:** Bildnisse dürfen nur mit Einwilligung des Abgebildeten verbreitet oder öffentlich gezeigt werden (Wortlaut geprüft). Folge für die Wahl: das Werkzeug soll eine **eigene Einwilligungsprüfung** haben, und im Klon dürfen nur Personen stecken, die schriftlich zugestimmt haben (auch kein Teammitglied ohne eigene Einwilligung). Zur Stimme gibt es hier keine geprüfte Norm, siehe Abschnitt 4.
- **AI Act Art. 50:** gilt seit 02.08.2026. Anbieter müssen Ausgaben maschinenlesbar markieren (Art. 50 Abs. 2, Schonfrist bis 02.12.2026 für Systeme, die vor dem 02.08.2026 am Markt waren). Wer Deepfakes veröffentlicht, muss sie offenlegen (Art. 50 Abs. 4); ein Deepfake ist Inhalt, der bestehenden Personen ähnelt und fälschlich echt wirken würde, für erkennbar künstlerische oder kreative Werke gilt eine mildere Offenlegung. Folge für die Wahl: **Markierung schon heute eingebaut** und ein **sichtbares Label** im Werkzeug zählen. Quellen: EU-Kommission (FAQ zu Art. 50), Goodwin (08/2026).
- **§ 3 und § 11 Abs. 1 Nr. 5 HWG:** keine Irreführung, keine vergleichende Darstellung vor und nach einem operativen plastisch-chirurgischen Eingriff (Wortlaut geprüft). Folge für die Wahl: erzeugtes Bildmaterial nur ohne Körper, Ergebnisse oder Patientinnen, **Text und Aussagen immer in Remotion setzen**, nie im erzeugten Bild, damit jede Zeile prüfbar bleibt. Synthesia sperrt seinerseits Ergebnis-Darstellungen und "Wunderheilung"-Aussagen der Praxen (siehe 3.1).

### 3.1 Synthesia (Empfehlung Klon)

- **Deutsch:** kein unabhängiger deutscher Blindvergleich gefunden. Drittquelle vantaige.io: 90-Sekunden-Modul mit deutschem Personal Avatar, Lippen bei Standardwortschatz etwa 80 bis 90 Prozent Trefferquote (Methode offen). Drittquelle seo-tech.de (Jan. 2024): Stimmen wirkten "vor allem in Englisch" natürlich. **Deutsch: nicht belegt, Vergleich nötig.** Herstellerangabe: über 160 Sprachen.
- **Preis:** Starter 29 $/Monat (1.200 Credits, etwa 10 Min), Creator 89 $/Monat (3.600 Credits, etwa 30 Min, 5 Personal Avatars, API-Zugang), Enterprise nach Anfrage. Ein Credit-Preis: 2 Credits je Sekunde Video (Drittquelle zur API). Zusatz-Credits: nicht belegt.
- **API:** "Legacy v2 API" ab Creator, Interactive-Avatars-API in allen Tarifen (Hilfe-Artikel, Juli 2026).
- **Eigentum und Lizenz:** "Customer will own all Customer Data", Ausnahmen sind die Bausteine des Dienstes. Synthesia bekommt eine begrenzte Lizenz nur, soweit nötig, um den Dienst bereitzustellen, zu betreiben und zu verbessern. Nutzung der Nutzungsdaten darf **nicht** zu Feintuning oder neuen Modellen für andere führen. Avatare sind **nicht exportierbar**; nach Kontolöschung löscht Synthesia Daten und Custom Avatars (Kundenvertrag, gültig ab 20.07.2026).
- **Training:** "Synthesia does not use Customer Data, including inputs or outputs, to pre-train its AI Components." Feintuning nur nach schriftlicher Weisung des Kunden (AI Governance Practices, Stand 09/2024).
- **Einwilligung:** Personal Avatar nur mit **Live-Einwilligungsvideo derselben Person**, nicht hochladbar, mindestens 18 Jahre. Einladung per "Personal Avatar request" möglich: die Person legt selbst ein Konto an und wird Eigentümerin des Avatars, sie kann jederzeit Löschung verlangen. Aus Foto oder mit 1 bis 5 Minuten Video (bis 24 Stunden Wartezeit), Stimme optional per Stimmaufnahme. Kundenvertrag: Kunde muss sicherstellen, dass die Person volljährig ist und "free and informed consent" gegeben hat.
- **Inhaltsregeln, wichtig für Praxen:** Inhalte über Diagnose, Behandlungen und Eingriffe einer zugelassenen Ärztin oder eines Arztes sind nur mit **Studio- oder Personal-Avataren** erlaubt, nicht mit Stock-Avataren. Praxisspezifische Ergebnisse und Empfehlungen samt Patientenstimmen sind eingeschränkt, "Wunderheilung" und Vollheilung verboten. Stock-Avatare dürfen nicht in bezahlten Anzeigen laufen (Facebook, Instagram, TikTok, YouTube), **Custom Avatars sind davon ausgenommen** und richten sich nach der Vereinbarung mit der Person.
- **EU und AVV:** Kundendaten "currently stored within the EU" in Rechenzentren in Irland, Sicherungen in Irland und AWS Frankfurt, SOC 2 Typ II, ISO 27001, ISO 42001 (Sicherheitsseite, Stand 03.02.2026). **AVV** zum Selbstunterschreiben per Link (Stand 22.07.2026). **US-Unterauftragnehmer** (Stand 15.09.2026): OpenAI, ElevenLabs, WellSaid, Runway, Anthropic, Cartesia, AssemblyAI, Modal, Mux und weitere; EU-Anbieter unter anderem DeepL (Deutschland). Der Vertragspartner ist Synthesia Limited (London).
- **Kennzeichnung:** "carry C2PA-compliant provenance signals ... no setup required" und nicht abschaltbar; für die sichtbare Offenlegung gibt es im Editor "Media > AI Labels" (Hilfe-Artikel zu Art. 50, gültig ab 02.08.2026).
- **Quellen:**
  - https://www.synthesia.io/pricing
  - https://www.synthesia.io/legal/customer-terms-of-service
  - https://www.synthesia.io/legal/data-processing-agreement
  - https://www.synthesia.io/legal/subprocessors
  - https://www.synthesia.io/legal/security-practices
  - https://www.synthesia.io/legal/ai-governance-practices
  - https://help.synthesia.io/en/articles/16046624-what-does-the-eu-ai-act-article-50-mean-for-my-synthesia-videos
  - https://help.synthesia.io/en/articles/13603121-how-do-i-create-a-personal-avatar-from-a-photo
  - https://help.synthesia.io/en/articles/6341928-synthesia-video-licensing
  - https://help.synthesia.io/en/articles/8330530-disagreeable-content
  - https://help.synthesia.io/en/articles/6341327-how-do-i-use-the-synthesia-api
  - https://docs.synthesia.io/docs/personal-avatars
  - Drittquellen: https://vantaige.io/ai-tool/synthesia, https://www.seo-tech.de/synthesia-erfahrungen/
  - Abruf: 30.09.2026

### 3.2 HeyGen (Zweitwahl Klon)

- **Deutsch:** nur Drittquellen. Coda-Bericht: Deutsch unter den Sprachen mit "cleaner sync" (ohne Methode und Datum). all-ai.de (09.04.2026) gibt HeyGens **eigenen** MOS-Vergleich zu Avatar V wieder (Lippen 4,69), also Herstellerangabe. jens.marketing (11.02.2026) nennt die Sprache "noch sehr monoton". **Nicht belegt, Vergleich nötig.**
- **Preis (Hilfe-Center 2026):** Creator 29 $/Monat mit 600 Credits, Pro ab 49 $/Monat mit 1.000, Business 149 $/Monat mit 1.500. Credits je Minute: Avatar IV Video-Look 31, Avatar V 48. **API** getrennt, nur Guthaben zum Aufladen: Avatar IV Digital Twin 4,83 $/Min, Avatar V Digital Twin 7,20 $/Min, Foto-Avatar IV 2,31 $/Min, Sprachausgabe 0,12 $/Min. **Einen Digital Twin per API anlegen geht nur für Enterprise**, im Browser reicht Creator (1 Twin).
- **Eigentum:** bezahlte Tarife "you own all rights in your User Input or User Output"; Free: nur eingeschränkte Lizenz.
- **Training:** Nutzungsbedingungen (Stand 23.07.2026): Lizenz auf Inhalte "including to train or otherwise improve ... our artificial intelligence and machine learning models", "irrevocable", übertragbar, unterlizenzierbar. Datenschutzerklärung (11.08.2026): Ausstieg "by contacting us"; Enterprise standardmäßig ausgenommen (Sicherheitsseite). **Vertraglich widersprüchlich, deshalb Ausstieg schriftlich bestätigen lassen.**
- **Einwilligung:** bei Digital Twins Pflicht-Einwilligungsvideo, Stufe 1 per Webcam über gehostete Seite (Link 24 Stunden gültig), Stufe 2 und 3 nur Enterprise (Vorab-Video, Verzicht bei Haftungsfreistellung). Person muss zum Trainingsmaterial passen.
- **EU und AVV:** "All HeyGen customer data is stored in the United States" (Sicherheitsseite); die DSGVO-Seite sagt ausdrücklich, EU-Speicherung werde nicht angeboten (eine Suchzusammenfassung nennt EU-Speicherung für Enterprise: **widersprüchlich, nicht belegt**). Data Privacy Framework, DSB in Europa. AVV nur für Enterprise auf Anfrage. Unterauftragnehmer-Liste auf security.heygen.com.
- **Kennzeichnung:** laut Hilfe-Artikel vom 29.07.2026 will HeyGen unsichtbares Wasserzeichen, Metadaten und Prüfmöglichkeit **bis 02.12.2026** haben, **Stand heute also nicht eingebaut**. Offenlegung gegenüber dem Publikum liegt beim Kunden. Die Bedingungen verlangen ausdrücklich, KI-Herkunft offenzulegen.
- **Quellen:**
  - https://help.heygen.com/en/articles/15125761-heygen-credit-based-pricing-plans-explained
  - https://help.heygen.com/en/articles/15126059-how-to-use-credits-on-heygen
  - https://help.heygen.com/en/articles/10060327-heygen-api-pricing-explained
  - https://www.heygen.com/terms
  - https://www.heygen.com/privacy
  - https://www.heygen.com/security
  - https://www.heygen.com/gdpr-compliant
  - https://developers.heygen.com/docs/avatar-consent
  - https://help.heygen.com/en/articles/11395771-heygen-s-compliance-with-the-eu-ai-act
  - Drittquellen: https://docs.superhuman.com/@rohan-mac/heygen-avatar-iv-review/heygen-multilingual-test-lipsync-translation-and-accent-quality-7, https://www.all-ai.de/news/news26/heygen-5-v-avatar-ki, https://jens.marketing/tool/heygen/
  - Abruf: 30.09.2026. Hinweis: die Tarifseite www.heygen.com/pricing trug den Vermerk "2025" und wurde nicht verwendet.

### 3.3 Argil

- **Deutsch:** nicht belegt.
- **Preis:** Doku (docs.argil.ai): Classic 39 $/Monat mit 1.500 Credits und API-Zugang, Pro 149 $, Scale 499 $. Eine Drittquelle nennt eine Live-Preisseite mit anderen Beträgen (10 $ und 20 $), die Preisseite lud dynamisch und war nicht lesbar. **Preis nicht sicher.** API: 160 Credits je Minute Video, 20 je Minute Stimme, Ausschüttung 20 Credits je Video nur bei Argil-eigenen Avataren, Umrechnung Credit in Dollar nicht veröffentlicht (Beispiel: 130 Credits sind etwa 0,35 $).
- **Rechte:** "The Company does not claim any intellectual property rights over the Generated Content" (Ziff. 12.4). Skripte und Nutzerinhalte dürfen zum Erstellen und zum "training its AI" genutzt werden (12.3). Das Nutzer-Video dient laut 5.2.3.1 nur dem Nutzer-Avatar, nicht dem Training allgemeiner Modelle für Dritte.
- **Einwilligung:** Firmen, die Avatare für Dritte anlegen, sind "solely responsible" für schriftliche Einwilligungen; Erklärung nach DSGVO Art. 9 in Produktschritten.
- **Vertrag:** Argil, Inc., Delaware, **Recht von Delaware**, Gerichtsstand Delaware. Unterauftragnehmer AWS und Google Cloud, Region nicht belegt. AVV nicht belegt. Nutzungsbedingungen verbieten, Wasserzeichen oder Herkunftsmechanismen zu entfernen.
- **Quellen:** https://argil.ai/terms · https://docs.argil.ai/resources/api-pricings · https://docs.argil.ai/resources/subscription-and-plans · Abruf: 30.09.2026.

### 3.4 Arcads

- **Rechte (Bedingungen, Ziff. 13):** nur "non-exclusive, personal and non-transferable license" am Video, Änderungen nur Zuschneiden, Musik, Text, Untertitel, Emoji, B-Roll, Format und Logo. Alles Weitere braucht schriftliche Zustimmung. Bei Verstößen gegen die Modell-Regeln nach 30 Tagen **500.000 € Pauschale je Verstoß**. Anbieter darf mit Skript, Eingaben und eingefügten Elementen seine KI-Modelle trainieren. Widerspricht **Kanon Abschnitt 7** (Nutzung "mit einer anderen Agentur", "bearbeiten").
- **API:** nur mit Sonderangebot ("customized offer"). Klonen laut Drittquelle nur im höchsten Tarif. Preise nicht belegt (nicht öffentlich, in der Plattform angezeigt).
- **Vertrag:** FRESHR SAS, Frankreich, französisches Recht, Paris.
- **Quelle:** https://www.arcads.ai/terms · Abruf: 30.09.2026.

### 3.5 Creatify

- **Preis (Seite vom 28.09.2026):** Starter 39 $/Monat (100 Credits, Wasserzeichen), Pro 99 $/Monat (3 eigene Avatare, ohne Wasserzeichen), Enterprise nach Anfrage; API als eigener Tarif, Preis nicht belegt.
- **Rechte (Bedingungen von 23.09.2024, also alt):** Nutzer besitzt seinen Originalinhalt in den Assets; Assets **dürfen nicht** zum Training von KI genutzt werden. Creatify erhält für Prompts und Bilder eine ewige, unwiderrufliche, unterlizenzierbare Lizenz zum Betreiben und Verbessern. Community-Assets darf Creatify zum Training nutzen.
- **Nicht belegt:** Deutsch, Einwilligungsprüfung, EU, AVV, Kennzeichnung.
- **Quellen:** https://www.creatify.ai/pricing · https://creatify.ai/terms · Abruf: 30.09.2026.

### 3.6 Captions (Mirage)

- **Preis (Seite):** Max 24,99 $/Monat (500 Credits), Frontier 1x 69,99 $, 2x 139,99 $, 4x 279,99 $, Enterprise. "Digital twin" in allen bezahlten Tarifen. API-Preise nicht belegt (eine "Mirage API" mit eigenen Bedingungen existiert).
- **Rechte (Stand 04.09.2025):** Ausgabe gehört dem Nutzer, vorbehaltlich Rechten von Mirage am eingebetteten Material. Mirage bekommt eine "limited, nonexclusive, royalty-free, sublicensable" Lizenz an Eingaben und Ausgaben, auch für neue Produkte; **Stimme wird nicht allein vermarktet ohne schriftliche Erlaubnis**. Ein Ausstieg aus dem Training ist nicht beschrieben. Nutzer versichert die schriftliche Einwilligung jeder erkennbaren Person.
- **Vertrag:** Mirage US LLC, Recht von New York. EU, AVV, Kennzeichnung: nicht belegt.
- **Quellen:** https://captions.ai/pricing · https://mirage.app/legal/captions-terms · Abruf: 30.09.2026.

### 3.7 D-ID

- **Preis:** die Preisseiten laden dynamisch und waren nicht lesbar. Drittquelle: Lite 4,70 $, Pro 16 $, Advanced 108 $ im Monat, 10, 15 und 100 Minuten. **Nicht bestätigt.** Wasserzeichen in Trial und Lite; Minuten verfallen monatlich.
- **Rechte (Nutzungsbedingungen 07/2024):** Nutzer behält seine Rechte an Eingaben und Ausgaben; D-ID erhält eine weltweite, unwiderrufliche, ewige Lizenz. Lite nur nicht kommerziell, Pro und höher kommerziell (Hilfe-Center laut Suchtreffer). Keine Einwilligungsprüfung beschrieben, Nutzer trägt alle Risiken.
- **Datenschutz (Stand 11.09.2024):** Daten liegen bei AWS in Oregon, USA, **kein EU-Speicherort**. Anwendungsdaten werden nicht für Modelltraining genutzt. API-Daten werden binnen 24 Stunden gelöscht, außer mit "persist". Ein AVV ist nicht erwähnt.
- **Quellen:** https://www.d-id.com/privacy-policy/ · https://www.d-id.com/studio-end-user-license-agreement/ · https://www.d-id.com/pricing/studio/ · Drittquelle: https://www.argil.ai/blog/d-id-pricing-5be73 · Abruf: 30.09.2026.

### 3.8 ElevenLabs (Stimme, Ergänzung)

- **Deutsch:** Modell Eleven v3 mit 70+ Sprachen (Herstellerangabe), Eleven v4 seit kurzem. Drittquelle Humanness Index (Vapi): Eleven v3 Wert 96 bis 97 nach 1.000 blinden Stimmen, **nicht deutschspezifisch**. Drittquelle (Suchtreffer zu Artificial Analysis, 09/2026): Eleven-v3-Familie in 7 von 9 neuen Sprachen unter den ersten 3; im deutschen Hörvergleich führt laut diesem Treffer Cartesia. Nicht selbst nachgeprüft.
- **Preis:** Free 10.000 Credits (nur nicht kommerziell), Starter 6 $, Creator 11 $ (erster Monat 22 $ mit Rabatt), Pro 99 $, Scale 299 $, Business 990 $. Kommerzielle Lizenz ab Starter. API in allen Tarifen inkl. Free (API-Preisseite), v3 und v2 Multilingual 0,08 $ je 1.000 Zeichen, v4 regulär 0,08 $ (bis 12.10. mit Rabatt 0,022 $). Gleichzeitige Anfragen: Starter 4, Creator 6, Pro 10.
- **Rechte (EEA-Bedingungen, 31.03.2026):** "you retain all rights in and to your Output". Lizenz an Inhalten ewig und unwiderruflich, unterlizenzierbar. **Ausstieg aus dem Training** jederzeit im Menü "Data use", wirkt ab Bearbeitung, nicht rückwirkend. Vertragspartei ist auch für EEA-Kunden Eleven Labs Inc.
- **Klonen:** Professional Voice Cloning nur die **eigene** Stimme, mit Stimm-Prüfung, mindestens 30 Minuten Material, Deutsch unterstützt. Instant Voice Cloning ab unter 2 Minuten Audio, Einwilligungsregeln dort nicht belegt.
- **EU und AVV:** AVV öffentlich (Stand 08.04.2026) für Enterprise und Selbstbucher, mit Standardvertragsklauseln; Unterauftragnehmer unter compliance.elevenlabs.io. **EU-Speicherung nur Enterprise**, Verarbeitung kann trotzdem außerhalb stattfinden, außer im Modus "Zero Retention".
- **Kennzeichnung:** nicht belegt.
- **Quellen:** https://elevenlabs.io/pricing · https://elevenlabs.io/pricing/api · https://elevenlabs.io/terms-of-use-eu · https://elevenlabs.io/dpa · https://elevenlabs.io/docs/overview/administration/data-residency · https://elevenlabs.io/docs/eleven-creative/voices/voice-cloning/professional-voice-cloning · Drittquellen: https://humannessindex.vapi.ai/models/elevenlabs-eleven-v3, https://www.digitalapplied.com/blog/best-text-to-speech-models-september-2026-ranked-priced · Abruf: 30.09.2026.

### 3.9 Cartesia (Stimme, nur zum Vergleich)

- **Preis (Seite):** Free 0 $ (20.000 Credits), Pro 5 $/Monat (100.000 Credits, etwa 133 Minuten, kommerzielle Lizenz, Instant Cloning), Startup 49 $ (Profi-Cloning), Scale 299 $; **DPAs und BAAs nur Enterprise**.
- **Rechte (Bedingungen):** "unless otherwise agreed", dürfen Eingaben, Ausgaben und Nutzung zum Training dienen; ewige, unwiderrufliche Lizenz. Ausstieg im Standardtarif nicht beschrieben, also **für Klon-Stimmen ungeeignet**.
- **Deutsch:** Drittquelle (Artificial Analysis, Stand 25.09.2026): Sonic 3.6 an der Spitze mit 1.279 Elo, die ersten drei liegen laut Quelle statistisch gleichauf. Nicht selbst geprüft.
- **Quellen:** https://cartesia.ai/pricing · https://cartesia.ai/legal/terms · https://cartesia.ai/legal/dpa · Abruf: 30.09.2026.

### 3.10 Veo 3.1 über die Gemini API (Bildmaterial, Empfehlung)

- **Preis (Seite, Stand 24.09.2026, Ton standardmäßig dabei):** Standard 0,40 $/Sek. (720p und 1080p), Fast 0,10 $ (720p) und 0,12 $ (1080p), Lite 0,05 $ (720p) und 0,08 $ (1080p). Abgerechnet wird nur bei erfolgreicher Erzeugung.
- **Bedingungen (Stand 23.03.2026):** Bezahlprodukte: "Google doesn't use your prompts ... or responses to improve our products", AVV für Produkte, bei denen Google Auftragsverarbeiter ist. Google beansprucht kein Eigentum an erzeugten Inhalten. Für Nutzer im EWR, in der Schweiz und im Vereinigten Königreich sind **nur Bezahlprodukte** zulässig.
- **Technik:** SynthID-Wasserzeichen, 9:16 und 16:9, höchstens 8 Sekunden je Erzeugung, Wartezeit 11 Sekunden bis 6 Minuten, Videos liegen 2 Tage auf dem Server. **In der EU und der Schweiz ist bei der Personendarstellung nur "allow_adult" zulässig.** Sprache: Englisch voll unterstützt, andere Sprachen "nicht bewertet". Ob Veo in EU-Regionen der Vertex-Plattform läuft, ist **nicht belegt** (ein Forumsbeitrag sagt nein, ohne Datum). Für Bildmaterial ohne Personendaten im Prompt ist das nachrangig.
- **Quellen:** https://ai.google.dev/gemini-api/docs/pricing · https://ai.google.dev/gemini-api/terms · https://ai.google.dev/gemini-api/docs/veo · Abruf: 30.09.2026.

### 3.11 Runway (Bildmaterial, Ersatz)

- **Preis (Entwickler-Doku):** 0,01 $ je Credit. Gen-4.5 12 Credits/Sek. (0,12 $), Gen-4 Turbo 5 Credits/Sek. (0,05 $), Veo 3.1 über Runway 40 Credits/Sek. mit Ton, 20 ohne.
- **Bedingungen (Stand 15.09.2026):** "does not claim ownership of any of your Inputs or Outputs", keine Einschränkung der kommerziellen Nutzung. Zugleich dürfen Eingaben und Ausgaben zum Training dienen, ewige unwiderrufliche Lizenz, **kein Ausstieg im Standardvertrag**. Enterprise-Bedingungen gelten gesondert (Suchtreffer: Vertragszusage, nicht zu trainieren). Für generische Prompts ohne Personendaten tragbar, für Klon-Daten nie.
- **Quellen:** https://docs.dev.runwayml.com/guides/pricing/ · https://runway.com/terms-of-use · Abruf: 30.09.2026.

### 3.12 Kling

- Die Seiten von Kling (Preise, API-Bedingungen) laden per Skript und waren nicht lesbar. **Preise, Eigentum, Training, EU: nicht belegt.** Drittquellen (Suchtreffer) nennen Training mit Widerspruch per E-Mail und Verarbeitung ggf. in China. Wegen der Datenlage nicht empfohlen.
- **Quelle:** https://kling.ai/dev/pricing · Abruf: 30.09.2026.

### 3.13 Remotion (Empfehlung Vorlagen)

- **Lizenz (Seite vom 30.09.2026):** Free License für Einzelpersonen und Firmen bis 3 Personen, "Create and automate", "Unlimited commercial use", "Must upgrade when your organization grows". Ab 4 Personen Company License: "Remotion for Creators" 25 $ je Platz und Monat oder "Remotion for Automators" 0,01 $ je Render bei mindestens 100 $ im Monat. Laut FAQ gilt die Free License **auch für Automatisierung und SaaS**.
- **Kosten Rendern:** Lambda-Beispiel (2.048 MB, us-east-1): 1 Minute Video etwa 0,017 bis 0,021 $. Regionen inkl. eu-central-1 (Frankfurt); Funktion und Speicher müssen in derselben Region liegen.
- **Bestand bei EINS:** `D:\Desktop\EINS Final\eins-showcase-video` (mit `remotion.config.ts`) und `D:\Desktop\Claude\teardown-runs\_remotion-frames`. Im Repo `EINSCodebase` steht kein Remotion in den `package.json`; die Vorschau-Vorlage müsste also als eigener Ordner unter `D:\Desktop\Claude\...` entstehen.
- **Quellen:** https://www.remotion.dev/docs/license/pricing · https://www.remotion.dev/docs/license/faq · https://www.remotion.dev/docs/lambda/cost-example · https://www.remotion.dev/docs/lambda/region-selection · Abruf: 30.09.2026.

### 3.14 Creatomate und Shotstack (nur zur Vollständigkeit)

- **Creatomate:** Firma in Leeuwarden, Niederlande, Datenverantwortlicher. API und Bedienoberfläche in allen Tarifen. Credit-Rechnung: 1 Bild = 1 Credit, 1 Minute Video in 720p etwa 14 Credits; Essential 2.000, Growth 10.000 bis 40.000, Beyond 50.000 bis 200.000 Credits im Monat; erzeugte Dateien 30 Tage gehostet. **Preise auf der Seite nicht lesbar**, eine Drittquelle nennt 54, 129 und 329 $ (nicht bestätigt). AVV nicht belegt.
- **Shotstack:** 0,30 $ je Minute bei Guthabenkauf, 0,20 $ je Minute im Abo ab 39 $ im Monat (Seite mit Vermerk 2025, also möglicherweise veraltet); Firma in Australien; EU-Region und AVV **nicht belegt**.
- **Bewertung:** beide bringen gegenüber Remotion keinen Vorteil, der die Zusatzkosten und einen weiteren Datenempfänger rechtfertigt.
- **Quellen:** https://creatomate.com/pricing · https://creatomate.com/privacy-policy · https://www.shotstack.io/pricing/ · Abruf: 30.09.2026.

---

## 4. Offene Punkte für Karam

**Entscheiden und selbst ausführen (ich habe kein Konto angelegt)**
1. **Deutsch-Vergleich vor der Wahl des Klon-Werkzeugs.** 60 Sekunden Text mit echtem Praxiswortschatz (etwa Hyaluron, Unterspritzung, Fadenlifting, Nasenkorrektur, Beratungsgespräch), mit **Karams eigenem Gesicht und eigener Stimme**, nicht mit dem eines Arztes (Kanon Abschnitt 8). Zwei Monatstarife nebeneinander: Synthesia Creator (89 $) und HeyGen Creator (29 $). Hören lassen: Karam und zwei Personen ohne Technikbezug. Bewerten: Aussprache der Fachwörter, Betonung, Lippen bei "b, m, p, ü, ö", Wirkung auf einen 55-Jährigen. Höchstkosten etwa 118 $. Entscheidung: nimmt Synthesia klar mehr Punkte, bleibt es bei Synthesia. Liegt HeyGen deutlich vorn, HeyGen nur mit schriftlicher Bestätigung des Trainings-Ausstiegs (siehe Punkt 5).
2. **Kosten:** Synthesia Creator 89 $ im Monat, HeyGen Creator 29 $. Zusatz-Credits bei Synthesia sind **nicht belegt**; vor dem dritten Kunden beim Anbieter klären. Veo-Bildmaterial unter 6 $ je Praxis (Rechnung oben). Rechnungen laufen in Dollar.
3. **Konto:** Wer hält den Klon? Empfohlen: EINS legt das Konto an und lädt den Inhaber per "Personal Avatar request" ein, der Inhaber nimmt Einwilligung und Aufnahme selbst am eigenen Gerät auf und wird Eigentümer des Avatars (Synthesia-Dokumentation). Bitte im Kanon Abschnitt 7 abstimmen, ob das gewollt ist.
4. **Musik für Anzeigen:** Lizenz für Hintergrundmusik in bezahlten Anzeigen wurde **nicht geprüft**. Stockmaterial ebenfalls nicht.
5. **HeyGen-Ausstieg vom Training:** falls HeyGen gewählt wird, per E-Mail an den Anbieter bestätigen lassen und ablegen; die Nutzungsbedingungen sagen zugleich "irrevocable".

**Anwaltsfragen (zusätzlich zu den zwei aus dem Plan: AI Act Art. 50 und MBO-Ä § 27)**
1. **"Der Klon gehört Ihnen" (Kanon 7):** Synthesia-Avatare sind nicht exportierbar, und laut Synthesia-Vertrag gehören dem **Kunden** (EINS) die Videos mit Custom Avatars. Reicht "dauerhaft nutzen dürfen, Löschung 30 Tage nach Ende" als Formulierung, oder braucht es eine andere Konstruktion (Konto beim Inhaber)?
2. **Kennzeichnung:** Wer ist "Betreiber" nach Art. 50 Abs. 4, EINS oder die Praxis? Gilt eine Offenlegungspflicht auch für **erzeugtes Bildmaterial und eine generische Sprecherstimme** in den Vorschau-Anzeigen (Kanon 8 kennt nur den Klon)? Die Empfehlung, Vorschau-Anzeigen ohne Stimme zu bauen (nur Text und Musik), umgeht die Stimmfrage.
3. **Einwilligung und Stimme:** Reicht die Einwilligung "KI-Abbild und Stimme" als Grundlage für Gesicht **und** Stimme (Recht am eigenen Bild, § 22 KUG, plus Stimme)? Zur Stimme wurde hier keine Norm geprüft. Ist Gesicht oder Stimme für einen Klon **biometrische Daten** im Sinne der DSGVO (Argil erwähnt Art. 9 in seinen Bedingungen)?
4. **AVV und Drittländer:** Kanon Abschnitt 12 hat den Platzhalter `[OFFEN: Anbieter KI-Video und Stimme]`. Kandidat: Synthesia Limited (London). Zu klären: Übermittlung nach Großbritannien und in die USA an Synthesias Unterauftragnehmer (OpenAI, ElevenLabs, Cartesia, Anthropic, Runway und weitere), ob die Praxis der Verantwortliche ist und EINS Auftragsverarbeiter.
5. **HWG für erzeugtes Bildmaterial:** genügt die Regel "keine Körper, keine Ergebnisse, Text nur aus Remotion", und muss jede Vorschau-Anzeige von einer Person geprüft werden, bevor sie einer Praxis gezeigt wird?
6. **Synthesia-Inhaltsregeln:** Behandlungsinhalte sind nur mit Personal-Avataren zulässig, Ergebnis-Darstellungen und Patientenstimmen sind eingeschränkt. Vorab klären, ob Beiträge der Praxen dort je gesperrt werden könnten (der Anbieter darf Konten bei Verstoß aussetzen).
