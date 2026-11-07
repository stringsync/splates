import type { JSX } from "react";
import { CardSection } from "./card-section";
import { CardBody } from "./card-shell";

/**
 * A merged card's report: a Summary section with the first paragraph of the
 * agent's report (or of the task's `## Outcome` when the report says
 * nothing), then the rest of both, the outcome's demo and verification among
 * them. Pass `ruled` when Before and After sit above it.
 */
export function MergedBody({
	text,
	outcome,
	ruled = false,
}: {
	text: string;
	outcome: string | undefined;
	/** Whether a rule sits above Summary, when sections come before it. */
	ruled?: boolean;
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
		<div className="flex flex-col gap-0 px-4 py-3.5 @max-md:px-3 @max-md:py-2.5">
			<CardSection label="Summary" title="Summary" ruled={ruled}>
				<CardBody className="p-0 @max-md:p-0" text={first} />
				{more.length > 0 && (
					<section aria-label="outcome" className="mt-2 flex flex-col gap-2">
						{more.map((each) => (
							<CardBody className="p-0 @max-md:p-0" key={each} text={each} />
						))}
					</section>
				)}
			</CardSection>
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
