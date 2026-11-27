import {
	CheckIcon,
	CircleCheckIcon,
	HistoryIcon,
	ScaleIcon,
	WrenchIcon,
	XCircleIcon,
	XIcon,
} from "lucide-react";
import type { JSX, ReactNode } from "react";
import { CardShell } from "./card-shell";
import { judgeDisplay } from "./eval-judge";
import { Coded } from "./eval-proposal-card";
import type { EvalReportLine, EvalRunReport } from "./eval-report";
import { Line } from "./work-timeline";

interface HighlightItem {
	kind: "check" | "judge" | "error";
	pass: boolean;
	text: string;
	judgeName?: string;
	/** Zero-based index into live transcript lines, when pinned. */
	step?: number;
	pin?: number;
}

/** One live transcript line, with its pin when a highlight points at it. */
export interface LiveItem {
	index: number;
	line: EvalReportLine;
	pin?: number;
}

/**
 * The eval run report card: pass/fail `CardShell`, title, responsive
 * two-column body (short transcript + numbered highlights) stacked on phone,
 * and a calm fault/change footer on failure.
 */
export function EvalReportCard({
	report,
}: {
	report: EvalRunReport;
}): JSX.Element {
	const passed = report.status === "pass";
	const headerTitle = passed
		? "Eval passed"
		: report.status === "error"
			? "Eval errored"
			: "Eval failed";
	const asideParts = [
		formatAgent(report.agent),
		report.round,
		report.seconds !== null ? `${report.seconds}s` : null,
	].filter((part): part is string => part !== null && part !== "");

	const seededCount = report.transcript.filter(
		(line) => line.seeded === true,
	).length;
	const liveLines = report.transcript.filter((line) => line.seeded !== true);
	const { liveItems, highlights } = buildPins(liveLines, report);

	const hasBody =
		seededCount > 0 || liveItems.length > 0 || highlights.length > 0;
	const hasFooter = report.fault !== null || report.change !== null;

	return (
		<div data-slot="eval-report">
			<CardShell
				label={headerTitle}
				Icon={passed ? CircleCheckIcon : XCircleIcon}
				title={headerTitle}
				tone={passed ? "success" : "destructive"}
				aside={
					asideParts.length > 0 ? (
						<span className="text-[11.5px] text-muted-foreground">
							{asideParts.join(" · ")}
						</span>
					) : undefined
				}
			>
				<h3 className="m-0 px-4 pt-3 pb-2.5 font-bold text-[15.5px] leading-[1.3] @max-md:px-3">
					{report.group !== null && (
						<span className="font-medium text-muted-foreground">
							<Coded text={`${report.group} `} />
						</span>
					)}
					<Coded text={report.eval} />
				</h3>

				{hasBody && (
					<div className="flex flex-col @xl:grid @xl:grid-cols-[1fr_1.15fr] @xl:border-t">
						<EvalTranscript seededCount={seededCount} items={liveItems} />

						<section
							aria-label="Highlights"
							className="rule-t flex flex-col gap-2 px-4 py-3 @max-md:px-3 @xl:border-t-0 @xl:[background-image:none]"
						>
							<ul className="m-0 flex list-none flex-col gap-2 p-0">
								{highlights.map((item, index) => (
									<li
										// biome-ignore lint/suspicious/noArrayIndexKey: highlights never reorder
										key={index}
										className="flex items-start gap-2 text-[13px] leading-[1.45] [&_code]:[overflow-wrap:anywhere]"
									>
										<span className="mt-px inline-flex shrink-0 items-center gap-1.5">
											{item.pin !== undefined && <Pin n={item.pin} />}
											<span
												className={
													item.pass
														? "inline-flex text-emerald-600 dark:text-emerald-400"
														: "inline-flex text-destructive"
												}
											>
												{item.pass ? (
													<CheckIcon
														aria-label="pass"
														className="size-3.5 stroke-[2.2]"
													/>
												) : (
													<XIcon
														aria-label="fail"
														className="size-3.5 stroke-[2.2]"
													/>
												)}
											</span>
										</span>
										<span className="min-w-0 flex-1">
											{item.kind === "judge" && (
												<span className="mr-1 inline-flex items-center gap-1 font-semibold text-foreground">
													<ScaleIcon
														aria-hidden
														className="size-3.5 text-muted-foreground"
													/>
													{item.judgeName}:
												</span>
											)}
											<Coded text={item.text} />
										</span>
									</li>
								))}
							</ul>
						</section>
					</div>
				)}

				{hasFooter && (
					<section
						aria-label="Fault"
						className="rule-t px-4 py-3 @max-md:px-3 [&_code]:[overflow-wrap:anywhere]"
					>
						<div className="flex items-start gap-2 text-[13px] leading-[1.45]">
							<WrenchIcon
								aria-hidden
								className="mt-0.5 size-[13px] shrink-0 text-muted-foreground"
							/>
							<span className="min-w-0 flex-1">
								{report.fault !== null && (
									<b className="font-semibold">
										{capitalize(report.fault)} fault
										{report.change !== null ? " · " : ""}
									</b>
								)}
								{report.change !== null && <Coded text={report.change} />}
							</span>
						</div>
					</section>
				)}
			</CardShell>
		</div>
	);
}

/**
 * An eval run's short transcript: how many turns were seeded, then the
 * user's messages on the right and the agent's words and tool calls on the
 * left, each pinned when a highlight points at it. `children` follow the
 * last line, such as a running step.
 */
export function EvalTranscript({
	seededCount,
	items,
	children,
}: {
	seededCount: number;
	items: LiveItem[];
	children?: ReactNode;
}): JSX.Element {
	const blocks = groupLiveBlocks(items);
	return (
		<section
			aria-label="Short transcript"
			className="rule-t flex min-w-0 flex-col gap-2 px-4 py-3 @max-md:px-3 @xl:border-t-0 @xl:border-r @xl:[background-image:none]"
		>
			{seededCount > 0 && (
				<div className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
					<HistoryIcon aria-hidden className="size-[13px] shrink-0" />
					<span>
						{seededCount} seeded {seededCount === 1 ? "turn" : "turns"}
					</span>
				</div>
			)}
			{blocks.map((block, index) =>
				block.kind === "user" ? (
					<div
						// biome-ignore lint/suspicious/noArrayIndexKey: transcript never reorders
						key={index}
						className="max-w-[88%] self-end rounded-2xl rounded-br-sm bg-muted px-3 py-1.5 text-[13px] text-foreground [&_code]:[overflow-wrap:anywhere]"
					>
						<Coded text={block.item.line.text} />
					</div>
				) : (
					<div
						// biome-ignore lint/suspicious/noArrayIndexKey: transcript never reorders
						key={index}
						className="flex max-w-[96%] flex-col items-start gap-1.5 self-start"
					>
						{block.items.map((item) =>
							item.line.who === "tool" ? (
								<ToolStep key={item.index} item={item} />
							) : (
								<div
									key={item.index}
									className="inline-flex flex-wrap items-center gap-2"
								>
									<div className="rounded-2xl rounded-bl-sm border bg-card px-3 py-1.5 text-[13px] text-foreground [&_code]:[overflow-wrap:anywhere]">
										<Coded text={item.line.text} />
									</div>
									{item.pin !== undefined && <Pin n={item.pin} />}
								</div>
							),
						)}
					</div>
				),
			)}
			{children}
		</section>
	);
}

/**
 * A tool call as the conversation's timeline draws one: its name, then its
 * arguments cut to the line, opening to them in full.
 */
function ToolStep({ item }: { item: LiveItem }): JSX.Element {
	const text = item.line.text.trim();
	const space = text.search(/\s/);
	const name = space === -1 ? text : text.slice(0, space);
	const { short, full } = toolArgs(
		space === -1 ? "" : text.slice(space).trim(),
	);
	return (
		<div className="min-w-0 self-stretch">
			<Line
				state="done"
				verb={name}
				resource={
					short === "" ? null : (
						<code className="min-w-0 truncate font-mono text-muted-foreground text-xs">
							{short}
						</code>
					)
				}
				after={item.pin !== undefined && <Pin n={item.pin} />}
			>
				{full !== "" && (
					<pre className="m-0 whitespace-pre-wrap rounded-md bg-muted px-2.5 py-2 font-mono text-muted-foreground text-xs [overflow-wrap:anywhere]">
						{full}
					</pre>
				)}
			</Line>
		</div>
	);
}

/**
 * A tool call's arguments in a line and in full: a JSON object of one
 * string field reads as that string, and JSON opens pretty-printed.
 */
export function toolArgs(args: string): { short: string; full: string } {
	let parsed: unknown;
	try {
		parsed = JSON.parse(args);
	} catch {
		return { short: args, full: args };
	}
	const values =
		typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
			? Object.values(parsed)
			: [];
	const only = values.length === 1 ? values[0] : undefined;
	return {
		short: typeof only === "string" ? only : args,
		full: JSON.stringify(parsed, null, 2),
	};
}

/** Neutral numbered circle connecting a transcript step to its highlight row. */
function Pin({ n }: { n: number }): JSX.Element {
	return (
		<span className="inline-flex size-[18px] shrink-0 items-center justify-center rounded-full border bg-muted font-semibold text-[11px] text-foreground leading-none">
			{n}
		</span>
	);
}

type LiveBlock =
	| { kind: "user"; item: LiveItem }
	| { kind: "agent"; items: LiveItem[] };

function groupLiveBlocks(items: LiveItem[]): LiveBlock[] {
	const blocks: LiveBlock[] = [];
	for (const item of items) {
		if (item.line.who === "user") {
			blocks.push({ kind: "user", item });
		} else {
			const prev = blocks.at(-1);
			if (prev?.kind === "agent") {
				prev.items.push(item);
			} else {
				blocks.push({ kind: "agent", items: [item] });
			}
		}
	}
	return blocks;
}

/**
 * Assigns neutral sequential pin numbers (`1`, `2`, `3`...) to live transcript
 * steps referenced by checks or judge, so pins read top-to-bottom on the left
 * and match the numbered rows on the right.
 */
function buildPins(
	liveLines: EvalReportLine[],
	report: EvalRunReport,
): { liveItems: LiveItem[]; highlights: HighlightItem[] } {
	const lastAgentIndex = liveLines.findLastIndex(
		(line) => line.who === "agent",
	);
	const highlights: HighlightItem[] = [];

	for (const check of report.checks) {
		const validStep =
			check.step !== undefined &&
			check.step >= 0 &&
			check.step < liveLines.length
				? check.step
				: undefined;
		highlights.push({
			kind: "check",
			pass: check.pass,
			text:
				check.error !== undefined
					? `${check.about} (${check.error})`
					: check.about,
			...(validStep !== undefined ? { step: validStep } : {}),
		});
	}

	if (report.judge !== null) {
		const explicit =
			report.judge.step !== undefined &&
			report.judge.step >= 0 &&
			report.judge.step < liveLines.length
				? report.judge.step
				: undefined;
		const fallback =
			explicit === undefined && lastAgentIndex >= 0 ? lastAgentIndex : explicit;
		highlights.push({
			kind: "judge",
			pass: report.judge.pass,
			judgeName: judgeDisplay(report.judge.judge)?.name ?? "Jev",
			text: report.judge.reason,
			...(fallback !== undefined ? { step: fallback } : {}),
		});
	}

	if (report.error !== null) {
		highlights.push({
			kind: "error",
			pass: false,
			text: report.error,
		});
	}

	const referenced = [
		...new Set(
			highlights
				.map((item) => item.step)
				.filter((step): step is number => step !== undefined),
		),
	].sort((left, right) => left - right);

	const stepToPin = new Map<number, number>();
	referenced.forEach((step, idx) => {
		stepToPin.set(step, idx + 1);
	});

	const liveItems: LiveItem[] = liveLines.map((line, index) => ({
		index,
		line,
		...(stepToPin.has(index) ? { pin: stepToPin.get(index) } : {}),
	}));

	for (const item of highlights) {
		if (item.step !== undefined) {
			item.pin = stepToPin.get(item.step);
		}
	}

	return { liveItems, highlights };
}

/** An agent as `agent:model@effort`, shown by its model's name. */
export function formatAgent(agent: string): string | null {
	const trimmed = agent.trim();
	if (trimmed === "") {
		return null;
	}
	return judgeDisplay(trimmed)?.name ?? trimmed;
}

function capitalize(word: string): string {
	return word === "" ? "" : `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`;
}
