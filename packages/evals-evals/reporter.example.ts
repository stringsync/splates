// Turns a JSON list of eval results into a splates-evals/1 batch directory.
// Usage: bun evals-reporter.example.ts <results.json> <batch-dir>
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type Input = {
	case: string;
	model: string;
	status: "pass" | "fail" | "error";
	score?: number;
	reason?: string;
};

const [from, dir] = process.argv.slice(2);
if (from === undefined || dir === undefined) {
	console.error("usage: evals-reporter.example.ts <results.json> <batch-dir>");
	process.exit(1);
}

const inputs: Input[] = JSON.parse(readFileSync(from, "utf8"));
mkdirSync(dir, { recursive: true });

writeFileSync(
	join(dir, "batch.json"),
	JSON.stringify({
		format: "splates-evals/1",
		startedAt: new Date().toISOString(),
		cells: inputs.map((each, index) => ({
			id: `c${index}`,
			case: each.case,
			target: { model: each.model },
		})),
	}),
);

writeFileSync(
	join(dir, "results.jsonl"),
	`${inputs
		.map((each, index) =>
			JSON.stringify({
				cell: `c${index}`,
				status: each.status,
				score: each.score,
				reason: each.reason,
			}),
		)
		.join("\n")}\n`,
);
