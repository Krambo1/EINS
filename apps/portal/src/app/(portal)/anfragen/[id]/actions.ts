"use server";

// All write actions on this page have been removed. The portal is a
// read-only listener for lead state:
//
//   - status, revenue, treatment categorisation, notes, call logs → PVS
//   - Folgetermine (recall / followup / review_request) → PVS appointment
//     scheduler and recall queue (Wiederbestellung)
//   - lead ownership / "Zuständig" → not a real performance signal;
//     observable upstream data (phone-system call logs, PVS appointment
//     scheduler, billing) is the source of truth for who actually
//     handled a lead.
//
// If a new write action is genuinely portal-native (i.e. no upstream
// source of truth exists), it can be added back here — but the default
// is to listen, not to write.
export {};
