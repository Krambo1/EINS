# Sources for DESIGN.md

Copying from Triple Whale, Attio, Stripe and Linear is very important, so we don't reinvent what they have already worked out. How to copy a reference: `DESIGN.md`, section "Copy from references". This file lists the references used: the image, the product and what was taken from it.

## Reference images

Stored in `D:\Desktop\Claude\eins-dashboard-redesign\references` (overview: `reference-board.jpg`, notes: `README.md`, URLs per file: `SOURCES-<date>.md`).

- **Triple Whale** (`triplewhale/`), model for the clinic dashboard. From it: pinned numbers at the top, the tile anatomy (label, change, big number, sparkline), one sticky range control, and phone tiles as full-width rows. Source: the blog post "How To Build The Perfect Analytics Dashboard", help center GIFs, App Store screenshots.
- **Linear** (`linear/`), model for the admin. From it: the Cmd+K menu, J/K and Enter, dense rows, counts next to titles, quiet chrome. Sources: Linear docs and changelog.
- **Attio** (`attio/`), model for admin charts: one hue per chart, dashed gridlines, tooltip cards.
- **Attio funnel** (`attio/funnel/`), model for the Trichter. Images come from the help center articles "Set up a Funnel report" and "Build a sales reporting dashboard":
  - `funnel-steps-deals.png`: solid bar per step, tinted drop-off above it, % and count on each step.
  - `funnel-report-deals.png`, `funnel-analysis-report.png`: the flowing variant.

- **Breakdown and hover references, 2026-10-29** (`attio-breakdown/`, `stripe/`, `triplewhale-lines/`; URLs in `SOURCES-2026-10-29.md`):
  - Attio `open-number-history.png`: the hover card (title, colour bar, values in grey chips).
  - Attio `example-lead-channel-distribution.png`: paired light and dark bars (Behandlungen).
  - Attio `help-insight-groupby-segmented-bars.png`: segmented bars (Standorte).
  - Stripe `revrec-table-total-row.png`: the bold Gesamt row. Stripe `radar-chart-legend-rows.png`: legend rows under a chart.
  - Triple Whale `summary-tile-hover-tooltip-f004.png`: the small line tooltip beside the cursor with a short bold date.

- **Shell, toolbar and shape references, 2026-10-29** (looked at in the live products, no images stored):
  - Claude.ai, ChatGPT, Vercel: the account as the last row of the sidebar, with avatar, name and plan or role, and the menu opening upward. Copied for `UserMenu`.
  - Attio record lists and Notion databases: one toolbar row with search and filters on the left and the view's one action at the right end. Copied for the Anfragen toolbar with "Anfrage anlegen".
  - Linear inbox: two-line rows with a signal icon in front of the name. Copied for the Wiederbehandlungen rows below 1360 px.
  - Stripe tables: fixed figure columns, the name takes the rest; page buttons greyed out at the ends. Copied for the Wiederbehandlungen columns from 1360 px.
  - Material 3 shape scale and Apple's concentric corners: radius by element size, the inner element one step smaller. Copied for the `--r-*` tokens.

- **Inhalte references, 2026-10-29** (approval and file tools, looked at in the live products and their help pages, no images stored):
  - Planable, Kontentino, Sked: the post shown as it will look in the feed, with the account's name and picture above it. Copied for the preview in "Zur Freigabe".
  - Planable: "Review X posts" and approve, then schedule. Copied for the toast after a decision ("Noch 2 Beiträge warten.", "EINS plant ihn jetzt ein.").
  - Metricool, ContentStudio: the deadline says what happens when it passes. Copied for the Frist row.
  - ContentStudio, Sked: who approved and when. Copied for "Freigegeben am … von …" in "Alle Beiträge".
  - Frame.io: a comment tied to a moment in the video. Copied for "Stelle 0:12 einfügen". Also its comment box that stays closed until needed, copied for "Anpassung anfordern" (gone with the animations, 2026-10-30).
  - Frame.io, Google Drive, Linear Peek: a large viewer from the thumbnail, back and next with the arrow keys, download inside. Copied for `MediaViewer`.
  - Google Drive, downloading a folder: one ZIP file, split into several when it is big. Copied for "Alle herunterladen" (parts of 1 GB).
  - Stripe invoice list: one row per item with a status dot, a date and a figure. Copied for "Alle Beiträge".
  - Frame.io and Drive file lists, the Übersicht's Inhalte table (2026-10-30, the Medien card merged in): the picture leads the row, one tap opens it large, the download sits with the item. Copied for the post's picture and the well's "Herunterladen".
  - Looked at and left out: approving several posts at once (Planable), favourites (Drive's stars), copying a share link (Frame.io).

- **Dateien references, 2026-10-29** (`attio-files/`, `linear-create/`, `upload-ux/`; every element with its image in `SOURCES-2026-10-29.md`, three passes):
  - Attio's record "Files" tab: the section's one control at the right end of its title row (Art filter, "Dateien senden"), file rows of one height with a type icon, a quiet meta line, one action at the end and a rounded hover wash. Its coloured type icons and its "…" cut of long names are left out.
  - Linear: group header counts ("Von EINS 6"), two-line inbox rows, the "new issue" dialog for the send panel (close at the right, the files in a well, a footer band with "Dateien hinzufügen" and "Senden").
  - Stripe's table footer: "Zurück" and "Weiter" on every page, greyed out at the ends.
  - Convertio (`upload-ux/convertio-*.png`): drop anywhere on the page, the whole empty well opens the picker, the size limits in one line under it.
  - Smash (`upload-ux/smash-*.png`) and Drive: a dragged folder brings every file in it. Drive also: the drop target shown on the card, cancel per file, new rows light up, the browser asks before leaving mid-upload, the preview with arrows and download.
  - WeTransfer: count and size of the selection, one percentage for the batch. Slack and Linear: a pasted screenshot becomes a file.
  - WhatsApp: two grey ticks for "Übermittelt", two coloured ticks for "Gesehen".
  - Google Drive, downloading a folder (2026-10-30): "Alle herunterladen" on "Von EINS" is the Inhalte copy of it, the same packing code (`inhalte/_lib/zip.ts`), a ZIP named after what was chosen and the files under their own names.

- **Bewertungen references, 2026-10-29 and 2026-10-30** (every element with its product in `SOURCES-2026-10-29.md`, three passes; branch dashboard-redesign, not committed or deployed):
  - Triple Whale's tile for the platform tiles (logo, change, big number, a plain line scaled to its values) and its range switch for the tabs, the template switch and the status switch.
  - Linear's inbox: views with counts, two-line rows with a signal slot, the name bold while new. Linear's and Zendesk's details sidebar and Attio's record page for the Rückmeldung (name, the one action under it, labelled rows; copy beside the e-mail).
  - Stripe's tables for the Verlauf (header band, fixed figure columns) and the pager greyed out at the ends.
  - Review tools (help and product pages, no images stored; many help centres blocked automated reading): Google Business Profile and Trustpilot for "Link kopieren", Trustify for "+N seit …", Synup and Help Scout for filled and marked placeholders, Birdeye and Uberall for the "Neu" column and the CSV, Uberall, Linear and Birdeye for "Offen" as the default view, Podium for the counts and the bold unread rows, Nicereply, Retently and Yotpo for the star filter and search, Gmail and Zendesk for "N von M" with arrows, Help Scout for undo in the toast and templates at the cursor, Appbot and Retently for "Erledigt" with when and by whom.
  - Looked at and left out: Trustpilot's QR code of the review link (Karam, 2026-10-30: not needed).

- **Werbebudget references, 2026-10-29 and 2026-10-30** (`werbebudget/`, URLs in `werbebudget/SOURCES.md`, every element with its image in `SOURCES-2026-10-29.md`; branch dashboard-redesign, not committed or deployed):
  - The Übersicht's own period switch (`DashboardRangeSwitch`), copied part for part with its four periods.
  - Stripe's dashboard: a chart frame that keeps its gridlines and base line without data, the note in the middle; the "i" beside a figure instead of a card of notes.
  - Triple Whale's attribution table: channels as rows with the logo before the name and figures in fixed columns. Vercel's integration rows: the status as text in the row and the one button that fixes it at the row's end. Vercel's usage page: the amount so far over a thin share bar for "{Monat} bisher".
  - Meta Ads Manager's campaign table for Kampagnen. Its total row is left out: a campaign's Anfragen are matched by campaign id, so a sum would not match the Kennzahlen.
  - The Übersicht's Quellen for the unit and label "Pro qualifizierte Anfrage".
  - 2026-10-30, the cell that replaced "{Monat} bisher" (`werbebudget-ergebnis/`, URLs in its `SOURCES.md`): HubSpot Ads `hubspot-adsproduct-04.png` and `-05.png` (funnel steps in a row, conversion between them, "$91.74 each" under each step) for `AdFunnelCell`, with the Trichter's Attio bars. Google Ads `googleads-budget-01.png` (cumulative monthly spend, forecast, limit) looked at and left out: no stored monthly limit.

- **Inhalte card on the Übersicht, 2026-10-30** (`triplewhale-creative/`, `frameio/`, `wistia/`, `youtube-studio/`, `meta-business-suite/`, `buffer/`; every element with its image in `SOURCES-2026-10-30.md`; branch dashboard-redesign, not committed or deployed):
  - From xl Frame.io's media grid and YouTube Studio's shelves: four tiles, the picture on top with the format in its corner (YouTube's and Wistia's duration chip), the title, the status, then Triple Whale's label and value chips.
  - From lg Wistia's "Most played videos" and Buffer's "Performance per Post": a 16:9 picture, the title with one line under it, numbers in fixed columns under the Inhalte page's head band. Below lg Frame.io's mobile list.
  - A post waiting for the Freigabe fills a free slot with the step in place of the numbers (Frame.io's "Needs Review" card, Meta Business Suite's buttons under a post); waiting posts without a slot as a short link right of the title (Wistia's "View analytics").
  - Looked at and left out: Frame.io's dashed upload slot, Meta's number pill on the picture, Buffer's rank, and (Karam, 2026-10-30) the total "Anfragen über Beiträge" and the foot link.

## AI-design tells research (2026-10-25)

- Fountain Institute, "7 Tells that a UI is AI-Generated"
- Impeccable anti-patterns (pbakaus), mintlify.wiki/pbakaus/impeccable/concepts/anti-patterns
- ux-skill wiki, "How to detect AI slop in your design" and "How to design a dashboard with Claude Code" (github.com/Laith0003/ux-skill)
- Kosta Canatselis, "Spot the slop: a UI designer's guide to fixing AI defaults"

## Critique log (Karam)

- **2026-10-11**:
  - No status pills; status is a dot plus text.
  - One clear step per page.
  - Values compared across rows get fixed columns.
  - The same pattern everywhere.
- **2026-10-25, start of the redesign**:
  - "Mobile is very important."
  - "De ai-sloppify the site."
  - References: Triple Whale (clinic); Linear plus Attio charts (admin).
- **2026-10-25, cleanup round**:
  - A visible gap in the Quellen card was missed because only shrunk boards were checked: "Did you not visually verify your results?"
  - "Zeitraum für alle Karten" and the greeting were unnecessary: removing them "would not change anything about your decision making".
  - "The layout is literally not symmetrical or at least consistently spaced."
- **2026-10-29**:
  - The Trichter looked "horrible"; rebuild it the way Attio draws funnels.
  - Labels such as "Anfragen", "Termine" and "Behandlungen gewonnen" were too hard to read for how important they are: a visual hierarchy and weight problem.
- **2026-10-29, depth and motion round**:
  - "It looks very 2 dimensional and lacks animations."
  - "Multiple layers where you can actually feel the depth of the portal's elements." Led to the layer model and the Motion section.
  - Switching periods took one to two seconds, even back to the one shown a second before. Kept periods should come back at once, and the others should load while the portal is idle. Led to the period cache.
- **2026-10-29, follow-ups**:
  - The 12 Monate and 5 Jahre lines looked like a barcode (one point per day). Now weekly and monthly points.
  - "Delete the dark mode for the praxis side completely." Admin keeps it.
  - "The animations in some parts are a tiny bit too much", "especially places where it prevents me to actually see the information for quite some time". Now everything settles within about half a second.
  - "There's only a hover effect in the Anfragen card but no other card has it." Now every card lifts the same way.
  - Opening a Quelle resized the Quellen and Offene Anfragen cards; there should be room reserved for it. "Gesamt" and "28 weitere offene Anfragen" should sit on the same line, pinned to the bottom of their cards.

- **2026-10-29, Quellen, Behandlungen and Standorte round**:
  - "The graph lines should have EINS colors if possible." Lines are now mint.
  - The "Ihr EINS-Team / Gespräch buchen" card in the sidebar was removed; "a tiny bit more space between left nav and the cards".
  - "Redesign and simplify the hover card completely and take references where possible and copy." Led to the two hover cards in DESIGN.md §6.
  - The card headlines were "literally not the same size and inconsistent". Now every title goes through `CARD_TITLE`.
  - Behandlungen got "the same process" as the Quellen.
  - "Hell no you picked the wrong format for Standorte pick a better fitting one": paired bars were wrong for a few Standorte, now share bars.
  - The line under the Quellen columns should be thicker, and the shadow should not cross it. Then: "the thick floor under the bard looks very ugly and unfitting". Now a 2 px line with the shadow clipped at it.
  - A tiny "?" icon to the left of Unbekannt, "JUST an icon not an explainer" (a first try put an explainer popover after the name).

- **2026-10-29, Anfragen round (first Praxis page after the dashboard)**:
  - The account button top right had a different corner radius than "literally every other button". Now `rounded` (10 px) like every button, on every page.
  - "The individual rows are different sizes depending on their attributes": the timing line appeared under some names only.
  - "There's an overwhelming amount of random info."
  - The buttons were "not clear enough positionally (meaning what they belong to)"; for the call-outcome switch "it wasn't even clear for me what it belonged to".
  - "You missed adding a bit of depth to the whole Anfragen tab": only the search field and the filter chips had it.
  - Cause, in Karam's words: Linear, Attio and Stripe were not looked at enough in the first pass, so the page had to be redone. Led to "Every element gets its own reference, not just the page" in `DESIGN.md`.
  - "I don't want confirmation when you click something on Ergebnis des Anrufs remove that step." One tap saves now.
  - "Size of cards is NOT allowed to change when the contents of the card change, buttons are also not allowed to shift." His example: the "Jetzt anrufen" card grew with the length of the message, so "Ergebnis des Anrufs" moved for every patient. "You always have to find a clean solution that doesn't make the whole … card change." Led to "Fixed size" in `DESIGN.md` section 10. The audit found the same on the dashboard: "Heute" collapsed six of eight cards to their empty sentence, and on the phone Quellen and Behandlungen changed height between periods.
  - "Test the edge cases as well": long names, long and missing messages, missing phone or e-mail, every quiz answer, an empty queue, the last page, a failed save.

- **2026-10-29, radius, buttons, account and Wiederbehandlungen round**:
  - "Radius has to be consistently the same, but in a way that corresponds to the ratio to the actual element size." Led to "Radius by size" in `DESIGN.md` §5.
  - "Button placement and size consistency is an issue in the top right. Fix it and maybe take references on how to solve this issue, copy." Led to "One control height".
  - "There's no way you think it's obvious that there is a profile setting in the top left." The account moved to the foot of the sidebar.
  - "Anfragen top right is placed awkwardly": the lone "Anfrage anlegen" button above the toolbar. It is now the last control of the toolbar.
  - "I also don't like that it is an actual switch to Wiederbehandlungen at the top it should be actually integrated into the page." Wiederbehandlungen is now a card of the Anfragen page.
  - The reminder settings are a one-time setup: "include it in Onboarding as well".

- **2026-10-29, Inhalte round (Medien and Beiträge)**:
  - "Don't simply pick one merged page but kind of merge them and create a new one." Led to `/inhalte`, named by Karam.
  - "Look at websites online that basically resemble the page … copy ui/ux quality of life features and conveniences, don't reinvent the wheel." Led to the Inhalte references above.
  - "My scrolling literally stops working when I scroll over some elements": `overscroll-behavior: contain` on every scroll well, ten places on Übersicht, Anfragen and Inhalte. Removed for the whole portal, see "A well never traps the page" in `DESIGN.md` §10.
  - A ZIP "Alle herunterladen": "Yeah let's do this."

- **2026-10-29, Dateien round (Dokumente and "Dateien an EINS")**:
  - The same ask as Inhalte, a new merged page rather than one of the two kept. Named "Dateien" by Karam.
  - "It is also such an option ui/ux improvement to be able to drag a file from your desktop and drop it off into An eins gesendet how did you not add this yourself? … look at convertio for example." Led to the upload references above; "not only uploads but downloads and everything useful" added the download names and the preview.
  - "The Dateien Senden at the top right should be inside the card not outside it." It is the control of the "An EINS gesendet" header.
  - "Why does pressing weiter and zurück take AGES": each page was a server render of the whole route. Led to "A view switch is instant" in `DESIGN.md` §10 and the portal-wide fix.
  - "I want the gesehen and Übermittelt to be a checkmark system kind of like whatsapp instead of just colored dots."

- **2026-10-29 and 2026-10-30, Bewertungen round** (branch dashboard-redesign, not committed or deployed):
  - Rebuild Plattformen, Patientenfeedback and the Rückmeldung with the dashboard building blocks, every link and action kept, every state measured at 390, 768, 1100 and 1440, "and every skeleton matches its real page exactly".
  - The "rechtssichere Antworten" intro "must be reworded plainly". Now: "Ersetzen Sie die markierten Stellen, bevor Sie antworten."
  - "Look at websites online that basically resemble the page … copy ui/ux quality of life features and conveniences, don't reinvent the wheel", naming Trustpilot. Led to the review-tool references above.
  - Boards approved on 2026-10-30 ("OK, write the docs").

- **2026-10-29 and 2026-10-30, Werbebudget round** (branch dashboard-redesign, not committed or deployed):
  - Rebuild only `/werbebudget` with the dashboard building blocks, "Simplify + cut, then take heavy inspiration from other references, websites, SAAS products etc and copy".
  - On the 30 Tage view, "Do you see the issue": the Plattformen and Kampagnen tables were not on one grid (an action column of 232 px pushed the figures 144 px left), and the cost line was squeezed into the few days with an Anfrage. Now the button sits on the name line, both tables share one set of columns, Klickrate is cut, and the cost line runs over the whole period as the cost so far.
  - "Why is the timeline switcher different from the one inside Übersicht what the hell": Werbebudget had kept the old page's 7, 30 and 90 Tage as links. Now it is the Übersicht's switch, the same markup and the same four periods.
  - "Yes, switch it": the cost per Anfrage became cost per qualifizierte Anfrage, the Übersicht's unit, on the whole page. The Kampagnen column came back once its query counted qualified Anfragen too.
  - Boards approved on 2026-10-30 ("Boards OK").

- **2026-10-30, Auffälligkeiten card**:
  - Asked for a light touch ("the card is already mostly good"). A round with a well for the steps, an evidence line, a link button and labelled snooze and hide buttons was rejected: "you overcomplicated the card so hard keep it way more minimal". Back to the plain row with two copy fixes. A small, simple element gets small changes.

## Before/after captures

`D:\Desktop\Claude\eins-dashboard-redesign\screenshots`:
- `audit1` is the state before the cleanup round, `final` is after it.
- `r3-before` and `r3-c` are before and after the Trichter and label round.
- `r4-a` to `r4-d` are the depth and motion round: frames mid-entrance and mid-switch, settled screens. `r4-pages` and `r4-pages-dark` show the other clinic pages on the new canvas.
- `r8-hover` and `r8-quellen` to `r12-paired` are the Quellen, Behandlungen and Standorte round: hover cards, the base line, paired and share bars at 1440 to 390.
- `p2-account` (account row and menu), `p2-wb-view` (the rejected view switch), `p2-wb-card` (Wiederbehandlungen as a card, 390 to 1440, hide and restore) and `p2-wb-fs` (fixed-size runs and skeleton against the real page) are the radius, account and Wiederbehandlungen round.
- `medien-beitraege/before` and `after` are the two old pages and the new Inhalte page with demo data; `peek` the conveniences (viewer, video moment, animation request) and `fixed` every measured state with many posts and files. `zip-test` holds the saved ZIPs and the button while it packs. Boards: `boards/inhalte-1440.jpg`, `inhalte-390.jpg`, `inhalte-extras-1440.jpg`, `inhalte-extras-390.jpg`.
- `dokumente-dateien/before` holds the two old pages, `after` the new Dateien page, `states` every measured state at 390, 768, 1100 and 1440 (`states-run.txt` has the numbers and the flow checks). Boards in `dokumente-dateien/boards/`: `dateien-1440.jpg` and `dateien-390.jpg` (before and after), then drop, send, error and preview, the empty halves, loading, and the phone panel.
- `bewertungen/before` holds the old Plattformen, Patientenfeedback and two Rückmeldungen (long text and note, redirect) at 390 and 1440; `after/states` every measured state at the four widths (`measurements.json`, logs `after/states-run2.log` and `states-run4.log`). Boards in `bewertungen/boards/`: `bewertungen-plattformen-`, `-feedback-` and `-detail-1440.jpg` / `-390.jpg` (before and after), `bewertungen-detail-weiterleitung.jpg`, and the states per view (`*-zustaende-390.jpg`, `*-zustaende-1440.jpg`).
- `werbebudget/before` holds the old page in every state at 390 and 1440; `after5` the final page in the twelve measured states at 390, 768, 1100 and 1440 (card boxes per state in `states-run1.log` to `states-run3.log`). `after2` to `after4` are the passes before the shared period switch and the qualified cost. Boards in `werbebudget/boards/`: `werbebudget-1440-` and `-390-full-first.jpg` / `-organic-first.jpg` (before and after), `werbebudget-switch-vs-uebersicht.jpg`, `werbebudget-qualifiziert.jpg`, `werbebudget-1440-references.jpg` and the states (`werbebudget-1440-states-1.jpg`, `-2.jpg`, the same for 390).
