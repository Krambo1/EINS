/**
 * Versions of the consent texts on the pre-qualifier form (L-6). Sent with
 * every inquiry and stored on the portal request (requests.consents), so it
 * stays clear which wording a person agreed to.
 *
 * Bump the matching version (date of the change) whenever the wording
 * changes:
 *   PRIVACY_CONSENT_VERSION    explicit health-data consent from Final 14 + age
 *                              (components/sections/pre-qualifier/step-contact.tsx)
 *   MARKETING_CONSENT_VERSION  marketing opt-in on the confirmation screen
 *   AI_CONSENT_VERSION         AI notes scoring (field currently not shown)
 * The Meta/Google reporting consent has its own ADS_CONSENT_VERSION
 * (lib/ads-consent.ts).
 */
export const PRIVACY_CONSENT_VERSION = "2026-10-11-final14";
export const MARKETING_CONSENT_VERSION = "2026-10-07";
export const AI_CONSENT_VERSION = "2026-10-07";
