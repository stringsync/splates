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
		head: "Removed to redo",
		cell: (arm) => share(arm.redone, arm.merged + arm.removed),
	},
];
