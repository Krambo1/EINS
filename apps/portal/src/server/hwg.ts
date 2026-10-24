import "server-only";

/**
 * Rule-based HWG (Heilmittelwerbegesetz) screener for German aesthetic /
 * dental marketing copy. This covers only the 20 or so most common pitfalls
 * our clinics actually run into — a full legal review still needs a human.
 *
 * Verdict semantics:
 *   clean      → no hits; still remind the user a legal review is theirs.
 *   warn       → one or more yellow hits (gray-area language).
 *   violation  → at least one red hit (must not be published as-is).
 *
 * The rule list is intentionally readable so a lawyer or the user can spot-
 * check what we're matching.
 */

export type HwgSeverity = "red" | "yellow";

export interface HwgRule {
  id: string;
  severity: HwgSeverity;
  pattern: RegExp;
  /** One-sentence explanation shown to the user. */
  reason: string;
  /** German § or paragraph reference for credibility. */
  reference?: string;
}

export interface HwgFinding {
  ruleId: string;
  severity: HwgSeverity;
  reason: string;
  reference?: string;
  /** The exact matched text in the input. */
  match: string;
  /** Character offsets so the UI can highlight inline. */
  start: number;
  end: number;
}

export interface HwgResult {
  verdict: "clean" | "warn" | "violation";
  findings: HwgFinding[];
}

/**
 * Word-start guard. JS `\b` is ASCII-only and needs a word character on one
 * side, so it misses "-20 %" and anything around umlauts. Every pattern starts
 * with this Unicode-aware lookbehind instead; word ends are handled per rule
 * (stems consume `\p{L}*`, short words use `(?!\p{L})`).
 */
const START = String.raw`(?<![\p{L}\p{N}])`;
/** Treatments for the discount rule (stems, compounds allowed). */
const TREATMENT = String.raw`(?:zahn|implantat|botox|lifting|filler|hyaluron|falten|lid|brust|fettabsaug|laser|behandlung)\p{L}*`;
/** Discount wording for the discount rule. */
const DISCOUNT = String.raw`(?:rabatt\p{L}*|nachlass|-\s*\d+\s*%|\d+\s*%\s*(?:rabatt|nachlass|günstiger|reduziert)|sale(?!\p{L})|angebot\p{L}*|aktionspreis\p{L}*|gutschein\p{L}*)`;

function rx(body: string): RegExp {
  return new RegExp(`${START}(?:${body})`, "giu");
}

// --- The rule list. Order does not matter; all matches are reported. ---
const RULES: HwgRule[] = [
  // --- Red: explicit violations ---
  {
    id: "before-after",
    severity: "red",
    // "Vorher-Nachher", "Vorher/Nachher", "Vorher- und Nachher-Bilder",
    // "Before & After", "before and after".
    pattern: rx(
      String.raw`vorher[\s\-–/&]*(?:und[\s\-–]*)?nachher|before[\s\-–/&]*(?:and[\s\-–]*)?after`
    ),
    reason:
      "Vorher-Nachher-Bilder sind bei operativen Eingriffen (§ 11 HWG) grundsätzlich verboten.",
    reference: "§ 11 Abs. 1 Nr. 5 HWG",
  },
  {
    id: "guarantee",
    severity: "red",
    // Stems and compounds: "Garantie", "Garantien", "garantierte Ergebnisse",
    // "Erfolgsgarantie", "100 % Erfolg", "100 % zufrieden".
    pattern: rx(
      String.raw`\p{L}*garanti(?:e|er)\p{L}*|guarantee\p{L}*|100\s*%\s*(?:erfolg|zufrieden|sicher)\p{L}*`
    ),
    reason:
      "Erfolgs- oder Wirkungsgarantien sind in der Heilmittelwerbung untersagt.",
    reference: "§ 3 HWG",
  },
  {
    id: "pain-free",
    severity: "red",
    pattern: rx(
      String.raw`(?:völlig|komplett|absolut|garantiert|100\s*%)\s+schmerz(?:frei|los)\p{L}*|pain[\s\-]?free`
    ),
    reason:
      "Aussagen wie „völlig schmerzfrei“ gelten als irreführend, wenn sie nicht individuell zutreffen.",
    reference: "§ 3 HWG",
  },
  {
    id: "only-with-us",
    severity: "red",
    pattern: rx(String.raw`nur\s+bei\s+uns(?!\p{L})|einzigartig\p{L}*`),
    reason:
      "Alleinstellungsbehauptungen sind nur zulässig, wenn sie sachlich belegbar sind.",
    reference: "§ 3 HWG, § 5 UWG",
  },
  {
    id: "risk-free",
    severity: "red",
    pattern: rx(
      String.raw`risiko(?:frei|los)\p{L}*|nebenwirkungs(?:frei|los)\p{L}*|ohne\s+(?:jedes\s+|jegliches\s+|jegliche\s+)?(?:risiko|risiken|nebenwirkungen)(?!\p{L})`
    ),
    reason:
      "Aussagen zur völligen Risikofreiheit sind unzulässig, da jede medizinische Behandlung Risiken birgt.",
    reference: "§ 3 HWG",
  },

  // --- Yellow: grey area, requires context ---
  {
    id: "testimonial-generic",
    severity: "yellow",
    pattern: rx(String.raw`patientenstimme\p{L}*|erfahrungsbericht\p{L}*`),
    reason:
      "Patientenäußerungen sind bei operativen Eingriffen (§ 11 HWG) nur unter engen Voraussetzungen zulässig.",
    reference: "§ 11 Abs. 1 Nr. 11 HWG",
  },
  {
    id: "emotional-fear",
    severity: "yellow",
    pattern: rx(String.raw`(?:leiden\s+sie\s+unter|endlich\s+wieder|schluss\s+mit)(?!\p{L})`),
    reason:
      "Werbung, die Angst erzeugt oder Leid ausnutzt, ist bei Fachkreisen unzulässig.",
    reference: "§ 11 Abs. 1 Nr. 4 HWG",
  },
  {
    id: "medical-professional-attire",
    severity: "yellow",
    pattern: rx(String.raw`im\s+(?:weißen\s+)?kittel(?!\p{L})`),
    reason:
      "Fotos in Berufskleidung dürfen nicht werblich eingesetzt werden, wenn sie die Autorität medizinisch überhöhen.",
    reference: "§ 11 Abs. 1 Nr. 4 HWG",
  },
  {
    id: "before-after-soft",
    severity: "yellow",
    // "Ergebnisbild", "Ergebnis-Fotos", "Resultatbilder".
    pattern: rx(String.raw`(?:ergebnis|resultat|result)(?:s)?[\s\-]*(?:bild|foto)\p{L}*`),
    reason:
      "Ergebnis- oder Resultat-Bilder werden häufig als unzulässige Vorher-Nachher-Darstellung gewertet.",
    reference: "§ 11 Abs. 1 Nr. 5 HWG",
  },
  {
    id: "before-after-compare",
    severity: "yellow",
    pattern: rx(String.raw`gegenüberstellung\p{L}*|vergleichs(?:bild|foto)\p{L}*`),
    reason:
      "Direkte Vergleichsbilder fallen oft unter das Vorher-Nachher-Verbot.",
    reference: "§ 11 Abs. 1 Nr. 5 HWG",
  },
  {
    id: "discount-medical",
    severity: "yellow",
    // Either order: "-20 % auf Botox" and "Botox jetzt 20 % günstiger".
    pattern: rx(
      `${DISCOUNT}[^.!?\\n]{0,40}?${TREATMENT}|${TREATMENT}[^.!?\\n]{0,40}?${DISCOUNT}`
    ),
    reason:
      "Rabattwerbung für medizinische Leistungen ist gebührenrechtlich (GOÄ/GOZ) eingeschränkt.",
    reference: "GOÄ § 2, GOZ § 2",
  },
  {
    id: "miracle",
    severity: "yellow",
    pattern: rx(
      String.raw`wunder(?:mittel|waffe|heilung|kur|spritze|behandlung)\p{L}*|wunder(?!\p{L})|revolutionär\p{L}*|einzigartig\p{L}*|phänomenal\p{L}*`
    ),
    reason:
      "Superlative ohne sachliche Grundlage gelten als irreführende Werbung.",
    reference: "§ 3 HWG",
  },
];

export function checkHwg(input: string): HwgResult {
  const findings: HwgFinding[] = [];
  for (const rule of RULES) {
    // Reset RegExp lastIndex because we use /g.
    rule.pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = rule.pattern.exec(input)) !== null) {
      findings.push({
        ruleId: rule.id,
        severity: rule.severity,
        reason: rule.reason,
        reference: rule.reference,
        match: m[0],
        start: m.index,
        end: m.index + m[0].length,
      });
    }
  }

  const hasRed = findings.some((f) => f.severity === "red");
  const hasYellow = findings.some((f) => f.severity === "yellow");
  const verdict: HwgResult["verdict"] = hasRed
    ? "violation"
    : hasYellow
    ? "warn"
    : "clean";

  return { verdict, findings };
}
