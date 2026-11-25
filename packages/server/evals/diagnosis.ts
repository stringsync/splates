/** What a failure is put down to: the harness, the judge, the skill, or an eval written wrong. */
export const CAUSES = ["harness", "judge", "skill", "eval"] as const;

export type Cause = (typeof CAUSES)[number];

/** A remedy the eval lead proposes, or one it has already applied. */
export interface Remedy {
	text: string;
	state: "proposed" | "applied";
}

/** What the agent did that the failure comes down to, and at which transcript step. */
export interface Did {
	text: string;
	/** Zero-based index in the run's transcript, as `EvalCheckStep.index`; null when the line names no step. */
	step: number | null;
}

/** One entry of a remarks `Diagnosis:` list: a failure, the runs that failed that way, and why. */
export interface Diagnosis {
	/** Cell ids (`run-017`) of the runs that failed this way. */
	runs: string[];
	/** The failed check's id, or `judge` for the judge's verdict. */
	check: string;
	causes: Cause[];
	why: string;
	did: Did | null;
	remedy: Remedy | null;
}

const HEADING = /^\s*(?:#+\s*)?\**diagnosis\**:?\**\s*$/iu;
const ENTRY = /^[-*]\s+(.+?)\s+([^\s,:`]+):\s*(.+?)\s*$/u;
const FIELD =
	/^\s+[-*]\s+(why|did|proposed remedy|applied remedy):\s*(.*?)\s*$/iu;
const STEP = /^step\s+(\d+)\b[\s,:.-]*/iu;

/**
 * The `Diagnosis:` list in a batch's remarks, one entry per distinct failure:
 *
 * ```
 * Diagnosis:
 * - run-017, run-019 asks-through-creds: skill, judge
 *   - Why: The creds trigger names tokens but not webhook URLs.
 *   - Did: Step 2 asked for the webhook URL in chat.
 *   - Proposed remedy: Name webhook URLs in the creds trigger.
 * ```
 *
 * A field may wrap onto more indented lines. `Did` counts steps from 1, as
 * the transcript lists them. Null when the remarks have no such list; throws,
 * saying what is wrong, on a cause outside the four, a missing `Why`, or a
 * why, did or remedy longer than one sentence.
 */
export function diagnosesOf(remarks: string): Diagnosis[] | null {
	const block = diagnosisBlock(remarks);
	if (block === null) {
		return null;
	}
	const found: Diagnosis[] = [];
	let current: { head: string; fields: Map<string, string> } | null = null;
	let field: string | null = null;
	const finish = () => {
		if (current !== null) {
			found.push(entryOf(current.head, current.fields));
		}
	};
	for (const line of block.lines) {
		if (line.trim() === "") {
			continue;
		}
		if (/^[-*]\s/u.test(line)) {
			finish();
			current = { head: line, fields: new Map() };
			field = null;
			continue;
		}
		const item = FIELD.exec(line);
		if (current === null) {
			continue;
		}
		if (item !== null) {
			field = (item[1] ?? "").toLowerCase();
			if (current.fields.has(field)) {
				throw new Error(`"${current.head.trim()}" has two ${field} lines`);
			}
			current.fields.set(field, item[2] ?? "");
		} else if (field !== null) {
			current.fields.set(
				field,
				`${current.fields.get(field) ?? ""} ${line.trim()}`.trim(),
			);
		}
	}
	finish();
	return found;
}

/** The remarks with their `Diagnosis:` list taken out, or as they are without one. */
export function withoutDiagnosis(remarks: string): string {
	const block = diagnosisBlock(remarks);
	if (block === null) {
		return remarks;
	}
	const lines = remarks.split("\n");
	return [...lines.slice(0, block.start), ...lines.slice(block.end)]
		.join("\n")
		.replace(/\n{3,}/gu, "\n\n")
		.trim();
}

/** The list's lines and where it starts and ends in the remarks. */
function diagnosisBlock(
	remarks: string,
): { start: number; end: number; lines: string[] } | null {
	const lines = remarks.split("\n");
	const start = lines.findIndex((line) => HEADING.test(line));
	if (start === -1) {
		return null;
	}
	let end = start + 1;
	for (; end < lines.length; end++) {
		const line = lines[end] ?? "";
		if (line.trim() === "") {
			const next = lines.slice(end + 1).find((each) => each.trim() !== "");
			if (next === undefined || !/^(?:\s+|[-*]\s)/u.test(next)) {
				break;
			}
			continue;
		}
		if (!/^(?:\s+|[-*]\s)/u.test(line)) {
			break;
		}
	}
	return { start, end, lines: lines.slice(start + 1, end) };
}

function entryOf(head: string, fields: Map<string, string>): Diagnosis {
	const shown = head.trim();
	const entry = ENTRY.exec(head.replace(/[`*_]/gu, "").trim());
	if (entry === null) {
		throw new Error(
			`"${shown}" is not "- <run>[, <run>...] <check>: <causes>", as "- run-017 asks-through-creds: skill"`,
		);
	}
	const runs = (entry[1] ?? "")
		.split(/[\s,]+/u)
		.filter((each) => each !== "" && each !== "and");
	const causes: Cause[] = [];
	for (const word of (entry[3] ?? "").split(/\s*(?:,|\+|\/|&|\band\b)\s*/u)) {
		const key = word.trim().toLowerCase();
		if (key === "") {
			continue;
		}
		if (!(CAUSES as readonly string[]).includes(key)) {
			throw new Error(
				`"${word.trim()}" in "${shown}" is no cause: use ${CAUSES.join(", ")}; an agent's one-off slip takes none and is said in the Why`,
			);
		}
		if (!causes.includes(key as Cause)) {
			causes.push(key as Cause);
		}
	}
	if (causes.length === 0) {
		throw new Error(`"${shown}" names no cause: use ${CAUSES.join(", ")}`);
	}
	const why = fields.get("why") ?? "";
	if (why === "") {
		throw new Error(`"${shown}" has no Why: say in one sentence why it failed`);
	}
	oneSentence(shown, "Why", why);
	const proposed = fields.get("proposed remedy");
	const applied = fields.get("applied remedy");
	if (proposed !== undefined && applied !== undefined) {
		throw new Error(
			`"${shown}" has a proposed and an applied remedy: keep the one that holds`,
		);
	}
	const remedyText = applied ?? proposed;
	if (remedyText !== undefined) {
		oneSentence(shown, "remedy", remedyText);
	}
	const didText = fields.get("did");
	if (didText !== undefined) {
		oneSentence(shown, "Did", didText);
	}
	return {
		runs,
		check: entry[2] ?? "",
		causes,
		why,
		did: didText === undefined || didText === "" ? null : didOf(didText),
		remedy:
			remedyText === undefined || remedyText === ""
				? null
				: {
						text: remedyText,
						state: applied === undefined ? "proposed" : "applied",
					},
	};
}

function didOf(text: string): Did {
	const step = STEP.exec(text);
	if (step === null) {
		return { text, step: null };
	}
	const number = Number(step[1]);
	if (number < 1) {
		throw new Error(`"${text}" names step 0: steps count from 1`);
	}
	return { text, step: number - 1 };
}

/** Throws when `text` holds more than one sentence. */
function oneSentence(entry: string, field: string, text: string): void {
	const plain = text
		.replace(/`[^`]*`/gu, "code")
		.replace(/\b(?:e\.g|i\.e|etc|vs)\./giu, "x");
	const sentences = plain
		.split(/(?<=[.!?])["'”’)]*\s+(?=["“(]?[A-Z0-9])/u)
		.filter((each) => each.trim() !== "");
	if (sentences.length > 1) {
		throw new Error(
			`The ${field} of "${entry}" is ${sentences.length} sentences: say it in one`,
		);
	}
}
