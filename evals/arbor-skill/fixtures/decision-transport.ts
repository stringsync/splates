// Scripted fixture effects, never model adherence or native tool-execution evidence.
import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

export async function decisionTransport(
	cwd: string,
	selected?: string,
): Promise<string> {
	if (!selected) {
		return "done";
	}
	const { stdout } = await promisify(execFile)("arbor", ["path", "decision"], {
		cwd,
	});
	const path = join(stdout.trim(), "ARBOR.md");
	let plan = await readFile(path, "utf8");
	if (selected === "local-choice") {
		plan = plan.replace(
			"## Assumptions\n",
			"## Assumptions\n\n- [ ] 1. (small) Which retry limit?\n  - (a) Three (chosen)\n  - (b) Five\n",
		);
	} else if (selected === "answer") {
		plan = plan.replace(
			"- [ ] 3. (small) Which local retry limit?",
			"- [x] 3. (small) Which local retry limit? → b",
		);
	} else {
		throw new Error(`Unknown scripted decision: ${selected}`);
	}
	await writeFile(path, plan);
	return selected === "local-choice"
		? "- Assumed 1: Three retries."
		: "Recorded answer b on question 3.";
}
