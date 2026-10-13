import { Duration } from "webappwiz/time";

/**
 * How often `arbor dev` says a stream it serves is still there, so the page
 * can tell one that went quiet, as across a sleep, from one with no news.
 */
export const PULSE = Duration.secs(15);

/** The event it says so with, one the page's handlers for news never hear. */
export const PULSE_EVENT = new TextEncoder().encode("event: pulse\ndata:\n\n");
