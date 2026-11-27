import type { RuleCorrection, RuleSuggestionView } from "@splates/server/trust";
import { type JSX, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { modelName, projectName } from "./trust-page";

const SHORT_DATE = new Intl.DateTimeFormat("en-US", {
	month: "short",
	day: "numeric",
	timeZone: "UTC",
});

/**
 * Pending rule suggestions on the Trust page: one card per open Backlog
 * suggestion task, listing the repeated corrections behind it with actions to
 * queue the task for an agent or dismiss (remove) it.
 */
export function TrustRuleSuggestions({
	suggestions,
	selectedProject,
	onQueue,
	onDismiss,
}: {
	suggestions: readonly RuleSuggestionView[];
	/** Active project filter root, or null when viewing all projects. */
	selectedProject: string | null;
	onQueue: (suggestion: RuleSuggestionView) => Promise<void>;
	onDismiss: (suggestion: RuleSuggestionView) => Promise<void>;
}): JSX.Element | null {
	if (suggestions.length === 0) {
		return null;
	}
	const uniqueProjects = new Set(suggestions.map((each) => each.project));
	const multiProject = selectedProject === null && uniqueProjects.size > 1;
	const headerDetail = multiProject
		? `${suggestions.length} suggestions`
		: projectName(selectedProject ?? suggestions[0]?.project ?? "");
	return (
		<section aria-label="Rule suggestions" className="flex flex-col gap-2.5">
			<div className="flex items-baseline justify-between px-0.5">
				<h2 className="font-medium text-muted-foreground text-xs uppercase tracking-wider">
					Rule suggestions
				</h2>
				<span className="text-muted-foreground text-xs">{headerDetail}</span>
			</div>
			{suggestions.map((suggestion) => (
				<RuleSuggestionCard
					key={`${suggestion.project}\0${suggestion.taskId}`}
					suggestion={suggestion}
					showProject={multiProject}
					onQueue={() => onQueue(suggestion)}
					onDismiss={() => onDismiss(suggestion)}
				/>
			))}
		</section>
	);
}

function RuleSuggestionCard({
	suggestion,
	showProject,
	onQueue,
	onDismiss,
}: {
	suggestion: RuleSuggestionView;
	showProject: boolean;
	onQueue: () => Promise<void>;
	onDismiss: () => Promise<void>;
}): JSX.Element {
	const [busy, setBusy] = useState<"queue" | "dismiss" | null>(null);
	const [failed, setFailed] = useState<string | null>(null);
	const run = async (which: "queue" | "dismiss") => {
		setBusy(which);
		setFailed(null);
		try {
			await (which === "queue" ? onQueue() : onDismiss());
		} catch (error) {
			setFailed(String(error));
			setBusy(null);
		}
	};
	const meta = [
		showProject ? projectName(suggestion.project) : null,
		suggestion.corrections.length > 0
			? `${suggestion.corrections.length} ${suggestion.corrections.length === 1 ? "correction" : "corrections"}`
			: null,
		`Task #${suggestion.taskId}`,
	]
		.filter(Boolean)
		.join(" · ");
	return (
		<article
			aria-label={suggestion.subject}
			className="overflow-hidden rounded-xl border bg-card p-3.5 sm:p-4"
		>
			<h3 className="font-semibold text-[15px] leading-snug tracking-tight">
				{suggestion.subject}
			</h3>
			<p className="mt-0.5 text-muted-foreground text-xs">{meta}</p>
			{suggestion.corrections.length > 0 && (
				<ol className="mt-3 divide-y border-t border-b">
					{suggestion.corrections.map((correction) => (
						<li
							key={correction.id}
							className="grid gap-0.5 py-2.5 text-sm md:grid-cols-[minmax(180px,1fr)_minmax(220px,1.5fr)_auto] md:items-baseline md:gap-4"
						>
							<span className="font-medium leading-snug">
								{correction.subject}
							</span>
							<span className="text-muted-foreground text-xs leading-relaxed">
								{correctionSummary(correction)}
							</span>
							<time
								dateTime={correction.at}
								className="text-muted-foreground text-xs tabular-nums md:text-right"
							>
								{shortDate(correction.at)}
							</time>
						</li>
					))}
				</ol>
			)}
			{failed !== null && (
				<p role="alert" className="mt-2.5 text-destructive text-xs">
					{failed}
				</p>
			)}
			<div className="mt-3 flex flex-wrap items-center gap-2">
				<Button
					size="sm"
					className="h-9 px-3.5"
					disabled={busy !== null}
					onClick={() => void run("queue")}
				>
					{busy === "queue" ? "Queueing…" : "Queue task"}
				</Button>
				<Button
					size="sm"
					variant="outline"
					className="h-9 px-3.5"
					disabled={busy !== null}
					onClick={() => void run("dismiss")}
				>
					{busy === "dismiss" ? "Dismissing…" : "Dismiss"}
				</Button>
			</div>
		</article>
	);
}

function correctionSummary(correction: RuleCorrection): string {
	const parts: string[] = [];
	if (correction.picked !== undefined) {
		parts.push(`Agent picked ${correction.picked}`);
	}
	if (correction.instead !== undefined) {
		parts.push(`User chose ${correction.instead}`);
	}
	if (parts.length > 0) {
		return parts.join(" · ");
	}
	return `Overturned (${modelName({ project: "", agent: correction.agent, model: correction.model })})`;
}

function shortDate(iso: string): string {
	const parsed = new Date(iso);
	return Number.isNaN(parsed.getTime())
		? iso.slice(0, 10)
		: SHORT_DATE.format(parsed);
}
