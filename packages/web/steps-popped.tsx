import { useAui } from "@assistant-ui/react";
import type { Steps } from "@splates/server/plans/browser";
import {
	ChevronDownIcon,
	ChevronUpIcon,
	ListChecksIcon,
	MessageCircleIcon,
	XIcon,
} from "lucide-react";
import {
	createContext,
	type JSX,
	useCallback,
	useContext,
	useEffect,
	useRef,
	useState,
} from "react";
import {
	COMPOSER_LOOK,
	Thread,
} from "#web/components/assistant-ui/elements/thread.aui.tsx";
import { Composer } from "#web/components/assistant-ui/elements/thread-composer.aui.tsx";
import { ThreadExtrasContext } from "#web/components/assistant-ui/elements/thread-context.aui.ts";
import { Button } from "#web/components/ui/button.tsx";
import { cn } from "#web/lib/utils.ts";
import { ReplyContext } from "./card-reply";
import type { Exchange, Finished } from "./steps-asked";
import { moved, StepsBody } from "./steps-body";
import { DoneBar } from "./steps-done";

/** Provide `true` around messages shown in the pop-out; a Steps card among them renders nothing. */
export const InPopout = createContext(false);

/**
 * A Steps card as its popped-out window shows it: the steps, Chat (the
 * questions asked from here and the agent's answers) and a box to ask about
 * the step the person is reading. Render it into the pop-out's document; `onClose`
 * closes the window.
 */
export function Popped({
	steps,
	done,
	place,
	move,
	preview,
	togglePreview,
	changed,
	exchanges,
	last,
	versions,
	finished = null,
	window: popped,
	onClose,
}: {
	steps: Steps;
	done: number;
	place: (done: number) => void;
	move: (by: number) => void;
	preview: number | null;
	togglePreview: (step: number) => void;
	changed: ReadonlyMap<number, string | null>;
	exchanges: readonly Exchange[];
	/** The first line of the newest answer, which the folded bar shows. */
	last: string | null;
	/** How many versions of the card the thread holds. */
	versions: number;
	/** The Done sent for this version, or null; sending Done closes the window. */
	finished?: Finished | null;
	window: Window;
	onClose: () => void;
}): JSX.Element {
	// The keys work anywhere in the window but its box, which takes its own.
	useEffect(() => {
		const onKey = (event: globalThis.KeyboardEvent) => moved(event, move);
		popped.document.addEventListener("keydown", onKey);
		return () => popped.document.removeEventListener("keydown", onKey);
	}, [popped, move]);
	const { open, unread, show, toggle, seen } = useChatFold(
		exchanges,
		done,
		versions,
	);
	// The step they are on stays in view as they move through the steps.
	const list = useRef<HTMLDivElement>(null);
	useEffect(() => {
		void done;
		list.current
			?.querySelector("[aria-current=step]")
			?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
	}, [done]);
	const count = steps.steps.length;
	return (
		<div className="flex h-screen flex-col bg-card text-card-foreground">
			<div className="flex items-center gap-2.5 pt-2.5 pr-2.5 pb-2 pl-4">
				<ListChecksIcon className="size-4 shrink-0 text-violet-600 dark:text-violet-400" />
				<span className="min-w-0 flex-1 truncate font-semibold text-sm">
					{steps.title === "" ? "Steps" : steps.title}
				</span>
				<span className="text-muted-foreground text-xs tabular-nums">
					{done} of {count}
				</span>
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label="Close"
					onClick={onClose}
					className="text-muted-foreground"
				>
					<XIcon />
				</Button>
			</div>
			<div
				role="progressbar"
				aria-label="Steps done"
				aria-valuemin={0}
				aria-valuemax={count}
				aria-valuenow={done}
				className="mx-4 mb-1 h-[3px] shrink-0 overflow-hidden rounded-full bg-muted"
			>
				<div
					className="h-full rounded-full bg-violet-500 transition-[width] duration-500"
					style={{ width: `${count === 0 ? 0 : (done / count) * 100}%` }}
				/>
			</div>
			<div className="relative min-h-0 flex-1">
				<div
					ref={list}
					inert={open}
					className={cn(
						"h-full overflow-y-auto pb-12 transition-opacity duration-300",
						open && "opacity-45 saturate-50",
					)}
				>
					<StepsBody
						steps={steps}
						done={done}
						place={place}
						move={move}
						preview={preview}
						togglePreview={togglePreview}
						changed={changed}
						hint={false}
					/>
				</div>
				<section
					aria-label="Chat"
					onPointerDown={seen}
					onKeyDown={seen}
					className={cn(
						"absolute inset-x-0 bottom-0 flex flex-col overflow-hidden rounded-t-2xl border border-b-0 bg-card transition-[top,box-shadow] duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)] motion-reduce:transition-none",
						open
							? "top-12 shadow-[0_-10px_28px_-8px_rgb(0_0_0/0.22)]"
							: "top-[calc(100%-2.75rem)] shadow-[0_-6px_16px_-8px_rgb(0_0_0/0.14)]",
					)}
				>
					<button
						type="button"
						aria-expanded={open}
						onClick={toggle}
						className={cn(
							"flex h-11 shrink-0 items-center gap-2 px-4 text-left font-semibold text-xs",
							!open && "bg-muted/45 hover:bg-muted/70",
						)}
					>
						<MessageCircleIcon className="size-4 shrink-0 text-violet-600 dark:text-violet-400" />
						Chat
						{unread && !open ? (
							<span
								role="img"
								aria-label="New answer"
								className="-ml-0.5 size-[7px] shrink-0 rounded-full bg-violet-500"
							/>
						) : (
							exchanges.length > 0 && (
								<span className="rounded-full bg-muted px-1.5 font-medium text-[11px] text-muted-foreground tabular-nums">
									{exchanges.length}
								</span>
							)
						)}
						<span className="min-w-0 flex-1 truncate font-normal text-muted-foreground">
							{open ? "" : (last ?? "")}
						</span>
						{open ? (
							<ChevronDownIcon className="size-4 shrink-0 text-muted-foreground" />
						) : (
							<ChevronUpIcon className="size-4 shrink-0 text-muted-foreground" />
						)}
					</button>
					{/* The conversation's own thread, its composer kept at the window's foot. */}
					<div inert={!open} className="min-h-0 flex-1">
						<InPopout value>
							<Thread
								docked
								autoFocus={false}
								composer={false}
								welcome={
									<p className="text-center text-muted-foreground text-sm">
										Ask the agent about a step: its answers show here.
									</p>
								}
							/>
						</InPopout>
					</div>
				</section>
			</div>
			<Ask steps={steps} reading={preview ?? done} onSend={show} />
			<DoneBar steps={steps} done={done} finished={finished} onSent={onClose} />
		</div>
	);
}

/**
 * Whether Chat is open, and whether an answer came the person has yet to
 * look at: one since they last opened Chat, touched it or sent a message.
 * Chat opens when they send a message, and folds once they mark a step done
 * (unless an answer waits unread) or the agent sends the steps again.
 */
function useChatFold(
	exchanges: readonly Exchange[],
	done: number,
	versions: number,
): {
	open: boolean;
	unread: boolean;
	show: () => void;
	toggle: () => void;
	seen: () => void;
} {
	const answers = exchanges.reduce(
		(sum, each) => sum + each.messages.length - 1,
		0,
	);
	const [open, setOpen] = useState(() =>
		exchanges.some((each) => each.waiting),
	);
	const [read, setRead] = useState(answers);
	const unread = answers > read;
	const seen = useCallback(() => setRead(answers), [answers]);
	const show = useCallback(() => {
		setOpen(true);
		setRead(answers);
	}, [answers]);
	const toggle = useCallback(() => {
		setOpen((was) => !was);
		setRead(answers);
	}, [answers]);
	// A step marked done takes them back to the steps, unless an answer
	// waits; steps sent again fold Chat over whatever it holds.
	const before = useRef({ done, versions });
	useEffect(() => {
		const was = before.current;
		before.current = { done, versions };
		if (versions > was.versions || (done > was.done && !unread)) {
			setOpen(false);
		}
	}, [done, versions, unread]);
	return { open, unread, show, toggle, seen };
}

/**
 * The conversation's composer, to ask the agent about the step the person
 * is reading: what it sends names the step. None where nothing can be sent.
 */
function Ask({
	steps,
	reading,
	onSend,
}: {
	steps: Steps;
	reading: number;
	onSend: () => void;
}): JSX.Element | null {
	const send = useContext(ReplyContext)?.send ?? null;
	const aui = useAui();
	useEffect(() => aui.on("composer.send", onSend), [aui, onSend]);
	if (send === null) {
		return null;
	}
	const on = Math.min(reading, steps.steps.length - 1) + 1;
	return (
		<fieldset
			aria-label="Ask"
			className="min-w-0 shrink-0 border-t bg-background px-2 pt-2 pb-2"
			style={COMPOSER_LOOK}
		>
			<ThreadExtrasContext.Provider
				value={{ placeholder: `Ask about step ${on}…` }}
			>
				<Composer autoFocus={false} />
			</ThreadExtrasContext.Provider>
		</fieldset>
	);
}
