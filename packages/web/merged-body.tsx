import type { JSX } from "react";
import { CardBody } from "./card-shell";

/**
 * A merged card's one body: the first paragraph of the agent's report, or of
 * the task's `## Outcome` when the report says nothing, under a Summary
 * heading, then the rest of both, the outcome's demo and verification among
 * them, all in one text color with no rule between.
 */
export function MergedBody({
	text,
	outcome,
}: {
	text: string;
	outcome: string | undefined;
}): JSX.Element | null {
	const [first, ...rest] = paragraphs(text !== "" ? text : (outcome ?? ""));
	if (first === undefined) {
		return null;
	}
	const more = [
		rest.join("\n\n"),
		text !== "" && outcome !== undefined ? outcome : "",
	].filter((each) => each !== "");
	return (
		<div className="flex flex-col gap-2 px-4 py-3.5 @max-md:px-3 @max-md:py-2.5">
			<CardBody className="p-0 @max-md:p-0" text={`### Summary\n\n${first}`} />
			{more.length > 0 && (
				<section aria-label="outcome" className="flex flex-col gap-2">
					{more.map((each) => (
						<CardBody className="p-0 @max-md:p-0" key={each} text={each} />
					))}
				</section>
			)}
		</div>
	);
}

/** `text`'s paragraphs, a blank line apart, outside any code fence. */
export function paragraphs(text: string): string[] {
	const found: string[] = [];
	let fenced = false;
	let current: string[] = [];
	for (const line of text.trim().split("\n")) {
		if (/^\s*(```|~~~)/.test(line)) {
			fenced = !fenced;
		}
		if (!fenced && line.trim() === "") {
			if (current.length > 0) {
				found.push(current.join("\n"));
			}
			current = [];
		} else {
			current.push(line);
		}
	}
	if (current.length > 0) {
		found.push(current.join("\n"));
	}
	return found;
}
