import { useDisposerEffect, useReactive } from "@webappwiz/react";
import { CheckIcon, SquareIcon, TerminalIcon, XIcon } from "lucide-react";
import {
	createContext,
	type JSX,
	type ReactNode,
	useContext,
	useEffect,
	useRef,
	useState,
} from "react";
import { Button } from "#dev/components/ui/button.tsx";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuTrigger,
} from "#dev/components/ui/dropdown-menu.tsx";
import { cn } from "#dev/lib/utils.ts";
import type { Background, BackgroundState } from "../conversations";
import { stopBackground } from "./api";
import { BackgroundOutput } from "./background-output";
import { PANE_WIDTH } from "./changes";

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

/**
 * The commands an agent left in the background, as one row of the actions
 * card saying how many run, opening a menu of them. Nothing at all while it
 * has left none.
 */
export function BackgroundRow({
	conversation,
	background,
}: {
	conversation: string;
	background: Background[];
}): JSX.Element | null {
	const watch = useContext(WatchBackground);
	if (background.length === 0 || watch === null) {
		return null;
	}
	const running = background.filter((each) => each.state === "running");
	return (
		<div className="py-1">
			<BackgroundMenuOf
				conversation={conversation}
				background={background}
				watch={watch}
				trigger={
					<button
						type="button"
						aria-label="Background commands"
						title={`Background commands: ${running.length} running`}
						className="flex h-8 w-full items-center gap-2 px-3 text-left text-sm transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none data-popup-open:bg-accent [&_svg]:size-4 [&_svg]:text-muted-foreground"
					/>
				}
			>
				<TerminalIcon />
				<span className="flex-1">Background</span>
				<span className="flex items-center gap-1.5 text-muted-foreground">
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
			</BackgroundMenuOf>
		</div>
	);
}

/**
 * The row as one icon button, beside `ActionButtons` in a conversation too
 * narrow for the card, opening the same menu.
 */
export function BackgroundMenu({
	conversation,
	background,
}: {
	conversation: string;
	background: Background[];
}): JSX.Element | null {
	const watch = useContext(WatchBackground);
	if (background.length === 0 || watch === null) {
		return null;
	}
	const running = background.filter((each) => each.state === "running");
	return (
		<div className="@min-[76rem]:hidden">
			<BackgroundMenuOf
				conversation={conversation}
				background={background}
				watch={watch}
				trigger={
					<Button
						variant="outline"
						size="icon-sm"
						aria-label="Background commands"
						title={`Background commands: ${running.length} running`}
						className="relative"
					/>
				}
			>
				<TerminalIcon />
				{running.length > 0 && (
					<span
						aria-hidden
						className="-top-1 -right-1 absolute size-2 animate-pulse rounded-full bg-success"
					/>
				)}
			</BackgroundMenuOf>
		</div>
	);
}

/**
 * A menu of the commands from `trigger`, each saying how it stands and
 * opening what it printed.
 */
function BackgroundMenuOf({
	conversation,
	background,
	watch,
	trigger,
	children,
}: {
	conversation: string;
	background: Background[];
	watch: (conversation: string, background: string) => void;
	trigger: JSX.Element;
	children: ReactNode;
}): JSX.Element {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger render={trigger}>{children}</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-64">
				<DropdownMenuGroup>
					<DropdownMenuLabel>Background commands</DropdownMenuLabel>
					{background.map((each) => (
						<DropdownMenuItem
							key={each.id}
							title={each.command ?? each.name}
							onClick={() => watch(conversation, each.id)}
						>
							<StateMark state={each.state} />
							<span className="flex-1 truncate">{each.name}</span>
							<span className="text-muted-foreground text-xs">
								{SAID[each.state]}
							</span>
						</DropdownMenuItem>
					))}
				</DropdownMenuGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

/**
 * What background command `background` printed, in the pane down the right
 * of the page (the whole screen on a phone), following it as it prints, with
 * a Stop while it runs.
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
		() => new BackgroundOutput(conversation, background.id),
	);
	useEffect(() => () => output.dispose(), [output]);
	const { status } = useReactive(
		output,
		(output) => ({ status: output.status }),
		["changed"],
	);
	const [stopping, setStopping] = useState(false);
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
				<div className="flex min-w-0 flex-1 flex-col">
					<h2 className="truncate font-medium text-sm">{background.name}</h2>
					{background.command !== null && (
						<code className="truncate text-muted-foreground text-xs">
							{background.command}
						</code>
					)}
				</div>
				<span role="status" className="text-muted-foreground text-xs">
					{refused ??
						(status === "closed" && running
							? "Disconnected"
							: SAID[background.state])}
				</span>
				{running && (
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
