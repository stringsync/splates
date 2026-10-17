import { createHash } from "node:crypto";

/**
 * The headings whose text differs between two versions of the skill, each
 * given as its markdown files by path. A section is a `##` or `###` heading
 * and the text up to the next one, wherever it lives, so moving a section
 * to another file unchanged changes nothing, and a scenario reruns only for
 * the words it reads.
 */
export function changedSections(
	before: Map<string, string>,
	after: Map<string, string>,
): string[] {
	const was = sections(before);
	const is = sections(after);
	const headings = new Set([...was.keys(), ...is.keys()]);
	return [...headings].filter(
		(heading) => was.get(heading) !== is.get(heading),
	);
}

/** A digest of each section's text, by its heading; the text above the first is under the file's title. */
export function sections(files: Map<string, string>): Map<string, string> {
	const found = new Map<string, string[]>();
	for (const path of [...files.keys()].sort()) {
		let heading = "";
		let fenced = false;
		for (const line of withoutVersion(files.get(path) ?? "").split("\n")) {
			if (/^\s*(```|~~~)/.test(line)) {
				fenced = !fenced;
			}
			const match = fenced ? null : /^(#{1,3}) (.+)$/.exec(line);
			if (match !== null) {
				heading = (match[2] as string).trim();
				found.set(heading, found.get(heading) ?? []);
				continue;
			}
			found.get(heading)?.push(line);
		}
	}
	return new Map(
		[...found].map(([heading, lines]) => [
			heading,
			digest(lines.join("\n").trim()),
		]),
	);
}

/**
 * One digest of the skill's files, which names a version of it in the results.
 * The `version:` line is left out: `ship` stamps it, and a bump that changes
 * no words would otherwise pay for every scenario again.
 */
export function skillHash(files: Map<string, string>): string {
	const all = [...files.keys()]
		.sort()
		.map((path) => `${path}\n${withoutVersion(files.get(path) ?? "")}`);
	return digest(all.join("\n\0\n")).slice(0, 12);
}

function withoutVersion(text: string): string {
	return text.replace(/^version: .*\n/m, "");
}

function digest(text: string): string {
	return createHash("sha256").update(text).digest("hex");
}
