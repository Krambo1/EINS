/**
 * The cards of /einstellungen in their order, with their anchors. Other pages
 * link to these ids (`#profil`, `#team`, `#praxis-angaben`, `#bewertungen`,
 * `#wiederbehandlungen`, `#werbekonten`, ...), so an id never changes. The
 * page shows a card by the role's permissions; `loading.tsx` draws the
 * Inhaber's view, which has every card.
 *
 * Order (Karam, 2026-10-30, "where do I find the one setting I came for?"):
 * the person, the Praxis and its people, what EINS sends to patients, the
 * connections, then the Start-Unterlagen and the Protokoll.
 */
export const SECTIONS = [
  { id: "profil", title: "Profil" },
  { id: "team", title: "Team" },
  { id: "praxis-angaben", title: "Praxis-Angaben" },
  { id: "standorte", title: "Standorte" },
  { id: "behandlungen", title: "Behandlungen" },
  { id: "bewertungen", title: "Bewertungen" },
  { id: "wiederbehandlungen", title: "Erinnerungen" },
  { id: "abstaende", title: "Abstand je Behandlung" },
  { id: "werbekonten", title: "Werbekonten" },
  { id: "praxis-software", title: "Praxis-Software" },
  { id: "onboarding", title: "Start-Unterlagen" },
  { id: "audit", title: "Protokoll" },
] as const;

export type SectionId = (typeof SECTIONS)[number]["id"];

/** The Start-Unterlagen rows (Inhaber): the onboarding hub and its two forms. */
export const START_LINKS = [
  { href: "/onboarding", label: "Erste Schritte" },
  { href: "/onboarding/fragebogen", label: "Fragebogen zum Start" },
  { href: "/onboarding/checkliste", label: "Checkliste zum Start" },
] as const;
