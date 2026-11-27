/** One `**Label:** text` field of a plan, with the lines under it. */
export type PlanField = { label: string; body: string };

/** One tag of a plan's Tags field, and the reason given for it. */
export type PlanTag = { name: string; why: string };

/** A field line: a short bold label ending in a colon, then its text. */
const FIELD = /^\*\*([A-Za-z][A-Za-z ]{0,23}):\*\*[ \t]*(.*)$/;

/** A fence line, opening or closing a code block. */
const FENCE = /^\s*(```|~~~)/;

/** A heading line, which ends the fields: what follows draws as before. */
const HEADING = /^#{1,6}\s/;

/**
 * Split a plan's body into the text before its fields, its fields, and what
 * follows them from the first heading on (a diagram, say). Null when it
 * has no fields, so it draws as plain markdown.
 */
export function planFields(
	text: string,
): { lead: string; fields: PlanField[]; rest: string } | null {
	const lines = text.split("\n");
	const lead: string[] = [];
	const fields: { label: string; lines: string[] }[] = [];
	let fenced = false;
	let end = lines.length;
	for (const [at, line] of lines.entries()) {
		const fence = FENCE.test(line);
		const field = fenced || fence ? null : FIELD.exec(line);
		if (!fenced && fields.length > 0 && HEADING.test(line)) {
			end = at;
			break;
		}
		if (fence) {
			fenced = !fenced;
		}
		if (field !== null) {
			fields.push({ label: field[1] ?? "", lines: [field[2] ?? ""] });
		} else {
			(fields.at(-1)?.lines ?? lead).push(line);
		}
	}
	if (fields.length === 0) {
		return null;
	}
	return {
		lead: lead.join("\n").trim(),
		fields: fields.map((each) => ({
			label: each.label.trim(),
			body: each.lines.join("\n").trim(),
		})),
		rest: lines.slice(end).join("\n").trim(),
	};
}

/** A tag item: `- Name: why`, or `- Name` alone. */
const TAG_ITEM = /^\s*[-*]\s+(.+?)(?::\s+(.*))?$/;

/**
 * The tags a Tags field lists, one `- Name: why` item each, or, written on
 * one line, separated by commas.
 */
export function planTags(body: string): PlanTag[] {
	const items = body
		.split("\n")
		.map((line) => TAG_ITEM.exec(line))
		.filter((item) => item !== null)
		.map((item) => ({
			name: (item[1] ?? "").trim(),
			why: (item[2] ?? "").trim(),
		}));
	if (items.length > 0) {
		return items;
	}
	return body
		.split(/[,·\n]/)
		.map((name) => name.trim())
		.filter((name) => name !== "")
		.map((name) => ({ name, why: "" }));
}

/** Whether a plan's body carries the One-way Undo tag under `**Tags:**`. */
export function planHasOneWayTag(body: string): boolean {
	const parsed = planFields(body);
	if (parsed === null) {
		return false;
	}
	return parsed.fields
		.filter((field) => /^tags$/i.test(field.label))
		.flatMap((field) => planTags(field.body))
		.some(
			(tag) =>
				tag.name.toLowerCase().replace(/\s+until\b.*$/, "") === "one-way",
		);
}
