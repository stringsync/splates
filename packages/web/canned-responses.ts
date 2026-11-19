import { Dispatcher } from "core/events";
/**
 * Replies a person can add to an answer box with one tap. Each reads on its
 * own: the agent gets it with no memory of why it was picked and often with
 * the question's options out of view.
 */
export interface CannedGroup {
	label: string;
	replies: readonly string[];
}

export const CANNED_RESPONSES: readonly CannedGroup[] = [
	{
		label: "Clarify",
		replies: [
			"I don't understand the options you've given me. Please explain each one in plain words, say what it would change, and then ask again.",
			"I don't have enough context to decide. Please tell me what you've done so far, what this question is blocking, and what each option means for the user.",
			"Please show me a picture, mockup or example of each option before I choose.",
			"I don't know the terms you used. Please define them and ask again.",
		],
	},
	{
		label: "Decide",
		replies: [
			"Go with your recommendation.",
			"Use your own judgment on this one and don't ask me again.",
			"I need to think about this. Park it and continue with whatever doesn't depend on it.",
		],
	},
	{
		label: "Redirect",
		replies: [
			"None of these options is right. Here's what I want instead: ",
			"This is too big for one task. Please split it up and queue the rest.",
			"Please stop and tell me what you've done so far before going further.",
		],
	},
];

/** `text` added after what is already written, never in place of it. */
export function withCanned(current: string, reply: string): string {
	if (current.trim() === "") {
		return reply;
	}
	const gap = /\s$/.test(current) ? "" : "\n";
	return `${current}${gap}${reply}`;
}

const STORED = "splates.canned-replies";

/** The replies a person has saved, or `CANNED_RESPONSES` until they change them. */
export class CannedStore {
	private readonly dispatcher = new Dispatcher<{ changed: undefined }>();
	readonly events = this.dispatcher.events;
	private groups: readonly CannedGroup[];

	constructor(private readonly storage: Storage) {
		this.groups = read(storage) ?? CANNED_RESPONSES;
	}

	get(): readonly CannedGroup[] {
		return this.groups;
	}

	/** Whether the list is no longer the default. */
	get edited(): boolean {
		return this.groups !== CANNED_RESPONSES;
	}

	set(groups: readonly CannedGroup[]): void {
		this.groups = groups;
		this.storage.setItem(STORED, JSON.stringify(groups));
		this.dispatcher.dispatch("changed");
	}

	reset(): void {
		this.groups = CANNED_RESPONSES;
		this.storage.removeItem(STORED);
		this.dispatcher.dispatch("changed");
	}
}

function read(storage: Storage): readonly CannedGroup[] | undefined {
	try {
		const stored: unknown = JSON.parse(storage.getItem(STORED) ?? "null");
		if (!Array.isArray(stored)) {
			return undefined;
		}
		return stored.flatMap((group): CannedGroup[] =>
			typeof group?.label === "string" &&
			Array.isArray(group.replies) &&
			group.replies.every((reply: unknown) => typeof reply === "string")
				? [{ label: group.label, replies: group.replies }]
				: [],
		);
	} catch {
		return undefined;
	}
}

/** The page's saved canned replies. */
export const canned: CannedStore = new CannedStore(
	typeof localStorage === "undefined" ? (null as never) : localStorage,
);
