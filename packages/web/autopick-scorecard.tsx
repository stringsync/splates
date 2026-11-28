import type { AutopickRules, Lineup } from "@splates/server/autopick";
import type {
	LineupOverrides,
	PeriodId,
	ScorecardRow,
} from "@splates/server/stats/browser";
import { ChevronRightIcon } from "lucide-react";
import { type CSSProperties, type JSX, useEffect, useState } from "react";
import { Badge } from "#web/components/ui/badge.tsx";
import { Card } from "#web/components/ui/card.tsx";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "#web/components/ui/collapsible.tsx";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#web/components/ui/select.tsx";
import { Separator } from "#web/components/ui/separator.tsx";
import { cn } from "#web/lib/utils.ts";
import { type AutopickScores, autopickScores } from "./autopick-api";
import { LineupDot } from "./autopick-looks";
import { OverrideMoves, OverrideReview } from "./autopick-overrides";
import { cellKeyLabel, pickedCell } from "./autopick-rules";
import { ScorecardEvidence } from "./autopick-scorecard-evidence";
import { ReadFailed, ReadingNow } from "./countdown";
import { ModelProviderMark } from "./model-provider-mark";
import { PageSection } from "./page-section";
import { PERIODS } from "./stats-report";

type ScoreRead = { scores: AutopickScores } | { error: string };

/** Finished Autopick outcomes, using the same period across the machine's projects. */
export function AutopickScorecard({
	rules,
	onCell,
}: {
	rules: AutopickRules;
	onCell: (cell: string) => void;
}): JSX.Element {
	const [request, setRequest] = useState<{ period: PeriodId }>({
		period: "7d",
	});
	const { period } = request;
	const [read, setRead] = useState<ScoreRead | null>(null);
	// biome-ignore lint/correctness/useExhaustiveDependencies: the saved rules affect suggestions on the server.
	useEffect(() => {
		let live = true;
		autopickScores(request.period).then(
			(scores) => {
				if (live) {
					setRead({ scores });
				}
			},
			(error: unknown) => {
				if (live) {
					setRead({
						error: error instanceof Error ? error.message : String(error),
					});
				}
			},
		);
		return () => {
			live = false;
		};
	}, [request, rules]);

	return (
		<PageSection
			title="Scorecard"
			aside={
				<Select
					value={period}
					items={PERIODS.map(({ id, label }) => ({ value: id, label }))}
					onValueChange={(next) => {
						if (next !== null && next !== period) {
							setRead(null);
							setRequest({ period: next });
						}
					}}
				>
					<SelectTrigger size="sm" aria-label="Scorecard period">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectGroup>
							{PERIODS.map(({ id, label }) => (
								<SelectItem key={id} value={id}>
									{label}
								</SelectItem>
							))}
						</SelectGroup>
					</SelectContent>
				</Select>
			}
		>
			<OverrideReview />
			{read === null ? (
				<ReadingNow label="Reading Autopick scorecard…" />
			) : "error" in read ? (
				<ReadFailed
					error={read.error}
					onRetry={() => {
						setRead(null);
						setRequest({ period });
					}}
				/>
			) : read.scores.rows.length === 0 &&
				read.scores.overrides.length === 0 ? (
				<p className="text-muted-foreground text-sm">
					No finished Autopick tasks or recorded overrides in this period.
				</p>
			) : (
				<>
					<Card render={<ul />} className="divide-y">
						{Array.from(scoreEntries(read.scores), ([key, entry]) => (
							<ScoreRow
								key={key}
								entry={entry}
								lineups={rules.lineups}
								onCell={onCell}
							/>
						))}
					</Card>
					{read.scores.rows.length > 0 && (
						<p className="text-muted-foreground text-xs">
							{read.scores.rows.reduce((total, row) => total + row.tasks, 0)}{" "}
							finished tasks across projects. Verdicts require{" "}
							{read.scores.minimumTasks} tasks per cell and lineup.
						</p>
					)}
				</>
			)}
		</PageSection>
	);
}

type ScoreEntry =
	| { row: ScorecardRow; history?: LineupOverrides }
	| { row: null; history: LineupOverrides };

function scoreKey(
	row: Pick<ScorecardRow, "kind" | "depth" | "lineup">,
): string {
	return JSON.stringify([pickedCell(row), row.lineup ?? null]);
}

/** Preserves the scorecard order and appends moves with no matching outcome row. */
function scoreEntries({
	rows,
	overrides,
}: AutopickScores): Map<string, ScoreEntry> {
	const entries = new Map<string, ScoreEntry>();
	for (const row of rows) {
		entries.set(scoreKey(row), { row });
	}
	for (const history of overrides) {
		const key = scoreKey(history);
		entries.set(key, { row: entries.get(key)?.row ?? null, history });
	}
	return entries;
}

const VERDICTS = {
	weak: { label: "Underpowered", tone: "--warning" },
	strong: { label: "Overpowered", tone: "--info" },
	fine: { label: "Good fit", tone: "--success" },
	sparse: { label: "Not enough data", tone: "--muted-foreground" },
} as const;

function ScoreRow({
	entry: { row, history },
	lineups,
	onCell,
}: {
	entry: ScoreEntry;
	lineups: readonly Lineup[];
	onCell: (cell: string) => void;
}): JSX.Element {
	const pick = row === null ? history : row;
	const cell = pickedCell(pick);
	const lineup = lineups.find((each) => each.id === pick.lineup);
	const verdict = row === null ? null : VERDICTS[row.verdict];
	return (
		<li>
			<Collapsible>
				<CollapsibleTrigger
					className={cn(
						"group flex min-h-11 w-full items-center gap-3 px-4 py-3 text-left text-sm",
						(row === null || row.verdict === "sparse") &&
							"text-muted-foreground",
					)}
				>
					<span className="flex min-w-0 flex-1 flex-col gap-1">
						<span className="font-semibold">{cellKeyLabel(cell)}</span>
						<span className="flex items-center gap-1.5 text-muted-foreground text-xs">
							{lineup !== undefined && <LineupDot color={lineup.color} />}
							<span className="wrap-anywhere">
								{lineup?.name ?? pick.lineup ?? "No recorded lineup"} ·{" "}
								{row === null
									? `${history.count} ${history.count === 1 ? "override" : "overrides"}`
									: `${row.tasks} ${row.tasks === 1 ? "task" : "tasks"}`}
							</span>
						</span>
						{row?.suggestion && (
							<span className="flex items-start gap-1 font-medium text-xs">
								<ModelProviderMark
									provider={row.suggestionProvider}
									className="mt-px size-3.5"
								/>
								<span className="min-w-0 wrap-anywhere">{row.suggestion}</span>
							</span>
						)}
					</span>
					{verdict !== null && (
						<Badge
							variant="outline"
							className="scorecard-verdict"
							style={{ "--verdict": `var(${verdict.tone})` } as CSSProperties}
						>
							{verdict.label}
						</Badge>
					)}
					<ChevronRightIcon
						aria-hidden
						className="size-4 shrink-0 text-muted-foreground transition-transform group-aria-expanded:rotate-90"
					/>
				</CollapsibleTrigger>
				<CollapsibleContent className="flex flex-col gap-3 border-t bg-muted/40 px-4 py-3">
					{row !== null && (
						<ScorecardEvidence
							row={row}
							lineupName={(id) =>
								lineups.find((each) => each.id === id)?.name ??
								id ??
								"an unrecorded lineup"
							}
						/>
					)}
					{row !== null && history !== undefined && <Separator />}
					{history !== undefined && (
						<OverrideMoves overrides={history} onLog={() => onCell(cell)} />
					)}
				</CollapsibleContent>
			</Collapsible>
		</li>
	);
}
