import { useDisposerEffect, useReactive } from "@webappwiz/react";
import {
	ChevronLeftIcon,
	MessageSquareIcon,
	PanelLeftCloseIcon,
	RotateCcwIcon,
	SquareIcon,
	SquareTerminalIcon,
	XIcon,
} from "lucide-react";
import {
	createContext,
	type JSX,
	type ReactNode,
	useContext,
	useEffect,
	useRef,
} from "react";
import { Button } from "#dev/components/ui/button.tsx";
import { cn } from "#dev/lib/utils.ts";
import type { ConversationState } from "../conversations";
import { PANE_WIDTH } from "./changes";
import { focusComposer } from "./composer-editor";
import { useNameOf } from "./conversation-names";
import { useShortcutLabel } from "./hooks/use-shortcut";
import type { TerminalSession } from "./terminal-session";
import type { Terminals } from "./terminals";
import { type BarAction, BarButton, BELOW_BAR, TITLE, TopBar } from "./top-bar";

/**
 * Shows a conversation's terminal in the pane beside the page, or hides it;
 * null where the page has none.
 */
export const ToggleTerminal = createContext<
	((conversation: string) => void) | null
>(null);

/**
 * Opens a conversation and shows its terminal beside it; null where the page
 * has no shells.
 */
export const ShowTerminal = createContext<
	((conversation: string) => void) | null
>(null);

/**
 * Opens a conversation's terminal on a page of its own, in place of the
 * conversation; null where the page has no shells.
 */
export const OpenTerminalPage = createContext<
	((conversation: string) => void) | null
>(null);

/** Runs a code block in the open conversation's terminal, where available. */
export const RunInTerminal = createContext<((code: string) => void) | null>(
	null,
);

/** Whether a conversation's shell is up; none where the page has no shells. */
export const ShellRunning = createContext<(conversation: string) => boolean>(
	() => false,
);

/**
 * `conversation`'s shell, in the pane down the right of the page (the whole
 * screen on a phone), with where it runs and how it stands above it. Unlike
 * the changes that pane also shows, Escape here is the shell's. The pane
 * hides once the shell exits.
 */
export function TerminalPane({
	terminals,
	conversation,
	phone,
}: {
	terminals: Terminals;
	conversation: ConversationState;
	phone: boolean;
}): JSX.Element | null {
	// The session too, since Restart swaps it for the same conversation. None
	// once hidden, so the exit that hid it does not start another.
	const { session } = useReactive(
		terminals,
		(terminals) => ({
			session: terminals.open
				? terminals.sessionFor(conversation.id, conversation.task)
				: null,
		}),
		["changed"],
	);
	useEffect(
		() =>
			terminals.events.on("exited", (key) => {
				if (key === conversation.id) {
					terminals.hide();
					focusComposer();
				}
			}),
		[terminals, conversation.id],
	);
	if (session === null) {
		return null;
	}
	return (
		<PaneScreen
			terminals={terminals}
			conversation={conversation}
			session={session}
			phone={phone}
		/>
	);
}

/** The terminal pane, once its shell is made. */
function PaneScreen({
	terminals,
	conversation,
	session,
	phone,
}: {
	terminals: Terminals;
	conversation: ConversationState;
	session: TerminalSession;
	phone: boolean;
}): JSX.Element {
	const openPage = useContext(OpenTerminalPage);
	const { status } = useReactive(
		session,
		(session) => ({ status: session.status }),
		["changed"],
	);
	const shortcut = useShortcutLabel("shortcuts.terminal");

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
				<h2 className="min-w-0 flex-1 truncate font-medium text-sm">
					{session.task ?? "Main tree"}
				</h2>
				<span role="status" className="text-muted-foreground text-xs">
					{status === "connecting" && "Connecting"}
					{status === "closed" && "Disconnected"}
				</span>
				{/* A shell stays where it started, so once the agent has moved the
				    conversation into a task, Restart starts one there. */}
				{(status === "closed" || session.task !== conversation.task) && (
					<Button
						size="sm"
						variant="outline"
						onClick={() => terminals.restart(conversation.id)}
					>
						Restart
					</Button>
				)}
				{/* Hiding leaves the shell running; Stop hangs up on it, and on
				    whatever runs in it, as archiving would. */}
				{(status === "connecting" || status === "open") && (
					<Button
						size="sm"
						variant="destructive"
						title="Stop the shell and whatever runs in it"
						onClick={() => {
							terminals.hide();
							terminals.close(conversation.id);
							focusComposer();
						}}
					>
						<SquareIcon className="size-3 fill-current" />
						Stop
					</Button>
				)}
				{openPage !== null && (
					<Button
						size="icon-sm"
						variant="ghost"
						aria-label="Close the conversation"
						title="Close the conversation, keeping the terminal"
						onClick={() => openPage(conversation.id)}
					>
						<PanelLeftCloseIcon />
					</Button>
				)}
				<Button
					size="icon-sm"
					variant="ghost"
					aria-label="Hide the terminal"
					title={
						shortcut === null
							? "Hide the terminal"
							: `Hide the terminal (${shortcut})`
					}
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
 * is up, and closed once it exits or its X is clicked.
 */
export function MainTerminal({
	terminals,
	terminal,
	trunk,
	onBack,
	onExit,
	onClose,
}: {
	terminals: Terminals;
	/** Its key, `terminal/<n>`. */
	terminal: string;
	/** The main tree's branch. */
	trunk: string;
	onBack: (() => void) | null;
	/** Leaves the page, once the shell has exited and its row gone. */
	onExit: () => void;
	/** Leaves the page and hangs up on the shell, as its row's X does. */
	onClose: () => void;
}): JSX.Element {
	useEffect(() => terminals.keep(terminal), [terminals, terminal]);
	const exit = useRef(onExit);
	exit.current = onExit;
	useEffect(
		() =>
			terminals.events.on("exited", (key) => {
				if (key === terminal) {
					exit.current();
				}
			}),
		[terminals, terminal],
	);
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
		<PageScreen
			terminals={terminals}
			terminal={terminal}
			session={session}
			where={<OnTrunk trunk={trunk} />}
			onBack={onBack}
			onClose={onClose}
		/>
	);
}

/**
 * A conversation's terminal filling the page, as one of the main tree's
 * does: the same shell its pane shows, in the conversation's tree, with a
 * way to its conversation, which shows the shell in its pane.
 */
export function ConversationTerminal({
	terminals,
	conversation,
	trunk,
	onBack,
	onConversation,
	onExit,
	onClose,
}: {
	terminals: Terminals;
	conversation: ConversationState;
	/** The main tree's branch. */
	trunk: string;
	onBack: (() => void) | null;
	/** Opens the conversation, its pane showing this shell. */
	onConversation: () => void;
	/** Leaves the page, once the shell has exited. */
	onExit: () => void;
	/** Leaves the page, once the shell is hung up on. */
	onClose: () => void;
}): JSX.Element {
	const nameOf = useNameOf();
	// Set as the shell goes, so the change that says so starts no other.
	const gone = useRef(false);
	const exit = useRef(onExit);
	exit.current = onExit;
	useEffect(
		() =>
			terminals.events.on("exited", (key) => {
				if (key === conversation.id) {
					gone.current = true;
					exit.current();
				}
			}),
		[terminals, conversation.id],
	);
	const { session } = useReactive(
		terminals,
		(terminals) => ({
			session: gone.current
				? null
				: terminals.sessionFor(conversation.id, conversation.task),
		}),
		["changed"],
	);
	if (session === null) {
		return <section aria-label="terminal" />;
	}
	const name = nameOf(conversation);
	return (
		<PageScreen
			terminals={terminals}
			terminal={conversation.id}
			session={session}
			where={
				<>
					<span className="truncate">{name}</span>
					{/* A conversation mostly goes by its task's name already. */}
					{session.task !== name && (
						<>
							<span aria-hidden>·</span>
							{session.task === null ? (
								<OnTrunk trunk={trunk} />
							) : (
								<span className="truncate">
									in <span className="font-mono">{session.task}</span>
								</span>
							)}
						</>
					)}
				</>
			}
			moved={session.task !== conversation.task}
			actions={[
				{
					label: "Open the conversation",
					icon: <MessageSquareIcon />,
					run: onConversation,
				},
			]}
			onBack={onBack}
			onClose={() => {
				gone.current = true;
				onClose();
			}}
		/>
	);
}

/** Where a main-tree shell runs, as its page says. */
function OnTrunk({ trunk }: { trunk: string }): JSX.Element {
	return (
		<span className="truncate">
			in the main tree, on <span className="font-mono">{trunk}</span>
		</span>
	);
}

/**
 * A terminal's page, once its shell is made: its name, `where` it runs, and
 * `actions` ahead of Restart and Close. Restart shows once the shell is lost,
 * or once it is `moved`: started in a tree its conversation has since left.
 */
function PageScreen({
	terminals,
	terminal,
	session,
	where,
	moved = false,
	actions = [],
	onBack,
	onClose,
}: {
	terminals: Terminals;
	terminal: string;
	session: TerminalSession;
	where: ReactNode;
	moved?: boolean;
	actions?: BarAction[];
	onBack: (() => void) | null;
	onClose: () => void;
}): JSX.Element {
	const { status } = useReactive(
		session,
		(session) => ({ status: session.status }),
		["changed"],
	);
	const { name } = useReactive(
		terminals,
		(terminals) => ({ name: terminals.nameOf(terminal) }),
		["changed"],
	);

	return (
		<section
			aria-label="terminal"
			className={cn(
				"flex min-h-0 min-w-0 flex-col gap-2",
				onBack === null ? BELOW_BAR : "h-full",
			)}
		>
			<TopBar
				leading={
					onBack !== null && (
						<BarButton label="Back to conversations" onClick={onBack}>
							<ChevronLeftIcon />
						</BarButton>
					)
				}
				title={
					<h2 className={cn(TITLE, "flex items-center gap-2")}>
						<SquareTerminalIcon className="size-4 shrink-0 text-muted-foreground" />
						<span className="truncate">{name}</span>
					</h2>
				}
				detail={
					<span className="flex min-w-0 items-center gap-2 text-sm">
						{where}
						<span role="status" className="shrink-0 text-xs">
							{status === "connecting" && "Connecting"}
							{status === "closed" && "Disconnected"}
						</span>
					</span>
				}
				actions={[
					...actions,
					...(status === "closed" || moved
						? [
								{
									label: "Restart",
									icon: <RotateCcwIcon />,
									text: "Restart",
									run: () => terminals.restart(terminal),
								},
							]
						: []),
					{ label: "Close the terminal", icon: <XIcon />, run: onClose },
				]}
			/>
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
