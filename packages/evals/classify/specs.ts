import { type ClassifySpec, it } from "./spec";

// Seeds drawn from requests made on this board, one per kind; each spec
// grades only the classes its request settles.

/** Every Auto pick classification spec, for `list`, `plan` and `run` to pick from. */
export const CLASSIFY_SPECS: readonly ClassifySpec[] = [
	it("a crash report reads as a bugfix", {
		subject:
			"Score editor crashes when a down-stemmed chord has a displaced head",
		detail:
			"Opening any score with a down-stemmed chord whose second note is displaced throws `Cannot read properties of undefined (reading 'line')` in the ledger check and the page goes blank. It used to render fine. Find why and fix it, with a test on that chord.",
		judged: {
			kind: { bugfix: true, design: false, devops: false },
			clarity: { settled: true },
		},
	}),
	it("choosing how eval results are stored reads as design", {
		subject: "Decide how eval remarks record why each failure happened",
		detail:
			"Eval remarks are free Markdown today, so the page can't group failures by cause. We need a shape for a diagnosis per failure: which runs, the check, whether the harness, judge, skill or the eval itself was at fault, and a remedy. Weigh a structured list in remarks.md against a separate JSON file and against fields on each result line, and pick one the page and the CLI can both read and check.",
		judged: {
			kind: { design: true, bugfix: false, devops: false },
		},
	}),
	it("an unexplained slowdown to look into reads as open-ended", {
		subject: "Find out why Auto pick sometimes takes 20s to start a task",
		detail:
			"Most tasks start within a second or two, but every so often one sits on 'picking' for 15 to 20 seconds. Not sure whether it's the judge, the lineup reserve, provider health checks or something else. Look into it and tell me what's going on before changing anything.",
		judged: {
			kind: { open: true, devops: false },
			clarity: { unresolved: true },
		},
	}),
	it("a deploy health check change reads as devops", {
		subject: "Shorten web's ECS health check grace period",
		detail:
			"A rollout of web keeps the old task running for a full minute after the new one passes its probes, because the CDK service uses the 60s default grace period. Set it to 15s in the web stack and deploy to staging.",
		judged: {
			kind: { devops: true, bugfix: false, open: false },
			depth: { shallow: true },
		},
	}),
];
