import { useDisposerEffect, useReactive } from "@webappwiz/react";
import {
	CheckIcon,
	ChevronDownIcon,
	SquareIcon,
	TerminalIcon,
	XIcon,
} from "lucide-react";
import {
	createContext,
	type JSX,
	useContext,
	useEffect,
	useRef,
	useState,
} from "react";
import { Button } from "#dev/components/ui/button.tsx";
import { cn } from "#dev/lib/utils.ts";
import type { Background, BackgroundState } from "../conversations";
import { BackgroundOutput } from "./background-output";
import { PANE_WIDTH } from "./changes";
import { stopBackground } from "./conversation-api";
import { useReadOnly } from "./handed-out";

/**
 * Opens what a conversation's background command printed in the pane beside
 * the page; null where the page has no pane.
 */
export const WatchBackground = createContext<
	((conversation: string, background: string) => void) | null
>(null);

/** How each state reads beside a command's name. */
const SAID: Record<BackgroundState, string> = {
	running: "Running",
	completed: "Done",
	failed: "Failed",
	stopped: "Stopped",
};

/** How many of a conversation's commands its card shows until expanded. */
const SHOWN = 3;

/**
 * The commands an agent left in the background, as a card beside its
 * thread: the latest few, newest first, each saying how it stands and
 * opening what it printed, then a row that expands to the rest. Nothing at
 * all while it has left none.
 */
export function BackgroundCard({
	conversation,
	background,
}: {
	conversation: string;
	background: Background[];
}): JSX.Element | null {
	const watch = useContext(WatchBackground);
	const [expanded, setExpanded] = useState(false);
	if (background.length === 0 || watch === null) {
		return null;
	}
	const running = background.filter((each) => each.state === "running");
	const newest = background.toReversed();
	const more = newest.length - SHOWN;
	return (
		<section
			aria-label="background commands"
			data-widget
			className="overflow-hidden rounded-lg border bg-background py-1"
		>
			<h3 className="flex h-8 items-center gap-2 px-3 font-medium text-sm [&_svg]:size-4 [&_svg]:text-muted-foreground">
				<TerminalIcon />
				<span className="flex-1">Background</span>
				<span className="flex items-center gap-1.5 font-normal text-muted-foreground">
					{running.length > 0 ? (
						<>
							<span
								aria-hidden
								className="size-2 animate-pulse rounded-full bg-success"
							/>
							{running.length} running
						</>
					) : (
						background.length
					)}
				</span>
			</h3>
			<ul>
				{(expanded ? newest : newest.slice(0, SHOWN)).map((each) => (
					<li key={each.id}>
						<button
							type="button"
							title={
								each.subagent === null
									? (each.command ?? each.name)
									: `${each.command ?? each.name}\nStarted by ${each.subagent.title}`
							}
							onClick={() => watch(conversation, each.id)}
							className="flex h-8 w-full items-center gap-2 px-3 text-left text-sm transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
						>
							<StateMark state={each.state} />
							<span className="min-w-0 flex-1 truncate">{each.name}</span>
							<span className="shrink-0 text-muted-foreground text-xs">
								{SAID[each.state]}
							</span>
						</button>
					</li>
				))}
			</ul>
			{more > 0 && (
				<button
					type="button"
					aria-expanded={expanded}
					onClick={() => setExpanded((was) => !was)}
					className="flex h-8 w-full items-center gap-2 px-3 text-left text-muted-foreground text-sm transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
				>
					<ChevronDownIcon
						aria-hidden
						className={cn(
							"size-4 shrink-0 transition-transform motion-reduce:transition-none",
							expanded && "rotate-180",
						)}
					/>
					{expanded ? "Show fewer" : `Show ${more} more`}
				</button>
			)}
		</section>
	);
}

/**
 * What background command `background` printed, in the pane down the right
 * of the page (the whole screen on a phone), after its command as a shell
 * echoes it, following it as it prints, with a Stop while it runs.
 */
export function BackgroundPane({
	conversation,
	background,
	phone,
	onClose,
}: {
	conversation: string;
	background: Background;
	phone: boolean;
	onClose: () => void;
}): JSX.Element {
	const [output] = useState(
		() => new BackgroundOutput(conversation, background.id, background.command),
	);
	useEffect(() => () => output.dispose(), [output]);
	const { status } = useReactive(
		output,
		(output) => ({ status: output.status }),
		["changed"],
	);
	const [stopping, setStopping] = useState(false);
	// One that answers to another leaves its commands to that one.
	const readOnly = useReadOnly(conversation);
	const [refused, setRefused] = useState<string | null>(null);
	const running = background.state === "running";
	useEffect(() => {
		const close = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				onClose();
			}
		};
		window.addEventListener("keydown", close);
		return () => window.removeEventListener("keydown", close);
	}, [onClose]);
	return (
		<aside
			aria-label="background command"
			className={cn(
				"fixed z-40 flex flex-col gap-2 bg-background p-3",
				phone ? "inset-0" : cn("inset-y-0 right-0 border-l", PANE_WIDTH),
			)}
		>
			<header className="flex min-h-8 items-center gap-2">
				<StateMark state={background.state} />
				<h2 className="min-w-0 flex-1 truncate font-medium text-sm">
					{background.name}
				</h2>
				<span role="status" className="text-muted-foreground text-xs">
					{refused ??
						(status === "closed" && running
							? "Disconnected"
							: SAID[background.state])}
				</span>
				{running && !readOnly && (
					<Button
						size="sm"
						variant="destructive"
						disabled={stopping}
						onClick={() => {
							setStopping(true);
							setRefused(null);
							stopBackground(conversation, background.id).catch(
								(error: unknown) => {
									setStopping(false);
									setRefused(
										error instanceof Error ? error.message : "Not stopped",
									);
								},
							);
						}}
					>
						<SquareIcon className="size-3 fill-current" />
						{stopping ? "Stopping" : "Stop"}
					</Button>
				)}
				<Button
					size="icon-sm"
					variant="ghost"
					aria-label="Close"
					title="Close (Escape)"
					onClick={onClose}
				>
					<XIcon />
				</Button>
			</header>
			<Output
				output={output}
				className="min-h-0 flex-1 overflow-hidden rounded-lg bg-[#0a0a0a] p-2"
			/>
		</aside>
	);
}

function Output({
	output,
	className,
}: {
	output: BackgroundOutput;
	className: string;
}): JSX.Element {
	const container = useRef<HTMLDivElement>(null);
	useDisposerEffect(
		(disposer) => {
			if (container.current !== null) {
				disposer.use(output.attach(container.current));
			}
		},
		[output],
	);
	return <div ref={container} data-testid="output" className={className} />;
}

/** How a command stands, at a glance: a pulsing dot while it runs. */
function StateMark({ state }: { state: BackgroundState }): JSX.Element {
	return (
		<span
			aria-hidden
			className="flex size-4 shrink-0 items-center justify-center [&_svg]:size-3.5"
		>
			{state === "running" && (
				<span className="size-2 animate-pulse rounded-full bg-success" />
			)}
			{state === "completed" && <CheckIcon className="text-muted-foreground" />}
			{state === "failed" && <XIcon className="text-destructive" />}
			{state === "stopped" && (
				<SquareIcon className="size-2.5! fill-current text-muted-foreground" />
			)}
		</span>
	);
}
