/** The longest task name `taskName` makes, so a long subject stays a name. */
const NAME_LENGTH = 40;

/**
 * A task name for a queued task called `subject`: its words, lowercased and
 * dashed, cut at a word to `NAME_LENGTH`, and numbered past any in `taken`.
 */
export function taskName(subject: string, taken: ReadonlySet<string>): string {
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
	base ||= "task";
	let name = base;
	for (let count = 2; taken.has(name); count++) {
		name = `${base}-${count}`;
	}
	return name;
}
