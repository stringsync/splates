import { useDisposerEffect, useReactive } from "@webappwiz/react";
import { SquareTerminalIcon, XIcon } from "lucide-react";
import { createContext, type JSX, useEffect, useRef } from "react";
import { Button } from "#dev/components/ui/button.tsx";
import { cn } from "#dev/lib/utils.ts";
import type { ConversationState } from "../conversations";
import { Back } from "./back";
import { PANE_WIDTH } from "./changes";
import { type TerminalSession, TOGGLE } from "./terminal-session";
import { numberOf, type Terminals } from "./terminals";

/**
 * Shows a conversation's terminal in the pane beside the page, or hides it;
 * null where the page has none.
 */
export const ToggleTerminal = createContext<
	((conversation: string) => void) | null
>(null);

/** Whether a conversation's shell is up; none where the page has no shells. */
export const ShellRunning = createContext<(conversation: string) => boolean>(
	() => false,
);

/**
 * `conversation`'s shell, in the pane down the right of the page (the whole
 * screen on a phone), with where it runs and how it stands above it. Unlike
 * the changes that pane also shows, Escape here is the shell's.
 */
export function TerminalPane({
	terminals,
	conversation,
	phone,
}: {
	terminals: Terminals;
	conversation: ConversationState;
	phone: boolean;
}): JSX.Element {
	// The session too, since Restart swaps it for the same conversation.
	const { session } = useReactive(
		terminals,
		(terminals) => ({
			session: terminals.sessionFor(conversation.id, conversation.task),
		}),
		["changed"],
	);
	const { status, code } = useReactive(
		session,
		(session) => ({ status: session.status, code: session.code }),
		["changed"],
	);

	return (
		<aside
			aria-label="terminal"
			className={cn(
				"fixed z-40 flex flex-col gap-2 bg-background p-3",
				phone ? "inset-0" : cn("inset-y-0 right-0 border-l", PANE_WIDTH),
			)}
		>
			<header className="flex h-8 items-center gap-2">
				<SquareTerminalIcon className="size-4 shrink-0 text-muted-foreground" />
				<h2 className="min-w-0 truncate font-medium text-sm">
					{session.task ?? "Main tree"}
				</h2>
				<span role="status" className="text-muted-foreground text-xs">
					{status === "connecting" && "Connecting"}
					{status === "exited" && `Exited with ${code ?? "?"}`}
					{status === "closed" && "Disconnected"}
				</span>
				{/* A shell stays where it started, so once the agent has moved the
				    conversation into a task, Restart starts one there. */}
				{(status === "exited" ||
					status === "closed" ||
					session.task !== conversation.task) && (
					<Button
						size="sm"
						variant="outline"
						onClick={() => terminals.restart(conversation.id)}
					>
						Restart
					</Button>
				)}
				<Button
					size="icon-sm"
					variant="ghost"
					aria-label="Hide the terminal"
					title={`Hide the terminal (${TOGGLE})`}
					className="ml-auto"
					onClick={() => {
						terminals.toggle(conversation.id);
						focusComposer();
					}}
				>
					<XIcon />
				</Button>
			</header>
			<Screen
				session={session}
				focused={terminals.focusing === conversation.id}
				className={cn(
					"min-h-0 flex-1 overflow-hidden rounded-lg bg-[#0a0a0a] p-2",
					status !== "open" && "opacity-60",
				)}
			/>
		</aside>
	);
}

/**
 * One of the main tree's own terminals, opened from New, filling the page: a
 * shell on trunk that no conversation owns, kept running while another page
 * is up.
 */
export function MainTerminal({
	terminals,
	terminal,
	trunk,
	onBack,
}: {
	terminals: Terminals;
	/** Its key, `terminal/<n>`. */
	terminal: string;
	/** The main tree's branch. */
	trunk: string;
	onBack: (() => void) | null;
}): JSX.Element {
	useEffect(() => terminals.keep(terminal), [terminals, terminal]);
	// None once closed, so the close it hears does not start it again.
	const { session } = useReactive(
		terminals,
		(terminals) => ({
			session: terminals.mains.includes(terminal)
				? terminals.sessionFor(terminal, null)
				: null,
		}),
		["changed"],
	);
	if (session === null) {
		return <section aria-label="terminal" />;
	}
	return (
		<MainScreen
			terminals={terminals}
			terminal={terminal}
			session={session}
			trunk={trunk}
			onBack={onBack}
		/>
	);
}

/** A main-tree terminal's page, once its shell is kept. */
function MainScreen({
	terminals,
	terminal,
	session,
	trunk,
	onBack,
}: {
	terminals: Terminals;
	terminal: string;
	session: TerminalSession;
	trunk: string;
	onBack: (() => void) | null;
}): JSX.Element {
	const { status, code } = useReactive(
		session,
		(session) => ({ status: session.status, code: session.code }),
		["changed"],
	);

	return (
		<section
			aria-label="terminal"
			className="flex h-[calc(100dvh-2rem)] min-h-0 min-w-0 flex-col gap-2"
		>
			<header className="flex h-9 shrink-0 items-center gap-2">
				{onBack !== null && <Back onBack={onBack} />}
				<SquareTerminalIcon className="size-4 shrink-0 text-muted-foreground" />
				<h2 className="min-w-0 truncate font-medium text-sm">
					Terminal {numberOf(terminal)}{" "}
					<span className="font-normal text-muted-foreground">
						in the main tree, on <span className="font-mono">{trunk}</span>
					</span>
				</h2>
				<span role="status" className="text-muted-foreground text-xs">
					{status === "connecting" && "Connecting"}
					{status === "exited" && `Exited with ${code ?? "?"}`}
					{status === "closed" && "Disconnected"}
				</span>
				{(status === "exited" || status === "closed") && (
					<Button
						size="sm"
						variant="outline"
						className="ml-auto"
						onClick={() => terminals.restart(terminal)}
					>
						Restart
					</Button>
				)}
			</header>
			<Screen
				session={session}
				focused
				className={cn(
					"min-h-0 flex-1 overflow-hidden rounded-lg bg-[#0a0a0a] p-2",
					status !== "open" && "opacity-60",
				)}
			/>
		</section>
	);
}

/**
 * Where `session` draws, taking the keyboard as it shows when `focused`, so
 * typing goes straight in.
 */
function Screen({
	session,
	focused,
	className,
}: {
	session: TerminalSession;
	focused: boolean;
	className: string;
}): JSX.Element {
	const container = useRef<HTMLDivElement>(null);
	useDisposerEffect(
		(disposer) => {
			if (container.current === null) {
				return;
			}
			disposer.use(session.attach(container.current));
			if (focused) {
				session.focus();
			}
		},
		[session, focused],
	);
	return <div ref={container} data-testid="terminal" className={className} />;
}

/**
 * Puts the keyboard in the open conversation's composer, since a terminal
 * hidden while it had it would leave it nowhere.
 */
export function focusComposer(): void {
	document
		.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message input"]')
		?.focus();
}
