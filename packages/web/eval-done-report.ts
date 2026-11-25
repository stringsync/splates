/** An eval loop's Done report: the one line on its outcome, and the batch of its last run. */
export interface EvalDoneReport {
	/** The report's first paragraph, with its heading, table and bookkeeping lines left out. */
	outcome: string;
	/** The batch the last run landed in, named by a `Final batch:` line. */
	batch: string;
	/** The report's `Checks` section: one `- [x]` / `- [ ]` item per eval and model; "" when it has none. */
	checks: string;
}

/** The report `text` is, or null when it names no `Final batch:` and so ends no eval loop. */
export function evalDoneOf(text: string): EvalDoneReport | null {
	const lines = text.split("\n");
	const named = lines.find((line) => /^final batch:/iu.test(line.trim()));
	if (named === undefined) {
		return null;
	}
	const batch = named.replace(/^[^:]*:\s*/u, "").replace(/[`\s]/gu, "");
	if (batch === "") {
		return null;
	}
	const outcome = text
		.split(/\n\s*\n/u)
		.map((paragraph) => paragraph.trim())
		.find(
			(paragraph) =>
				paragraph !== "" &&
				!/^(#|\||final batch:|commit:|stopped by:)/iu.test(paragraph),
		);
	return { outcome: outcome ?? "", batch, checks: checksOf(lines) };
}

/** The lines under a `Checks` heading (any level), up to the next heading or bookkeeping line. */
function checksOf(lines: string[]): string {
	const start = lines.findIndex((line) =>
		/^(#{1,6}\s+)?\**checks\**:?\s*$/iu.test(line.trim()),
	);
	if (start === -1) {
		return "";
	}
	const body: string[] = [];
	for (const line of lines.slice(start + 1)) {
		if (
			/^(#|\[?open the report|final batch:|commit:|stopped by:)/iu.test(
				line.trim(),
			)
		) {
			break;
		}
		body.push(line);
	}
	return body.join("\n").trim();
}
