import { CheckIcon, CopyIcon } from "lucide-react";
import type { JSX, ReactNode } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { copiedLabel, useCopy } from "./card";
import { Markdown } from "./markdown";

/** A step's `user` words split around their numbered list, each item without its number. */
export interface Instructions {
	before: string;
	items: string[];
	after: string;
}

const ITEM = /^\d+\.\s+/;

/** Splits `text` at its first run of numbered lines; with none, it is all `before`. */
export function instructionsOf(text: string): Instructions {
	const lines = text.split("\n");
	const first = lines.findIndex((line) => ITEM.test(line));
	if (first === -1) {
		return { before: text.trim(), items: [], after: "" };
	}
	let end = first;
	while (end < lines.length && ITEM.test(lines[end] ?? "")) {
		end++;
	}
	return {
		before: lines.slice(0, first).join("\n").trim(),
		items: lines.slice(first, end).map((line) => line.replace(ITEM, "")),
		after: lines.slice(end).join("\n").trim(),
	};
}

/** Whether `text` reads as numbered steps, which the page draws as `StepInstructions`. */
export function numbered(text: string): boolean {
	return instructionsOf(text).items.length > 0;
}

/**
 * A step's words as numbered steps down a line, each with what it needs
 * (a link, a command, a field) set under it by `under`, keyed from 1; the
 * words after the list follow as a quiet note.
 */
export function StepInstructions({
	text,
	under = {},
}: {
	text: string;
	under?: Record<number, ReactNode>;
}): JSX.Element {
	const { before, items, after } = instructionsOf(text);
	return (
		<div className="flex flex-col gap-4">
			{before !== "" && <Markdown text={before} />}
			<ol aria-label="instructions" className="flex flex-col gap-3">
				{items.map((item, index) => (
					<li
						key={item}
						className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-x-2"
					>
						<span
							aria-hidden
							className="text-muted-foreground text-xs leading-5 tabular-nums"
						>
							{index + 1}.
						</span>
						<div className="flex min-w-0 flex-col gap-3">
							<Markdown text={item} inline className="text-sm leading-5" />
							{under[index + 1]}
						</div>
					</li>
				))}
			</ol>
			{after !== "" && (
				<Markdown text={after} className="text-muted-foreground text-sm" />
			)}
		</div>
	);
}

/** A command to paste elsewhere, shown whole, with a button that copies it. */
export function CommandBlock({ command }: { command: string }): JSX.Element {
	const { copied, copy } = useCopy();
	return (
		<div className="relative rounded-lg border bg-muted/50">
			<pre className="overflow-x-auto whitespace-pre-wrap break-all py-2.5 pr-11 pl-3 font-mono text-[12px] leading-5">
				{command}
			</pre>
			<Button
				type="button"
				variant="ghost"
				size="icon-sm"
				className="absolute top-1.5 right-1.5 text-muted-foreground"
				aria-label={copiedLabel(copied, "Copy the command")}
				title={copied.state === "failed" ? copied.error : undefined}
				onClick={() => copy(command)}
			>
				{copied.state === "copied" ? <CheckIcon /> : <CopyIcon />}
			</Button>
		</div>
	);
}
