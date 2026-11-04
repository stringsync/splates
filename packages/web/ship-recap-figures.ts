import type { Cascade, StageKey } from "@splates/server/ship";
import { Duration } from "core/time";
import { isSlow, PERSON_STAGES, spentOn } from "./ship-slow";

/** How a step shows on the recap: quiet when it went as expected, loud when it is worth a look. */
export type RowTone = "quiet" | "slow" | "failed" | "person";

/** One step that ran, with the time it took against the time it was expected to. */
export type RecapRow = {
	key: StageKey;
	name: string;
	spent: number;
	expected: number;
	tone: RowTone;
};

/** One project's part of a ship, every step that ran in order. */
export type RecapProject = {
	slug: string;
	spent: number;
	rows: RecapRow[];
	/** Every step went as expected and nothing failed, so the page folds it. */
	clean: boolean;
};

/** What a finished ship has to say: how long it took and where, what went wrong, and who it waited on. */
export type Recap = {
	total: number;
	/** Time spent on steps that wait for the person: sign-in, 2FA, approval. */
	person: number;
	machine: number;
	slowest: { project: string; row: RecapRow } | null;
	errors: { project: string; text: string }[];
	/** Projects sent to an agent for adoption or investigation. */
	agents: string[];
	projects: RecapProject[];
};

const FAILED = ["failed", "hung"];

/** The recap of `cascade`, reading steps still going against `now`. */
export function recapOf(cascade: Cascade, now: number): Recap {
	const total = Math.max(
		0,
		(cascade.ended === null ? now : Date.parse(cascade.ended)) -
			Date.parse(cascade.started),
	);
	let person = 0;
	let slowest: Recap["slowest"] = null;
	const errors: Recap["errors"] = [];
	const projects = cascade.steps.map((step): RecapProject => {
		const rows: RecapRow[] = [];
		for (const stage of step.stages) {
			const spent = spentOn(stage, now);
			if (spent === null || stage.state === "skipped") {
				continue;
			}
			const tone: RowTone = FAILED.includes(stage.state)
				? "failed"
				: PERSON_STAGES.includes(stage.key)
					? "person"
					: isSlow(stage, now)
						? "slow"
						: "quiet";
			const row = {
				key: stage.key,
				name: stage.name,
				spent,
				expected: stage.expected,
				tone,
			};
			rows.push(row);
			if (tone === "person") {
				person += spent;
			}
			if (
				tone === "slow" &&
				spent - row.expected >
					(slowest === null ? 0 : slowest.row.spent - slowest.row.expected)
			) {
				slowest = { project: step.slug, row };
			}
			if (tone === "failed") {
				errors.push({
					project: step.slug,
					text: `${stage.name} ${stage.state}${step.note ? `: ${step.note.split("\n")[0]}` : ""}`,
				});
			}
		}
		return {
			slug: step.slug,
			spent: rows.reduce((sum, row) => sum + row.spent, 0),
			rows,
			clean: rows.every((row) => row.tone === "quiet" || row.tone === "person"),
		};
	});
	return {
		total,
		person,
		machine: Math.max(0, total - person),
		slowest,
		errors,
		agents: cascade.steps
			.filter((step) => step.adopt === "agent" || step.sentToAgent === true)
			.map((step) => step.slug),
		projects,
	};
}

/** `ms` as `1h 02m`, `22m 05s` or `41s`. */
export function lasted(ms: number): string {
	const seconds = Math.round(ms / Duration.secs(1).ms);
	const hours = Math.floor(seconds / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	const rest = seconds % 60;
	const two = (value: number) => String(value).padStart(2, "0");
	return hours > 0
		? `${hours}h ${two(minutes)}m`
		: minutes > 0
			? `${minutes}m ${two(rest)}s`
			: `${rest}s`;
}
