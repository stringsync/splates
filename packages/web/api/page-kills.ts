import type { Killed } from "../page-kill";
import { sendJson } from "./request";

/** Tells the server the system killed the page, so an agent can look into repeats. */
export async function reportPageKill(killed: Killed): Promise<void> {
	await sendJson("/api/page-kills", "POST", killed);
}
