import type { Attached, Image, Message, Sent } from "./conversation-state";

/** What the person said, `at`: what they sent with it, then their words. */
export function said(
	text: string,
	at: string | null,
	sent: Sent[] = [],
): Message {
	return {
		role: "user",
		parts: [
			// Its images first, the order the agent is sent them in, which their
			// chips count by.
			...sent.filter((each) => each.type === "image"),
			...sent.filter((each) => each.type === "file"),
			...(text === "" ? [] : [{ type: "text" as const, text }]),
		],
		plan: null,
		at,
		until: at,
	};
}

/** How many of `messages` went out, as the thread shows them. */
export function sent(messages: Message[]): number {
	return messages.filter((each) => !each.queued).length;
}

/** A prompt entry's images and files, each left out of the log when there are none. */
export function shown(sent: Sent[]): { images?: Image[]; files?: Attached[] } {
	const images = sent.flatMap(({ type, ...image }) =>
		type === "image" ? [image] : [],
	);
	const files = sent.flatMap((each) => {
		if (each.type !== "file") {
			return [];
		}
		const { type: _, ...file } = each;
		return [file];
	});
	return {
		...(images.length === 0 ? {} : { images }),
		...(files.length === 0 ? {} : { files }),
	};
}

/** The words of `message`, without what was sent with them. */
export function textOf(message: Message): string {
	return message.parts
		.map((part) => (part.type === "text" ? part.text : ""))
		.join("");
}

/** Marks up to `count` queued messages as gone out, all by default. */
export function delivered(messages: Message[], count = Infinity): void {
	for (const each of messages
		.filter((message) => message.queued)
		.slice(0, count)) {
		delete each.queued;
	}
}

/** Removes the `index`th queued message, returning it if there was one. */
export function takeBack(messages: Message[], index: number): Message | null {
	const queued = messages.filter((each) => each.queued);
	const message = queued[index];
	if (message === undefined) {
		return null;
	}
	messages.splice(messages.indexOf(message), 1);
	return message;
}

/** What an error says, whether it is an `Error` or only shaped like one. */
export function messageOf(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}
	if (typeof error === "object" && error !== null && "message" in error) {
		return String(error.message);
	}
	return String(error);
}
