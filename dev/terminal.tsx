import { useDisposerEffect, useReactive } from "@webappwiz/react";
import { SquareTerminalIcon, XIcon } from "lucide-react";
import { createContext, type JSX, useRef } from "react";
import { Button } from "#dev/components/ui/button.tsx";
import { cn } from "#dev/lib/utils.ts";
import type { ConversationState } from "../conversations";
import { PANE_WIDTH } from "./changes";
import { type TerminalSession, TOGGLE } from "./terminal-session";
import type { Terminals } from "./terminals";

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
