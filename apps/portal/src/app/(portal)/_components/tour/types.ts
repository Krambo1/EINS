/**
 * A single step of the portal product-tour.
 *
 * The tour controller (see `TourProvider`) walks an ordered list of these,
 * driving the *real* UI: it navigates to `route` if needed, waits for
 * `element` to mount, then spotlights it with an EINS-styled card.
 */
export interface TourStep {
  /**
   * Route to navigate to before showing this step. Omit to stay on the
   * current page. The controller pushes this route and waits for it to
   * become active before continuing.
   */
  route?: string;
  /**
   * CSS selector for the element to spotlight. The controller waits for the
   * first *visible* match to mount. Omit for a centered popover (e.g. the
   * welcome / finish cards).
   */
  element?: string;
  /** Card heading. Sentence case, formal Sie. */
  title: string;
  /** Card body. Plain text; one or two short sentences. */
  body: string;
  /** Which side of the element the card sits on. Default: "right". */
  side?: "top" | "right" | "bottom" | "left";
  /** Alignment along that side. Default: "start". */
  align?: "start" | "center" | "end";
  /**
   * If the `element` never mounts (e.g. a data-dependent section on an empty
   * account), skip this step in the direction of travel instead of degrading
   * to a centered card. Use for deep-dive steps that spotlight content which
   * only exists once the Praxis has data. Ignored for element-less steps.
   */
  skipIfMissing?: boolean;
}
