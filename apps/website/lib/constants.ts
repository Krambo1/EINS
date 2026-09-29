// Swap these values when you have final URLs.
// Every CTA button on the site reads from CALENDLY_URL.
export const CALENDLY_URL = "https://calendly.com/karam8issa/30min";
export const CONTACT_EMAIL = "team@eins.ag";
export const CONTACT_PHONE = "+49 1628456643";
export const PORTAL_URL = "https://portal.eins.ag";

// Portal origin that serves the outreach video API behind eins.ag/v/<slug>
// (video metadata + view tracking). Server-side override for local dev:
// VIDEO_API_ORIGIN=http://localhost:3001.
export const VIDEO_API_ORIGIN = (process.env.VIDEO_API_ORIGIN ?? PORTAL_URL).replace(/\/$/, "");
