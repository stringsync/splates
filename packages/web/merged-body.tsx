import { ChevronDownIcon } from "lucide-react";
import { type JSX, useState } from "react";
import { CardBody } from "./card-shell";

/**
 * A merged card's one body: the first paragraph of the agent's report, or of
 * the task's `## Outcome` when the report says nothing, with More opening the
 * rest of both, the outcome's demo and verification among them.
 */
export function MergedBody({
	text,
	outcome,
	lead,
}: {
	text: string;
	outcome: string | undefined;
	lead: boolean;
}): JSX.Element | null {
	const [open, setOpen] = useState(false);
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
			<CardBody text={first} lead={lead} />
			{open ? (
				<section aria-label="outcome" className="-mt-2">
					{more.map((each) => (
						<CardBody key={each} text={each} />
					))}
				</section>
			) : (
				more.length > 0 && (
					<button
						type="button"
						onClick={() => setOpen(true)}
						className="flex h-10 pointer-coarse:h-11 w-full items-center justify-center gap-1 border-t font-medium text-muted-foreground text-sm hover:bg-muted active:bg-muted"
					>
						More
						<ChevronDownIcon className="size-4" />
					</button>
				)
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
