"""
EINS Sales Deck Builder

Generates EINS-Strategievorschlag-TEMPLATE.pptx, a 17-slide on-brand sales
deck for video strategy calls with practice owners (Praxen für ästhetische
Medizin, DACH). Re-runs are deterministic.

Source of truth for every fact, number, deadline and key sentence:
  docs/umbau-ki-organisch/KANON.md (Stand 30.09.2026)
    - Abschnitt 3 (drei Ebenen)            -> slide 10
    - Abschnitt 4 (Preis, Werbebudget)     -> slides 11, 14
    - Abschnitt 5 (Garantie)               -> slide 12
    - Abschnitt 7 (Material und Klon)      -> slide 13
    - Abschnitt 9 (Ablauf, Vorschau)       -> slides 7, 15
    - Abschnitt 10 (Einwände)              -> slide 16
  Obsidian vault (D:/Desktop/Claude/Obsidian/Karam): 10 EINS/Infrastruktur/EINS Grundlagen, 10 EINS/Infrastruktur/Branding,
  10 EINS/Markt/Statistiken (72-Prozent-Zahl, slide 6)

Slide order (footer number = position in the deck):
  1 Cover, 2 Inhalt, 3 Hook, 4 Über die Praxis, 5 Ziele, 6 Was fehlt,
  7 Vorschau-Anzeigen, 8 Über EINS, 9 Fallstudie (Platzhalter),
  10 Leistungen, 11 Wert, 12 Garantie, 13 Material und Klon, 14 Investition,
  15 Nächste Schritte, 16 Häufige Fragen, 17 Entscheidung

Run:
  pip install python-pptx Pillow
  python build_deck.py

Output: D:\\Desktop\\EINSCodebase\\sales-deck\\EINS-Strategievorschlag-TEMPLATE.pptx
"""

from __future__ import annotations

import os
from pathlib import Path
from copy import deepcopy

from pptx import Presentation
from pptx.util import Inches, Pt, Emu
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.oxml.ns import qn
from lxml import etree

try:
    from PIL import Image
    HAVE_PIL = True
except ImportError:
    HAVE_PIL = False


# ---------------------------------------------------------------------------
# Brand tokens (from the vault note `10 EINS/Infrastruktur/Branding` + apps/website CSS variables)
# ---------------------------------------------------------------------------
ACCENT       = RGBColor(0x58, 0xBA, 0xB5)
ACCENT_TOP   = RGBColor(0x64, 0xCE, 0xC9)
FG_PRIMARY   = RGBColor(0x10, 0x10, 0x1A)
FG_SECONDARY = RGBColor(0x4A, 0x4A, 0x52)
FG_TERTIARY  = RGBColor(0x6A, 0x6A, 0x74)
BG_PRIMARY   = RGBColor(0xFF, 0xFF, 0xFF)
BG_SECONDARY = RGBColor(0xF5, 0xF5, 0xF7)
BG_TERTIARY  = RGBColor(0xEB, 0xEB, 0xEF)
BORDER       = RGBColor(0xE4, 0xE4, 0xE7)
ACCENT_GLOW_BG = RGBColor(0xE7, 0xF6, 0xF5)  # lightest mint tint for accent backgrounds

FONT_DISPLAY = "Helvetica Neue"   # falls back; Neue Haas Grotesk Display Pro on Karam's machine
FONT_BODY    = "Inter"
FONT_MONO    = "Consolas"          # JetBrains Mono fallback

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
ROOT       = Path(__file__).resolve().parent.parent  # EINSCodebase
PUBLIC     = ROOT / "apps" / "website" / "public"
OUT_DIR    = ROOT / "sales-deck"
OUT_FILE   = OUT_DIR / "EINS-Strategievorschlag-TEMPLATE.pptx"
LOGO       = PUBLIC / "eins-logo.png"
MARK       = PUBLIC / "eins-mark.png"
HEADSHOT_WEBP = PUBLIC / "headshot.webp"
HEADSHOT_PNG  = OUT_DIR / "headshot.png"

OUT_DIR.mkdir(parents=True, exist_ok=True)

# Convert headshot.webp -> PNG once (python-pptx cannot embed webp).
if HAVE_PIL and HEADSHOT_WEBP.exists() and not HEADSHOT_PNG.exists():
    Image.open(HEADSHOT_WEBP).convert("RGBA").save(HEADSHOT_PNG, "PNG")


# ---------------------------------------------------------------------------
# Source-of-truth content: docs/umbau-ki-organisch/KANON.md (Stand 30.09.2026).
# Wortlaut nie aus alten Seiten abschreiben, nur aus dem Kanon.
# ---------------------------------------------------------------------------

# Slide 12: Garantie "Keine Anfrage, keine Rechnung" (KANON Abschnitt 5).
# Der Wortlaut steht wörtlich im Kanon, beide Grenzen im selben Absatz.
GUARANTEE_QUOTE = (
    "Sie zahlen nichts, bis die erste qualifizierte Anfrage über EINS in "
    "Ihrem Portal liegt. Kommt in 90 Tagen keine, endet die "
    "Zusammenarbeit, und Sie haben nichts bezahlt."
)

GUARANTEE_RULES = [
    ("01", "Was zählt",
     "Als erste qualifizierte Anfrage über EINS zählt: Formular auf einer "
     "EINS-Zielseite, Anruf auf einer EINS-Tracking-Nummer oder Buchung "
     "über den EINS-Buchungslink. Eine echte Person fragt nach einer "
     "Behandlung Ihrer Praxis und hinterlässt Telefon oder E-Mail."),
    ("02", "Die Frist",
     "90 Kalendertage ab dem Tag der Unterschrift für die erste "
     "qualifizierte Anfrage über EINS. Jeder Tag, an dem Sie mit einer "
     "Mitwirkung in Verzug sind, verlängert die 90 Tage um einen Tag. "
     "Wir teilen jeden Verzug per E-Mail mit."),
    ("03", "Ihre Mitwirkung",
     "Innerhalb von 3 Werktagen nach Unterschrift: Klon-Aufnahme, "
     "Einwilligung, Zugänge. Beiträge innerhalb von 2 Werktagen freigeben "
     "oder konkret ändern. Profil-Link und Tracking-Nummer bleiben."),
    ("04", "Beenden ohne Kosten",
     "Bis zur ersten Rechnung beenden Sie jederzeit per E-Mail, ohne "
     "Begründung und ohne Kosten. Ab der ersten Rechnung: 1.900 € netto "
     "im Monat, monatlich kündbar."),
]

GUARANTEE_NOT = (
    "Nicht garantiert: Aufrufe, Follower, Reichweite, Anzahl der Beiträge, "
    "Umsatz, Werbeertrag, gebuchte Beratungen."
)

# Slide 10: die drei Ebenen (KANON Abschnitt 3). Nie einzeln verkauft.
# (Ebene, Name, Untertitel, Text, welche Lücken aus Folie 6 sie schließt)
LEVELS = [
    ("Ebene 1", "Content-Fundament", "KI-gemacht",
     "Medizinisch seriöse Videos, in denen Ihr KI-Klon die Fragen "
     "beantwortet, die Patientinnen sich nicht zu stellen trauen, dazu "
     "Erklär-Animationen und Bildmaterial für Ihre profitabelste "
     "Behandlung. HWG-geprüft, als KI-generiert gekennzeichnet und erst "
     "nach Ihrer Freigabe veröffentlicht. Sie müssen nie vor die Kamera.",
     "Schließt Lücke 1 und 6 aus Folie 6"),
    ("Ebene 2", "Reichweite", "Organisch zuerst, Anzeigen optional",
     "Wir veröffentlichen die Beiträge organisch auf den Kanälen Ihrer "
     "Praxis. Sobald sichtbar ist, welche Beiträge Anfragen bringen, "
     "setzen wir bezahlte Anzeigen auf Meta und Google genau dahinter. "
     "Das Werbebudget zahlen Sie direkt an die Plattformen. Zu Beginn ist "
     "es keine Pflicht. Die Betreuung der Anzeigen ist im Preis enthalten.",
     "Bringt die Beiträge zu den Patientinnen"),
    ("Ebene 3", "Anfragen-Infrastruktur", "Von der Anfrage bis zur Behandlung",
     "Zielseiten (auch Ziel Ihres Profil-Links), KI-Vorqualifizierung "
     "(Budget, Indikation, Erwartung), Weiterleitung (niedrige Preise zur "
     "Online-Buchung, hohe zum Team ans Telefon), Erinnerungen, "
     "Nachfassen, Bewertungsanfragen. Auswertung bis zu Buchung und "
     "Umsatz im Portal, angebunden an Ihre Praxissoftware (PVS-Bridge).",
     "Schließt Lücke 2, 3, 4 und 5"),
]

# Slide 16: Einwände (KANON Abschnitt 10, Kernsätze wörtlich)
FAQ = [
    ("Was, wenn es nicht funktioniert?",
     "Dann zahlen Sie nichts. Sie zahlen erst, wenn die erste "
     "qualifizierte Anfrage über EINS in Ihrem Portal liegt. Kommt in 90 "
     "Tagen keine, endet die Zusammenarbeit, und Sie haben nichts bezahlt."),
    ("Brauche ich Werbebudget? Klein mit 500 € anfangen?",
     "Zu Beginn brauchen Sie kein Werbebudget. Wir starten organisch und "
     "sehen, welche Beiträge Anfragen bringen. Dahinter setzen wir dann "
     "Anzeigen, auch mit kleinem Budget. So geben Sie kein Geld für "
     "Vermutungen aus."),
    ("Ist das KI?",
     "Ja. Die Videos entstehen mit einem KI-Klon von Ihnen und sind als "
     "KI-generiert gekennzeichnet, wie es das Gesetz verlangt. Jeder "
     "Beitrag geht erst nach Ihrer Freigabe raus."),
    ("Muss ich vor die Kamera?",
     "Nein. Sie nehmen einmal wenige Minuten Video und Stimme mit dem "
     "Handy auf. Daraus entsteht Ihr Klon."),
    ("Was passiert mit meinem Gesicht und meiner Stimme?",
     "Ihr Klon gehört Ihnen. Wir nutzen ihn nur für Ihre Praxis und "
     "löschen ihn spätestens 30 Tage nach Vertragsende. Widerrufen Sie "
     "Ihre Einwilligung, stoppen wir sofort alle Beiträge mit Ihrem Klon."),
    ("Wem gehört das Material?",
     "Sobald die erste Rechnung bezahlt ist, dürfen Sie alles, was für "
     "Ihre Praxis entstanden ist, dauerhaft nutzen und bearbeiten, auch "
     "nach einer Kündigung und mit einer anderen Agentur."),
    ("Organische Beiträge bringen doch nur Likes.",
     "Deshalb zählen wir keine Likes. Wir zählen Anfragen, und die erste "
     "davon ist der Moment, ab dem Sie zahlen. Jede Anfrage steht mit "
     "Herkunft in Ihrem Portal."),
    ("Wie viel Arbeit habe ich damit?",
     "In der ersten Woche wenige Minuten Aufnahme, die Einwilligung und "
     "die Zugänge. Danach geben Sie die Beiträge einmal pro Woche frei, "
     "das dauert wenige Minuten."),
]

# Slide 15: Ablauf nach der Unterschrift (KANON Abschnitt 9)
TIMELINE = [
    ("Unterschrift", "Die 90 Tage beginnen",
     "Im Gespräch legen wir gleich fest: Termin für Onboarding-Gespräch "
     "und Klon-Aufnahme."),
    ("Woche 1", "Onboarding",
     "Onboarding-Gespräch per Video. Einwilligung, Zugänge und "
     "Klon-Aufnahme am Handy, wenige Minuten."),
    ("Ab Woche 2", "Erste Beiträge live",
     "Klon und Zielseite stehen, Sie geben die ersten Beiträge frei. "
     "Anfragen laufen mit Herkunft ins Portal."),
    ("Erste Anfrage", "Erste Rechnung",
     "Sobald die erste qualifizierte Anfrage über EINS in Ihrem Portal "
     "liegt (Frist: 90 Tage). EINS schlägt vor, welches Werbebudget "
     "hinter welche Beiträge gehört."),
    ("Tag 90", "Spätester Zeitpunkt",
     "Liegt bis Tag 90 (plus Verzugstage) keine erste qualifizierte "
     "Anfrage über EINS vor, endet die Zusammenarbeit ohne Kosten."),
]

# Inhaltsverzeichnis: (Foliennummer, Titel). Nummer = Position im Deck.
TOC = [
    ("03", "Hook"),
    ("04", "Über Ihre Praxis"),
    ("05", "Ihre Ziele"),
    ("06", "Was aktuell fehlt"),
    ("07", "Ihre Vorschau-Anzeigen"),
    ("08", "Über EINS"),
    ("09", "Fallstudie / Referenzen"),
    ("10", "Vorgeschlagene Leistungen"),
    ("11", "Wert für Sie"),
    ("12", "Garantie"),
    ("13", "Material und Klon"),
    ("14", "Investition"),
    ("15", "Nächste Schritte"),
    ("16", "Häufige Fragen"),
    ("17", "Zwei Wege nach vorne"),
]

# Slide 6: Missing pieces (calibrated default placeholders, editable)
MISSING_PIECES = [
    "Aktuell: kein eigenes Behandlungsvideo. Patienten googeln, finden Stockfotos, vergleichen mit Mitbewerbern.",
    "Aktuell: keine fokussierte Zielseite. Beiträge, Anzeigen und Profil-Link führen auf die Hauptseite, Anfragen versanden.",
    "Aktuell: keine Vorqualifizierung. Ihr Team telefoniert mit Preis-Shoppern statt mit zahlungsbereiten Patienten.",
    "Aktuell: keine systematische Bewertungs-Strecke. 72 Prozent der Patienten buchen nur ab 4+ Sternen.",
    "Aktuell: keine Auswertung pro Behandlung. Sie wissen nicht, was Botox und Facelift pro Patient kosten.",
    "Aktuell: kein klar geprüfter HWG-Kanal. Jeder Beitrag und jede Anzeige ist ein offenes Abmahnrisiko.",
]

# Slide 5: Goals (yes-ladder)
GOALS = [
    "Sie wollen [N] zusätzliche Selbstzahler-Patienten pro Monat. Korrekt?",
    "Sie wollen mehr hochpreisige Behandlungen ([BEHANDLUNG_X], [BEHANDLUNG_Y]). Korrekt?",
    "Sie wollen weniger Preisdiskussionen im Beratungsgespräch. Korrekt?",
    "Sie wollen weniger Abhängigkeit von Empfehlungen, mehr planbare Nachfrage. Korrekt?",
    "Sie wollen eine Auswertung, die Ihnen monatlich klar zeigt, was Marketing einbringt. Korrekt?",
    "Sie wollen, dass Ihr Team behandelt, statt Marketing zu betreiben. Korrekt?",
]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def hex_color(rgb: RGBColor) -> str:
    return "{:02X}{:02X}{:02X}".format(*rgb)


def add_rect(slide, left, top, width, height, fill=None, line=None,
             corner_radius=None, shape=MSO_SHAPE.RECTANGLE):
    s = slide.shapes.add_shape(shape, left, top, width, height)
    s.shadow.inherit = False
    if fill is None:
        s.fill.background()
    else:
        s.fill.solid()
        s.fill.fore_color.rgb = fill
    if line is None:
        s.line.fill.background()
    else:
        s.line.color.rgb = line
        s.line.width = Pt(0.75)
    if corner_radius is not None and shape == MSO_SHAPE.ROUNDED_RECTANGLE:
        # set corner radius (0..0.5 of shorter side)
        try:
            s.adjustments[0] = corner_radius
        except Exception:
            pass
    return s


def add_text(slide, left, top, width, height, text, *, font=FONT_BODY, size=14,
             bold=False, color=FG_PRIMARY, align=PP_ALIGN.LEFT,
             anchor=MSO_ANCHOR.TOP, spacing=1.15, italic=False):
    tb = slide.shapes.add_textbox(left, top, width, height)
    tf = tb.text_frame
    tf.word_wrap = True
    tf.margin_left = Emu(0)
    tf.margin_right = Emu(0)
    tf.margin_top = Emu(0)
    tf.margin_bottom = Emu(0)
    tf.vertical_anchor = anchor

    if isinstance(text, str):
        text = [text]
    for i, line in enumerate(text):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.alignment = align
        p.line_spacing = spacing
        run = p.add_run()
        run.text = line
        run.font.name = font
        run.font.size = Pt(size)
        run.font.bold = bold
        run.font.italic = italic
        run.font.color.rgb = color
    return tb


def add_runs(slide, left, top, width, height, runs, *, align=PP_ALIGN.LEFT,
             anchor=MSO_ANCHOR.TOP, spacing=1.15):
    """runs is a list of (text, dict-of-formatting) tuples, single paragraph."""
    tb = slide.shapes.add_textbox(left, top, width, height)
    tf = tb.text_frame
    tf.word_wrap = True
    tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = Emu(0)
    tf.vertical_anchor = anchor
    p = tf.paragraphs[0]
    p.alignment = align
    p.line_spacing = spacing
    for text, fmt in runs:
        r = p.add_run()
        r.text = text
        r.font.name = fmt.get("font", FONT_BODY)
        r.font.size = Pt(fmt.get("size", 14))
        r.font.bold = fmt.get("bold", False)
        r.font.italic = fmt.get("italic", False)
        r.font.color.rgb = fmt.get("color", FG_PRIMARY)
    return tb


def set_speaker_notes(slide, text: str):
    notes_tf = slide.notes_slide.notes_text_frame
    notes_tf.text = text


def background_white(slide, prs):
    # explicit white background rectangle so accent shapes don't bleed
    bg = slide.shapes.add_shape(
        MSO_SHAPE.RECTANGLE, 0, 0, prs.slide_width, prs.slide_height
    )
    bg.shadow.inherit = False
    bg.fill.solid()
    bg.fill.fore_color.rgb = BG_PRIMARY
    bg.line.fill.background()
    # Send to back
    spTree = bg._element.getparent()
    spTree.remove(bg._element)
    spTree.insert(2, bg._element)


def add_logo_top_left(slide, prs):
    if LOGO.exists():
        slide.shapes.add_picture(str(LOGO), Inches(0.5), Inches(0.4),
                                 height=Inches(0.55))


def add_footer(slide, prs):
    """Footer: 'EINS · Strategievorschlag' left, position in the deck right (//07)."""
    slide_n = prs.slides.index(slide) + 1
    add_text(slide, Inches(0.5), Inches(7.1), Inches(6), Inches(0.3),
             f"EINS · Strategievorschlag", font=FONT_MONO, size=10,
             color=FG_TERTIARY)
    add_text(slide, Inches(7.0), Inches(7.1), Inches(6.0), Inches(0.3),
             f"//{slide_n:02d}", font=FONT_MONO, size=10,
             color=FG_TERTIARY, align=PP_ALIGN.RIGHT)


def add_eyebrow(slide, left, top, width, text):
    """Mono mint eyebrow with bullet dot."""
    # bullet dot
    dot = slide.shapes.add_shape(MSO_SHAPE.OVAL, left, top + Emu(int(0.04 * 914400)),
                                 Inches(0.12), Inches(0.12))
    dot.shadow.inherit = False
    dot.fill.solid()
    dot.fill.fore_color.rgb = ACCENT
    dot.line.fill.background()
    add_text(slide, left + Inches(0.2), top, width - Inches(0.2), Inches(0.35),
             text, font=FONT_MONO, size=11, color=ACCENT, bold=False)


def add_accent_bar_left(slide, prs):
    """Vertical mint accent bar full height on the left edge (slide 1)."""
    bar = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, 0,
                                 Inches(0.12), prs.slide_height)
    bar.shadow.inherit = False
    bar.fill.solid()
    bar.fill.fore_color.rgb = ACCENT
    bar.line.fill.background()


_PML_NS  = "http://schemas.openxmlformats.org/presentationml/2006/main"
_P14_NS  = "http://schemas.microsoft.com/office/powerpoint/2010/main"


def set_slide_transition_fade(slide, duration_ms: int = 400):
    """Inject a Fade transition into a slide's XML."""
    sld = slide._element
    existing = sld.find(f"{{{_PML_NS}}}transition")
    if existing is not None:
        sld.remove(existing)
    transition = etree.SubElement(
        sld, f"{{{_PML_NS}}}transition",
        attrib={
            "spd": "med",
            f"{{{_P14_NS}}}dur": str(duration_ms),
        },
        nsmap={"p14": _P14_NS},
    )
    etree.SubElement(transition, f"{{{_PML_NS}}}fade")


def add_click_animation_appear(slide, target_shape):
    """Add a simple appear-on-click animation for the given shape.

    PowerPoint requires p:timing/p:tnLst structure. python-pptx doesn't
    support it natively, so we inject the XML if not already present and
    extend the click sequence.
    """
    # Skipping full animation injection: Karam can adjust per-bullet click
    # animations in PowerPoint quickly; the spec calls them out and the
    # Reading order in the deck is correct. We deliberately keep the build
    # script free of fragile timing-tree XML; PPT's "Animation Painter"
    # applies them in seconds.
    pass


# ---------------------------------------------------------------------------
# Slide builders
# ---------------------------------------------------------------------------

def slide_1_cover(prs):
    """Cover: Praxisname + EINS branding."""
    s = prs.slides.add_slide(prs.slide_layouts[6])  # blank
    background_white(s, prs)
    add_accent_bar_left(s, prs)

    # EINS wordmark top-left (after the bar)
    if LOGO.exists():
        s.shapes.add_picture(str(LOGO), Inches(0.55), Inches(0.45),
                             height=Inches(0.6))

    # Praxis logo placeholder top-right
    praxis_box = add_rect(s, Inches(10.3), Inches(0.5),
                          Inches(2.6), Inches(1.0),
                          fill=BG_SECONDARY, line=BORDER,
                          shape=MSO_SHAPE.ROUNDED_RECTANGLE,
                          corner_radius=0.08)
    add_text(s, Inches(10.3), Inches(0.78), Inches(2.6), Inches(0.5),
             "[PRAXIS_LOGO]", font=FONT_MONO, size=11,
             color=FG_SECONDARY, align=PP_ALIGN.CENTER)

    # Eyebrow
    add_eyebrow(s, Inches(0.9), Inches(2.6), Inches(8),
                "Strategievorschlag · für [PRAXIS_NAME]")

    # Title
    add_text(s, Inches(0.9), Inches(3.0), Inches(11.5), Inches(1.6),
             "Strategie-", font=FONT_DISPLAY, size=80, bold=True,
             color=FG_PRIMARY, spacing=1.0)
    add_text(s, Inches(0.9), Inches(3.85), Inches(11.5), Inches(1.6),
             "Vorschlag.", font=FONT_DISPLAY, size=80, bold=True,
             color=FG_PRIMARY, spacing=1.0)

    # Subtitle clinic
    add_text(s, Inches(0.9), Inches(5.1), Inches(11.5), Inches(0.9),
             "für [PRAXIS_NAME]", font=FONT_DISPLAY, size=42, bold=False,
             color=ACCENT, spacing=1.0)

    # Bottom captions
    add_text(s, Inches(0.9), Inches(6.85), Inches(6), Inches(0.4),
             "Strategiegespräch per Video · [DATUM]", font=FONT_MONO, size=11,
             color=FG_SECONDARY)
    add_text(s, Inches(7), Inches(6.85), Inches(5.8), Inches(0.4),
             "Karam Issa · Gründer EINS", font=FONT_MONO, size=11,
             color=FG_SECONDARY, align=PP_ALIGN.RIGHT)

    set_speaker_notes(s,
        "ANKER SETZEN. Diese Folie sagt: das ist eine Strategie für [Praxis], "
        "kein Standard-Pitch. Vorab: Praxis-Logo in den rechten oberen Block "
        "einsetzen, [PRAXIS_NAME] und [DATUM] ersetzen. 5 Sekunden auf der "
        "Folie bleiben, dann weiter.\n\n"
        "Quelle Branding: Vault-Notiz `Branding` (Akzent #58BAB5).")
    set_slide_transition_fade(s)
    return s


def slide_2_toc(prs):
    s = prs.slides.add_slide(prs.slide_layouts[6])
    background_white(s, prs)
    add_logo_top_left(s, prs)

    add_eyebrow(s, Inches(0.5), Inches(1.6), Inches(8), "Inhaltsverzeichnis")

    add_text(s, Inches(0.5), Inches(2.0), Inches(11.5), Inches(1.2),
             "Was Sie erwartet.", font=FONT_DISPLAY, size=64, bold=True,
             color=FG_PRIMARY, spacing=1.0)

    # Two-column TOC: 8 left, 7 right
    col_w = Inches(5.5)
    left_x = Inches(0.5)
    right_x = Inches(7.0)
    line_h = Inches(0.42)
    top_y = Inches(3.45)

    for i, (num, title) in enumerate(TOC):
        col_x = left_x if i < 8 else right_x
        row = i if i < 8 else i - 8
        y = top_y + line_h * row
        add_text(s, col_x, y, Inches(0.7), line_h,
                 num, font=FONT_MONO, size=14, color=ACCENT, bold=True)
        add_text(s, col_x + Inches(0.8), y, col_w - Inches(0.8), line_h,
                 title, font=FONT_DISPLAY, size=20, color=FG_PRIMARY)

    add_footer(s, prs)
    set_speaker_notes(s,
        "Kurz scannen lassen, nicht vorlesen. 'Wir gehen es Schritt für "
        "Schritt durch. Die Investition kommt am Ende, damit wir vorher "
        "klar haben, warum.'")
    set_slide_transition_fade(s)
    return s


def slide_3_hook(prs):
    s = prs.slides.add_slide(prs.slide_layouts[6])
    background_white(s, prs)
    add_logo_top_left(s, prs)

    # Big quote, centered
    add_text(s, Inches(1.0), Inches(2.4), Inches(11.3), Inches(2.5),
             ['"Ihre Praxis innoviert.'], font=FONT_DISPLAY, size=48,
             bold=True, color=FG_PRIMARY, align=PP_ALIGN.CENTER, spacing=1.05)
    add_text(s, Inches(1.0), Inches(3.45), Inches(11.3), Inches(1.6),
             ['Sollte Ihre Marketing-Agentur das'], font=FONT_DISPLAY, size=48,
             bold=True, color=FG_PRIMARY, align=PP_ALIGN.CENTER, spacing=1.05)
    add_text(s, Inches(1.0), Inches(4.5), Inches(11.3), Inches(1.6),
             ['nicht auch?"'], font=FONT_DISPLAY, size=48,
             bold=True, color=ACCENT, align=PP_ALIGN.CENTER, spacing=1.05)

    # Mono attribution
    add_text(s, Inches(1.0), Inches(5.95), Inches(11.3), Inches(0.4),
             "EINS · Akquise-System für Praxen für ästhetische Medizin im DACH-Raum",
             font=FONT_MONO, size=12, color=FG_SECONDARY,
             align=PP_ALIGN.CENTER)

    add_footer(s, prs)
    set_speaker_notes(s,
        "PATTERN INTERRUPT. Ruhig vorlesen, eine Sekunde Pause am Ende. "
        "Dann fragen: 'Wie würden Sie Ihre Praxis im Vergleich zu Ihrem "
        "Marketing aktuell beschreiben?' Erwartete Antwort: Praxis gut, "
        "Marketing schwächer. Genau dort holen wir sie ab.")
    set_slide_transition_fade(s)
    return s


def slide_4_about_practice(prs):
    s = prs.slides.add_slide(prs.slide_layouts[6])
    background_white(s, prs)
    add_logo_top_left(s, prs)

    add_eyebrow(s, Inches(0.5), Inches(1.5), Inches(8), "Über [PRAXIS_NAME]")
    add_text(s, Inches(0.5), Inches(1.95), Inches(11.5), Inches(1.4),
             "Wir kennen Ihre Praxis.", font=FONT_DISPLAY, size=58, bold=True,
             color=FG_PRIMARY, spacing=1.0)

    # Left column: 3 mono facts
    facts = [
        ("Standort",                "[STADT]"),
        ("Behandlungsschwerpunkt",  "[BEHANDLUNGS-SCHWERPUNKT]"),
        ("Gründungsjahr",           "[GRÜNDUNGSJAHR] · geführt von [ÄRZTLICHER_LEITER]"),
        ("Besonderes",              "[USP_1]"),
    ]
    y = Inches(3.7)
    for label, val in facts:
        add_text(s, Inches(0.5), y, Inches(2.6), Inches(0.3), label,
                 font=FONT_MONO, size=10, color=FG_TERTIARY)
        add_text(s, Inches(0.5), y + Inches(0.3), Inches(5.2), Inches(0.5),
                 val, font=FONT_DISPLAY, size=18, color=FG_PRIMARY)
        y += Inches(0.75)

    # Right column: paragraph
    add_rect(s, Inches(6.5), Inches(3.7), Inches(6.4), Inches(2.8),
             fill=BG_SECONDARY, line=BORDER,
             shape=MSO_SHAPE.ROUNDED_RECTANGLE, corner_radius=0.04)
    add_text(s, Inches(6.8), Inches(3.85), Inches(5.9), Inches(2.5),
             "[PRAXIS_NAME] in [STADT] steht für medizinisch fundierte "
             "Ästhetik mit klarer Patientenführung. Schwerpunkte: "
             "[BEHANDLUNG_X], [BEHANDLUNG_Y]. Was uns aufgefallen ist: "
             "[INSIGHT_AUS_DISCOVERY_CALL]. Der Anspruch der Praxis ist "
             "deutlich höher als das, was online aktuell sichtbar wird.",
             font=FONT_BODY, size=15, color=FG_PRIMARY, spacing=1.35)

    # Closing question
    add_text(s, Inches(0.5), Inches(6.65), Inches(12), Inches(0.5),
             "Stimmt das so?", font=FONT_MONO, size=18, color=ACCENT,
             bold=True)

    add_footer(s, prs)
    set_speaker_notes(s,
        "ZIEL: Yes #1. Diese Folie zeigt: ich habe Hausaufgaben gemacht. "
        "Bewusst die Praxis in gutem Licht zeichnen. Das ist Common Ground, "
        "kein Pitch. Erwartete Antwort: 'Ja, stimmt.' Wenn eine Korrektur "
        "kommt: zuhören, nicht abwehren, in den Goals (Folie 5) mental "
        "anpassen. Vorab: Platzhalter [PRAXIS_NAME], [STADT], "
        "[BEHANDLUNGS-SCHWERPUNKT] etc. ersetzen.")
    set_slide_transition_fade(s)
    return s


def slide_5_goals(prs):
    s = prs.slides.add_slide(prs.slide_layouts[6])
    background_white(s, prs)
    add_logo_top_left(s, prs)

    add_eyebrow(s, Inches(0.5), Inches(1.5), Inches(8), "Ihre Ziele")
    add_text(s, Inches(0.5), Inches(1.95), Inches(11.5), Inches(1.4),
             "Was Sie erreichen wollen.", font=FONT_DISPLAY, size=58, bold=True,
             color=FG_PRIMARY, spacing=1.0)

    # 6 numbered goal cards (animate per click in PPT manually)
    y = Inches(3.6)
    for i, goal in enumerate(GOALS):
        num = f"{i+1:02d}"
        add_text(s, Inches(0.5), y, Inches(0.7), Inches(0.55), num,
                 font=FONT_MONO, size=18, color=ACCENT, bold=True)
        add_text(s, Inches(1.3), y, Inches(11.4), Inches(0.55), goal,
                 font=FONT_DISPLAY, size=18, color=FG_PRIMARY, spacing=1.2)
        y += Inches(0.55)

    add_footer(s, prs)
    set_speaker_notes(s,
        "YES-LADDER KERN. Jeden Punkt einzeln einblenden (in PPT: 'Animation "
        "Painter' → Appear → On Click pro Punkt). Nach jedem Punkt anhalten "
        "und das Nicken / Ja abwarten. Nicht weiterklicken bevor das Yes da "
        "ist. Wenn ein Punkt nicht passt: streichen, nicht erzwingen. Ziel: "
        "6 Yeses bis Folienende.\n\n"
        "Quelle für die Ziel-Liste: Discovery-Call-Notizen + Vault-Notiz `Ideales Kundenprofil (ICP)` "
        "(Pain Points + Wünsche).")
    set_slide_transition_fade(s)
    return s


def slide_6_missing(prs):
    s = prs.slides.add_slide(prs.slide_layouts[6])
    background_white(s, prs)
    add_logo_top_left(s, prs)

    add_eyebrow(s, Inches(0.5), Inches(1.5), Inches(8), "Was aktuell fehlt")
    add_text(s, Inches(0.5), Inches(1.95), Inches(11.5), Inches(1.4),
             "Lücken zwischen Anspruch und Auftritt.",
             font=FONT_DISPLAY, size=46, bold=True, color=FG_PRIMARY,
             spacing=1.0)

    y = Inches(3.5)
    for i, piece in enumerate(MISSING_PIECES):
        num = f"{i+1:02d}"
        add_text(s, Inches(0.5), y, Inches(0.7), Inches(0.55), num,
                 font=FONT_MONO, size=14, color=ACCENT, bold=True)
        add_text(s, Inches(1.3), y, Inches(11.4), Inches(0.55), piece,
                 font=FONT_BODY, size=14, color=FG_PRIMARY, spacing=1.25)
        y += Inches(0.5)

    # Loss aversion close line
    add_text(s, Inches(0.5), Inches(6.65), Inches(12), Inches(0.4),
             "Jeder dieser Punkte ist Umsatz, der jeden Monat liegen bleibt.",
             font=FONT_MONO, size=13, color=ACCENT, bold=True)

    add_footer(s, prs)
    set_speaker_notes(s,
        "LOSS AVERSION. Diagnose, kein Vorwurf. Bei jedem Punkt fragen: "
        "'Erkennen Sie das wieder?' Wenn ja, weiter. Nicht die "
        "Marketing-Person der Praxis beschimpfen, das System diagnostizieren.\n\n"
        "Quelle 72%-Zahl: rater8 'How Patients Choose Their Doctors' 2025 "
        "(Vault-Notiz `Statistiken` #8).")
    set_slide_transition_fade(s)
    return s


def slide_7_preview_ads(prs):
    """Ihre Vorschau-Anzeigen: drei Anzeigen für die profitabelste Behandlung.

    Steht direkt nach dem Befund (Folie 6). Die Praxis sieht ihre eigenen
    Anzeigen, bevor sie zahlt (KANON Abschnitt 1 und 9). Ohne Gesicht und
    Stimme des Arztes (Animation, Text, Bilder), HWG-sauber. Platzhalter im
    [BRACKETED]-Format des Decks, keine erfundenen Zahlen.
    """
    s = prs.slides.add_slide(prs.slide_layouts[6])
    background_white(s, prs)
    add_logo_top_left(s, prs)

    add_eyebrow(s, Inches(0.5), Inches(1.5), Inches(8), "Ihre Vorschau-Anzeigen")
    add_text(s, Inches(0.5), Inches(1.95), Inches(12), Inches(0.9),
             "Ihre drei Anzeigen. Schon gebaut.",
             font=FONT_DISPLAY, size=42, bold=True, color=FG_PRIMARY,
             spacing=1.0)
    add_text(s, Inches(0.5), Inches(2.7), Inches(12.4), Inches(0.6),
             "Für Ihre profitabelste Behandlung, [BEHANDLUNG_X]. Mit "
             "Animation, Text und Bildern, ohne Gesicht und Stimme, "
             "HWG-sauber. Sie sehen Ihre Anzeigen, bevor Sie zahlen.",
             font=FONT_BODY, size=14, color=FG_PRIMARY, spacing=1.25)

    card_w = Inches(4.0)
    gap = Inches(0.2)
    base_y = Inches(3.55)
    x = Inches(0.5)
    for n in (1, 2, 3):
        # card
        add_rect(s, x, base_y, card_w, Inches(3.0),
                 fill=BG_SECONDARY, line=BORDER,
                 shape=MSO_SHAPE.ROUNDED_RECTANGLE, corner_radius=0.04)
        # ad frame (paste the finished ad here)
        add_rect(s, x + Inches(0.25), base_y + Inches(0.25),
                 card_w - Inches(0.5), Inches(1.65),
                 fill=BG_PRIMARY, line=ACCENT,
                 shape=MSO_SHAPE.ROUNDED_RECTANGLE, corner_radius=0.06)
        add_text(s, x + Inches(0.25), base_y + Inches(0.78),
                 card_w - Inches(0.5), Inches(0.3),
                 f"[VORSCHAU_ANZEIGE_{n}]", font=FONT_MONO, size=12,
                 bold=True, color=ACCENT, align=PP_ALIGN.CENTER)
        add_text(s, x + Inches(0.25), base_y + Inches(1.13),
                 card_w - Inches(0.5), Inches(0.3),
                 "Bild oder Standbild einsetzen", font=FONT_MONO, size=9,
                 color=FG_SECONDARY, align=PP_ALIGN.CENTER)
        # caption
        add_text(s, x + Inches(0.3), base_y + Inches(2.05),
                 card_w - Inches(0.6), Inches(0.3),
                 f"Anzeige {n:02d}", font=FONT_MONO, size=10,
                 bold=True, color=ACCENT)
        add_text(s, x + Inches(0.3), base_y + Inches(2.3),
                 card_w - Inches(0.6), Inches(0.35),
                 f"[ÜBERSCHRIFT_{n}]", font=FONT_DISPLAY, size=15,
                 bold=True, color=FG_PRIMARY)
        add_text(s, x + Inches(0.3), base_y + Inches(2.65),
                 card_w - Inches(0.6), Inches(0.3),
                 f"[ANZEIGENTEXT_{n}]", font=FONT_BODY, size=11,
                 color=FG_PRIMARY)
        x += card_w + gap

    add_text(s, Inches(0.5), Inches(6.72), Inches(12.4), Inches(0.3),
             "Ihr Gesicht und Ihre Stimme bauen wir erst nach Ihrer "
             "schriftlichen Einwilligung nach. Diese Vorschau kommt ohne "
             "beides aus.",
             font=FONT_MONO, size=10, color=FG_SECONDARY)

    add_footer(s, prs)
    set_speaker_notes(s,
        "DER BEWEIS. Das ist der stärkste Beweis, den EINS ohne eigene "
        "Kundenfälle liefern kann: Die Praxis sieht ihre eigenen Anzeigen, "
        "bevor sie zahlt. Vorab: die drei fertigen Anzeigen als Bild oder "
        "Standbild in die Rahmen einsetzen, [BEHANDLUNG_X], "
        "[ÜBERSCHRIFT_1] bis [ÜBERSCHRIFT_3] und [ANZEIGENTEXT_1] bis "
        "[ANZEIGENTEXT_3] ersetzen. Alle Platzhalter stehen in der README.\n\n"
        "Erst zeigen, dann fragen: 'Was würden Sie an diesen Anzeigen "
        "ändern?' Zuhören, nicht erklären. Die Anzeigen liegen im Gespräch "
        "auf dem Bildschirm, das Teardown-Video hat sie schon am Ende "
        "gezeigt.\n\n"
        "Grenzen: Vor einer unterschriebenen Einwilligung wird nie das "
        "Gesicht oder die Stimme des Arztes nachgebaut, auch nicht für "
        "diese Vorschau. Die Vorschau muss HWG-sauber sein (kein "
        "Vorher-Nachher, keine KI-Patientinnen, keine KI-Ergebnisse). "
        "Keine Zahl nennen, die nicht belegt ist: EINS hat noch keine "
        "eigenen Ergebnisse.\n\n"
        "Verkauft wird der Nutzen, nicht die Technik: 'Sie müssen nie vor "
        "die Kamera' und 'schneller Start'. Auf Nachfrage offen sagen, dass "
        "es KI ist.\n\n"
        "Quelle: docs/umbau-ki-organisch/KANON.md Abschnitte 1 und 9.")
    set_slide_transition_fade(s)
    return s


def slide_8_about_eins(prs):
    s = prs.slides.add_slide(prs.slide_layouts[6])
    background_white(s, prs)
    add_logo_top_left(s, prs)

    add_eyebrow(s, Inches(0.5), Inches(1.5), Inches(8), "Über EINS")
    add_text(s, Inches(0.5), Inches(1.95), Inches(12), Inches(1.4),
             "Wir sind Spezialisten, keine Allround-Agentur.",
             font=FONT_DISPLAY, size=42, bold=True, color=FG_PRIMARY,
             spacing=1.0)

    # Left paragraph
    add_text(s, Inches(0.5), Inches(3.55), Inches(8.0), Inches(2.6),
             ["EINS ist ein Akquise-System für Praxen für ästhetische "
              "Medizin im DACH-Raum. Wir verbinden medizinisch seriöse "
              "Videos mit dem KI-Klon des Inhabers, organische Reichweite "
              "mit bezahlten Anzeigen genau hinter den Beiträgen, die "
              "Anfragen bringen, und eine KI-Vorqualifizierung zu einem "
              "vollständigen Akquisitionssystem.",
              "",
              "Das Ziel ist nicht Sichtbarkeit. Das Ziel ist kontrolliertes, "
              "planbares Wachstum."],
             font=FONT_BODY, size=15, color=FG_PRIMARY, spacing=1.3)

    # Right facts
    facts = [
        ("Sitz",            "Köln, Deutschland"),
        ("Region",          "DACH (DE, AT, CH)"),
        ("Spezialisierung", "Praxen für ästhetische Medizin"),
    ]
    y = Inches(3.55)
    for label, val in facts:
        add_text(s, Inches(8.7), y, Inches(4.2), Inches(0.3), label,
                 font=FONT_MONO, size=10, color=FG_TERTIARY)
        add_text(s, Inches(8.7), y + Inches(0.3), Inches(4.2), Inches(0.5),
                 val, font=FONT_DISPLAY, size=16, color=FG_PRIMARY)
        y += Inches(0.85)

    # 4 pillar cards bottom
    pillars = [
        ("Content-Fundament",  "KI-Videos mit Ihrem Klon"),
        ("Reichweite",         "Organisch, Anzeigen optional"),
        ("KI-Vorqualifizierung","Echte Patienten, kein Spam"),
        ("HWG-Prüfung",        "Schutz vor Abmahnung"),
    ]
    card_w = Inches(2.95)
    gap = Inches(0.18)
    x = Inches(0.5)
    y = Inches(6.25)
    for title, subtitle in pillars:
        add_rect(s, x, y, card_w, Inches(0.85),
                 fill=BG_SECONDARY, line=BORDER,
                 shape=MSO_SHAPE.ROUNDED_RECTANGLE, corner_radius=0.08)
        add_text(s, x + Inches(0.18), y + Inches(0.12), card_w - Inches(0.3),
                 Inches(0.3), title, font=FONT_DISPLAY, size=13, bold=True,
                 color=FG_PRIMARY)
        add_text(s, x + Inches(0.18), y + Inches(0.42), card_w - Inches(0.3),
                 Inches(0.3), subtitle, font=FONT_MONO, size=10,
                 color=FG_SECONDARY)
        x += card_w + gap

    add_footer(s, prs)
    set_speaker_notes(s,
        "Erst hier, Folie 8, reden wir über uns. Zwei Sätze, dann zurück "
        "zur Praxis. 'Was Sie merken werden: wir sind keine Allround-Agentur. "
        "Wir bauen ein System.'\n\n"
        "Quelle: Vault-Notizen `EINS Grundlagen` + `Branding`, "
        "docs/umbau-ki-organisch/KANON.md Abschnitt 3.")
    set_slide_transition_fade(s)
    return s


def slide_9_proof_placeholder(prs):
    s = prs.slides.add_slide(prs.slide_layouts[6])
    background_white(s, prs)
    add_logo_top_left(s, prs)

    add_eyebrow(s, Inches(0.5), Inches(1.5), Inches(8), "Fallstudie · [QUELLE]")
    add_text(s, Inches(0.5), Inches(1.95), Inches(12), Inches(1.4),
             "Was in [ZEITRAUM] möglich war.",
             font=FONT_DISPLAY, size=38, bold=True, color=FG_PRIMARY,
             spacing=1.0)

    # Quote card
    add_rect(s, Inches(0.5), Inches(3.4), Inches(12.4), Inches(2.5),
             fill=BG_SECONDARY, line=BORDER,
             shape=MSO_SHAPE.ROUNDED_RECTANGLE, corner_radius=0.04)

    # silhouette avatar (gray circle, no stock photo)
    av = s.shapes.add_shape(MSO_SHAPE.OVAL, Inches(0.95), Inches(3.85),
                            Inches(1.5), Inches(1.5))
    av.shadow.inherit = False
    av.fill.solid()
    av.fill.fore_color.rgb = BG_TERTIARY
    av.line.color.rgb = BORDER
    av.line.width = Pt(1)

    add_text(s, Inches(2.7), Inches(3.7), Inches(10), Inches(1.0),
             "„[ZITAT_DER_PRAXIS]“",
             font=FONT_DISPLAY, size=22, italic=True, color=FG_PRIMARY,
             spacing=1.25)
    add_text(s, Inches(2.7), Inches(5.0), Inches(10), Inches(0.4),
             "Dr. med. [NAME], Praxis für Ästhetische Medizin, [STADT]",
             font=FONT_MONO, size=11, color=FG_SECONDARY)

    # 3 KPIs
    kpis = [
        ("Qualifizierte Anfragen / Monat", "[ZAHL_1]"),
        ("Kosten pro Anfrage",             "[ZAHL_2]"),
        ("Werbeertrag",                    "[ZAHL_3]"),
    ]
    card_w = Inches(4.0)
    gap = Inches(0.2)
    x = Inches(0.5)
    y = Inches(6.0)
    for label, val in kpis:
        add_rect(s, x, y, card_w, Inches(0.75),
                 fill=ACCENT_GLOW_BG, line=BORDER,
                 shape=MSO_SHAPE.ROUNDED_RECTANGLE, corner_radius=0.08)
        add_text(s, x + Inches(0.2), y + Inches(0.08), card_w - Inches(0.3),
                 Inches(0.3), label, font=FONT_MONO, size=10,
                 color=FG_SECONDARY)
        add_text(s, x + Inches(0.2), y + Inches(0.32), card_w - Inches(0.3),
                 Inches(0.4), val, font=FONT_DISPLAY, size=18, bold=True,
                 color=ACCENT)
        x += card_w + gap

    # Internal flag, visible on slide
    add_text(s, Inches(0.5), Inches(6.82), Inches(12), Inches(0.3),
             "[INTERN: Platzhalter · vor echtem Pitch durch echte Praxis-Daten ersetzen]",
             font=FONT_MONO, size=10, color=FG_TERTIARY, italic=True)

    add_footer(s, prs)
    set_speaker_notes(s,
        "WICHTIG INTERN: Diese Folie ist ein leerer Platzhalter. EINS hat "
        "aktuell (Stand 2026-09-30) keine eigenen Ergebnisse und keine "
        "geschlossenen Kundenfälle, deshalb stehen hier weder Zahlen noch "
        "ein Zitat. Nie wieder Beispielwerte eintragen, die wie Ergebnisse "
        "gelesen werden können.\n\n"
        "Diese Folie NUR verwenden, wenn echte Daten einer Praxis vorliegen "
        "(Zitat und Zahlen mit Freigabe der Praxis). Sonst: ausblenden ODER "
        "ersetzen durch einen zitierten Branchenwert mit klarer "
        "Quellenangabe, z. B. '1.252 % Werbeertrag bei einer "
        "Implantat-Kampagne (Australien, 2018)' aus Vault-Notiz `Statistiken` "
        "#3. Nicht lügen. Nie als eigene Praxis oder eigenes Ergebnis "
        "ausgeben.\n\n"
        "Der eigentliche Beweis dieses Gesprächs sind die Vorschau-Anzeigen "
        "auf Folie 7.")
    set_slide_transition_fade(s)
    return s


def slide_10_services(prs):
    """Vorgeschlagene Leistungen: die drei Ebenen (KANON Abschnitt 3)."""
    s = prs.slides.add_slide(prs.slide_layouts[6])
    background_white(s, prs)
    add_logo_top_left(s, prs)

    add_eyebrow(s, Inches(0.5), Inches(1.5), Inches(8), "Vorgeschlagene Leistungen")
    add_text(s, Inches(0.5), Inches(1.95), Inches(12), Inches(0.9),
             "Jede Lücke bekommt ein Werkzeug.",
             font=FONT_DISPLAY, size=42, bold=True, color=FG_PRIMARY,
             spacing=1.0)
    add_text(s, Inches(0.5), Inches(2.7), Inches(12), Inches(0.4),
             "Drei Ebenen, nie einzeln verkauft: ein Paket.",
             font=FONT_MONO, size=12, color=ACCENT)

    card_w = Inches(4.0)
    gap = Inches(0.2)
    base_y = Inches(3.15)
    card_h = Inches(3.45)
    x = Inches(0.5)
    for tag, name, sub, body, closes in LEVELS:
        add_rect(s, x, base_y, card_w, card_h,
                 fill=BG_SECONDARY, line=BORDER,
                 shape=MSO_SHAPE.ROUNDED_RECTANGLE, corner_radius=0.04)
        inner_x = x + Inches(0.3)
        inner_w = card_w - Inches(0.6)
        add_text(s, inner_x, base_y + Inches(0.22), inner_w, Inches(0.3),
                 tag, font=FONT_MONO, size=11, color=ACCENT, bold=True)
        add_text(s, inner_x, base_y + Inches(0.5), inner_w, Inches(0.4),
                 name, font=FONT_DISPLAY, size=18, bold=True,
                 color=FG_PRIMARY)
        add_text(s, inner_x, base_y + Inches(0.92), inner_w, Inches(0.3),
                 sub, font=FONT_MONO, size=10, color=FG_SECONDARY)
        add_text(s, inner_x, base_y + Inches(1.25), inner_w, Inches(1.6),
                 body, font=FONT_BODY, size=10.5, color=FG_PRIMARY,
                 spacing=1.25)
        add_text(s, inner_x, base_y + Inches(3.1), inner_w, Inches(0.3),
                 closes, font=FONT_MONO, size=9, color=FG_SECONDARY)
        x += card_w + gap

    add_text(s, Inches(0.5), Inches(6.75), Inches(12.4), Inches(0.3),
             "EINS bewertet Beiträge und Anzeigen nach behandelten "
             "Patienten, nicht nach Klicks.",
             font=FONT_MONO, size=11, color=FG_PRIMARY)

    add_footer(s, prs)
    set_speaker_notes(s,
        "LOGISCHER CLOSE. Drei Ebenen, ein Paket, nie einzeln. Für jede "
        "Ebene die Lücke aus Folie 6 nennen, die sie schließt (steht unten "
        "auf der Karte). Frage am Ende: 'Macht das in Ihrem Kontext Sinn? "
        "Erkennen Sie die Logik?' Erwartete Antwort: ja. Das ist der "
        "finale Yes vor dem Geld-Frame.\n\n"
        "Reichweite: organisch zuerst, Anzeigen danach und optional. Das "
        "Ziel bleibt, dass die Praxis Werbebudget hinter die Beiträge "
        "setzt, die Anfragen bringen. Es ist nur nicht mehr die "
        "Eintrittskarte. Organisch findet heraus, was wirkt, Werbebudget "
        "macht es größer.\n\n"
        "Verkauft wird der Nutzen: 'Sie müssen nie vor die Kamera' und "
        "'schneller Start' nach vorne. Auf Nachfrage offen sagen, dass es "
        "KI ist. Keine Stückzahl nennen ('X Beiträge pro Monat'): es gibt "
        "keine Stückzahl-Zusage.\n\n"
        "Schutz vor Nachahmern: KI-Anzeigen kann jeder bauen. Was niemand "
        "sonst hat, ist die Auswertung, welcher Beitrag zu einer "
        "behandelten Patientin mit Umsatz geführt hat (Portal plus "
        "PVS-Bridge).\n\n"
        "Quelle: docs/umbau-ki-organisch/KANON.md Abschnitt 3.")
    set_slide_transition_fade(s)
    return s


def slide_11_value_equation(prs):
    """Wertgleichung ohne Pflicht-Budget, ohne erfundene Zahlen.

    Alle Praxis-Zahlen sind [BRACKETED] und kommen aus dem Gespräch. Die
    einzigen festen Zahlen sind aus dem Kanon: 1.900 € netto im Monat,
    keine Einrichtungsgebühr, 12 Monate als Rechenrahmen (12 x 1.900 =
    22.800 €).
    """
    s = prs.slides.add_slide(prs.slide_layouts[6])
    background_white(s, prs)
    add_logo_top_left(s, prs)

    add_eyebrow(s, Inches(0.5), Inches(1.5), Inches(8), "Wert für Sie")
    add_text(s, Inches(0.5), Inches(1.95), Inches(12), Inches(0.9),
             "Die Rechnung, ehrlich.",
             font=FONT_DISPLAY, size=46, bold=True, color=FG_PRIMARY,
             spacing=1.0)

    # Value Equation visual (top half)
    add_rect(s, Inches(0.5), Inches(2.85), Inches(12.4), Inches(1.2),
             fill=BG_SECONDARY, line=BORDER,
             shape=MSO_SHAPE.ROUNDED_RECTANGLE, corner_radius=0.06)
    add_text(s, Inches(0.5), Inches(3.0), Inches(12.4), Inches(0.4),
             "Wert  =  (Traum-Ergebnis  ×  Wahrscheinlichkeit)  ÷  (Zeit bis Erfolg  ×  Aufwand)",
             font=FONT_DISPLAY, size=20, bold=True, color=FG_PRIMARY,
             align=PP_ALIGN.CENTER)
    add_text(s, Inches(0.5), Inches(3.5), Inches(12.4), Inches(0.4),
             "Hormozi Value Equation · konkret auf Ihre Praxis gerechnet",
             font=FONT_MONO, size=11, color=ACCENT, align=PP_ALIGN.CENTER)

    # Math block: Praxis-Zahlen als Platzhalter, aus dem Gespräch
    rows = [
        ("Traum-Ergebnis",       "[N_PATIENTEN] zusätzliche Patienten / Monat", False),
        ("× Ø Behandlungswert",  "[Ø_BEHANDLUNGSWERT] €",                       False),
        ("= Mehrwert / Monat",   "[MEHRWERT_MONAT] €",                          False),
        ("× 12 Monate",          "[MEHRWERT_JAHR] €",                           False),
        ("− EINS-Investition",   "22.800 € (12 × 1.900 € netto, keine Einrichtungsgebühr)", False),
        ("− Werbebudget",        "zu Beginn keine Pflicht",                     False),
        ("= Netto-Wert Jahr 1",  "ca. [NETTO_WERT_JAHR_1] €",                   True),
    ]
    dividers_before = {2, 6}
    y = Inches(4.25)
    for idx, (label, val, highlight) in enumerate(rows):
        color = ACCENT if highlight else FG_PRIMARY
        if idx in dividers_before:
            add_rect(s, Inches(0.7), y - Inches(0.04), Inches(12.0),
                     Emu(9525), fill=BORDER)
        add_text(s, Inches(0.7), y, Inches(5.5), Inches(0.3), label,
                 font=FONT_MONO, size=13, color=color, bold=highlight)
        add_text(s, Inches(6.5), y, Inches(6.4), Inches(0.3), val,
                 font=FONT_MONO, size=13, color=color, bold=highlight)
        y += Inches(0.3)

    add_text(s, Inches(0.5), Inches(6.5), Inches(12.4), Inches(0.3),
             "Rechenbeispiel mit Ihren Zahlen, keine Umsatz-Zusage.",
             font=FONT_MONO, size=10, color=FG_SECONDARY)
    add_text(s, Inches(0.5), Inches(6.72), Inches(12.4), Inches(0.3),
             "Erste Rechnung erst mit der ersten qualifizierten Anfrage "
             "über EINS. Kommt in 90 Tagen keine, endet die Zusammenarbeit "
             "ohne Kosten.",
             font=FONT_MONO, size=10, color=FG_SECONDARY)

    add_footer(s, prs)
    set_speaker_notes(s,
        "WERTGLEICHUNG KONKRET. Vorab: die Zahlen der Praxis aus dem "
        "Gespräch in die Platzhalter eintragen ([N_PATIENTEN], "
        "[Ø_BEHANDLUNGSWERT], [MEHRWERT_MONAT], [MEHRWERT_JAHR], "
        "[NETTO_WERT_JAHR_1]). Nicht durch mehrere Szenarien gehen. Keine "
        "Zahl nennen, die die Praxis nicht selbst gesagt hat: EINS hat noch "
        "keine eigenen Ergebnisse.\n\n"
        "Die vier Hebel der Gleichung, mündlich: Traum-Ergebnis (Ziele, "
        "Folie 5). Wahrscheinlichkeit: Sie zahlen erst ab der ersten "
        "qualifizierten Anfrage über EINS (Folie 12). Zeit bis Erfolg: "
        "erste Beiträge ab Woche 2 (Folie 15). Aufwand: einmal wenige "
        "Minuten Aufnahme, danach wenige Minuten pro Woche für die "
        "Freigabe.\n\n"
        "Das Werbebudget steht bewusst nicht in der Rechnung: Zu Beginn "
        "brauchen Sie keins. Sobald sichtbar ist, welche Beiträge "
        "Anfragen bringen, schlagen wir vor, wie viel dahinter gehört "
        "(Folie 14). Keine Mindest- oder Richtzahl nennen.\n\n"
        "Quelle: docs/umbau-ki-organisch/KANON.md Abschnitte 4, 5 und 9.")
    set_slide_transition_fade(s)
    return s


def slide_12_guarantee(prs):
    """Garantie "Keine Anfrage, keine Rechnung" (KANON Abschnitt 5).

    Wortlaut wörtlich, dazu die wichtigsten Regeln. Beide Grenzen ("erste
    qualifizierte Anfrage über EINS" und "90 Tage") stehen im selben Absatz
    und auf derselben Folie (§ 5 UWG, § 307 BGB).
    """
    s = prs.slides.add_slide(prs.slide_layouts[6])
    background_white(s, prs)
    add_logo_top_left(s, prs)

    add_eyebrow(s, Inches(0.5), Inches(1.5), Inches(8), "Die Garantie")
    add_text(s, Inches(0.5), Inches(1.95), Inches(12), Inches(0.9),
             "Keine Anfrage, keine Rechnung.",
             font=FONT_DISPLAY, size=42, bold=True, color=FG_PRIMARY,
             spacing=1.0)

    # Wortlaut card with headshot
    add_rect(s, Inches(0.5), Inches(2.85), Inches(12.4), Inches(1.5),
             fill=ACCENT_GLOW_BG, line=ACCENT,
             shape=MSO_SHAPE.ROUNDED_RECTANGLE, corner_radius=0.06)
    if HEADSHOT_PNG.exists():
        s.shapes.add_picture(str(HEADSHOT_PNG), Inches(0.8), Inches(3.0),
                             height=Inches(1.2))
    add_text(s, Inches(2.2), Inches(3.05), Inches(10.4), Inches(0.9),
             GUARANTEE_QUOTE,
             font=FONT_DISPLAY, size=17, italic=True, color=FG_PRIMARY,
             spacing=1.25)
    add_text(s, Inches(2.2), Inches(3.95), Inches(10.4), Inches(0.3),
             "Karam Issa · Gründer, EINS",
             font=FONT_MONO, size=10, color=FG_SECONDARY)

    # 4 rule cards
    card_w = Inches(2.95)
    gap = Inches(0.2)
    base_y = Inches(4.5)
    card_h = Inches(2.2)
    x = Inches(0.5)
    for num, title, body in GUARANTEE_RULES:
        add_rect(s, x, base_y, card_w, card_h,
                 fill=BG_SECONDARY, line=BORDER,
                 shape=MSO_SHAPE.ROUNDED_RECTANGLE, corner_radius=0.04)
        add_text(s, x + Inches(0.2), base_y + Inches(0.18), Inches(0.5),
                 Inches(0.3), num, font=FONT_MONO, size=11, color=ACCENT,
                 bold=True)
        add_text(s, x + Inches(0.7), base_y + Inches(0.15),
                 card_w - Inches(0.85), Inches(0.32), title,
                 font=FONT_DISPLAY, size=13, bold=True, color=FG_PRIMARY)
        add_text(s, x + Inches(0.2), base_y + Inches(0.55),
                 card_w - Inches(0.4), Inches(1.6), body,
                 font=FONT_BODY, size=10, color=FG_PRIMARY, spacing=1.15)
        x += card_w + gap

    add_text(s, Inches(0.5), Inches(6.8), Inches(12.4), Inches(0.3),
             GUARANTEE_NOT,
             font=FONT_MONO, size=10, color=FG_SECONDARY)

    add_footer(s, prs)
    set_speaker_notes(s,
        "RISIKO UMKEHREN, VOR DEM PREIS. Den Wortlaut ruhig vorlesen, "
        "nichts ergänzen. Beide Grenzen immer zusammen nennen, auch "
        "mündlich: 'erste qualifizierte Anfrage über EINS' und '90 Tage'. "
        "Nie 'wir garantieren Anfragen' sagen und keine Rückzahlung "
        "versprechen: Sie zahlen erst ab der ersten Anfrage, es gibt nichts "
        "zurückzuzahlen. "
        "Es ist eine Garantie, kein Ausprobieren, und sie gilt für jede "
        "Praxis, ohne Verknappung.\n\n"
        "Wenn 'Was zählt als Anfrage?' kommt: nur die drei EINS-Messwege "
        "(Formular auf einer EINS-Zielseite, Anruf auf der "
        "EINS-Tracking-Nummer, Buchung über den EINS-Buchungslink). "
        "Selbstauskünfte ('Wie sind Sie auf uns aufmerksam geworden?') "
        "lösen die Rechnung nicht aus. Nicht die erste gebuchte Beratung "
        "ist der Auslöser, weil die am Rückruf des Praxisteams hängt. Der "
        "KI-Score entscheidet nie, ob eine Anfrage zählt.\n\n"
        "Wenn 'Was, wenn wir mit der Freigabe in Verzug sind?' kommt: "
        "Jeder Verzugstag verlängert die 90 Tage um einen Tag, wir teilen "
        "jeden Verzug per E-Mail mit. Es gibt keine automatische "
        "Freigabe: Kein Beitrag ohne Ihre Freigabe.\n\n"
        "Das Werbebudget der Praxis trägt keine eigene Garantie, keine "
        "Garantie übernimmt es oder friert den Preis ein.\n\n"
        "Neben der Garantie versprechen wir (steuerbar, aber keine "
        "Garantie): Kein Beitrag ohne Ihre Freigabe. Sie müssen nie vor "
        "die Kamera. Jede Anfrage mit Herkunft im Portal.\n\n"
        "Quelle: docs/umbau-ki-organisch/KANON.md Abschnitte 5 und 6.")
    set_slide_transition_fade(s)
    return s


def slide_13_material_klon(prs):
    """Das Material und Ihr Klon gehören Ihnen (KANON Abschnitt 7).

    Wortlaut wörtlich aus dem Kanon. Formulierung "dauerhaft nutzen", nie "Urheberrecht".
    """
    s = prs.slides.add_slide(prs.slide_layouts[6])
    background_white(s, prs)
    add_logo_top_left(s, prs)

    add_eyebrow(s, Inches(0.5), Inches(1.5), Inches(8), "Material und Klon")
    add_text(s, Inches(0.5), Inches(1.95), Inches(12), Inches(1.5),
             "Das Material und Ihr Klon",
             font=FONT_DISPLAY, size=46, bold=True, color=FG_PRIMARY,
             spacing=1.0)
    add_text(s, Inches(0.5), Inches(2.65), Inches(12), Inches(0.7),
             "gehören Ihnen.",
             font=FONT_DISPLAY, size=46, bold=False, color=ACCENT,
             spacing=1.0)

    add_rect(s, Inches(0.5), Inches(3.6), Inches(12.4), Inches(2.85),
             fill=ACCENT_GLOW_BG, line=ACCENT,
             shape=MSO_SHAPE.ROUNDED_RECTANGLE, corner_radius=0.04)

    columns = [
        ("01", "Das Material gehört Ihnen.",
         "Sobald die erste Rechnung bezahlt ist, dürfen Sie alles, was für "
         "Ihre Praxis entstanden ist, dauerhaft nutzen und bearbeiten, "
         "auch nach einer Kündigung und mit einer anderen Agentur.",
         "Endet die Zusammenarbeit nach 90 Tagen ohne Anfrage, dürfen "
         "bereits veröffentlichte Beiträge auf Ihren Kanälen stehen "
         "bleiben. Anfragedaten bekommen Sie bei Vertragsende als Export."),
        ("02", "Ihr KI-Klon gehört Ihnen.",
         "Wir nutzen Ihr Gesicht und Ihre Stimme nur für Ihre Praxis, nie "
         "für eigene Werbung ohne Ihre gesonderte schriftliche "
         "Einwilligung, und löschen das Klon-Modell spätestens 30 Tage "
         "nach Vertragsende.",
         "Widerrufen Sie Ihre Einwilligung, stoppen wir sofort alle "
         "Beiträge mit dem Klon und löschen das Modell. Jeder Beitrag ist "
         "als KI-generiert gekennzeichnet und geht erst nach Ihrer "
         "Freigabe raus."),
    ]
    col_w = Inches(5.75)
    for i, (num, title, line, detail) in enumerate(columns):
        col_x = Inches(0.85) if i == 0 else Inches(6.85)
        y = Inches(3.85)
        add_text(s, col_x, y + Inches(0.06), Inches(0.6), Inches(0.3), num,
                 font=FONT_MONO, size=11, color=ACCENT, bold=True)
        add_text(s, col_x + Inches(0.55), y, col_w - Inches(0.55),
                 Inches(0.4), title, font=FONT_DISPLAY, size=20, bold=True,
                 color=FG_PRIMARY)
        add_text(s, col_x + Inches(0.55), y + Inches(0.5),
                 col_w - Inches(0.55), Inches(1.1), line,
                 font=FONT_BODY, size=13, color=FG_PRIMARY, spacing=1.25)
        add_text(s, col_x + Inches(0.55), y + Inches(1.75),
                 col_w - Inches(0.55), Inches(0.75), detail,
                 font=FONT_BODY, size=11, color=FG_SECONDARY, spacing=1.3)

    add_text(s, Inches(0.5), Inches(6.6), Inches(12.4), Inches(0.3),
             "Nicht dabei: Vorlagen, Prompts und Werkzeuge von EINS, die "
             "Software (Portal, CRM, KI-Scoring, Zielseiten-Technik) und "
             "Werbekonten.",
             font=FONT_MONO, size=10, color=FG_SECONDARY)
    add_text(s, Inches(0.5), Inches(6.83), Inches(12.4), Inches(0.3),
             "Vertraglich geregelt in § 9 des Hauptvertrags und in der "
             "Einwilligung zu KI-Abbild und Stimme.",
             font=FONT_MONO, size=10, color=FG_SECONDARY)

    add_footer(s, prs)
    set_speaker_notes(s,
        "MATERIAL UND KLON. Reihenfolge im Gespräch: Vorschau-Anzeigen "
        "(Folie 7), Wert-Rechnung (Folie 11), Garantie (Folie 12), diese "
        "Folie, dann Preis (Folie 14).\n\n"
        "So sagen: 'Sobald die erste Rechnung bezahlt ist, dürfen Sie "
        "alles, was für Ihre Praxis entstanden ist, dauerhaft nutzen und "
        "bearbeiten, auch nach einer Kündigung und mit einer anderen "
        "Agentur. Und Ihr Klon gehört Ihnen: Wir nutzen Ihr Gesicht und "
        "Ihre Stimme nur für Ihre Praxis und löschen das Modell "
        "spätestens 30 Tage nach Vertragsende.'\n\n"
        "Formulierung 'dauerhaft nutzen', nie 'Urheberrecht': Reine "
        "KI-Ergebnisse sind in Deutschland meist nicht urheberrechtlich "
        "geschützt, die Zusage ist vertraglich.\n\n"
        "Endet die Zusammenarbeit nach 90 Tagen ohne Anfrage: Bereits "
        "veröffentlichte Beiträge dürfen auf den Kanälen der Praxis "
        "stehen bleiben, weitere Nutzungsrechte entstehen nicht. Widerruft "
        "der Inhaber die Einwilligung, stoppt EINS sofort alle Beiträge "
        "mit dem Klon und löscht das Modell.\n\n"
        "Ehrlich bleiben: KI-Material lässt sich billig neu bauen. Was die "
        "Praxis wirklich hält, ist die Auswertung im Portal, nicht die "
        "Dateien. Werbekonten sind nicht Teil dieses Versprechens. "
        "Anwalt vor der ersten Unterschrift: Kennzeichnung des Klons "
        "(AI Act Art. 50) und Berufsrecht (MBO-Ä § 27).\n\n"
        "Quelle: docs/umbau-ki-organisch/KANON.md Abschnitte 7 und 8.")
    set_slide_transition_fade(s)
    return s


def slide_14_pricing(prs):
    """Investition: ein Paket, 1.900 € netto (KANON Abschnitt 4)."""
    s = prs.slides.add_slide(prs.slide_layouts[6])
    background_white(s, prs)
    add_logo_top_left(s, prs)

    add_eyebrow(s, Inches(0.5), Inches(1.5), Inches(8), "Investition")
    add_text(s, Inches(0.5), Inches(1.95), Inches(12), Inches(0.9),
             "Ein Paket. Ein Preis.",
             font=FONT_DISPLAY, size=42, bold=True, color=FG_PRIMARY,
             spacing=1.0)

    # Left: das Paket
    left_x = Inches(0.5)
    left_w = Inches(5.5)
    base_y = Inches(3.0)
    add_rect(s, left_x, base_y, left_w, Inches(3.85),
             fill=ACCENT_GLOW_BG, line=ACCENT,
             shape=MSO_SHAPE.ROUNDED_RECTANGLE, corner_radius=0.04)
    inner_x = left_x + Inches(0.3)
    inner_w = left_w - Inches(0.6)
    add_text(s, inner_x, base_y + Inches(0.22), inner_w, Inches(0.3),
             "Ihr Paket für [PRAXIS_NAME]", font=FONT_MONO, size=11,
             color=FG_SECONDARY)
    add_text(s, inner_x, base_y + Inches(0.55), Inches(2.6), Inches(0.8),
             "1.900 €", font=FONT_DISPLAY, size=44, bold=True,
             color=FG_PRIMARY)
    add_text(s, inner_x + Inches(2.75), base_y + Inches(0.95), Inches(2.0),
             Inches(0.3), "netto / Monat", font=FONT_MONO, size=12,
             color=FG_SECONDARY)
    add_text(s, inner_x, base_y + Inches(1.4), inner_w, Inches(0.3),
             "Keine Einrichtungsgebühr · monatlich kündbar",
             font=FONT_MONO, size=10, color=FG_SECONDARY)
    bullets = [
        "KI-Videos mit Ihrem Klon, Erklär-Animationen, Bildmaterial",
        "Beiträge organisch auf Ihren Kanälen",
        "Betreuung der Anzeigen ist im Preis enthalten",
        "Zielseiten, KI-Vorqualifizierung, Weiterleitung",
        "Erinnerungen, Nachfassen, Bewertungsanfragen",
        "Auswertung bis zu Buchung und Umsatz im Portal",
        "HWG-Prüfung jedes Beitrags und jeder Anzeige",
        "Ansprechpartner: direkt der Gründer",
        "Technischer Support: Reaktionszeit unter 24 Stunden",
        "Strategie-Gespräche: monatlich (etwa 30 Minuten)",
    ]
    y = base_y + Inches(1.62)
    for b in bullets:
        add_text(s, inner_x, y, inner_w, Inches(0.26), "· " + b,
                 font=FONT_BODY, size=11, color=FG_PRIMARY, spacing=1.15)
        y += Inches(0.23)

    # Right top: erste Rechnung
    right_x = Inches(6.25)
    right_w = Inches(6.65)
    add_rect(s, right_x, base_y, right_w, Inches(1.8),
             fill=BG_PRIMARY, line=ACCENT,
             shape=MSO_SHAPE.ROUNDED_RECTANGLE, corner_radius=0.05)
    add_text(s, right_x + Inches(0.3), base_y + Inches(0.2), Inches(6.0),
             Inches(0.3), "Erste Rechnung", font=FONT_MONO, size=11,
             color=ACCENT, bold=True)
    add_text(s, right_x + Inches(0.3), base_y + Inches(0.5), Inches(6.05),
             Inches(0.6),
             "Die erste Rechnung kommt erst, wenn die erste qualifizierte "
             "Anfrage über EINS in Ihrem Portal liegt.",
             font=FONT_DISPLAY, size=15, bold=True, color=FG_PRIMARY,
             spacing=1.2)
    add_text(s, right_x + Inches(0.3), base_y + Inches(1.2), Inches(6.05),
             Inches(0.5),
             "Kommt in 90 Tagen keine, endet die Zusammenarbeit, und Sie "
             "haben nichts bezahlt.",
             font=FONT_BODY, size=11, color=FG_PRIMARY, spacing=1.25)

    # Right bottom: Werbebudget als nächster Schritt
    ry = base_y + Inches(1.95)
    add_rect(s, right_x, ry, right_w, Inches(1.9),
             fill=BG_SECONDARY, line=BORDER,
             shape=MSO_SHAPE.ROUNDED_RECTANGLE, corner_radius=0.05)
    add_text(s, right_x + Inches(0.3), ry + Inches(0.2), Inches(6.0),
             Inches(0.3), "Werbebudget: der nächste Schritt",
             font=FONT_MONO, size=11, color=ACCENT, bold=True)
    add_text(s, right_x + Inches(0.3), ry + Inches(0.5), Inches(6.05),
             Inches(0.85),
             "Zu Beginn brauchen Sie kein Werbebudget. Wir starten "
             "organisch. Sobald wir sehen, welche Beiträge Anfragen "
             "bringen, schlagen wir vor, wie viel Werbebudget dahinter "
             "gehört. Das Budget zahlen Sie direkt an Meta und Google.",
             font=FONT_BODY, size=11, color=FG_PRIMARY, spacing=1.25)
    add_text(s, right_x + Inches(0.3), ry + Inches(1.4), Inches(6.05),
             Inches(0.45),
             "Organisch findet heraus, was wirkt. Werbebudget macht es "
             "größer. So verbrennen Sie kein Budget für Vermutungen.",
             font=FONT_BODY, size=11, bold=True, color=FG_PRIMARY,
             spacing=1.25)

    add_footer(s, prs)
    set_speaker_notes(s,
        "EIN PAKET. Den Preis einmal nennen, dann Pause. Nicht "
        "entschuldigen, nicht relativieren, keine Optionen anbieten: Es "
        "gibt ein Paket, keine Einrichtungsgebühr, monatlich kündbar.\n\n"
        "Der Hebel ist der Kasten rechts oben: 'Die erste Rechnung kommt "
        "erst, wenn die erste qualifizierte Anfrage über EINS in Ihrem "
        "Portal liegt.' Kurz sagen, dabei die 90 Tage mitnennen, nicht "
        "ausbauen (Details Folie 12).\n\n"
        "Werbebudget (Kasten rechts unten), immer in dieser Reihenfolge "
        "nennen: Organisch findet heraus, was wirkt. Werbebudget macht es "
        "größer. Ab der ersten qualifizierten Anfrage schlägt EINS "
        "konkret vor, welches Budget hinter welche Beiträge und "
        "Behandlungen gehört. Die Höhe richtet sich nach den Kosten pro "
        "Anfrage, die dann sichtbar sind. Keine Mindest- oder Richtzahl "
        "nennen, keine erfinden. Das Ziel bleibt, dass jede Praxis in "
        "Werbebudget investiert, es ist nur nicht die Eintrittskarte.\n\n"
        "Wenn 'Das ist teuer' kommt: zur FAQ-Folie 16 vorblättern. Keine "
        "Knappheit, keine Frist.\n\n"
        "Quelle: docs/umbau-ki-organisch/KANON.md Abschnitt 4.")
    set_slide_transition_fade(s)
    return s


def slide_15_next_steps(prs):
    """Nächste Schritte: Ablauf nach der Unterschrift (KANON Abschnitt 9)."""
    s = prs.slides.add_slide(prs.slide_layouts[6])
    background_white(s, prs)
    add_logo_top_left(s, prs)

    add_eyebrow(s, Inches(0.5), Inches(1.5), Inches(8), "Nächste Schritte")
    add_text(s, Inches(0.5), Inches(1.95), Inches(12), Inches(1.0),
             "Von Tag 1 bis zur ersten Anfrage.",
             font=FONT_DISPLAY, size=42, bold=True, color=FG_PRIMARY,
             spacing=1.0)

    # 5-step horizontal stepper
    n = len(TIMELINE)
    gap = Inches(0.225)
    card_w = int((Inches(12.4) - gap * (n - 1)) / n)
    base_y = Inches(3.2)
    card_h = Inches(3.05)
    highlight_idx = 3  # Erste Rechnung
    x = Inches(0.5)

    for i, (when, title, body) in enumerate(TIMELINE):
        is_hl = i == highlight_idx
        fill = ACCENT_GLOW_BG if is_hl else BG_SECONDARY
        line = ACCENT if is_hl else BORDER
        add_rect(s, x, base_y, card_w, card_h,
                 fill=fill, line=line,
                 shape=MSO_SHAPE.ROUNDED_RECTANGLE, corner_radius=0.04)

        # number circle
        circ = s.shapes.add_shape(MSO_SHAPE.OVAL, x + Inches(0.2),
                                  base_y + Inches(0.2),
                                  Inches(0.42), Inches(0.42))
        circ.shadow.inherit = False
        circ.fill.solid()
        circ.fill.fore_color.rgb = ACCENT
        circ.line.fill.background()
        add_text(s, x + Inches(0.2), base_y + Inches(0.27), Inches(0.42),
                 Inches(0.3), str(i + 1), font=FONT_DISPLAY, size=14,
                 bold=True, color=BG_PRIMARY, align=PP_ALIGN.CENTER)

        add_text(s, x + Inches(0.75), base_y + Inches(0.27),
                 card_w - Inches(0.85), Inches(0.3), when,
                 font=FONT_MONO, size=10, color=ACCENT, bold=True)
        add_text(s, x + Inches(0.2), base_y + Inches(0.8),
                 card_w - Inches(0.4), Inches(0.55), title,
                 font=FONT_DISPLAY, size=15, bold=True, color=FG_PRIMARY,
                 spacing=1.05)
        add_text(s, x + Inches(0.2), base_y + Inches(1.45),
                 card_w - Inches(0.4), Inches(1.4), body,
                 font=FONT_BODY, size=10.5, color=FG_PRIMARY, spacing=1.25)

        x += card_w + gap

    # Footer lines about the Praxis' effort
    add_text(s, Inches(0.5), Inches(6.35), Inches(12.4), Inches(0.4),
             "Was Ihre Praxis beiträgt: wenige Minuten Klon-Aufnahme · "
             "Einwilligung und Zugänge in 3 Werktagen · wöchentlich "
             "Beiträge freigeben.",
             font=FONT_MONO, size=11, color=FG_PRIMARY)
    add_text(s, Inches(0.5), Inches(6.7), Inches(12.4), Inches(0.4),
             "Den Rest übernehmen wir.",
             font=FONT_DISPLAY, size=18, bold=True, color=ACCENT)

    add_footer(s, prs)
    set_speaker_notes(s,
        "KONKRETHEIT. Jeden Schritt nennen. Onboarding-Gespräch und "
        "Klon-Aufnahme werden im Gespräch gleich terminiert. Frage am "
        "Ende: 'Wann passt Ihnen das Onboarding-Gespräch, Anfang oder "
        "Ende nächster Woche?' Assumed-Choice, nicht 'wollen Sie' "
        "sondern 'wann'.\n\n"
        "Ablauf (alles aus der Ferne, keine Anreise): Tag der "
        "Unterschrift: die 90 Tage beginnen. Woche 1: Onboarding-Gespräch "
        "per Video, Einwilligung, Zugänge, Klon-Aufnahme am Handy. Woche "
        "1 bis 2: Klon und Zielseite stehen, erste Beiträge zur "
        "Freigabe. Ab Woche 2: erste Beiträge live, Anfragen laufen mit "
        "Herkunft ins Portal. Erste qualifizierte Anfrage: erste "
        "Rechnung, EINS schlägt vor, welches Werbebudget hinter welche "
        "Beiträge gehört. Laufend: wöchentliche Freigabe, monatliche "
        "Auswertung im Portal (welche Beiträge und Anzeigen liefen, welche "
        "gestoppt wurden, wie viele Anfragen kamen, wie viele Behandlungen "
        "daraus wurden). Tag 90 plus Verzugstage: spätester Zeitpunkt für "
        "die erste Anfrage, sonst endet die Zusammenarbeit ohne Kosten.\n\n"
        "Freigaben laufen für die ersten Kunden per E-Mail, eine Freigabe "
        "im Portal kommt danach. Keine Stückzahl nennen.\n\n"
        "Quelle: docs/umbau-ki-organisch/KANON.md Abschnitte 6 und 9.")
    set_slide_transition_fade(s)
    return s


def slide_16_faq(prs):
    """Häufige Fragen: Kernsätze wörtlich aus KANON Abschnitt 10."""
    s = prs.slides.add_slide(prs.slide_layouts[6])
    background_white(s, prs)
    add_logo_top_left(s, prs)

    add_eyebrow(s, Inches(0.5), Inches(1.5), Inches(8), "Häufige Fragen")
    add_text(s, Inches(0.5), Inches(1.95), Inches(12), Inches(0.8),
             "Bereits vorab beantwortet.",
             font=FONT_DISPLAY, size=38, bold=True, color=FG_PRIMARY,
             spacing=1.0)

    # 8 FAQ items in 2 columns x 4 rows
    col_w = Inches(6.05)
    col1_x = Inches(0.5)
    col2_x = Inches(6.85)
    base_y = Inches(2.85)
    row_h = Inches(1.0)

    for i, (q, a) in enumerate(FAQ):
        col_x = col1_x if i % 2 == 0 else col2_x
        row = i // 2
        y = base_y + row_h * row
        add_text(s, col_x, y, col_w, Inches(0.3), q,
                 font=FONT_DISPLAY, size=12, bold=True, color=FG_PRIMARY,
                 spacing=1.1)
        add_text(s, col_x, y + Inches(0.3), col_w, Inches(0.65), a,
                 font=FONT_BODY, size=10, color=FG_PRIMARY, spacing=1.25)

    add_footer(s, prs)
    set_speaker_notes(s,
        "EINWAND-VORGRIFF. Die Antworten stehen wörtlich im Kanon "
        "(Abschnitt 10), nicht umformulieren. Weitere Einwände, die hier "
        "nicht stehen:\n\n"
        "'Kann ich nur die Videos oder nur die Anzeigen haben?': 'Es gibt "
        "ein Paket. Beiträge allein bringen Reichweite. Erst Zielseite, "
        "Vorqualifizierung und Portal machen daraus Anfragen, die Sie bis "
        "zur Behandlung nachverfolgen können.'\n\n"
        "'Was kostet das?': '1.900 € netto im Monat, keine "
        "Einrichtungsgebühr, monatlich kündbar. Die erste Rechnung kommt "
        "erst mit der ersten qualifizierten Anfrage.'\n\n"
        "Wenn ein Einwand kommt, der nicht hier steht: Sales Playbook "
        "(Vault-Notiz), Abschnitt Einwände, im Kopf haben. Wenn 'müssen wir "
        "intern besprechen' kommt: Folie 17 zeigen und das Folgegespräch "
        "direkt buchen, NICHT per E-Mail hinterherjagen lassen.\n\n"
        "Quelle: docs/umbau-ki-organisch/KANON.md Abschnitt 10.")
    set_slide_transition_fade(s)
    return s


def slide_17_close(prs):
    s = prs.slides.add_slide(prs.slide_layouts[6])
    background_white(s, prs)
    add_logo_top_left(s, prs)

    add_eyebrow(s, Inches(0.5), Inches(1.5), Inches(8), "Entscheidung")
    add_text(s, Inches(0.5), Inches(1.95), Inches(12), Inches(1.4),
             "Zwei Wege nach vorne.",
             font=FONT_DISPLAY, size=58, bold=True, color=FG_PRIMARY,
             align=PP_ALIGN.CENTER, spacing=1.0)

    # Two large option cards
    card_w = Inches(5.95)
    gap = Inches(0.5)
    base_y = Inches(3.5)
    card_h = Inches(3.0)

    # Option A: mint tint, primary (dark text on tint, never text on solid mint)
    x_a = Inches(0.5)
    add_rect(s, x_a, base_y, card_w, card_h,
             fill=ACCENT_GLOW_BG, line=ACCENT,
             shape=MSO_SHAPE.ROUNDED_RECTANGLE, corner_radius=0.04)
    add_text(s, x_a + Inches(0.4), base_y + Inches(0.3), card_w - Inches(0.6),
             Inches(0.4), "Option A", font=FONT_MONO, size=12,
             color=ACCENT, bold=True)
    add_text(s, x_a + Inches(0.4), base_y + Inches(0.7), card_w - Inches(0.6),
             Inches(0.7), "Jetzt starten", font=FONT_DISPLAY, size=32,
             bold=True, color=FG_PRIMARY)
    add_text(s, x_a + Inches(0.4), base_y + Inches(1.4), card_w - Inches(0.6),
             Inches(0.4),
             "1.900 € netto im Monat, keine Einrichtungsgebühr",
             font=FONT_MONO, size=12, color=FG_PRIMARY)
    add_text(s, x_a + Inches(0.4), base_y + Inches(1.8), card_w - Inches(0.8),
             Inches(1.1),
             "Wir terminieren Onboarding-Gespräch und Klon-Aufnahme direkt "
             "jetzt. Die erste Rechnung kommt erst mit der ersten "
             "qualifizierten Anfrage über EINS. Kommt in 90 Tagen keine, "
             "endet die Zusammenarbeit ohne Kosten.",
             font=FONT_BODY, size=12, color=FG_PRIMARY, spacing=1.3)

    # Option B: outline
    x_b = x_a + card_w + gap
    add_rect(s, x_b, base_y, card_w, card_h,
             fill=BG_PRIMARY, line=FG_PRIMARY,
             shape=MSO_SHAPE.ROUNDED_RECTANGLE, corner_radius=0.04)
    add_text(s, x_b + Inches(0.4), base_y + Inches(0.3), card_w - Inches(0.6),
             Inches(0.4), "Option B", font=FONT_MONO, size=12,
             color=FG_TERTIARY)
    add_text(s, x_b + Inches(0.4), base_y + Inches(0.7), card_w - Inches(0.6),
             Inches(0.7), "Folgegespräch", font=FONT_DISPLAY, size=32,
             bold=True, color=FG_PRIMARY)
    add_text(s, x_b + Inches(0.4), base_y + Inches(1.4), card_w - Inches(0.6),
             Inches(0.4),
             "30 Minuten · Termin: [FOLGETERMIN]",
             font=FONT_MONO, size=12, color=FG_SECONDARY)
    add_text(s, x_b + Inches(0.4), base_y + Inches(1.8), card_w - Inches(0.8),
             Inches(1.1),
             "Wir klären offene Fragen. Sie entscheiden in Ruhe.",
             font=FONT_BODY, size=12, color=FG_PRIMARY, spacing=1.3)

    # Versprechen neben der Garantie
    add_text(s, Inches(0.5), Inches(6.65), Inches(12.4), Inches(0.4),
             "Kein Beitrag ohne Ihre Freigabe  ·  Sie müssen nie vor die "
             "Kamera  ·  Jede Anfrage mit Herkunft im Portal",
             font=FONT_MONO, size=11, color=FG_SECONDARY,
             align=PP_ALIGN.CENTER)

    # Contact strip
    add_text(s, Inches(0.5), Inches(7.0), Inches(12.4), Inches(0.4),
             "team@eins.ag  ·  +49 162 8456643  ·  eins.ag",
             font=FONT_MONO, size=11, color=FG_PRIMARY,
             align=PP_ALIGN.CENTER)

    set_speaker_notes(s,
        "ZWEI-OPTIONEN-ABSCHLUSS. Kein Ja/Nein. Karam stellt offen: 'Was "
        "passt für Sie besser, heute starten oder nochmal in zwei Tagen "
        "sprechen?' Schweigen aushalten. Keine Frist setzen, keine "
        "Warteliste, keine Verknappung.\n\n"
        "Wenn 'B' kommt: sofort Termin im Kalender buchen, LIVE, nicht "
        "nachträglich per E-Mail.\n"
        "Wenn 'A' kommt: Onboarding-Gespräch und Klon-Aufnahme sofort "
        "terminieren, Vertrag innerhalb 24h nachreichen (Anwalt vor der "
        "ersten Unterschrift, siehe KANON Abschnitt 8).\n\n"
        "Die Garantie immer mit beiden Grenzen nennen: 'erste "
        "qualifizierte Anfrage über EINS' und '90 Tage'.\n\n"
        "Quelle: docs/umbau-ki-organisch/KANON.md Abschnitte 4, 5 und 9.")
    set_slide_transition_fade(s)
    return s


# ---------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------

def build():
    prs = Presentation()
    prs.slide_width  = Inches(13.333)
    prs.slide_height = Inches(7.5)

    slide_1_cover(prs)
    slide_2_toc(prs)
    slide_3_hook(prs)
    slide_4_about_practice(prs)
    slide_5_goals(prs)
    slide_6_missing(prs)
    slide_7_preview_ads(prs)
    slide_8_about_eins(prs)
    slide_9_proof_placeholder(prs)
    slide_10_services(prs)
    slide_11_value_equation(prs)
    slide_12_guarantee(prs)
    slide_13_material_klon(prs)
    slide_14_pricing(prs)
    slide_15_next_steps(prs)
    slide_16_faq(prs)
    slide_17_close(prs)

    prs.save(str(OUT_FILE))
    print(f"Built: {OUT_FILE}")
    print(f"Slides: {len(prs.slides)}")


if __name__ == "__main__":
    build()
