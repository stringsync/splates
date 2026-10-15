import { ArrowDownIcon, ArrowUpDownIcon, ArrowUpIcon } from "lucide-react";
import { type JSX, type KeyboardEvent, useRef, useState } from "react";
import { Button } from "#dev/components/ui/button.tsx";
import { Kbd } from "#dev/components/ui/kbd.tsx";
import { useTouch } from "#dev/hooks/use-touch.ts";
import { cn } from "#dev/lib/utils.ts";
import type { Question } from "../plan";
import type { Answer } from "../reply";
import { ChoiceBody, HowToPick } from "./choice-body";
import { Markdown } from "./markdown";

/**
 * A question whose choices are put in order: each moves up or down by its
 * buttons, or with Alt and the arrows, and the answer is every choice's
 * letter in the order they end up in. "Keep this order" answers with the
 * order as it stands.
 */
export function Ranking({
	asked,
	answer,
	live,
	roomy = false,
	onAnswer,
	onNext,
}: {
	asked: Question;
	answer: Answer;
	live: boolean;
	/** Sized for a finger, as on a phone's screen of one question. */
	roomy?: boolean;
	onAnswer: (answer: Answer) => void;
	onNext: () => void;
}): JSX.Element {
	const { number, text } = asked;
	const order = ranked(asked, answer);
	const answered = answer.picks.length > 0;
	const [at, setAt] = useState(0);
	const touch = useTouch();
	const list = useRef<HTMLOListElement>(null);
	const focus = (index: number) => {
		setAt(index);
		list.current?.querySelectorAll<HTMLElement>("[data-row]")[index]?.focus();
	};
	const move = (from: number, step: number) => {
		const to = from + step;
		if (to < 0 || to >= order.length) {
			return;
		}
		const next = order.map((choice) => choice.key);
		next.splice(to, 0, ...next.splice(from, 1));
		onAnswer({ ...answer, picks: next });
		// The focus goes with the choice it was on.
		setAt(to);
		requestAnimationFrame(() => focus(to));
	};
	const keys = (event: KeyboardEvent<HTMLOListElement>) => {
		// A screenshot under a choice keeps its own keys.
		if (
			event.metaKey ||
			event.ctrlKey ||
			!(event.target as HTMLElement).hasAttribute("data-row")
		) {
			return;
		}
		const step =
			event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
		if (step !== 0) {
			event.preventDefault();
			if (event.altKey) {
				move(at, step);
			} else {
				focus((at + step + order.length) % order.length);
			}
		} else if (event.key === "Enter") {
			event.preventDefault();
			onNext();
		}
	};
	return (
		<div className={cn("flex flex-col", roomy ? "gap-2.5" : "gap-1.5")}>
			<p>
				<HowToPick
					Icon={ArrowUpDownIcon}
					text="Put in order, first at the top"
				/>
			</p>
			<ol
				ref={list}
				aria-label={text}
				onKeyDown={live ? keys : undefined}
				className={cn("flex flex-col", roomy ? "gap-2.5" : "gap-1.5")}
			>
				{order.map((choice, index) => (
					<li
						key={choice.key}
						data-row
						tabIndex={live ? (index === at ? 0 : -1) : undefined}
						data-stop={live && index === at ? number : undefined}
						onFocus={() => setAt(index)}
						className={cn(
							"flex items-center gap-3 border outline-none transition-[background-color,border-color,box-shadow] duration-150 focus:ring-3 focus:ring-ring/40",
							roomy
								? "min-h-14 rounded-xl py-1.5 pr-1.5 pl-4 text-base"
								: "rounded-lg px-3 py-1.5 text-sm",
							answered
								? "border-primary/60 bg-primary/[0.04]"
								: "border-border/70 bg-background",
						)}
					>
						<span className="w-3 shrink-0 text-right text-muted-foreground text-xs tabular-nums">
							{index + 1}
						</span>
						<span className="flex size-5 shrink-0 items-center justify-center rounded-md border bg-muted/60 font-medium font-mono text-[11px] text-muted-foreground">
							{choice.key}
						</span>
						<span className="flex min-w-0 flex-1 flex-col">
							<Markdown text={choice.text} inline unlinked />
							<ChoiceBody body={choice.body} inset={false} />
						</span>
						{live && (
							<span className="flex shrink-0">
								<Button
									variant="ghost"
									size={roomy ? "icon-lg" : "icon-sm"}
									className={cn(roomy && "size-11")}
									tabIndex={-1}
									aria-label={`Move ${choice.key} up`}
									disabled={index === 0}
									onClick={() => move(index, -1)}
								>
									<ArrowUpIcon />
								</Button>
								<Button
									variant="ghost"
									size={roomy ? "icon-lg" : "icon-sm"}
									className={cn(roomy && "size-11")}
									tabIndex={-1}
									aria-label={`Move ${choice.key} down`}
									disabled={index === order.length - 1}
									onClick={() => move(index, 1)}
								>
									<ArrowDownIcon />
								</Button>
							</span>
						)}
					</li>
				))}
			</ol>
			{live && (
				<div className="flex items-center gap-3">
					<p className="flex-1 text-muted-foreground text-xs">
						{!touch && (
							<>
								<Kbd>⌥↑</Kbd> <Kbd>⌥↓</Kbd> moves
							</>
						)}
					</p>
					<Button
						variant="outline"
						size={roomy ? "default" : "xs"}
						className={cn(roomy && "h-10 px-3")}
						onClick={() =>
							onAnswer({
								...answer,
								picks: answered ? [] : order.map((choice) => choice.key),
							})
						}
					>
						{answered ? "Clear order" : "Keep this order"}
					</Button>
				</div>
			)}
		</div>
	);
}

/**
 * The choices in the order an answer puts them, those it leaves out after in
 * the order they were offered: the agent's order until the person moves one.
 */
function ranked(asked: Question, answer: Answer): Question["choices"] {
	const placed = answer.picks.flatMap(
		(key) => asked.choices.find((choice) => choice.key === key) ?? [],
	);
	return [
		...placed,
		...asked.choices.filter((choice) => !placed.includes(choice)),
	];
}
