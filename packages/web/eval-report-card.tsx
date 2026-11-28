import {
	BookOpenIcon,
	BoxIcon,
	CheckIcon,
	CircleCheckIcon,
	CpuIcon,
	FlaskConicalIcon,
	HistoryIcon,
	ListChecksIcon,
	MessageSquareIcon,
	ScaleIcon,
	WrenchIcon,
	XCircleIcon,
	XIcon,
} from "lucide-react";
import type { JSX, ReactNode } from "react";
import { CardSection } from "./card-section";
import { CardShell } from "./card-shell";
import { judgeDisplay } from "./eval-judge";
import { Coded } from "./eval-proposal-card";
import type {
	EvalReportFault,
	EvalReportLine,
	EvalRunReport,
} from "./eval-report";
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
 * The eval run report card: pass/fail `CardShell`, title, and responsive
 * two-column body (short transcript + numbered checks and, underneath the
 * checks, what went wrong by area), stacked on phone.
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
	const faults = faultsOf(report);
	const hasPins = highlights.some((item) => item.pin !== undefined);

	const hasBody =
		seededCount > 0 ||
		liveItems.length > 0 ||
		highlights.length > 0 ||
		faults.length > 0;

	return (
		<div data-slot="eval-report">
			<CardShell
				label={headerTitle}
				Icon={passed ? CircleCheckIcon : XCircleIcon}
				title={headerTitle}
				tone={passed ? "success" : "destructive"}
				sheet={{ title: headerTitle, action: "Open" }}
				aside={
					asideParts.length > 0 ? (
						<span className="text-[11.5px] text-muted-foreground">
							{asideParts.join(" · ")}
						</span>
					) : undefined
				}
			>
				<h3 className="m-0 px-4 pt-3 pb-2.5 font-bold text-[15.5px] leading-[1.3]">
					{report.group !== null && (
						<span className="font-medium text-muted-foreground">
							<Coded text={`${report.group} `} />
						</span>
					)}
					<Coded text={report.eval} />
				</h3>

				{hasBody && (
					<div className="flex flex-col @xl:grid @xl:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] @xl:border-t">
						<EvalTranscript seededCount={seededCount} items={liveItems} />

						<section
							aria-label="Highlights"
							className="rule-t flex flex-col gap-2 px-4 py-3 @xl:border-t-0 @xl:[background-image:none]"
						>
							{highlights.length > 0 && (
								<ul className="m-0 flex list-none flex-col gap-2 p-0">
									{highlights.map((item, index) => (
										<li
											// biome-ignore lint/suspicious/noArrayIndexKey: highlights never reorder
											key={index}
											className="flex items-start gap-2 text-[13px] leading-[1.45] [&_code]:[overflow-wrap:anywhere]"
										>
											<span className="inline-flex h-[1.45em] shrink-0 items-center gap-1.5">
												{hasPins && (
													<span className="inline-flex size-[18px] shrink-0 items-center justify-center">
														{item.pin !== undefined && <Pin n={item.pin} />}
													</span>
												)}
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
													<span className="mr-1 font-semibold text-foreground">
														{item.judgeName} judged the reply and transcript:
													</span>
												)}
												<Coded text={item.text} />
											</span>
										</li>
									))}
								</ul>
							)}

							{faults.length > 0 && (
								<CardSection
									label="What went wrong"
									title="What went wrong"
									ruled={highlights.length > 0}
									className={
										highlights.length > 0 ? "mt-1.5 py-2.5 last:pb-0" : "py-0"
									}
								>
									<ul className="m-0 flex list-none flex-col gap-[7px] p-0">
										{faults.map((item, index) => (
											<li
												// biome-ignore lint/suspicious/noArrayIndexKey: faults never reorder
												key={index}
												className="flex items-start gap-2 text-[12.5px] leading-[1.44] [&_code]:[overflow-wrap:anywhere]"
											>
												<FaultAreaIcon area={item.area} />
												<span className="min-w-0 flex-1">
													<b className="font-semibold text-foreground">
														{capitalize(item.area)}
														{item.detail !== "" ? " · " : ""}
													</b>
													{item.detail !== "" && <Coded text={item.detail} />}
												</span>
											</li>
										))}
									</ul>
								</CardSection>
							)}
						</section>
					</div>
				)}
			</CardShell>
		</div>
	);
}

/** Issues diagnosed for `report`: explicit `faults`, else a legacy `fault`/`change` pair. */
function faultsOf(report: EvalRunReport): EvalReportFault[] {
	if (report.faults.length > 0) {
		return report.faults;
	}
	if (report.fault !== null) {
		return [{ area: report.fault, detail: report.change ?? "" }];
	}
	if (report.change !== null) {
		return [{ area: "note", detail: report.change }];
	}
	return [];
}

/** Quiet monochrome icon matching a diagnosed eval area. */
function FaultAreaIcon({ area }: { area: string }): JSX.Element {
	const className = "mt-0.5 size-[13px] shrink-0 text-muted-foreground";
	switch (area.toLowerCase()) {
		case "skill":
			return <BookOpenIcon aria-hidden className={className} />;
		case "judge":
			return <ScaleIcon aria-hidden className={className} />;
		case "environment":
		case "sandbox":
			return <BoxIcon aria-hidden className={className} />;
		case "prompt":
			return <MessageSquareIcon aria-hidden className={className} />;
		case "checks":
		case "check":
			return <ListChecksIcon aria-hidden className={className} />;
		case "model":
			return <CpuIcon aria-hidden className={className} />;
		case "eval":
			return <FlaskConicalIcon aria-hidden className={className} />;
		default:
			return <WrenchIcon aria-hidden className={className} />;
	}
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
			className="rule-t flex min-w-0 flex-col gap-2 px-4 py-3 @xl:border-t-0 @xl:border-r @xl:[background-image:none]"
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
						className="flex min-w-0 max-w-[96%] flex-col items-start gap-1.5 self-start"
					>
						{block.items.map((item) =>
							item.line.who === "tool" ? (
								<ToolStep key={item.index} item={item} />
							) : (
								<div
									key={item.index}
									className="flex min-w-0 max-w-full flex-wrap items-center gap-2"
								>
									{item.pin !== undefined && <Pin n={item.pin} />}
									<div className="min-w-0 max-w-full rounded-2xl rounded-bl-sm border bg-card px-3 py-1.5 text-[13px] text-foreground [overflow-wrap:anywhere] [&_code]:[overflow-wrap:anywhere]">
										<Coded text={item.line.text} />
									</div>
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
