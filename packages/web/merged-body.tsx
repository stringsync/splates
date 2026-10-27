import type { JSX } from "react";
import { CardBody } from "./card-shell";

/**
 * A merged card's one body: the first paragraph of the agent's report, or of
 * the task's `## Outcome` when the report says nothing, set large under a
 * Summary heading, then the rest of both in full and muted under a rule, the
 * outcome's demo and verification among them. It is the last thing in a
 * conversation, so nothing of it is folded away.
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
		<div>
			<CardBody
				text={`### Summary\n\n${first}`}
				className="[&_p]:font-semibold [&_p]:text-base [&_p]:leading-snug [&_p]:first-letter:uppercase"
			/>
			{more.length > 0 && (
				<section
					aria-label="outcome"
					className="border-t text-muted-foreground"
				>
					{more.map((each) => (
						<CardBody key={each} text={each} />
					))}
				</section>
			)}
		</div>
	);
}

/** `text`'s paragraphs, a blank line apart, outside any code fence. */
function paragraphs(text: string): string[] {
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
