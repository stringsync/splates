import { makeAssistantDataUI } from "@assistant-ui/react";
import type { TaskReport } from "@splates/server/plans";
import { type JSX, useContext } from "react";
import { CardArchive, useArchivable } from "./archive-offer";
import { BeforeAfter, cardRecord } from "./before-after";
import { Board } from "./board";
import { InMessage, useCardReply } from "./card-reply";
import { CardBody, CardShell, ENDINGS, reportText } from "./card-shell";
import { ChecksSection } from "./checks-section";
import {
	DeferredBody,
	deferredTask,
	HeldBlockers,
	heldTask,
} from "./deferred-body";
import { EvalDoneBody } from "./eval-done-card";
import { evalDoneOf } from "./eval-done-report";
import { Markdown } from "./markdown";
import { MergedBody } from "./merged-body";
import { MergedStats, useLanded } from "./merged-stats";
import { QueueSummaryAfter } from "./queue-summary-card";

/**
 * Renders a `data-report` part as a card: how a task ended, or what it waits
 * on, as the agent reported it. A Deferred card also shows where its task
 * stands now and what is left to unblock it.
 */
export const ReportUI = makeAssistantDataUI<{ report: TaskReport }>({
	name: "report",
	render: ({ data }) => (
		<InMessage>
			<ReportCard report={data.report} />
			<QueueSummaryAfter report={data.report} />
		</InMessage>
	),
});

export function ReportCard({
	report,
}: {
	report: TaskReport;
}): JSX.Element | null {
	const { Icon, tone } = ENDINGS[report.ending];
	const merged = report.ending === "merged";
	const removed = report.ending === "removed";
	const text = reportText(report);
	// A Done report that ends an eval loop names the batch of its last run.
	const done = report.ending === "done" ? evalDoneOf(text) : null;
	const archivable = useArchivable(report);
	const landed = useLanded(
		merged || removed ? report.task : null,
		removed ? "removed" : "merged",
	);
	// A deferral follows the board record of its task, when it has one.
	const board = useContext(Board);
	const deferral =
		report.ending === "deferred"
			? deferredTask(board.todos, report.task)
			: null;
	// An old deferral, recorded with no why or blockers, keeps its words and
	// lets the person link what its task waits on.
	const held =
		report.ending === "deferred" && deferral === null
			? heldTask(board.todos, report.task)
			: null;
	// Once the conversation went on past it, or its task was taken again, a
	// deferral is history: folded to its header, opened to what the agent said.
	const { sent } = useCardReply();
	const resumed =
		deferral !== null && (sent !== null || deferral.takenBy !== null);
	// A merge leads with the Before and After its record kept, when it did.
	const record = merged ? cardRecord(landed?.outcome.outcome) : null;
	// A merge shows once its outcome is read, so it never grows a footer.
	if (landed === undefined) {
		return null;
	}
	return (
		<div>
			{merged && text !== "" && (
				// A merge's own words are the agent's, so they sit above its card.
				<Markdown
					text={text}
					className="mb-3 px-1 text-sm leading-relaxed [&_p:first-child]:mt-0 [&_p:last-child]:mb-0"
				/>
			)}
			<CardShell
				label={`${report.ending} ${report.task}`.trim()}
				Icon={Icon}
				title={ENDINGS[report.ending].title}
				tone={tone}
				// A Done report names no task; a merge names its task and base in its header.
				task={report.task === "" ? undefined : report.task}
				base={report.base}
				folded={resumed}
				aside={
					resumed ? (
						<span className="text-muted-foreground text-xs">Resumed</span>
					) : undefined
				}
			>
				{resumed ? (
					text !== "" && <CardBody text={text} lead={report.reason !== null} />
				) : deferral !== null ? (
					<DeferredBody task={deferral} />
				) : text === "" && !merged ? (
					archivable ? (
						<CardArchive report={report} />
					) : undefined
				) : (
					<>
						{!merged && done !== null ? (
							<EvalDoneBody read={done} lead={report.reason !== null} />
						) : merged && record !== null ? (
							<BeforeAfter
								record={record}
								folds
								className="px-4 py-3.5 @max-md:px-3 @max-md:py-2.5"
							>
								<ChecksSection text={record.checks ?? ""} />
							</BeforeAfter>
						) : merged ? (
							<MergedBody text="" outcome={landed?.outcome.outcome} />
						) : (
							text !== "" && (
								<CardBody text={text} lead={report.reason !== null} />
							)
						)}
						{held !== null && <HeldBlockers task={held} />}
						{(merged || removed) && <MergedStats landed={landed} />}
						<CardArchive report={report} unmerge={merged} />
					</>
				)}
			</CardShell>
		</div>
	);
}
