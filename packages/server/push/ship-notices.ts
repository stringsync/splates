import type { Waiting } from "../ship";
import { plain } from "./notices";

/** A ship prompt worth a push: where it waits, and what to say of it. */
export interface ShipNotice {
	waiting: Waiting;
	title: string;
	body: string;
}

/**
 * Tells which ship prompts opened since the last look, so a phone hears of
 * each once. The first look tells nothing, as `Notices` does.
 */
export class ShipNotices {
	private seen: Set<string> | null = null;

	look(waiting: Waiting[]): ShipNotice[] {
		const before = this.seen;
		this.seen = new Set(waiting.map(keyOfWaiting));
		if (before === null) {
			return [];
		}
		return waiting
			.filter((each) => !before.has(keyOfWaiting(each)))
			.map((each) => ({
				waiting: each,
				title: plain(`Ship needs you: ${each.does}`, 40),
				body: plain(`${each.target}: ${said(each)}`, 80),
			}));
	}
}

/** What tells a prompt apart from every other, in a notification and its click. */
export function keyOfWaiting(waiting: Waiting): string {
	return `ship ${waiting.run} ${waiting.target} ${waiting.step} ${waiting.id}`;
}

function said({ prompt }: Waiting): string {
	switch (prompt.kind) {
		case "confirm":
		case "ask":
			return prompt.question;
		case "link":
			return "Sign in";
	}
}
