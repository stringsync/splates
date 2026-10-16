/**
 * What an Investigated report's `body` says: what was fixed, and each finding
 * left, from its `- ` lines at the margin, each with why after its colon.
 */
export function leftIn(body: string): { fixed: string; left: string[] } {
	const lines = body.split("\n");
	const left = lines.flatMap((line) => {
		const item = /^- (.+)$/.exec(line);
		return item === null ? [] : [(item[1] as string).trim()];
	});
	return {
		fixed: lines
			.filter((line) => !/^- /.test(line))
			.join("\n")
			.trim(),
		left,
	};
}
