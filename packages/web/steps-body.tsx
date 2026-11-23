import type { Steps } from "@splates/server/plans/browser";
import { CheckIcon, ChevronDownIcon, RotateCcwIcon } from "lucide-react";
import type { JSX, KeyboardEvent, ReactNode } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { cn } from "#web/lib/utils.ts";
import { CopyableCode } from "./copyable-code";
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
		event.defaultPrevented ||
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
	preview,
	togglePreview,
	hint,
	changed = NONE_CHANGED,
}: {
	steps: Steps;
	done: number;
	place: (done: number) => void;
	move: (by: number) => void;
	preview: number | null;
	togglePreview: (step: number) => void;
	/** Whether the step they are on says how to mark it done. */
	hint: boolean;
	/** The steps the agent changed in its last version, with their old words. */
	changed?: ReadonlyMap<number, string | null>;
}): JSX.Element {
	return (
		<CopyableCode value>
			<StepsList
				steps={steps}
				done={done}
				place={place}
				move={move}
				preview={preview}
				togglePreview={togglePreview}
				hint={hint}
				changed={changed}
			/>
		</CopyableCode>
	);
}

function StepsList({
	steps,
	done,
	place,
	move,
	preview,
	togglePreview,
	hint,
	changed,
}: {
	steps: Steps;
	done: number;
	place: (done: number) => void;
	move: (by: number) => void;
	preview: number | null;
	togglePreview: (step: number) => void;
	hint: boolean;
	changed: ReadonlyMap<number, string | null>;
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
						previewed={i === preview}
						hint={hint}
						was={changed.has(i) ? (changed.get(i) ?? null) : undefined}
						onDone={() => place(i + 1)}
						onPreview={() => togglePreview(i)}
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
				// One column no wider than the step, so a long command scrolls in it.
				"grid grid-cols-[minmax(0,1fr)] transition-[grid-template-rows,opacity] duration-400 ease-[cubic-bezier(0.2,0.8,0.2,1)] motion-reduce:transition-none",
				open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
			)}
		>
			<div className="min-h-0 overflow-hidden">{children}</div>
		</div>
	);
}

/**
 * The current step stays unfolded. One other step can be opened for reference.
 */
function Step({
	n,
	text,
	at,
	previewed,
	hint,
	was,
	onDone,
	onPreview,
}: {
	n: number;
	text: string;
	at: "past" | "here" | "ahead";
	previewed: boolean;
	hint: boolean;
	/** What it said before the agent changed it: null for a new step, undefined for one unchanged. */
	was: string | null | undefined;
	onDone: () => void;
	onPreview: () => void;
}): JSX.Element {
	const here = at === "here";
	const past = at === "past";
	const open = here || previewed;
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
				previewed && "border-muted-foreground/35 bg-muted/50",
				past && "text-muted-foreground",
			)}
		>
			<Mark
				n={n}
				at={at}
				previewed={previewed}
				onClick={here ? onDone : onPreview}
			/>
			<div
				className={cn(
					"min-w-0 flex-1 text-sm leading-relaxed",
					here && "pt-0.5",
				)}
			>
				<Fold open={open}>
					<div className="mb-0.5 flex items-baseline gap-2">
						<span
							className={cn(
								"font-semibold text-[10px] uppercase tracking-[0.06em]",
								here
									? "text-violet-600 dark:text-violet-400"
									: "text-muted-foreground",
							)}
						>
							{here ? "You are here" : "Preview"}
						</span>
						{open && updated}
						{here && hint && (
							<span className="ml-auto text-muted-foreground/80 text-xs @max-md:hidden">
								tap the circle ·{" "}
								<kbd className="rounded border border-b-2 bg-background px-1 font-mono text-[11px]">
									Space
								</kbd>
							</span>
						)}
					</div>
				</Fold>
				{/* biome-ignore lint/a11y/useKeyWithClickEvents: the step's mark is the keyboard and screen reader control */}
				{/* biome-ignore lint/a11y/noStaticElementInteractions: the title extends the mark's pointer target while preserving links */}
				<div
					className={cn(
						"flex items-baseline gap-2",
						!here && "cursor-pointer hover:text-foreground",
					)}
					onClick={
						here
							? undefined
							: (event) => {
									if (!(event.target as Element).closest("a, button")) {
										onPreview();
									}
								}
					}
				>
					<Markdown
						text={linkedUrls(line)}
						className={cn(
							"min-w-0 flex-1 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0",
							// Folded, a step is its first line, cut short to fit.
							!open && "text-muted-foreground [&_p]:truncate",
							past &&
								!previewed &&
								"line-through decoration-muted-foreground/40",
						)}
					/>
					{!open && updated}
					{!here && (
						<ChevronDownIcon
							aria-hidden
							className={cn(
								"size-4 shrink-0 self-center text-muted-foreground transition-transform motion-reduce:transition-none",
								previewed && "rotate-180",
							)}
						/>
					)}
				</div>
				{/* Its old words and what is indented under its line: detail, a command. */}
				<Fold open={open}>
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
 * The current circle marks a step done. Other markers open the preview.
 */
function Mark({
	n,
	at,
	previewed,
	onClick,
}: {
	n: number;
	at: "past" | "here" | "ahead";
	previewed: boolean;
	onClick: () => void;
}): JSX.Element {
	const here = at === "here";
	return (
		<button
			type="button"
			title={here ? "Mark done" : previewed ? "Close preview" : "Preview step"}
			aria-label={
				here
					? `Mark step ${n} done`
					: `Preview step ${n}${at === "past" ? ", done" : ""}`
			}
			aria-expanded={here ? undefined : previewed}
			onClick={onClick}
			className={cn(
				"grid shrink-0 place-items-center rounded-full border-2 outline-none tabular-nums transition-all duration-500 focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:transition-none",
				SPRING,
				here
					? "group/mark size-10 border-violet-500 bg-background font-bold text-lg text-violet-600 shadow-[0_0_0_6px] shadow-violet-500/15 hover:bg-violet-600 hover:text-white focus-visible:bg-violet-600 focus-visible:text-white dark:text-violet-400 dark:hover:text-white dark:focus-visible:text-white"
					: "mt-px size-6 border-transparent text-xs hover:bg-muted",
				at === "past" && "text-success",
				at === "ahead" && "text-muted-foreground",
			)}
		>
			{at === "past" && <CheckIcon className="size-4" />}
			{here && (
				<>
					<span className="group-hover/mark:hidden group-focus-visible/mark:hidden">
						{n}
					</span>
					<CheckIcon className="hidden size-5 stroke-3 group-hover/mark:block group-focus-visible/mark:block" />
				</>
			)}
			{at === "ahead" && n}
		</button>
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
