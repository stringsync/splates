import type { TaskReport } from "@splates/server/plans";
import { type JSX, useState } from "react";
import { CardBody, CardShell, ENDINGS } from "./card-shell";
import { SplatesEvent } from "./splates-event";

/**
 * The line a Blocked report becomes once the conversation goes on past it:
 * "Blocked <task> · waits on #812", with Show to open what the agent wrote and
 * Hide to fold it again.
 */
export function BlockedLine({
	report,
	waits,
	resumed,
	text,
}: {
	report: TaskReport;
	/** The tasks it still waits on, by number. */
	waits: readonly number[];
	/** Whether its task was taken up again. */
	resumed: boolean;
	/** What the agent said in the report. */
	text: string;
}): JSX.Element {
	const [open, setOpen] = useState(false);
	const { Icon, tone, title } = ENDINGS.deferred;
	const after = resumed
		? "resumed"
		: waits.length > 0
			? `waits on ${waits.map((id) => `#${id}`).join(", ")}`
			: "nothing left to wait on";
	return (
		<section aria-label={`deferred ${report.task}`}>
			<SplatesEvent
				event={{
					words: [title, { kind: "task", task: report.task }, `· ${after}`],
					act: { label: open ? "Hide" : "Show", run: () => setOpen(!open) },
				}}
			/>
			{open && (
				<CardShell
					label={`blocked report ${report.task}`}
					Icon={Icon}
					title={title}
					tone={tone}
					task={report.task}
				>
					{text !== "" && (
						<CardBody text={text} lead={report.reason !== null} />
					)}
				</CardShell>
			)}
		</section>
	);
}
