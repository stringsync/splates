/** The longest task name `taskName` makes, so a long subject stays a name. */
const NAME_LENGTH = 40;

/**
 * A task name for `queued`: the slug its writer gave it, else its subject's
 * words, lowercased and dashed, cut at a word to `NAME_LENGTH`; numbered past
 * any in `taken`.
 */
export function taskName(
	queued: { subject: string; slug?: string },
	taken: ReadonlySet<string>,
): string {
	const base = queued.slug ?? fromSubject(queued.subject);
	let name = base;
	for (let count = 2; taken.has(name); count++) {
		name = `${base}-${count}`;
	}
	return name;
}

/** `subject`'s words, lowercased and dashed, cut at a word to `NAME_LENGTH`. */
function fromSubject(subject: string): string {
	const words = subject
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter(Boolean);
	let base = "";
	for (const word of words) {
		const longer = base === "" ? word : `${base}-${word}`;
		if (longer.length > NAME_LENGTH && base !== "") {
			break;
		}
		base = longer.slice(0, NAME_LENGTH);
	}
	return base || "task";
}
