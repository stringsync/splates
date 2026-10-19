import { age } from "@stringsync/splates-server/age";
import type { AutoPicked } from "@stringsync/splates-server/auto-pick";
import {
	DIFFICULTIES,
	KINDS,
} from "@stringsync/splates-server/auto-pick/browser";
import type { JSX } from "react";

/**
 * The last Auto pick that started the task, in a few lines: whom, when, what
 * the judge took the task for and how sure it was, or why it could not say,
 * and the rest of why.
 */
export function AutoPickFact({ picked }: { picked: AutoPicked }): JSX.Element {
	const [headline, judged, ...why] = picked.reasons;
	const classification = picked.classified?.classification;
	return (
		<div className="flex flex-col gap-0.5">
			<span>
				{headline}{" "}
				<span className="text-muted-foreground">· {age(picked.at)} ago</span>
			</span>
			<span className="text-muted-foreground">
				{classification === undefined
					? judged
					: [
							likeliest(KINDS, classification.kinds, picked.kind),
							likeliest(
								DIFFICULTIES,
								classification.difficulty,
								picked.difficulty,
							),
						].join(" · ")}
			</span>
			{why.length > 0 && (
				<ul className="flex flex-col gap-0.5 text-muted-foreground">
					{why.map((reason) => (
						<li key={reason}>{reason}</li>
					))}
				</ul>
			)}
		</div>
	);
}

/**
 * The likeliest of `classes` with how sure the judge was, `Mechanical 80%`,
 * marked unsure when the pick did not take it, falling short of the threshold.
 */
function likeliest<Id extends string>(
	classes: readonly { id: Id; label: string }[],
	answers: Record<Id, number>,
	taken: Id | null,
): string {
	const best = classes.reduce((most, each) =>
		answers[each.id] > answers[most.id] ? each : most,
	);
	const said = `${best.label} ${Math.round(answers[best.id] * 100)}%`;
	return taken === null ? `unsure (${said})` : said;
}
