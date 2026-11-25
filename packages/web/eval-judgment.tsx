import type { EvalCheck, EvalDetail } from "@splates/server/evals/browser";
import { Duration } from "core/time";
import {
	CheckIcon,
	CircleCheckIcon,
	CircleXIcon,
	WrenchIcon,
	XIcon,
} from "lucide-react";
import type { JSX, ReactNode } from "react";
import { CardShell } from "./card-shell";
import { distinctJudges, JudgedBy, judgeDisplay } from "./eval-judge";
import { Markdown } from "./markdown";

export function EvalJudgment({
	run,
	onStep,
}: {
	run: EvalDetail;
	onStep: (index: number) => void;
}): JSX.Element {
	const { checks, judge, status } = run;
	const failed =
		checks.filter((check) => !check.pass).length +
		(judge?.pass === false ? 1 : 0);
	const total = checks.length + (judge === null ? 0 : 1);
	const graded = status === "pass" || status === "fail";
	const meta = [
		durationLabel(run.phases?.judgeMs),
		run.costUsd === null ? undefined : `$${run.costUsd.toFixed(2)} total`,
	]
		.filter(Boolean)
		.join(" · ");
	const title = !graded
		? "Run ended before grading finished"
		: total === 0
			? `Judged · ${status === "pass" ? "passed" : "failed"}`
			: `Judged · ${failed || total} of ${total} ${total === 1 ? "check" : "checks"} ${failed ? "failed" : "passed"}`;
	return (
		<JudgeBox tone={graded ? status : "neutral"} title={title} meta={meta}>
			{(run.error ?? run.reason) && (
				<Markdown
					className="border-b px-4 py-2 last:border-b-0"
					text={run.error ?? run.reason ?? ""}
				/>
			)}
			{total > 0 && (
				<ul className="divide-y">
					{checks.map((check) => {
						const step = checkStep(check, run);
						return (
							<li key={check.id} className="flex items-start gap-2 px-4 py-2">
								<JudgmentIcon
									tone={check.pass ? "pass" : "fail"}
									label={check.pass ? "Passed" : "Failed"}
								/>
								<div className="min-w-0">
									<code className="font-semibold text-xs">{check.id}</code>{" "}
									<Markdown
										text={check.about}
										className="text-muted-foreground"
										inline
									/>
									{check.error && <Markdown text={check.error} />}
									{step && (
										<button
											type="button"
											className="block cursor-pointer rounded-sm text-left text-destructive text-xs underline-offset-2 hover:underline focus-visible:underline"
											onClick={() => onStep(step.index)}
										>
											failed at {step.name} ↑
										</button>
									)}
								</div>
							</li>
						);
					})}
					{judge !== null && (
						<li className="flex items-start gap-2 px-4 py-2">
							<JudgmentIcon
								tone={judge.pass ? "pass" : "fail"}
								label={judge.pass ? "Passed" : "Failed"}
							/>
							<div className="min-w-0">
								{judgeDisplay(judge.judge) === null ? (
									<p className="font-medium">Judge</p>
								) : (
									<JudgedBy
										judges={distinctJudges([judge.judge])}
										className="text-sm"
									/>
								)}
								{run.rubric !== null && (
									<Markdown
										text={run.rubric}
										className="text-muted-foreground"
									/>
								)}
								<Markdown text={judge.reason} />
							</div>
						</li>
					)}
				</ul>
			)}
			{run.score !== undefined && (
				<p className="px-4 py-2 text-muted-foreground text-xs">
					Score {run.score.toFixed(2)}
				</p>
			)}
		</JudgeBox>
	);
}

type Tone = "pass" | "fail" | "neutral";

export function durationLabel(ms: number | undefined): string | undefined {
	return ms === undefined ? undefined : Duration.ms(ms).human();
}

/** Only saved evidence can identify a particular call as the cause of a failure. */
export function checkStep(check: EvalCheck, run: EvalDetail) {
	const step =
		check.step === undefined ? undefined : run.transcript[check.step.index];
	return !check.pass && check.step !== undefined && step?.kind === "tool"
		? {
				index: check.step.index,
				name: step.name,
				observed: check.step.observed,
			}
		: undefined;
}

/** The judge's verdict as a conversation card, its header toned green on a pass and red on a fail. */
export function JudgeBox({
	tone,
	title,
	meta,
	children,
}: {
	tone: Tone;
	title: string;
	meta?: string | undefined;
	children: ReactNode;
}): JSX.Element {
	return (
		<CardShell
			label={title}
			Icon={
				tone === "pass"
					? CircleCheckIcon
					: tone === "fail"
						? CircleXIcon
						: WrenchIcon
			}
			title={title}
			tone={
				tone === "pass"
					? "success"
					: tone === "fail"
						? "destructive"
						: "neutral"
			}
			aside={
				meta ? (
					<span className="shrink-0 text-muted-foreground text-xs tabular-nums">
						{meta}
					</span>
				) : undefined
			}
		>
			<div className="text-sm wrap-anywhere">{children}</div>
		</CardShell>
	);
}

function JudgmentIcon({
	tone,
	label,
}: {
	tone: Tone;
	label?: string;
}): JSX.Element {
	switch (tone) {
		case "pass":
			return (
				<CheckIcon
					aria-hidden={label === undefined}
					aria-label={label}
					className="size-3.5 shrink-0 text-success"
				/>
			);
		case "fail":
			return (
				<XIcon
					aria-hidden={label === undefined}
					aria-label={label}
					className="size-3.5 shrink-0 text-destructive"
				/>
			);
		case "neutral":
			return (
				<WrenchIcon
					aria-hidden
					className="size-3.5 shrink-0 text-muted-foreground"
				/>
			);
	}
}
