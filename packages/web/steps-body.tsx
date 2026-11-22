import type { Steps } from "@splates/server/plans/browser";
import { CheckIcon, RotateCcwIcon } from "lucide-react";
import type { JSX, KeyboardEvent, ReactNode } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { cn } from "#web/lib/utils.ts";
import { Markdown } from "./markdown";

/**
 * Handles a key pressed over the steps, so the keyboard can follow them:
 * Space or Enter marks the step done, Backspace steps back. Pass the keydown
 * event and the place's `move`.
 */
export function moved(
	event: KeyboardEvent | globalThis.KeyboardEvent,
	move: (by: number) => void,
): void {
	// Keys typed into a box or pressed on a control are left to it.
	// The window's document itself is a target too, with nothing to look up from.
	const target = event.target as Partial<Element> | null;
	if (
		event.metaKey ||
		event.ctrlKey ||
		event.altKey ||
		target?.closest?.("button, a, input, textarea, [contenteditable]")
	) {
		return;
	}
	if (event.key === " " || event.key === "Enter") {
		event.preventDefault();
		move(1);
	} else if (event.key === "Backspace") {
		event.preventDefault();
		move(-1);
	}
}

const NONE_CHANGED: ReadonlyMap<number, string | null> = new Map();

export function StepsBody({
	steps,
	done,
	place,
	move,
	hint,
	changed = NONE_CHANGED,
}: {
	steps: Steps;
	done: number;
	place: (done: number) => void;
	move: (by: number) => void;
	/** Whether the step they are on says how to mark it done. */
	hint: boolean;
	/** The steps the agent changed in its last version, with their old words. */
	changed?: ReadonlyMap<number, string | null>;
}): JSX.Element {
	const count = steps.steps.length;
	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: its keys are a shortcut for the steps' own buttons
		<div
			// biome-ignore lint/a11y/noNoninteractiveTabindex: focusable so its keys move the place
			tabIndex={0}
			className="py-1.5 outline-none"
			onKeyDown={(event) => moved(event, move)}
		>
			{steps.intro !== "" && (
				<Markdown
					text={linkedUrls(steps.intro)}
					className="px-4 pt-2 pb-1 text-sm leading-relaxed [&_p:first-child]:mt-0 [&_p:last-child]:mb-0"
				/>
			)}
			<ol aria-label="steps">
				{steps.steps.map((text, i) => (
					<Step
						// biome-ignore lint/suspicious/noArrayIndexKey: steps may repeat
						key={i}
						n={i + 1}
						text={text}
						at={i < done ? "past" : i === done ? "here" : "ahead"}
						hint={hint}
						was={changed.has(i) ? (changed.get(i) ?? null) : undefined}
						onDone={() => place(i + 1)}
						onHere={() => place(i)}
					/>
				))}
			</ol>
			{done === count && <AllDone onAgain={() => place(0)} />}
			{steps.outro !== "" && (
				<Markdown
					text={linkedUrls(steps.outro)}
					className="px-4 pt-1 pb-2 text-sm leading-relaxed [&_p:first-child]:mt-0 [&_p:last-child]:mb-0"
				/>
			)}
		</div>
	);
}

/** The springy ease a step's mark grows and shrinks on, with a slight overshoot. */
const SPRING = "ease-[cubic-bezier(0.34,1.56,0.64,1)]";

/** Folds its children away to nothing, animating its height, unless `open`. */
function Fold({
	open,
	children,
}: {
	open: boolean;
	children: ReactNode;
}): JSX.Element {
	return (
		<div
			inert={!open}
			className={cn(
				"grid transition-[grid-template-rows,opacity] duration-400 ease-[cubic-bezier(0.2,0.8,0.2,1)] motion-reduce:transition-none",
				open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
			)}
		>
			<div className="min-h-0 overflow-hidden">{children}</div>
		</div>
	);
}

/**
 * A step: the one they are on unfolds in full, its mark grown; every other
 * folds to its first line, so moving on animates one closed and the next open.
 */
function Step({
	n,
	text,
	at,
	hint,
	was,
	onDone,
	onHere,
}: {
	n: number;
	text: string;
	at: "past" | "here" | "ahead";
	hint: boolean;
	/** What it said before the agent changed it: null for a new step, undefined for one unchanged. */
	was: string | null | undefined;
	onDone: () => void;
	onHere: () => void;
}): JSX.Element {
	const here = at === "here";
	const past = at === "past";
	const cut = text.indexOf("\n");
	const line = cut === -1 ? text : text.slice(0, cut);
	const detail = cut === -1 ? "" : text.slice(cut + 1).trim();
	const updated = was !== undefined && (
		<span className="shrink-0 rounded-full bg-violet-500/15 px-2 font-semibold text-[10px] text-violet-700 uppercase tracking-[0.04em] dark:text-violet-300">
			Updated
		</span>
	);
	return (
		<li
			aria-current={here ? "step" : undefined}
			className={cn(
				"group/step relative flex items-start gap-3 border-l-[3px] px-4 transition-[background-color,border-color,color,padding] duration-400 ease-[cubic-bezier(0.2,0.8,0.2,1)] motion-reduce:transition-none",
				here
					? "border-violet-500 bg-linear-to-r from-violet-500/[0.09] via-violet-500/[0.04] to-transparent py-4"
					: "border-transparent py-2",
				past && "text-muted-foreground",
			)}
		>
			<Mark n={n} at={at} onDone={onDone} onHere={onHere} />
			<div
				className={cn(
					"min-w-0 flex-1 text-sm leading-relaxed",
					here && "pt-0.5",
				)}
			>
				<Fold open={here}>
					<div className="mb-0.5 flex items-baseline gap-2">
						<span className="font-semibold text-[10px] text-violet-600 uppercase tracking-[0.06em] dark:text-violet-400">
							You are here
						</span>
						{here && updated}
						{hint && (
							<span className="ml-auto text-muted-foreground/80 text-xs @max-md:hidden">
								tap the circle ·{" "}
								<kbd className="rounded border border-b-2 bg-background px-1 font-mono text-[11px]">
									Space
								</kbd>
							</span>
						)}
					</div>
				</Fold>
				<div className="flex items-baseline gap-2">
					<Markdown
						text={linkedUrls(line)}
						className={cn(
							"min-w-0 flex-1 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0",
							// Folded, a step is its first line, cut short to fit.
							!here && "text-muted-foreground [&_p]:truncate",
							past && "line-through decoration-muted-foreground/40",
						)}
					/>
					{!here && updated}
				</div>
				{/* Its old words and what is indented under its line: detail, a command. */}
				<Fold open={here}>
					{was !== undefined && was !== null && (
						<Markdown
							text={was.split("\n")[0] ?? ""}
							className="mt-0.5 text-[13px] text-muted-foreground line-through decoration-muted-foreground/50 [&_p]:my-0"
						/>
					)}
					{detail !== "" && (
						<Markdown
							text={linkedUrls(detail)}
							className="mt-0.5 text-muted-foreground [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_pre]:my-1.5 [&_pre]:text-foreground"
						/>
					)}
				</Fold>
			</div>
		</li>
	);
}

/**
 * A step's mark: a check once done, which steps back to it; the circle of the
 * step they are on, grown, which fills with a check on hover and marks it
 * done; and the number of one ahead, which shows a check on hover and marks
 * it done with every step before it. One ring holds each, so moving on grows
 * and shrinks it rather than swapping it.
 */
function Mark({
	n,
	at,
	onDone,
	onHere,
}: {
	n: number;
	at: "past" | "here" | "ahead";
	onDone: () => void;
	onHere: () => void;
}): JSX.Element {
	const here = at === "here";
	const inner =
		"absolute inset-0 grid place-items-center rounded-full outline-none";
	return (
		<span
			className={cn(
				"relative grid shrink-0 place-items-center rounded-full border-2 tabular-nums transition-all duration-500 motion-reduce:transition-none",
				SPRING,
				here
					? "size-10 border-violet-500 bg-background font-bold text-lg text-violet-600 shadow-[0_0_0_6px] shadow-violet-500/15 dark:text-violet-400"
					: "mt-px size-6 border-transparent text-xs",
				at === "ahead" && "text-muted-foreground",
			)}
		>
			{at === "past" && (
				<button
					type="button"
					title="Back to this step"
					aria-label={`Step ${n}, done: back to it`}
					onClick={onHere}
					className={cn(
						inner,
						"text-success transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50",
					)}
				>
					<CheckIcon className="size-4 animate-in zoom-in-50 fade-in duration-300" />
				</button>
			)}
			{here && (
				<button
					type="button"
					title="Mark done"
					aria-label={`Mark step ${n} done`}
					onClick={onDone}
					className={cn(
						inner,
						"group/mark transition-all duration-200 hover:scale-110 hover:bg-violet-600 hover:text-white focus-visible:bg-violet-600 focus-visible:text-white active:scale-95",
					)}
				>
					<span className="animate-in zoom-in-50 fade-in duration-300 group-hover/mark:hidden group-focus-visible/mark:hidden">
						{n}
					</span>
					<CheckIcon className="hidden size-5 stroke-3 group-hover/mark:block group-focus-visible/mark:block" />
				</button>
			)}
			{at === "ahead" && (
				<button
					type="button"
					title="Mark done, with every step before it"
					aria-label={`Mark steps through ${n} done`}
					onClick={onDone}
					className={cn(
						inner,
						"group/mark transition-all duration-200 hover:scale-110 hover:bg-success/15 hover:text-success focus-visible:bg-success/15 focus-visible:text-success active:scale-95",
					)}
				>
					<span className="group-hover/mark:hidden group-focus-visible/mark:hidden">
						{n}
					</span>
					<CheckIcon className="hidden size-4 group-hover/mark:block group-focus-visible/mark:block" />
				</button>
			)}
		</span>
	);
}

/** The end of the steps: a word that they are done, and a way to start over. */
function AllDone({ onAgain }: { onAgain: () => void }): JSX.Element {
	return (
		<div className="mx-4 mt-1 mb-2 flex items-center gap-2 rounded-lg bg-success/[0.08] px-3 py-2 text-sm animate-in fade-in duration-300">
			<CheckIcon className="size-4 text-success" />
			<span className="flex-1 font-medium">All done</span>
			<Button variant="ghost" size="xs" onClick={onAgain}>
				<RotateCcwIcon />
				Start over
			</Button>
		</div>
	);
}

/** Link standalone code-formatted addresses, leaving commands and fenced blocks alone. */
function linkedUrls(text: string): string {
	return text.replace(
		/(^```[\s\S]*?^```[^\n]*$|^~~~[\s\S]*?^~~~[^\n]*$)|(?<![\x60[])\x60(https?:\/\/[^\x60\s]+)\x60(?![\x60\]])/gm,
		(match, fence: string | undefined, url: string | undefined) =>
			fence !== undefined || url === undefined
				? match
				: `[\x60${url}\x60](<${url}>)`,
	);
}
