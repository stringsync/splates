import type { Arm, NoteStats } from "@stringsync/splates-server/stats/browser";
import type { JSX } from "react";
import { NONE } from "./stats-columns";
import { percent } from "./stats-report";

/**
 * Whether pointers to project notes help: conversations that got them
 * against the held-out fifth, then how each note was pointed at, read and
 * applied. Each figure shows its count, since the holdout is small.
 */
export function NoteSection({ notes }: { notes: NoteStats }): JSX.Element {
	return (
		<section
			aria-label="Notes"
			className="flex min-w-0 flex-col gap-4 text-foreground"
		>
			<h3 className="font-medium text-xs">Notes</h3>
			<div className="overflow-x-auto">
				<table className="w-full text-sm tabular-nums [&_td+td]:pl-4 [&_th+th]:pl-4">
					<thead className="text-muted-foreground text-xs">
						<tr className="whitespace-nowrap border-b text-right">
							<th className="py-1 text-left font-normal">
								Did the notes help?
							</th>
							<th className="py-1 font-normal">With pointers</th>
							<th className="py-1 font-normal">Holdout</th>
						</tr>
					</thead>
					<tbody>
						{FIGURES.map((figure) => (
							<tr
								key={figure.head}
								className="border-b text-right last:border-0"
							>
								<td className="py-1 text-left">{figure.head}</td>
								<td className="py-1">{figure.cell(notes.pointed)}</td>
								<td className="py-1">{figure.cell(notes.holdout)}</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
			<p className="text-muted-foreground text-xs">
				Pointed at on {share(notes.attached, notes.messages)} messages
				{notes.p50 === null
					? ""
					: `; the judge took ${notes.p50}ms at the median, ${notes.p95}ms at p95`}
				.
			</p>
			<p className="text-muted-foreground text-xs">
				{judgeSpend(notes.spend)} {contextRead(notes.context)}
			</p>
			{notes.notes.length === 0 ? (
				<p className="text-muted-foreground text-sm">
					No note has been pointed at or read yet.
				</p>
			) : (
				<div className="overflow-x-auto">
					<table className="w-full text-sm tabular-nums [&_td+td]:pl-4 [&_th+th]:pl-4">
						<thead className="text-muted-foreground text-xs">
							<tr className="whitespace-nowrap border-b text-right">
								<th className="py-1 text-left font-normal">
									Is the routing right?
								</th>
								<th className="py-1 font-normal">Read now</th>
								<th className="py-1 font-normal">Maybe relevant</th>
								<th className="py-1 font-normal">Applied</th>
								<th className="py-1 font-normal">Read unprompted</th>
							</tr>
						</thead>
						<tbody>
							{notes.notes.map((note) => (
								<tr
									key={note.path}
									className="border-b text-right last:border-0"
								>
									<td className="max-w-48 truncate py-1 text-left">
										{note.path}
									</td>
									<td className="py-1">{share(note.nowRead, note.now)}</td>
									<td className="py-1">
										{share(note.optionalRead, note.optional)}
									</td>
									<td className="py-1">{share(note.applied, note.judged)}</td>
									<td className="py-1">{note.unprompted}</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
		</section>
	);
}

/** What the judge cost, routing and weighing apart, with the judgments that said a price. */
function judgeSpend(spend: NoteStats["spend"]): string {
	if (spend.routed === 0 && spend.weighed === 0) {
		return "No judgment of notes has said what it cost yet.";
	}
	const routing =
		spend.routed === 0
			? ""
			: `${money(spend.routing)} routing ${spend.routed} message${spend.routed === 1 ? "" : "s"} (${money(spend.routing / spend.routed)} each)`;
	const weighing =
		spend.weighed === 0
			? ""
			: `${money(spend.weighing)} weighing ${spend.weighed} note${spend.weighed === 1 ? "" : "s"} read`;
	return `The judge cost ${money(spend.routing + spend.weighing)}: ${[routing, weighing].filter((each) => each !== "").join(", ")}.`;
}

/** What the notes read took of their conversations' context. */
function contextRead(context: NoteStats["context"]): string {
	return context.share === null
		? "No note read has said its conversation's context yet."
		: `Notes read took ${percent(context.share)} of the context, about ${Math.round(context.tokens / context.conversations).toLocaleString()} tokens a conversation, over ${context.conversations}.`;
}

/**
 * Dollars small enough for a judge: to the cent from a dollar up, else to
 * two significant figures, since one judgment costs a fraction of a cent.
 */
function money(amount: number): string {
	return amount >= 1 || amount === 0
		? `$${amount.toFixed(2)}`
		: `$${Number(amount.toPrecision(2))}`;
}

/** `part` of `whole`, as a share with the count beside it, so a small sample reads as one. */
function share(part: number, whole: number): string {
	return whole === 0 ? NONE : `${percent(part / whole)} of ${whole}`;
}

/** What one arm's figures read as, in the order the comparison table lists them. */
const FIGURES: { head: string; cell: (arm: Arm) => string }[] = [
	{ head: "Conversations", cell: (arm) => String(arm.conversations) },
	{
		head: "Skill checks passed",
		cell: (arm) => share(arm.checksPassed, arm.checksApplied),
	},
	{
		head: "Merged first try",
		cell: (arm) => share(arm.firstTry, arm.merged),
	},
	{
		head: "Tokens per merged task",
		cell: (arm) =>
			arm.used === 0
				? NONE
				: `${Math.round(arm.tokens / arm.used).toLocaleString()} of ${arm.used}`,
	},
	{
		head: "Turns per merged task",
		cell: (arm) =>
			arm.turned === 0
				? NONE
				: `${(arm.turns / arm.turned).toFixed(1)} of ${arm.turned}`,
	},
	{
		head: "Messages correcting the agent",
		cell: (arm) => share(arm.corrected, arm.said),
	},
	{
		head: "Removed to redo",
		cell: (arm) => share(arm.redone, arm.merged + arm.removed),
	},
];
