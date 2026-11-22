import type { Steps } from "@splates/server/plans/browser";
import { ArrowUpIcon, ListChecksIcon, SparklesIcon } from "lucide-react";
import {
	type JSX,
	useContext,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { Button } from "#web/components/ui/button.tsx";
import { CardBox } from "./card-box";
import { ReplyContext } from "./card-reply";
import { Files } from "./files";
import { Markdown } from "./markdown";
import { askedFrom, type Exchange } from "./steps-asked";
import { moved, StepsBody } from "./steps-body";

/** What the agent's newest version changed, and a way back to the one before. */
export interface Update {
	/** Whether the version before is shown in its place. */
	back: boolean;
	/** The steps it changed, by number from 0. */
	steps: number[];
	toggle: () => void;
}

/**
 * A Steps card as its popped-out window shows it: the steps, then every
 * question asked from here and the agent's answers, as a chat, and a box to
 * ask about the step the person is on.
 */
export function Popped({
	steps,
	done,
	place,
	move,
	changed,
	exchanges,
	update,
	window: popped,
}: {
	steps: Steps;
	done: number;
	place: (done: number) => void;
	move: (by: number) => void;
	changed: ReadonlyMap<number, string | null>;
	exchanges: readonly Exchange[];
	update: Update | null;
	window: Window;
}): JSX.Element {
	// The keys work anywhere in the window but its box, which takes its own.
	useEffect(() => {
		const onKey = (event: globalThis.KeyboardEvent) => moved(event, move);
		popped.document.addEventListener("keydown", onKey);
		return () => popped.document.removeEventListener("keydown", onKey);
	}, [popped, move]);
	// A new question or answer scrolls down to it, as a chat does.
	const scroller = useRef<HTMLDivElement>(null);
	const said = exchanges
		.map((each) => `${each.id}:${each.answers.length}:${each.waiting}`)
		.join(",");
	useLayoutEffect(() => {
		if (said !== "") {
			scroller.current?.scrollTo({
				top: scroller.current.scrollHeight,
				behavior: "smooth",
			});
		}
	}, [said]);
	const count = steps.steps.length;
	return (
		<div className="flex h-screen flex-col bg-card text-card-foreground">
			<div className="flex items-center gap-2 border-b bg-muted/40 px-4 py-2.5">
				<ListChecksIcon className="size-4 shrink-0 text-violet-600 dark:text-violet-400" />
				<span className="min-w-0 flex-1 font-medium text-[13px]">
					{steps.title === "" ? "Steps" : steps.title}
				</span>
				<span className="text-muted-foreground text-xs tabular-nums">
					{done} of {count}
				</span>
			</div>
			{update !== null && update.steps.length > 0 && (
				<UpdateStrip update={update} />
			)}
			<div ref={scroller} className="min-h-0 flex-1 overflow-y-auto pb-3">
				<StepsBody
					steps={steps}
					done={done}
					place={place}
					move={move}
					changed={changed}
					hint={false}
				/>
				{exchanges.map((exchange) => (
					<Chat key={exchange.id} exchange={exchange} />
				))}
			</div>
			<Ask steps={steps} done={done} />
		</div>
	);
}

/** Says which steps the agent changed, with Undo to the version before. */
function UpdateStrip({ update }: { update: Update }): JSX.Element {
	const named = update.steps.map((step) => step + 1);
	const which =
		named.length === 1
			? `step ${named[0]}`
			: `steps ${named.slice(0, -1).join(", ")} and ${named.at(-1)}`;
	return (
		<div className="mx-3 mt-2.5 flex items-center gap-2 rounded-xl border border-violet-500/25 bg-violet-500/[0.07] px-3 py-2 text-[13px] animate-in fade-in slide-in-from-top-1 duration-300">
			<SparklesIcon className="size-4 shrink-0 text-violet-600 dark:text-violet-400" />
			<span className="flex-1">
				{update.back
					? "Showing the steps before the update"
					: `The agent updated ${which}`}
			</span>
			<button
				type="button"
				onClick={update.toggle}
				className="font-medium text-violet-700 hover:underline dark:text-violet-300"
			>
				{update.back ? "Use the update" : "Undo"}
			</button>
		</div>
	);
}

/** A question asked from the pop-out and the agent's answers, as bubbles. */
function Chat({ exchange }: { exchange: Exchange }): JSX.Element {
	return (
		<section
			aria-label={`Asked on step ${exchange.step}`}
			className="px-4 pt-3"
		>
			<div className="mb-2.5 flex items-center gap-2.5 text-[11px] text-muted-foreground before:h-px before:flex-1 before:bg-border after:h-px after:flex-1 after:bg-border">
				Asked on step {exchange.step}
			</div>
			<div className="flex flex-col gap-1.5">
				<div className="max-w-[85%] self-end wrap-anywhere rounded-3xl bg-muted px-4 py-2 text-sm leading-relaxed animate-in fade-in slide-in-from-bottom-1 duration-200">
					<Markdown
						text={exchange.words}
						className="[&_p:first-child]:mt-0 [&_p:last-child]:mb-0"
					/>
				</div>
				{exchange.answers.map((answer, i) => (
					<div
						// biome-ignore lint/suspicious/noArrayIndexKey: answers only grow
						key={i}
						className="max-w-[90%] self-start wrap-anywhere rounded-3xl border bg-background px-4 py-2 text-sm leading-relaxed shadow-xs animate-in fade-in slide-in-from-bottom-1 duration-200"
					>
						<Markdown
							text={answer}
							className="[&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_pre]:my-1.5"
						/>
					</div>
				))}
				{exchange.carded && (
					<p className="self-start px-2 text-muted-foreground text-xs">
						The agent asked something in the splates tab.
					</p>
				)}
				{exchange.waiting ? (
					<div
						role="status"
						aria-label="The agent is answering"
						className="flex gap-1 self-start rounded-3xl border bg-background px-4 py-3"
					>
						{[0, 150, 300].map((delay) => (
							<span
								key={delay}
								className="size-1.5 animate-bounce rounded-full bg-muted-foreground/70"
								style={{ animationDelay: `${delay}ms` }}
							/>
						))}
					</div>
				) : (
					exchange.answers.length > 0 && (
						<p className="self-start px-2 text-[11px] text-muted-foreground">
							Agent
						</p>
					)
				)}
			</div>
		</section>
	);
}

/**
 * The box to ask the agent about the step the person is on: typed, pasted
 * or dictated, sent as a message of the conversation naming the step.
 */
function Ask({
	steps,
	done,
}: {
	steps: Steps;
	done: number;
}): JSX.Element | null {
	const send = useContext(ReplyContext)?.send ?? null;
	const [words, setWords] = useState("");
	const [files] = useState(() => new Files());
	const [sending, setSending] = useState(false);
	if (send === null) {
		return null;
	}
	const on = Math.min(done, steps.steps.length - 1) + 1;
	const submit = () => {
		const text = words.trim();
		if ((text === "" && files.files.length === 0) || sending) {
			return;
		}
		setSending(true);
		void send(askedFrom(steps, done, text), files.files)
			.then(() => {
				setWords("");
				files.clear();
			})
			.finally(() => setSending(false));
	};
	return (
		<div className="flex items-end gap-2 border-t bg-card px-3 pt-2.5 pb-3">
			<div className="min-w-0 flex-1">
				<CardBox
					roomy
					aria-label="Ask the agent"
					placeholder={`Ask about step ${on}…`}
					value={words}
					onValue={setWords}
					files={files}
					onKeyDown={(event) => {
						if (event.key === "Enter" && !event.shiftKey) {
							event.preventDefault();
							submit();
						}
					}}
				/>
			</div>
			<Button
				size="icon"
				aria-label="Send"
				disabled={sending || words.trim() === ""}
				onClick={submit}
				className="mb-1 size-9 shrink-0 rounded-full"
			>
				<ArrowUpIcon />
			</Button>
		</div>
	);
}
