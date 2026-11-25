import type { JSX } from "react";
import { cn } from "#web/lib/utils.ts";
import { AgentMark } from "./agent-icons";
import { formatModelLabel } from "./eval-spec-data";

/** A judge as shown: its maker's mark, the model's name and its effort. */
export interface JudgeDisplay {
	agent: string;
	name: string;
	effort: string | null;
}

/**
 * Reads a judge as evals write it, `claude:sonnet@high` (a verdict's
 * `judge`, a scenario's `judgeWith`), or a bare model such as `opus`, which
 * is Claude's since only Claude judges; null for none.
 */
export function judgeDisplay(
	text: string | null | undefined,
): JudgeDisplay | null {
	const trimmed = text?.trim() ?? "";
	if (trimmed === "") {
		return null;
	}
	const colon = trimmed.indexOf(":");
	const agent = colon < 0 ? "claude" : trimmed.slice(0, colon).toLowerCase();
	const rest = colon < 0 ? trimmed : trimmed.slice(colon + 1);
	const at = rest.indexOf("@");
	const model = at < 0 ? rest : rest.slice(0, at);
	const effort = at < 0 ? null : rest.slice(at + 1) || null;
	return { agent, name: formatModelLabel(agent, model), effort };
}

/** Judges named by `texts`, each shown once, in the order first named. */
export function distinctJudges(
	texts: readonly (string | null | undefined)[],
): JudgeDisplay[] {
	const seen = new Map<string, JudgeDisplay>();
	for (const text of texts) {
		const judge = judgeDisplay(text);
		if (judge !== null) {
			seen.set(`${judge.agent}/${judge.name}@${judge.effort ?? ""}`, judge);
		}
	}
	return [...seen.values()];
}

/** `Judged by` the judges' marks and names, or what grades the run when no model does. */
export function JudgedBy({
	judges,
	lead = "Judged by",
	className,
}: {
	judges: readonly JudgeDisplay[];
	lead?: string;
	className?: string;
}): JSX.Element | null {
	if (judges.length === 0) {
		return null;
	}
	return (
		<span
			className={cn(
				"inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-muted-foreground text-xs",
				className,
			)}
		>
			{lead !== "" && <span>{lead}</span>}
			{judges.map((judge, index) => (
				<span
					key={`${judge.agent}/${judge.name}@${judge.effort ?? ""}`}
					className="inline-flex items-center gap-1"
				>
					{index > 0 && <span aria-hidden>,</span>}
					<AgentMark agent={judge.agent} className="size-3.5" />
					<span className="font-medium text-foreground">{judge.name}</span>
					{judge.effort !== null && <span>· {judge.effort} effort</span>}
				</span>
			))}
		</span>
	);
}

/** Says a scripted check, not a model, graded the run. */
export function CheckedByCode({
	className,
}: {
	className?: string;
}): JSX.Element {
	return (
		<span className={cn("text-muted-foreground text-xs", className)}>
			Checked by code
		</span>
	);
}
