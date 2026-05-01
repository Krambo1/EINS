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

// --- The rule list. Order does not matter; all matches are reported. ---
const RULES: HwgRule[] = [
  // --- Red: explicit violations ---
  {
    id: "before-after",
    severity: "red",
    pattern: /\bvorher[-\s]?nachher\b|\bbefore[-\s]?after\b/gi,
    reason:
      "Vorher-Nachher-Bilder sind bei operativen Eingriffen (§ 11 HWG) grundsätzlich verboten.",
    reference: "§ 11 Abs. 1 Nr. 5 HWG",
  },
  {
    id: "guarantee",
    severity: "red",
    pattern: /\b(garantie|garantiert|guaranteed|100\s*%\s*erfolg)\b/gi,
    reason:
      "Erfolgs- oder Wirkungsgarantien sind in der Heilmittelwerbung untersagt.",
    reference: "§ 3 HWG",
  },
  {
    id: "pain-free",
    severity: "red",
    pattern: /\b(völlig|komplett|absolut)\s+schmerzfrei\b|\bpain[-\s]?free\b/gi,
    reason:
      "Aussagen wie „völlig schmerzfrei“ gelten als irreführend, wenn sie nicht individuell zutreffen.",
    reference: "§ 3 HWG",
  },
  {
    id: "only-with-us",
    severity: "red",
    pattern: /\bnur\s+bei\s+uns\b|\beinzigartig(e|er)?\b/gi,
    reason:
      "Alleinstellungsbehauptungen sind nur zulässig, wenn sie sachlich belegbar sind.",
    reference: "§ 3 HWG, § 5 UWG",
  },
  {
    id: "risk-free",
    severity: "red",
    pattern: /\b(risikofrei|nebenwirkungsfrei|ohne risiken)\b/gi,
    reason:
      "Aussagen zur völligen Risikofreiheit sind unzulässig, da jede medizinische Behandlung Risiken birgt.",
    reference: "§ 3 HWG",
  },

  // --- Yellow: grey area, requires context ---
  {
    id: "testimonial-generic",
    severity: "yellow",
    pattern: /\bpatientenstimmen?\b|\berfahrungsberichte?\b/gi,
    reason:
      "Patientenäußerungen sind bei operativen Eingriffen (§ 11 HWG) nur unter engen Voraussetzungen zulässig.",
    reference: "§ 11 Abs. 1 Nr. 11 HWG",
  },
  {
    id: "emotional-fear",
    severity: "yellow",
    pattern: /\b(leiden sie unter|endlich wieder|schluss mit)\b/gi,
    reason:
      "Werbung, die Angst erzeugt oder Leid ausnutzt, ist bei Fachkreisen unzulässig.",
    reference: "§ 11 Abs. 1 Nr. 4 HWG",
  },
  {
    id: "medical-professional-attire",
    severity: "yellow",
    pattern: /\bim\s+(weißen\s+)?kittel\b/gi,
    reason:
      "Fotos in Berufskleidung dürfen nicht werblich eingesetzt werden, wenn sie die Autorität medizinisch überhöhen.",
    reference: "§ 11 Abs. 1 Nr. 4 HWG",
  },
  {
    id: "before-after-soft",
    severity: "yellow",
    pattern: /\bergebnis\s*(bild|foto)\b|\bresult(at)?\s*(bild|foto)\b/gi,
    reason:
      "Ergebnis- oder Resultat-Bilder werden häufig als unzulässige Vorher-Nachher-Darstellung gewertet.",
    reference: "§ 11 Abs. 1 Nr. 5 HWG",
  },
  {
    id: "before-after-compare",
    severity: "yellow",
    pattern: /\bgegenüberstellung\b|\bvergleichsbild(er)?\b/gi,
    reason:
      "Direkte Vergleichsbilder fallen oft unter das Vorher-Nachher-Verbot.",
    reference: "§ 11 Abs. 1 Nr. 5 HWG",
  },
  {
    id: "discount-medical",
    severity: "yellow",
    pattern: /\b(rabatt|\-\s*\d+\s*%|sale|angebot)\b.{0,40}\b(zahn|implantat|botox|lifting|filler)\b/gi,
    reason:
      "Rabattwerbung für medizinische Leistungen ist gebührenrechtlich (GOÄ/GOZ) eingeschränkt.",
    reference: "GOÄ § 2, GOZ § 2",
  },
  {
    id: "miracle",
    severity: "yellow",
    pattern: /\b(wunder|revolutionär|einzigartig|phänomenal)\b/gi,
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
