/** Whose fault a failing run is, matching `evals/packages/evals/report.ts`. */
export type EvalFault = "judge" | "skill" | "harness" | "model" | "eval";

/** Outcome of one eval run. */
export type EvalReportStatus = "pass" | "fail" | "error";

/** Parses an `eval-report` JSON fence, or returns null if invalid. */
export function evalReportOf(source: string): EvalRunReport | null {
	let raw: unknown;
	try {
		raw = JSON.parse(source);
	} catch {
		return null;
	}
	if (!isRecord(raw)) {
		return null;
	}
	const title = nonEmptyString(raw.eval);
	const status =
		typeof raw.status === "string" && STATUSES.has(raw.status)
			? (raw.status as EvalReportStatus)
			: null;
	if (title === null || status === null) {
		return null;
	}
	const transcript: EvalReportLine[] = [];
	if (Array.isArray(raw.transcript)) {
		for (const item of raw.transcript) {
			if (!isRecord(item)) {
				continue;
			}
			const who =
				item.who === "user" || item.who === "agent" || item.who === "tool"
					? item.who
					: null;
			const text = typeof item.text === "string" ? item.text : null;
			if (who !== null && text !== null) {
				transcript.push({
					who,
					text,
					...(item.seeded === true ? { seeded: true } : {}),
				});
			}
		}
	}
	const checks: EvalReportCheck[] = [];
	if (Array.isArray(raw.checks)) {
		for (const item of raw.checks) {
			if (!isRecord(item)) {
				continue;
			}
			const about = nonEmptyString(item.about);
			if (about === null || typeof item.pass !== "boolean") {
				continue;
			}
			const step = stepIndexOf(item.step);
			checks.push({
				...(typeof item.id === "string" ? { id: item.id } : {}),
				about,
				pass: item.pass,
				...(typeof item.error === "string" && item.error.trim() !== ""
					? { error: item.error }
					: {}),
				...(step !== undefined ? { step } : {}),
			});
		}
	}
	let judge: EvalReportJudge | null = null;
	if (isRecord(raw.judge) && typeof raw.judge.pass === "boolean") {
		const reason = nonEmptyString(raw.judge.reason);
		if (reason !== null) {
			const step = stepIndexOf(raw.judge.step);
			judge = {
				pass: raw.judge.pass,
				reason,
				...(nonEmptyString(raw.judge.judge) !== null
					? { judge: nonEmptyString(raw.judge.judge) as string }
					: {}),
				...(step !== undefined ? { step } : {}),
			};
		}
	}
	const usage = isRecord(raw.usage) ? raw.usage : null;
	const seconds =
		typeof usage?.seconds === "number" && Number.isFinite(usage.seconds)
			? usage.seconds
			: typeof raw.seconds === "number" && Number.isFinite(raw.seconds)
				? raw.seconds
				: null;
	const fault =
		typeof raw.fault === "string" && FAULTS.has(raw.fault.toLowerCase())
			? (raw.fault.toLowerCase() as EvalFault)
			: null;
	const round =
		typeof raw.round === "number" && Number.isFinite(raw.round)
			? `R${raw.round}`
			: nonEmptyString(raw.round);

	return {
		eval: title,
		group: nonEmptyString(raw.group),
		agent: nonEmptyString(raw.agent) ?? "",
		round,
		status,
		error: nonEmptyString(raw.error),
		transcript,
		checks,
		judge,
		seconds,
		fault,
		change: nonEmptyString(raw.change) ?? nonEmptyString(raw.changed),
	};
}

/** One line of a run report's short transcript. */
export interface EvalReportLine {
	who: "user" | "agent" | "tool";
	text: string;
	seeded?: boolean;
}

/** One code check in a run report, optionally pinned to a live transcript step. */
export interface EvalReportCheck {
	id?: string;
	about: string;
	pass: boolean;
	error?: string;
	/** Zero-based index into live (non-seeded) transcript lines, for numbered pins. */
	step?: number;
}

/** The judge's verdict in a run report, optionally pinned to a live transcript step. */
export interface EvalReportJudge {
	pass: boolean;
	reason: string;
	judge?: string;
	/** Zero-based index into live (non-seeded) transcript lines, for a numbered pin. */
	step?: number;
}

/**
 * Parsed eval run report from an `eval-report` JSON fence, compatible with
 * `bin/evals run --json` plus optional agent-supplied fields (`group`, `round`,
 * `change`, `fault`, and `step` pins on checks/judge).
 */
export interface EvalRunReport {
	eval: string;
	group: string | null;
	agent: string;
	round: string | null;
	status: EvalReportStatus;
	error: string | null;
	transcript: EvalReportLine[];
	checks: EvalReportCheck[];
	judge: EvalReportJudge | null;
	seconds: number | null;
	fault: EvalFault | null;
	change: string | null;
}

const FAULTS = new Set<string>(["judge", "skill", "harness", "model", "eval"]);
const STATUSES = new Set<string>(["pass", "fail", "error"]);

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | null {
	if (typeof value !== "string") {
		return null;
	}
	const trimmed = value.trim();
	return trimmed === "" ? null : trimmed;
}

function stepIndexOf(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
		return value;
	}
	if (
		isRecord(value) &&
		typeof value.index === "number" &&
		Number.isInteger(value.index) &&
		value.index >= 0
	) {
		return value.index;
	}
	return undefined;
}
