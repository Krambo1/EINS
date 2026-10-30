# Portal UI rules (clinic portal and admin)

Read this before you change or add any page in `apps/portal`. The wording rules in the root `CLAUDE.md` (Sie, no em-dashes, Praxis) still apply on top.

## Copy from references: don't reinvent the wheel

Copying from proven products is very important. Triple Whale, Attio, Stripe and Linear have already worked out how numbers, charts, tables, hover cards and navigation look and behave, so we start from them instead of reinventing them. A new or changed element begins with a reference wherever one fits.

**Which product for what:**

| Need | Copy from |
|---|---|
| Clinic dashboard: pinned numbers, Kennzahl tiles, lines, line tooltips, the range switch, tiles as rows on the phone | Triple Whale |
| Charts: columns, bars, funnels, breakdowns, segmented bars, hover cards on a chart | Attio |
| Tables: rows with figures in fixed columns, legend rows under a chart, the total row, money columns | Stripe |
| Admin: navigation, Cmd+K, keyboard control, dense rows, quiet chrome | Linear |

If none of the four fits, another well-known product is worth a look before designing something new.

**How to copy a reference:**

1. **Name the question** the element answers ("which source brings the most Anfragen", "which Standort carries how much") and pick a reference that answers the same one, not just one that looks good. Grouped bars answer a ranking, so they did not fit the shares of two Standorte.
2. **Collect the reference** from public pages: marketing pages, help-center articles and their GIFs, docs, App Store screenshots. Save it with `curl`, or render the page in headless Chrome at 2x, into `D:\Desktop\Claude\eins-dashboard-redesign\references\<product>\`. From a GIF, save single frames.
3. **Note the source**: file name, URL and what it shows in a `SOURCES-<date>.md` table in the references folder (example: `SOURCES-2026-10-29.md`), and list the image under "Reference images" in `DESIGN-SOURCES.md`.
4. **Read the details off it** at full size: element order, sizes, spacing, line widths, radius, type weights, colours, what shows on hover and what is left out. Stripe: computed styles of the live page or the SVG markup. Triple Whale and Attio: measure the 2x images and sample the colours.
5. **Copy its structure and adapt the brand**: EINS mint and our colour tokens instead of their brand colour, our fonts, German wording, our layers (§5). Their logos, images and code stay theirs.
6. **Note what you leave out** (for example Triple Whale's blue and its icon rail), as `references/README.md` does.
7. **Compare side by side**: capture ours at 2x in a similar state, put it next to the reference (`tools/compare.py` builds boards) and close the differences that matter.
8. **Record it**: the rule and the file that builds it in this file, the reference per element in `DESIGN-SOURCES.md`.

Where no reference fits, design it yourself and mention that in the report.

**Every element gets its own reference, not just the page** (Karam, 2026-10-29, after `/anfragen` had to be rebuilt). A page is not "copied from Stripe" because its table is. Before writing code:

1. List every element of the page: each card, list, row type, button group, switch, hover card, empty and loading state.
2. Write the list down as a table in the round's `SOURCES-<date>.md`: element, product, image file, what is copied. Look at the image at full size for each row, not from memory.
3. Hold every element against its reference for these four, because they were missed in the first `/anfragen` round:
   - **Row height**: rows of one list are all the same height. A signal that only some rows have (an overdue warning, a due Wiedervorlage) becomes an icon in a fixed slot, with its text in a hover card, never an extra line (Linear's issue list and inbox, Stripe's tables).
   - **Facts per row**: a row shows its name and at most one meta line (Linear's inbox). Everything else waits in the hover card or on the detail page.
   - **Ownership of actions**: every button and switch sits inside the card or row of the one thing it acts on, labelled so a stranger knows what it changes (Linear's triage, Attio's record header). A control between two sections belongs to neither.
   - **Depth**: the layers in §5 apply to every control on the page, not only a few. Secondary buttons and set values are raised, tracks and table headers are pressed in.
4. An element with no reference in the four products is designed by hand only after looking, and the report says so.

The first `/anfragen` round copied only Stripe's toolbar and table and invented the call card. Every complaint that followed (rows of different heights, too much information, buttons that did not visibly belong to their patient, depth on only a few controls) was already solved in references nobody had held the page against.

## 1. Before you report UI work as done

- **Capture every state** with Playwright at `deviceScaleFactor: 2` and read each capture at full size, tile by tile. Shrunk overview boards do not count.
  - Desktop 1440 and phone 390. Admin also in dark; the Praxis side has no dark design.
  - Filled and empty data, every range ("Heute", "30 Tage", "12 Monate", "5 Jahre"), opened rows, the loading skeleton.
  - Admin: real data and the demo Praxis.
- **Check breakpoints**: any component that switches layout gets captured at 390, 768, 1100, 1280, 1440 and 1920.
- **Phone first**: look at 390 before desktop.
- **Motion**: full-page captures freeze every animation below the first screen at its start frame. Capture screen by screen while scrolling, plus frames in the middle of the entrance and of a period switch.
- **Charts**: capture a chart as an element about 1.5 s after scrolling to it. A capture taken while the bars still grow makes them look too short.
- **Switch speed**: measure the time from tap to new cards and count the server calls per switch. A switch to a preloaded period makes none.
- **Reference check**: new or changed elements were put next to their reference (Copy from references, step 7). Every element in the round's reference table has a board, and the four checks under "Every element gets its own reference" (row height, facts per row, ownership of actions, depth) pass.
- **Fixed size**: every card keeps its height and every button its place when the content changes (section 10, "Fixed size"). Run `fixed-size-dashboard.cjs` and `fixed-size-anfragen.cjs` and fix every DIFF.
- **Loop**: fix what you find, capture again, put before and after side by side.
- **Gates**: `npx tsc --noEmit -p apps/portal` and `next lint` clean.
- **Tools**: `D:\Desktop\Claude\eins-dashboard-redesign\tools`
  - `audit.cjs` (all dashboard states)
  - `depth.cjs` (`MODE=shots`: frames mid-entrance and settled screens, desktop and phone; `MODE=switch`: ms per switch, preload calls, frame bursts)
  - `verify-r5.cjs` (grouped lines and tooltips per period, card heights with a Quellen row open, footer lines, hover lift, stored dark theme ignored on the Praxis side)
  - `probe-shell.cjs`, `probe-shell-widths.cjs` (logo row and the page's first row on one line, nav level with the first card, every clinic page, 768 to 1920)
  - `probe-quellen.cjs` (Quellen heights closed and with each row open, Gesamt level with the link beside it, column hover card, phone)
  - `probe-titles.cjs` (every card title and Kennzahl label the same size and uncut, 390 to 1440)
  - `probe-hover.cjs` (hover cards on the Anfragen chart, a tile and the Quellen; pick a period with `?rLeads=mon|jahr`)
  - `probe-paired.cjs` (Behandlungen, Standorte and Quellen as element captures after the bars have grown, 1440 to 390, plus hovers at 1440)
  - `pages.cjs` (first screen of every clinic page; `DARK=1` stores dark first, which the Praxis side must ignore)
  - `card-widths.cjs` (one card at six widths)
  - `admin-demo.cjs` (admin with the demo Praxis)
  - `tiles.py` (full-size tiles)
  - `cap.cjs` (logs in with the seeded demo user)
  - `adm-login.cjs` (admin magic link from the dev log)
  - `flip.py` runs from the repo root; restore it with `flip.py off` in a shell `trap`.

## 2. Cut everything that does not change a decision

Ask of every element: would the owner decide anything differently without it? If not, delete it.

- **Delete on sight:**
  - greetings, dates and page subtitles
  - text that explains a control ("Zeitraum für alle Karten")
  - descriptions under card or panel titles
  - "0 …" lines, "– vs. Vormonat", and hints that show no data
  - flat all-zero sparklines, empty bar outlines, rows that are all 0
  - a digest card that repeats the panel below it
  - two tiles for the same number, two toggles for the same data
  - keyboard hints in the chrome
- **Missing value**: leave the figure out. Never show a lone "–" as a big number.
- **Empty card**: one sentence directly under the card title (`CardEmptyNote`). No centred floating text, no reserved height, no box in a box.

## 3. One grid

- **Clinic shell from md has no header bar** (Karam, 2026-10-29). The logo with the Praxis name at the top of the sidebar (`--shell-row`, 48 px) shares a line with the page's first row: the period switch on the Übersicht, the toolbar on Anfragen, the page title elsewhere. The nav starts below it, level with the first card. Notices that belong to every page (the Start-Checkliste reminder) go in the shell's `notice` slot above both columns, never inside the page. The phone keeps its header.
- **The account sits at the foot of the sidebar** (Claude.ai, ChatGPT, Vercel): one row with the avatar, the name, the role and an up-down chevron (`UserMenu`). The menu opens upward: e-mail and Praxis, Einstellungen, Abmelden. The phone drawer has the same row at its foot. Karam, 2026-10-29: the logo with the Praxis name and a chevron at the top left was not recognisable as the account; only a face and a name read as "you".
- **Sidebar**: logo row, nav, the Hilfe group and the account row pinned to the bottom. No contact card (the "Ihr EINS-Team" card was removed on 2026-10-29). Space between sidebar and cards: `gap-8`, `lg:gap-12`.
- **A page's one action sits at the right end of its first row.** Where the page has a toolbar (search, filters, sort), that toolbar is the first row and the action is its last control (Attio, Notion): on Anfragen "Anfrage anlegen" after the sort, the title only for screen readers. A lone button above the toolbar reads as belonging to nothing (Karam, 2026-10-29: "placed awkwardly"). On the phone the title row stays, with the button beside the title.
- **Page rows**: full width, halves (`lg:grid-cols-2`) or thirds (`lg:grid-cols-3`). Column edges line up from row to row.
- **Gaps**:
  - Clinic: `gap-4` on the phone, `md:gap-6` from md. Card padding 20 px on the phone, 24 px from md (`DashCard`).
  - Admin: `gap-4`. Panel padding `px-4`.
- **Inner grids land on the page grid.**
  - A 4-column chart in a full-width clinic card uses `gap-6`. The gap between columns 2 and 3 then sits under the gutter between the two half-width cards above.
  - Admin: a full-width panel with a thirds layout inside uses `lg:gap-x-12`, so its text lines up with the thirds panels above.
- **Figures under chart columns** use the same grid. Example: the Trichter footer at xl is `grid-cols-4 gap-6 px-6` and each figure is `col-span-2`.
- **Same-row numbers start at the same height.** Give label rows a fixed height (`h-5 leading-5`), so an info icon cannot push its number down.
- **Screen-reader headings** (`sr-only`) go outside a `space-y-*` stack.
- **Phone**: 16 px side gutter, 16 px between blocks, no horizontal scroll at 375 px.

## 4. Visual hierarchy and weight

Weight follows importance. A label that names a number is important and reads at a glance.

| Role | Classes |
|---|---|
| Primary number (one per page) | `font-display text-[2.5rem] md:text-[3rem] font-semibold leading-none tracking-tight tabular-nums` |
| Tile number | `text-[1.75rem] md:text-[2rem] font-semibold` |
| Chart step count (Trichter column) | `text-[1.75rem] font-semibold` |
| Supporting figure, row count, Trichter row | `text-2xl font-semibold` |
| Card title (h2), Kennzahl label | clinic `CARD_TITLE` (`text-base font-semibold leading-5`, `dashboard/_components/dash-ui.tsx`), admin `text-[15px] font-semibold` |
| Metric label, subsection heading | clinic `text-[15px] font-medium text-fg-primary`, admin `text-sm font-medium text-fg-primary` |
| Row name (person, source, Praxis, platform) | `text-[15px] font-medium text-fg-primary` |
| Table cell | `text-[15px] text-fg-primary`, zeros and "–" (no activity in the period) `text-fg-tertiary` |
| Meta line, context sentence | `text-sm text-fg-secondary` |
| Table column header | `text-sm text-fg-secondary` |
| Change vs. period before | `text-sm font-medium` + arrow icon, `text-tone-good` / `text-tone-bad` |

- **One title size**: every clinic card title and Kennzahl label goes through `CARD_TITLE`. Never size a title locally.
- **Long labels in narrow tiles** get a `shortLabel` ("Gewonnen" for "Behandlungen gewonnen"), switched by a container query (`.kpi-tile` in `globals.css`, 12rem, measured on the content box). Never cut a label.
- **Never cut data to fit**: no name or figure is shown cut off or ending in "…". Names wrap; a chart whose labels do not fit steps aside; a table shows fewer columns at the call site.
- **Labels**: never a metric label in `text-fg-secondary` regular, never below 14 px.
- **Minimum size**: nothing informational below `text-sm` on the clinic side. Admin may use 13 px for deltas and chips, never for labels.
- **No weight inversion**: a supporting figure is never bigger than the figure the card is about. In the Trichter, step counts are 28 px and footer figures are 24 px.
- **Share lines**: in "25 % der Anfragen" the share is `font-medium text-fg-primary` and the reference stays `text-fg-secondary`.
- **Body copy** is never `text-fg-secondary`.
- **Numbers**: every number gets `tabular-nums`.

## 5. Layers, containers, colour, radius

- **Layers, back to front** (clinic shell; tokens and classes in `src/app/globals.css`):
  1. **Canvas** `--surface-canvas`: the grey floor.
  2. **Card** `--surface-tile` + `elev-card`: stands on the canvas with a soft shadow.
  3. **Raised** `--surface-raised` + `elev-raised`: whatever is on right now, such as the active nav entry and the range marker.
  4. **Inset** `--surface-inset` + `elev-inset`: tracks pressed into the canvas, such as the range switch.
  5. **Data**: `bar-solid` bars sit on the card, lit from above; `bar-light` is the lighter partner bar of a pair. The drop-off tint behind them (`bar-ghost`) is pressed in.
  6. **Well** `--well` + `elev-inset`: an area pressed into a card, such as the money figures of an opened Quelle or an empty share bar.
  7. **Popover** `--elev-popover` (class `elev-popover`): hover cards, menus and dialogs, a 1 px ring, a close contact shadow and a wide soft drop, above everything else. Never `shadow-[var(--…)]`: Tailwind reads a `var()` there as a shadow colour and draws no shadow (the hover cards had none until 2026-10-30).
- **Card**: `elev-card rounded-[var(--r-card)] bg-[var(--surface-tile)]`, no border (the shadow carries its own 1 px ring). `DashCard` already has it. Never add a border or a tint on top.
- **Hover**: every card answers the pointer with a deeper shadow (`lift`, `--elev-card-hover`), the same way on every card, whether it is a link or not. The card stays where it is, it never moves up (Karam, 2026-10-30). Only where the pointer can hover; keyboard focus on a link inside does the same. Rows and nav entries get `--hover-wash`. Nothing moves on hover.
- **Cards side by side keep their height.** A card with rows that open keeps room for one open row from lg (an invisible copy of the open panel), so opening a row never resizes it or the card beside it. Footer lines ("Gesamt", "N weitere offene Anfragen") sit at the bottom of their card (`mt-auto` in a flex column) on the same line as the footer beside them; match the bottom padding so they line up.
- **Blur** only on sticky chrome (the phone header, the phone range band), so content scrolling under it stays readable. Never on cards.
- **Admin** keeps its white canvas and bordered panels. The other clinic pages still have bordered cards; they read fine on the canvas and move to `elev-card` only when they are restyled.
- **No nesting**: no card inside a card, no card around a single number. Media tiles (the Inhalte card on the Übersicht) and the post preview in "Zur Freigabe" are raised tiles, not cards: `elev-raised`, never `elev-card`. The Kennzahlen block is one panel with hairlines between cells (`gap-px bg-border`).
- **Separation: hairlines and depth** (Karam, 2026-10-30, after the Inhalte card and "Zur Freigabe": it gave good results). The parts of a card are told apart by clean 1 px lines (`border-border`) and by their layer, never by extra space or a tint alone. Apply it to every card that is built or restyled:
  - **Sections inside a card or tile** (picture, title with status, figures, the decision): a hairline between each, running the full width of the section.
  - **Details lists** (label left, value right): a hairline above, below and between the rows (`DETAIL_LINES` in `inhalte/_components/parts.tsx`; Stripe's details panel). No `gap-y` spacing instead of the lines.
  - **Lists and tables**: `divide-y divide-border` between the rows, the head band above.
  - **Objects that stand for one thing in a group** (a post tile, a post preview): raised (`elev-raised` on `--surface-raised`), the picture flush on top with a hairline under it, a deeper shadow on hover (`--elev-card-hover`), nothing moves. Places where something is read or written at length (text wells, change fields, tracks) are pressed in (`elev-inset` on `--well`). Raised and pressed-in parts side by side give the card its depth.
  - **Lines run level**: tiles side by side get fixed section heights, so their hairlines line up across the row (the Inhalte tiles).
  - Lines that are added take room: re-measure the card and raise its fixed height so wells and lists keep their size (section 10, "Fixed size").
- **Radius by size** (Karam, 2026-10-29: "consistently the same, but in a way that corresponds to the ratio to the actual element size"). The radius follows the element's height, one token per size band (Material 3 shape scale; Apple's concentric corners: an element inside another gets the smaller step). Tokens in `globals.css`:

  | Token | Radius | Height | For |
  |---|---|---|---|
  | `--r-mark` | 3 px | up to 12 px | legend squares |
  | `--r-small` | 6 px | 13 to 31 px | badges, value chips, sub-entries, thin bars, skeleton text |
  | `--r-control` | 8 px | 32 to 63 px | buttons, inputs, chips, nav entries, one-line rows, bars |
  | `--r-panel` | 12 px | 64 to 159 px | two-line rows, wells, banners, hover cards, tracks, menus |
  | `--r-card` | 20 px | 160 px and up | cards, wide funnel bars |

  Write `rounded-[var(--r-…)]`, never `rounded`, `rounded-md` or a pixel value on the Praxis side.
- **One control height**: every button, input, chip and switch is `--control-h` high (44 px on the phone, 40 px from sm), through `CONTROL` in `dash-ui.tsx` (`CONTROL_SQUARE` for icon buttons, `QUIET_CONTROL` for text links that act like buttons, `RAISED_CONTROL` for the raised look). A track around controls is `--track-h`. Buttons in the same place on different pages have the same height, width and position.
- **Brand mint** (`--accent`) only for data marks and the logo. No accent on nav icons, no glow, no sparkles icon for KI. The only gradients are one-hue shading: bars lighter at the top (`LIT_FROM_ABOVE` over a category colour), lines from `--line-top` to `--line-bottom`.
- **Status**: a coloured dot plus plain dark text. Changes are coloured text with an arrow. No pills, no filled badges.
- **Categories**: every category gets its own colour (Quellen: `SOURCE_COLORS`; Standorte: `SHARE_COLORS` in `ShareBreakdown.tsx`). Two categories never share a hue or a grey; "Unbekannt" and "Ohne Standort" are the light grey.
- **Source icons**: every source shows a logo or icon before its name (`withBrandLogos`). "Unbekannt" gets a plain "?" icon (`CircleHelp`, 1em, like the pencil of "Manueller Eintrag"). It is only an icon: no popover, no explanation.
- **Tints**: `bg-accent/20` does not work on the hex tokens. Use `bg-[color-mix(in_srgb,var(--accent)_22%,transparent)]`.
- **Dark mode**: admin only. The Praxis side is always light: no toggle, and `app/layout.tsx` applies a stored dark theme on the admin host only. Do not add dark styles to Praxis pages. Check admin changes in dark too.

## 6. Charts

- **Colour**: one hue per chart. The period before is a light tint or a dashed line, drawn once, on the primary chart only.
- **Grid**: dashed horizontal gridlines only, no vertical lines, small grey axis labels.
- **Sparklines**: a plain line with no fill and no axes. Hide it when every value is 0.
- **Kennzahl lines** follow Triple Whale in EINS mint: straight segments, 2 px, from `--line-top` to `--line-bottom` (`LINE_STYLE` in `KpiTiles.tsx`). The period before is a dotted grey line.
- **Pick the chart by the question**:
  - ranking many categories: columns (Quellen)
  - two figures per category: paired bars (Behandlungen)
  - shares of a few parts: share bars (Standorte). Never grouped bars for two to five parts.
- **Base line**: a 2 px straight line (`ChartFloor` in `dashboard/_components/hover-card.tsx`). Column shadows are clipped at the base (`COLUMN_CLIP`), so no shadow crosses it. No thick floor.
- **Hover cards** are copied from the references, not invented:
  - On a line (Triple Whale's tile tooltip): `TrendChart tooltip="compact"`. A small white card beside the point, never over the headline number: a 3 px mark in the line colour, the short date, the value in bold. It flips to the left of the point when the right side is too narrow.
  - On a column, a group or a share piece (Attio's history card): `HoverCardBody` in `hover-card.tsx`. The title, a 3 px bar in the category colour, then label and value pairs with the values in small grey chips. Card class `HOVER_CARD`.
  - On an (i) explainer (Attio's hover card, Karam 2026-10-30: the old mint-titled bubble did not fit the portal): `ExplainerPopover` from `(portal)/_components/ExplainerPopover.tsx`, never the one in `@eins/ui` (admin keeps that). A 288 px card in the popover layer (`--elev-popover`, no border, `--r-panel`), the term in `text-sm font-semibold`, the explanation in `text-sm` dark text, no mint. The open (i) is raised (`--elev-raised`). A tap opens it and a tap outside closes it: the old toggle shut it again on the same tap, so it never showed on the phone.
- **Points per period** (`rangeSeries`, `rangeRatioSeries`, `rangeTickFormat` in `lib/chart-data.ts`):
  - Heute and 30 Tage: one point per day.
  - 12 Monate: one point per week (52). 5 Jahre: one point per month (60). Daily points over a year are mostly 0 and draw spikes.
  - Steps are counted back from today, so the last point is always a full week or month and the line never dips at its end. The period before is cut the same way and lines up point for point.
  - The tooltip names the days a point covers ("4.–10. Sept. 2026"). 5 Jahre ticks show month and year.
  - Ratios such as Werbeertrag divide the sums of a step, never average daily ratios.
- **Funnels** follow Attio's "Funnel steps"; the built example is `FunnelOverviewCard` in `dashboard/_components/DashboardDetailBundle.tsx`.
  - One solid bar per step, sized against the first step. No grey track behind it.
  - Behind each bar, a pressed-in tint (`bar-ghost`) up to the size of the step before it, so the drop-off is visible.
  - Each step shows its label, its count and "X % der <Stufe davor>".
  - Columns where every label fits on one line (xl), horizontal bars stacked as rows below that.
  - The bar ends square where the tint continues and is rounded where it doesn't.
- **Counts per category** (Quellen) follow Attio's bar chart grouped by a category, with Stripe's legend rows under it. Built in `dashboard/_components/BreakdownStackChart.tsx`.
  - One column per source, largest first, each in its own colour (`SOURCE_COLORS` in `DashboardTopMetricsEnhanced.tsx`; Meta-Anzeige blue, Google-Anzeige the mint (Karam, 2026-10-30), Unbekannt the light grey). Rounded top corners, lit from above, the count above it, the top and middle of the scale as dashed lines, the 2 px base line. No axis labels.
  - Under it one row per source: colour square, name, then the figures in fixed columns (Anfragen, Gewonnen, Werbebudget; on the phone only Anfragen, the rest in a line under the name). A Gesamt row like Stripe's total row closes the list.
  - Column and row belong together: hovering either marks both and dims the other columns; the column floats a hover card with every figure of that source.
  - An opened source shows its money figures in a well.
- **Behandlungen** follow Attio's paired bars ("lead channel distribution") over the same rows. Built in `dashboard/_components/PairedBreakdown.tsx`.
  - Per Behandlung a light Anfragen bar (`bar-light`) beside a solid Gewonnen bar (`bar-solid`), counts on top, legend squares above.
  - The chart only from lg, and only while every name fits under its group in full (measured in `PairedColumns`); otherwise only the rows.
  - Rows (`BreakdownTable`): Anfragen, Gewonnen, Umsatz, Werbeertrag, then a Gesamt row. On the phone Gewonnen and Umsatz keep their columns, the rest goes in a line under the name. A Behandlung with no activity in the period keeps its row with "–".
- **Standorte** follow Attio's segmented bars, laid on their side. Built in `dashboard/_components/ShareBreakdown.tsx`.
  - One bar each for Anfragen, Termine, Gewonnen and Umsatz, split into the Standorte's pieces in their colours. A hovered piece shows the Standort's figures and its share of that bar.
  - The same rows as Behandlungen, with a colour square before each name.
- **Admin charts** follow Attio: rounded bar tops, the tooltip a white card.

## 7. Motion

All motion is CSS in `src/app/globals.css`. It starts with the first paint, is short and eases out (`--ease-out`).

**Motion never keeps a number from being read.** Everything settles within about half a second: cards 320 ms, bars 520 ms, lines 650 ms, digits 500 ms, changes between periods 450 ms. Longer or later motion was rejected for hiding the information.

- **Entrance**:
  - `anim-rise`: a card rises 10 px and fades in, once.
  - `anim-bar-y` / `anim-bar-x`: a bar grows from its baseline.
  - `anim-ghost`: the drop-off tint fades in after its bar.
  - `anim-wipe`: lines and share bars draw from left to right.
  - `RollingNumber` (`dashboard/_components/dash-ui.tsx`): digits roll into place. Screen readers get the plain value.
- **Stagger** with `--delay` on the element (`[--delay:60ms]`): steps of 20-60 ms, nothing starts later than about 250 ms. Lines and share bars start with their card, without a delay.
- **Period change**: nothing remounts. The same elements get new values, so digits roll and bars ease to the new size. Keep the element structure the same in every period. A line gets a `key` that changes with its data, so it draws again (`chartKey` in `KpiTiles.tsx`).
- **Reduced motion**: `@eins/ui` switches every animation and transition off. Motion never carries information on its own.
- **Never**: bounce, overshoot, parallax, loops, anything that moves on hover (the card's hover is its shadow only).

## 8. Numbers and wording on screen

- **Formatting**: German everywhere, through `lib/formatting.ts`: `formatEuro`, `formatMoney`, `formatNumber`, `formatPercent`, `formatRoas` ("6,1×"). Never print `toFixed()` output with a dot.
- **Ranges**: labels say what they cover: "30 Tage", "12 Monate", "5 Jahre", never "Monat / Jahr / Max". A tile anchored to the calendar month says "(Monat)".
- **Ages**: hours under 48 h, then "N Tage".

## 9. Patterns per surface

- **Clinic dashboard** (the owner, mostly on the phone):
  - One sticky range switch for every card.
  - The Kennzahlen block comes first: Anfragen as the primary number with a full chart, then a 2 × 2 block of the next four numbers. The two sit side by side from xl and stack below it, where a half-width tile is too narrow.
  - On the phone, tiles become rows: label and number left, sparkline right.
  - Order: Kennzahlen, then Offene Anfragen beside Quellen, then alerts, then the detail bundle (Inhalte first, then Trichter, Behandlungen, Reputation, Standorte), and nothing below it. Inhalte heads the bundle, so its place never depends on whether there are alerts (Karam, 2026-10-30: not beside Auffälligkeiten, which are often absent).
  - **Every card title leads to its page** (Karam, 2026-10-30): the title word is the link (`TitleLink` in `dash-ui.tsx`, DashCard's and KpiTile's `href`), with a chevron after it, underlined on hover, nothing moves. No "Alle … ansehen" line or header link beside it. Anfragen → `/anfragen`, Termine → `?status=termin_vereinbart`, Behandlungen gewonnen and Umsatz → `?status=gewonnen`, Werbeertrag → `/werbebudget`, Offene Anfragen → `?status=neu`, Quellen, Trichter, Behandlungen and Standorte → `/anfragen`, Inhalte → `/inhalte`, Reputation → `/bewertungen`. Auffälligkeiten has no page and no link.
  - **Auffälligkeiten** (`AlertsCard.tsx`; Karam, 2026-10-30: "keep it way more minimal"): absent when nothing is unusual. One plain row per alert: dot, headline, X to hide, "Nächste Schritte" as a bullet list, then a hairline and "In 7 Tagen erinnern" (Karam: "a bit more clean separation"). No wells, extra text lines or buttons; a round that added them was rejected as overcomplicated.
  - **Inhalte** (`InhalteCard.tsx`, sources in `SOURCES-2026-10-30.md`): the posts of the Quellen period that were online or brought an Anfrage, most Anfragen first, four fixed slots. From xl four raised tiles (`elev-raised` on `--surface-raised`, deeper shadow on hover, Triple Whale creative tiles and Frame.io cards): the picture flush on top with the format chip, then hairlines between picture, title with status, and the Anfragen and Gewonnen rows; the sections have fixed heights so the lines run level across the tiles (Karam, 2026-10-30: clear lines between the parts, with depth); from lg a table under the head band (Beitrag, Anfragen, Gewonnen); below lg a list with the number and its word on the right. Free slots take the posts waiting for the Freigabe (status "Wartet auf Freigabe", "Ansehen und freigeben" in place of the numbers, opens that post in the Freigabe card); waiting posts without a slot show as "N weitere warten auf Freigabe" right of the title. No total and no foot link (Karam, 2026-10-30).
  - **Period switch is instant** (`dashboard/_components/RangeViews.tsx`):
    - The page renders the period in the URL. The server action `loadDashboardRange` (`dashboard/range-actions.tsx`) renders every other period, and the client keeps one view per period.
    - After load, the other periods load one by one while the browser is idle: 30 Tage, 12 Monate, Heute, 5 Jahre.
    - A switch only rewrites the URL (`history.replaceState`): no navigation, no scroll jump.
    - A view older than 2 minutes still shows at once and refreshes behind it. Returning to the tab refreshes stale periods.
    - A failed load falls back to a normal navigation (`router.replace`).
    - A new period-dependent card goes into the loaders in `dashboard/_components/loaders.tsx`, so it lands in a `RangeSlot` and is kept too.
    - Do not rely on `router.prefetch`: it does nothing in dev.
- **Anfragen**:
  - First row: the toolbar. Search and filter chips on the left, sort and "Anfrage anlegen" at the right end, one row from xl; between md and xl the chips take a second row.
  - Then "Jetzt anrufen" and "Als Nächstes", then the list.
  - **Wiederbehandlungen have no card of their own** (Karam, 2026-10-29: mix them into the calls, give them a tag). Where each part of the old card lives now:
    - **Due patients are calls.** `mergeCallItems` (`anfragen/_lib/call-items.ts`) puts them into "Jetzt anrufen" and "Als Nächstes": first Anfragen without a contact attempt or with a due Wiedervorlage, then Wiederbehandlungen not called yet, then the other Anfragen, then Wiederbehandlungen not reached. While one is due it always holds the last place, so a day full of new Anfragen cannot bury them. A patient whose Anfrage is still worked (Neu, Kontaktiert, Nicht erreicht, Termin vereinbart) is called as that Anfrage, not twice: the rebuild ties a cycle to the patient's latest Anfrage, so a treated patient who writes again has it on the new one. That Anfrage's call card names the Wiederbehandlung on the first line of its well (tag plus "Botox: Seit 29 Tagen fällig").
    - **The call card is the Anfrage card part for part** (`RetreatmentCallCard`): same height, same buttons in the same place. Rows: Status (tag), Fällig, Behandlung, Telefon, Zuletzt (date and what was paid). The well: Erinnerung, Letzter Anruf, the message of the old Anfrage.
    - **Its own result**: Termin vereinbart (out of the calls for 21 days, until the PVS sends the date), Nicht erreicht (behind everyone not called yet), Kein Interesse (hidden, toast with "Rückgängig" that puts the patient back in the same place). Each call is a note on the old Anfrage, never a call on it: it would count as the first contact of that Anfrage.
    - **In "Alle Anfragen"** the Anfrage the patient came with shows the tag "Wiederbehandlung" (dot: orange due, green Termin, grey within 90 days) in place of its status; the full sentence is the tooltip. An Anfrage still worked keeps its own status. Filter: Status → "Wiederbehandlung fällig oder bald" (`?wb=offen`, due now or within 90 days; here every row shows the tag, the Anfrage's status is in its tooltip) and "Wiederbehandlung ausgeblendet" (`?wb=ausgeblendet`).
    - **On the Anfrage** a "Wiederbehandlung" card lists every cycle with when it is due, what was paid, the reminder and the last call, with "Ausblenden" / "Wieder aufnehmen" (fixed width, undo in the toast).
    - **On the Übersicht a tag in "Offene Anfragen"** (Karam, 2026-10-30: no Wiederbehandlungen card, no extra line, mix it into the open Anfragen like on Anfragen; the tag is an addition and never replaces the date). The tag follows the Behandlung in a row's second line, ("Botox ● Wiederbehandlung"), cut to "Wiederbeh." only where the line has no room for the full word next to the Behandlung (`RetreatmentFitTag` measures it), with the amber dot in that line's weight and grey (bold, it cut the Behandlung on a phone); the full sentence is its tooltip. Every row keeps its date on the right. A listed open Anfrage whose patient is due gets the tag on its own row (`retreatmentTagsForRequests`, due state only). The first due patient without an open Anfrage (`retreatmentCallQueue`, limit 1) gets a row of their own, dated by when it fell due, in the same red as the overdue Anfragen (it is overdue by definition). That row takes the third row, the last one on the phone, so new Anfragen cannot push it out of sight; one Anfrage fewer is listed and "N weitere offene Anfragen" counts on. The header number stays the open Anfragen. The forecast and reminder figures (due in 90 days, reminded, back after a reminder) are not shown anywhere.
    - `/wiederbehandlungen` redirects to `/anfragen?wb=offen`.
  - The reminder settings are set up once, in Einstellungen (`#wiederbehandlungen`) and as an onboarding step, not on the Anfragen page.
- **Inhalte** (`/inhalte`; Karam, 2026-10-29: Medien and Beiträge merged into one new page, not one of the two kept):
  - Two cards in the order the Praxis needs them: "Zur Freigabe", "Alle Beiträge". `/beitraege` redirects to `/inhalte`, `/medien` to `/inhalte#beitraege`. Fixed heights per breakpoint in `inhalte/_components/parts.tsx`, shared with `inhalte/loading.tsx`.
  - **No Medien card** (Karam, 2026-10-30: "one card"). Every file belongs to a post (the only upload creates it with the post, `createContentItem`), so the Medien card listed each post's file a second time and gave the post no download. The file now sits in its post's row. The animation templates left the Praxis' view with it: EINS uses them inside posts, "Anpassung anfordern" is gone (`animation_instances` and the admin side stay).
  - **Zur Freigabe**, one waiting post at a time:
    - The post as the patient sees it: the Praxis name and logo above the file (Planable's feed preview), then its facts, its text and the decision at the foot.
    - "Freigeben" and "Änderung wünschen" become "Änderung senden" and "Abbrechen" in the same two slots.
    - "N von M" with ‹ › pages through the waiting posts (`?beitrag=`).
    - The Frist row says what happens when it passes: "Ohne Ihre Freigabe geht der Beitrag nicht online."
    - On a video, change mode offers "Stelle 0:12 einfügen": it pauses the video and writes "Bei 0:12: " at the cursor (Frame.io).
    - The toast after a decision says what is left ("Noch 2 Beiträge warten.", Planable). No undo: the first decision counts.
  - **Alle Beiträge** (`PostsCard`, `#beitraege`): one row per post: the post's picture (48 px, square on the phone, wide from lg like the Übersicht's Inhalte table; a post without a file shows its format icon, greyed), then status dot and text, Seit, Anfragen. Rows are 72 px at every width.
    - The picture opens the viewer (`MediaViewer`: back, next, arrow keys, download; Drive, Frame.io), which pages through the files of every post.
    - A row opens a well (`RowWell`) with the file (Art, Größe, Fassung; "Noch keine Datei" keeps the row), who decided and when, the change asked for, the reason for a stop, the Anfragen by channel, where it is online and the text. Its foot: "Ansehen", "Herunterladen" (a square on the phone) and, on a waiting post, "In der Freigabe öffnen" ("Zur Freigabe" on the phone), so three fit one line at 390.
    - An open row is marked whole, picture included.
    - "Herunterladen" saves under the post's title (`downloadName`, Content-Disposition, as on Dateien).
  - **Alle herunterladen** (Alle Beiträge header, top right): the file of every listed post (drafts left out, a file two posts share once, named after the post). Without any file the button keeps its place, unseen.
    - `/api/inhalte/medien` only lists the files with signed links (6 h). The browser reads them straight from storage and packs the ZIP (`inhalte/_lib/zip.ts`, fflate, stored without compression).
    - Parts of 1 GB, as Drive splits big downloads; a file over 1 GB is saved alone. The label counts up in place ("Wird gepackt: 42 %"), leaving the page asks first.
    - Never send file bytes through a Vercel function: its time limit (300 s) cuts a slow multi-GB download half way.
    - In production it needs the R2 CORS rule with `GET` (head of `server/storage.ts`), the same rule uploads need.
  - Left out on purpose: approving several posts at once (one card at a time), favourites (needs the database), copying a link (the KI-Klon stays private).
- **Dateien** (`/dateien`; Karam, 2026-10-29: Dokumente and "Dateien an EINS" merged into one new page, `/dokumente` redirects and keeps `?kind=`):
  - Two cards, one per direction: "Von EINS" (Anleitung, Checkliste, Verträge, Auswertungen, Leitfäden) and "An EINS gesendet". Side by side from xl at one height, stacked below, "Von EINS" first. The title row has no action: each card carries its controls at the right end of its own header: "Alle herunterladen" and the Art filter (as wide as the longest Art label there is, whichever kinds the Praxis has) on "Von EINS", "Dateien senden" ("Senden" on the phone) on "An EINS gesendet".
  - **Frame** (`dateien/_components/file-ui.tsx`, shared with `loading.tsx`): six row slots per card (88 px rows below lg, where names take two lines; 68 px from lg), a reserved foot for "Zurück"/"Weiter", six files per page. Rows: type icon, name (wraps, never cut), one meta line, one square action. Meta facts are joined by dots that never start or end a line (`MetaFacts`).
  - **Paging and the Art filter switch in the browser** (`FileList.tsx`, see "A view switch is instant"): `?von=2`, `?an=3`, `?kind=vertrag`.
  - **Status of a sent file** (`SeenStatus`, Karam: "a checkmark system kind of like whatsapp"): two grey ticks and "Übermittelt" once it arrived at EINS, the same two in `accent-pressed` and "Gesehen" once EINS opened it; hovering shows when. Never one tick: a file in the list has already arrived. The word stays beside the ticks, so colour is never the only signal.
  - **Sending** (`SendFiles.tsx`): files dragged anywhere onto the page, a dragged folder, or a pasted image or file open the send panel with them. While a drag is over the window, "An EINS gesendet" shows "Zum Senden loslassen" over its frame, and the browser never opens a dropped file in the tab.
    - The panel keeps one height: thumbnails for pictures, the total of the selection in the well's foot, "Senden" shows the batch's percent at the same width.
    - The X cancels a running upload and hands focus to the X now in its place, or to "Dateien auswählen" once the list is empty.
    - More than 20 files go in rounds of 20; the browser asks before the tab closes mid-upload.
    - All rejections of one drop come in one toast; the same file twice (name, size and time) is taken once.
    - After sending, the card goes to its first page and the new rows light up once (`anim-fresh`).
  - **Opening and saving**: "Herunterladen" saves under the real name ("Hauptvertrag EINS.pdf") through `storage.urlFor(key, { downloadName })` (Content-Disposition, also on presigned R2 links, where the `download` attribute does nothing). A click on a picture or video name opens the preview (`FilePreview.tsx`: download, new tab, ←/→); PDFs and other files open in a new tab, because the portal's frame headers forbid showing them in a frame. Files from EINS added in the last 7 days carry a dot and "Neu".
  - **"Alle herunterladen"** (`DownloadAllFiles.tsx`, Karam, 2026-10-30): one ZIP of every file of the chosen Art on all pages, plus Anleitung and Checkliste under "Alle Arten"; the ZIP is named after the Art, the Praxis and the day ("Verträge Praxis Dr. Demo 30.10.2026.zip"). Each file keeps the name its own "Herunterladen" saves (`documentFileName` in `dateien/_lib/von-eins.ts`). Packed in the browser like Inhalte (`inhalte/_lib/zip.ts`, imported, never copied), with fresh links from `listVonEinsFilesAction`; the bytes never pass through a server function. A square with the folder icon while the card is narrower than 31rem (a container query, so it follows the card, not the window), the words above; while packing the same box shows the percent, then a toast. A file that does not load (gone from storage, a dropped connection) is left out instead of losing the whole ZIP: the rest is saved and the toast names what is missing ("ZIP-Datei gespeichert, 3 Dateien fehlen"); only when nothing loads is nothing saved.
  - Delete is one tap with a toast, no confirmation.
- **Bewertungen** (`/bewertungen`, tabs Plattformen and Patientenfeedback; Karam, 2026-10-30; branch dashboard-redesign, not committed or deployed). Sizes in `bewertungen/_lib/sizes.ts`, shared with the three `loading.tsx`:
  - **Plattformen** (`bewertungen/(plattformen)`): first row "Neues Feedback" (three two-line slots, "Alle ansehen" opens the Neu view) and one tile per platform, one height. A tile is a Kennzahl tile: rating, count and Stand, then "+24 seit 09.07.2026" (new reviews since the stand before; "Keine neuen seit …", or "Vergleich ab dem nächsten Stand" with one stand), the line scaled to its values, "Profil öffnen" and "Antworten". Header action "Link kopieren": the write-a-review link to hand to patients (Google Business Profile, Trustpilot); the toast says to give it to every patient, never only the satisfied ones (that is review gating), and to offer nothing in return; "Link hinterlegen" to Einstellungen without a stored link.
  - **Antwortvorlagen**: one switch 4-5 / 3 / 1-2 Sterne, three fixed slots, each text in a well. The Praxis name is filled in (`fillTemplate`, never "Praxis Praxis"), every placeholder still to replace is marked. Intro: "Ersetzen Sie die markierten Stellen, bevor Sie antworten." Never promise "rechtssichere" answers.
  - **Verlauf**: six row slots, a "Neu" column against the stand before of the same platform (from sm), "CSV laden" builds the file in the browser (semicolons, decimal commas, BOM).
  - **Patientenfeedback** (`feedback/(liste)`): search (name, e-mail, text), star filter, views Offen (Neu and Gesehen, the default), Neu, Gesehen, Beantwortet, Geschlossen, Alle with counts; ten 64 px row slots, the pager in the foot. Rows: signal slot (phone for Rückruf, platform logo for a redirect), name bold while new, age; then status, stars, "Mit Text". Switches in the browser below the 200-row cap, the server filters and counts at it (§10).
  - **Rückmeldung** (`feedback/[id]`): the record (Attio) first on the phone, from xl the column on the right (22rem): name (three lines, then it scrolls), stars, one main action ("Per E-Mail antworten" with a written greeting, only with consent and an address; "Bei Google ansehen" or "Bei Jameda ansehen" for a redirect; else one sentence why not), then the rows Status, Erledigt (when and by whom, always two lines), Eingang, Anlass, E-Mail (copy only with consent), Rückruf, Weg. Beside it the text in a well and "Bearbeiten": the status as a pressed switch (one tap saves, toast with "Rückgängig"), the internal note with "Vorlage einfügen" at the cursor (the group matching the stars first), Strg+Enter saves, "Nicht gespeichert" until it is.
  - ‹ › with "N von M" and the keys ←/→ page through the list view the person came from: `?status`, `?sterne` and `?suche` travel to the Rückmeldung and back.
  - Left out: a QR code of the review link (Karam, 2026-10-30: not needed; the review e-mails and "Link kopieren" cover it, a desk sign the Praxis can make itself).
- **Werbebudget** (`/werbebudget`; Karam, 2026-10-29 and 2026-10-30; branch dashboard-redesign, not committed or deployed). Sizes in `werbebudget/_lib/werbebudget.ts`, shared with `loading.tsx`:
  - **First row from lg**: the Übersicht's period switch (`WerbebudgetRangeSwitch`, the same markup and the same four periods, `?zeitraum=`) with "Werbekonten verbinden" or "verwalten" at its right end, one width in every state. Below lg the four periods and the button do not fit on one line, so the title row stays with the button beside it and the switch goes under it. The switch is instant: `ParamViews` with `loadWerbebudgetRange` (`werbebudget/range-actions.tsx`).
  - **Kennzahlen** (`KpiGrid`): Werbebudget with its line (stepped like the Übersicht's, `rangeSeries`), Anfragen über Werbung, Pro qualifizierte Anfrage, and across the block what the ad Anfragen became (`AdFunnelCell`, Karam, 2026-10-30: the "{Monat} bisher" meter only showed how far the month was, since its Hochrechnung was spent ÷ days × days in the month). HubSpot's ads funnel: Anfragen, Termine, Gewonnen side by side, the share of the step before beside the count (none at 0), the Trichter's bars, under each "12 qualifiziert", "656 € pro Termin", "1.640 € pro Behandlung" ("je 656 €" in a column under 8rem). Google Ads' budget report (cumulative spend, forecast, monthly limit) was looked at and left out: EINS stores no monthly limit to pace against. Without an ad account it is the same cards with the organic note in the chart.
  - **Cost is always per qualifizierte Anfrage**, the Übersicht's unit (`costPerQualified`, `server/queries/_qualified.ts`): the Kennzahl, its line (the cost so far up to each step), Plattformen and Kampagnen. "Anfragen über Werbung" and the Plattformen column "Anfragen" count every ad Anfrage. The Kampagnen column counts qualified ones and says "Qualifiziert".
  - **Plattformen**: Meta and Google always as two rows (Stripe's table, Triple Whale's channel rows). Logo, name and the row's one button (verbinden, Facebook-Seite auswählen, erneut verbinden) share a line, with the status as dot and text under it and the figures in fixed columns from xl. **Kampagnen** uses the same columns in a list of fixed height that scrolls.
  - Cut: the subtitle, "Insgesamt", the per-platform mini charts, Impressionen, Klicks, Klickrate, the sync history, the Konto-ID and the "Hinweise zur Messung" card (now the explainers).
- **Admin** (Karam, dense, keyboard first):
  - Linear-style navigation: Cmd/Ctrl+K menu; J/K moves through rows marked `data-row`; Enter opens.
  - Rows about 40 px high.
  - Panel header: title, muted count, one quiet link or control on the right. No description line.

## 10. States

### Fixed size: content never resizes a card, buttons never move

Karam, 2026-10-29: "Size of cards is NOT allowed to change when the contents of the card change, buttons are also not allowed to shift." His example: the "Jetzt anrufen" card grew with the length of the patient's message, so the "Ergebnis des Anrufs" switch sat somewhere else for every patient.

A card has one height per breakpoint. The next patient, another period, an empty period, a saved call, an error, loading and the hover all leave it the same. Every button in it stays at the same x and y.

- **Give the card its height, not its content.** Fixed height per breakpoint (`h-[…] md:h-[…]`). Inside it the parts of fixed size stay put and one region takes the rest (`flex-1 min-h-0`).
- **Text of any length goes into a scroll well of normal size.** Messages, quiz answers, notes: a well about as high as the usual text (three lines on the call card, Karam: "normal sized like before, but you could just scroll down inside"), with the `scroll-shadows` utility from `globals.css`. It scrolls, and a soft shadow at the edge shows where text is hidden. Never cut with "…", never "Mehr anzeigen" that grows the card, and never a well blown up to fill the card.
- **A text field that scrolls shows an arrow.** Every scroll well with text and every textarea sits in `ScrollHint` (`app/_components/ScrollHint.tsx`): an arrow in a circle in the bottom right corner while there is more text below, fading out at the bottom and absent when everything fits; a click scrolls on (Karam, 2026-10-30: the edge shadow alone was too easy to miss). Lists of rows keep only the shadow.
- **No visible scroll bars.** `scroll-shadows` hides them (Karam: "we aren't in 2005"), and `ScrollHint` hides them on the textareas it wraps; the edge shadow and the arrow are the hint. Size fixed slots so the normal content fits without scrolling (five 72 px rows in a 360 px list): scrolling is only for the rare long case.
- **A well never traps the page.** No `overscroll-behavior: contain` (Karam, 2026-10-29: the page stopped scrolling while the pointer was over a list, even one with nothing to scroll). The well scrolls first, then the page carries on, with the wheel and with the finger.
- **A well inside a list sets its own `--scroll-bg`.** Otherwise it inherits the list's white, and the well turns white behind its text where it should be grey (`RowWell` sets `--well`).
- **A fact that is sometimes missing keeps its row.** The row says so ("Keine offene Frist", "Keine Telefonnummer"), it does not disappear.
- **Lists of a few items have fixed slots.** "Als Nächstes" always has room for five rows. Fewer rows leave the slots empty, and no rows put one sentence in the same space.
- **Empty and "Heute" keep the frame.** A chart keeps its plot area and axis, a table keeps its header and body height, and the one sentence sits in the middle of that space (Stripe's dashboard with no data). A period with less data never collapses a card.
- **Confirmations and errors after an action go into the toast** (`ActionFlashToast` or the same `Toast` from `@eins/ui`), not into a line that appears in the card. The toast is solid: `ActionFlashToast` lays the page colour under the shared Toast's see-through tone tint (`SOLID_TONE`), and on the phone it sits 16 px from both edges (the viewport at `bottom-0 right-0` below `sm`). Check: `D:\Desktop\Claude\eins-dashboard-redesign\tools\toast-solid.cjs` (390, 1440, 390 dark).
- **Pending state changes colour, not size.** No spinner that appears inside a button and widens it.
- **Pages of a long list keep the full page height.** When a list has more than one page, the last page fills up with empty rows, so "Weiter" and "Zurück" stay where they were.
- **The skeleton has the same fixed height** as the card it stands in for.
- **Bewertungen, three more ways a card moved** (2026-10-30; branch dashboard-redesign, not committed or deployed):
  - An `inline-flex` button or icon row inside a block (DashCard's action slot, a record row) adds a line box of 1 to 4 px. Make the element or its wrapper `flex`.
  - A value that must stay on one line (an e-mail address in a record row) gets a fixed height and scrolls sideways with `scroll-shadows-x` (`globals.css`), never cut with "…".
  - A `loading.tsx` wraps every route below it, and on a full page load Next shows the outermost one: the list and a Rückmeldung showed the Plattformen skeleton. A page with routes below it keeps its page and loading file in a route group (`bewertungen/(plattformen)`, `bewertungen/feedback/(liste)`); the URLs stay the same.
- **Werbebudget, two more ways a label or control broke** (2026-10-30; branch dashboard-redesign, not committed or deployed):
  - A label that is sometimes too long for its cell switches to a shorter one by the room it has, never by cutting it: `FigureCell`'s `narrowLabel` is a container query on the label row ("Pro qualifizierte Anfrage", below 13.5rem "Pro qualif. Anfrage").
  - A control that gains segments may no longer share its row. Measure the narrowest width of each layout (768 here), not only 390 and 1440. `tools/fixed-size-werbebudget.cjs` runs twelve states at 390, 768, 1100 and 1440: no ad account, one platform, nothing spent, each period, sync error, Facebook-Seite missing, no Anfragen, 20 long campaigns with large amounts, qualified test Anfragen, and the skeleton with JavaScript off. Every DB change is backed up first and put back after its captures.
- **Check**: `tools/fixed-size-dashboard.cjs` and `tools/fixed-size-anfragen.cjs` measure every card per state (each period on the dashboard; before and after a saved call, a filter and the last page on Anfragen) at 390, 1100 and 1440. Every card has one height and one y. `tools/fixed-size-inhalte.cjs` does the same for Inhalte at 390, 768, 1100 and 1440 (next post, change mode, open rows, each filter, last page, empty, skeleton with JavaScript off). `tools/fixed-size-dateien.cjs` does it for Dateien at the same four widths (page 2, each Art, each card empty, drag over the page and the card, deleting, skeleton) and runs the drop, paste, send, preview, download, delete and upload-error flows at 390 and 1440; `tools/dd-zip.cjs` measures "Alle herunterladen" and the Art filter idle and while packing at the four widths and lists the saved ZIP's entries for "Alle Arten" and one Art, then on the real local data a ZIP with missing files and an Art with only missing files; its phone shots grow the viewport to the page, because Playwright's `fullPage` capture drops the touch emulation and shows desktop-only hints. `tools/fixed-size-bewertungen.cjs` does it for Bewertungen at the four widths (Plattformen: no stand, one platform, one stand, many new, long Praxis name, both copy buttons; list: every view, page 2, search, empty, the instant switch; Rückmeldung: long text, redirect, long name, Rückruf, status saved and undone, note saved, connection error, the arrow keys; every skeleton with JavaScript off). It measures layout boxes (the offset chain), so the card lift on hover and the rise animation are not counted as moves. `tools/scroll-trap-probe.cjs` turns the wheel over every scroll region on every page in the nav: the page must move while it can.

### A view switch is instant

Karam, 2026-10-29, after "Weiter" on Dateien: "Why does pressing weiter and zurück take AGES". A tab, period, filter, sort, search or page that lives in the address never waits for a server render of the whole route. The tools are in `src/app/_components/instant-views.tsx`.

- **Bounded data (the page can hold every row): load once, switch in the browser.** The server sends every row once. The list filters and sorts from `useSearchParams`; a control only rewrites the address (`setSearchParams`, `history.replaceState`): no request, no scroll jump, and a reload or a shared link opens the same view. Dateien (`FileList`), Rückmeldungen (`FeedbackList`), admin Praxen and Nutzer (filters inside `AdminFiltersInBrowser`), admin Videos. A query with a row cap (LIMIT) filters on the server again once the list reaches it.
- **One view per tab or period: `ParamViews`.** The server renders the value in the address, a server action renders the others; each is kept for 2 minutes and the rest load while the browser is idle. Dashboard (`RangeViews`), admin Übersicht, Leistung, Umsatz, Audit tabs. `only` makes a tab drop the other params, as its link did.
- **Unbounded data (the server must filter or page): `NavTransition`.** The control shows the new value on the tap (`usePendingParam`, `PendingLink`, `NavForm`, admin filters inside it); the old rows stay and dim at the same size (`PendingDim`, after 150 ms) until the server render lands. Never a resizing spinner, never an empty list in between. Admin Anfragen, Audit Protokoll, Praxis detail tabs, PVS-Ereignisse, Praxis Anfragen ("Alle Anfragen" dims, the call cards and the filter bar do not).
- **Tabs that are separate routes** (Bewertungen, ‹ › of a Rückmeldung): `<Link prefetch>`, so production has the page before the tap. Dev never prefetches.
- **A pager shows both buttons on every page**, greyed out at the ends, so neither moves.
- **Check**: `tools/instant-time.cjs` times every control on the dev server: ms from the click to the last change in `<main>`, and server requests per click (0 for a browser switch).

- **Loading**: a skeleton in the same shape and height as the real card (`DetailBundleSkeleton`, `admin/loading.tsx`). Update it whenever a card's height changes.
- **Period still loading**: the last view stays up and dims after 150 ms, so a kept period swaps in without a flicker.
- **Empty**: one sentence.
- **Errors**: keep the existing error copy unchanged.

### A save shows its result on the tap

Karam, 2026-10-30: the portal is optimistic. A tap that saves shows its result at once; the server confirms behind it.

- **Show the result on the tap, save behind it.** `useOptimistic` inside the action's transition, or local state with a rollback: the row leaves, the next patient or post takes the card, the status flips, a new Verlauf entry shows faded until the server render lands. References: `bewertungen/feedback/[id]/_status-switch.tsx`, `anfragen/_components/CallQueueState.tsx`, `anfragen/[id]/_pending.tsx`, `dateien/_components/FileList.tsx` (`hide`).
- **Confirm only what the server confirmed.** The success toast comes after the answer. A logged call or a Freigabe never says "gespeichert" before.
- **A failure undoes exactly that change and names it.** `{ok:false}` and a thrown error both roll back; the toast names the patient, post or file ("David Bauer: Keine Verbindung …"). A dialog reopens with the typed text.
- **A failure never moves what the user has moved on to.** If another patient or post is on the card by then, the failed one goes back into the list (first in "Als Nächstes", back in the pager), not onto the card.
- **Saves may overlap**; each one rolls back alone. Guard an action that sends mail or must not run twice with a ref, not only a disabled button.
- **Not optimistic**: uploads (they show progress), invites, password, connecting or disconnecting Meta and Google, revoking ad consent, "Anfrage anlegen", submitting the Fragebogen, syncing reviews. These grey out while they run.
- **Every submit button has a pending state.** A plain `<Button type="submit">` in a server-action form is `PendingSubmit` (`(portal)/_components/PendingSubmit.tsx`): greyed out, same size.
- **Check**: hold every server action (a POST with a `next-action` header) for 1.5 s, then abort it. At 250 ms the result shows; after the abort the old state is back with a toast that names it, and the card kept its height. `D:\Desktop\Claude\portal-checks\optimistic-ui\check.cjs` does this for every save above (`node check.cjs`, dev server on :3007).

## 11. AI-design tells to reject

- identical card grids, three equal KPI cards in a row
- a big number above a tiny grey label
- gradient text, purple or blue gradients, glow, glassmorphism
- a coloured left border on rounded panels
- an icon in a coloured circle above every heading, emoji as icons
- status dots on everything, "live" markers without live data
- decorative sparklines with no real data
- the same radius, padding and hover effect on everything
- an intro line that restates the heading
- every button styled as primary
- features hidden on the phone instead of adapted

Sources, reference images and the critique log: `apps/portal/DESIGN-SOURCES.md`.
