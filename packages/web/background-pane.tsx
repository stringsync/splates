import type { Background } from "@stringsync/splates-server/conversations";
import { useDisposerEffect, useReactive } from "@webappwiz/react";
import { SquareIcon, XIcon } from "lucide-react";
import { type JSX, useEffect, useRef, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { cn } from "#web/lib/utils.ts";
import { SAID, StateMark } from "./background";
import { BackgroundOutput } from "./background-output";
import { PANE_WIDTH } from "./changes";
import { stopBackground } from "./conversation-api";

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
		() =>
			new BackgroundOutput(
				`/api/conversations/${conversation}/background/${encodeURIComponent(background.id)}`,
				background.command,
			),
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
				<h2 className="min-w-0 flex-1 truncate font-medium text-sm">
					{background.name}
				</h2>
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

/**
 * What step `index` of `task`'s merge printed, its checks or its premerge,
 * in the same pane, following it while it runs.
 */
export function MergeOutputPane({
	task,
	index,
	label,
	running,
	phone,
	onClose,
}: {
	task: string;
	index: number;
	label: string;
	running: boolean;
	phone: boolean;
	onClose: () => void;
}): JSX.Element {
	const [output] = useState(
		() =>
			new BackgroundOutput(
				`/api/tasks/${encodeURIComponent(task)}/merge-output/${index}`,
			),
	);
	useEffect(() => () => output.dispose(), [output]);
	const { status } = useReactive(
		output,
		(output) => ({ status: output.status }),
		["changed"],
	);
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
			aria-label="merge step output"
			className={cn(
				"fixed z-40 flex flex-col gap-2 bg-background p-3",
				phone ? "inset-0" : cn("inset-y-0 right-0 border-l", PANE_WIDTH),
			)}
		>
			<header className="flex min-h-8 items-center gap-2">
				<StateMark state={running ? "running" : "completed"} />
				<h2 className="min-w-0 flex-1 truncate font-medium text-sm">{label}</h2>
				<span role="status" className="text-muted-foreground text-xs">
					{status === "closed"
						? running
							? "Disconnected"
							: "Gone"
						: running
							? "Running"
							: "Done"}
				</span>
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

/** A command's output, drawn by xterm.js into a box that follows its size. */
export function Output({
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
