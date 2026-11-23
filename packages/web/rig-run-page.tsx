import type { RunView } from "@splates/server/rigs/browser";
import { useReactive, useResource } from "core/react";
import {
	ExternalLinkIcon,
	RotateCcwIcon,
	SquareIcon,
	XIcon,
} from "lucide-react";
import { type JSX, useEffect, useRef } from "react";
import { renderAnsiLine } from "./ansi-line";
import { runLog } from "./api/rigs";
import { Button, buttonVariants } from "./components/ui/button";
import { cn } from "./lib/utils";
import { RunStatePill } from "./rig-state";
import { type RunLogApi, RunLogReader } from "./run-log-reader";

const SERVER: RunLogApi = { runLog };

/**
 * Run `run` on its own page: its state and last health check, a button to
 * open it, its links on this machine and from outside, the options it
 * started with, its log as it comes, and a stop. `onAgain` dismisses it,
 * exited, and opens the start form again on its tree.
 */
export function RigRunPage({
	run,
	onStop,
	onAgain,
	api = SERVER,
}: {
	run: RunView;
	onStop: () => void;
	onAgain: () => void;
	/** Where it reads the log; the server's by default. */
	api?: RunLogApi;
}): JSX.Element {
	// The page is keyed by its run, so one reader serves it while open.
	const reader = useResource(() => new RunLogReader(api, run.id), [api]);
	useEffect(() => {
		const watching = reader.watch();
		return () => watching.dispose();
	}, [reader]);
	const lines = useReactive(reader, (each) => each.lines, ["changed"]);
	const log = useRef<HTMLDivElement>(null);
	// biome-ignore lint/correctness/useExhaustiveDependencies: follow each new line
	useEffect(() => {
		const box = log.current;
		if (box !== null) {
			box.scrollTop = box.scrollHeight;
		}
	}, [lines.length]);
	const options = Object.entries(run.values)
		.map(([name, value]) => `${name}=${value}`)
		.join(" ");
	const main = run.ports[0];
	const exited = run.state === "exited";

	return (
		<section
			aria-label={`Run of ${run.label} on ${run.tree}`}
			className="flex flex-col gap-4"
		>
			<div className="flex flex-wrap items-center gap-2 text-muted-foreground text-xs">
				<RunStatePill state={run.state} exitCode={run.exitCode} />
				{run.health !== null && <span>{run.health}</span>}
			</div>
			{main !== undefined && !exited && (
				<a
					href={main.remote ?? main.local}
					target="_blank"
					rel="noreferrer"
					className={cn(buttonVariants(), "h-11 w-full text-[15px]")}
				>
					<ExternalLinkIcon />
					<span className="truncate">
						Open{" "}
						{main.remote !== null && run.slot !== null
							? `${run.slot.emoji} `
							: ""}
						{bare(main.remote ?? main.local)}
					</span>
				</a>
			)}
			<dl className="grid grid-cols-[5.5rem_1fr] gap-x-3 gap-y-2 text-sm">
				{run.ports.map((port, index) => (
					<Links
						key={port.name}
						port={port}
						named={run.ports.length > 1}
						slotEmoji={run.slot?.emoji ?? null}
						waitingForPublic={index === 0 && run.exposure === "self" && !exited}
					/>
				))}
				<dt className="text-muted-foreground">Options</dt>
				<dd className="break-words font-mono text-xs leading-5">
					{options || "none"}
				</dd>
				{run.preset !== null && (
					<>
						<dt className="text-muted-foreground">Preset</dt>
						<dd>{run.preset}</dd>
					</>
				)}
				{run.tree !== "main" && (
					<>
						<dt className="text-muted-foreground">Stops</dt>
						<dd>when {run.tree} merges or is removed</dd>
					</>
				)}
			</dl>
			<div
				ref={log}
				className="h-[45dvh] min-h-48 overflow-auto rounded-lg bg-[oklch(0.22_0.01_264)] p-3 font-mono text-[11.5px] text-[oklch(0.88_0.01_264)] leading-relaxed"
			>
				{lines.length === 0 ? (
					<p className="opacity-60">Nothing logged yet.</p>
				) : (
					lines.map((line) => <LogLine key={line.n} text={line.text} />)
				)}
			</div>
			{exited ? (
				<div className="flex gap-2">
					<Button variant="outline" className="h-11 flex-1" onClick={onStop}>
						<XIcon />
						Dismiss
					</Button>
					<Button className="h-11 flex-1" onClick={onAgain}>
						<RotateCcwIcon />
						Start again
					</Button>
				</div>
			) : (
				<Button variant="outline" block onClick={onStop}>
					<SquareIcon />
					Stop
				</Button>
			)}
		</section>
	);
}

/** A port's links: on this machine, and from outside when it has one. */
function Links({
	port,
	named,
	slotEmoji,
	waitingForPublic,
}: {
	port: RunView["ports"][number];
	named: boolean;
	slotEmoji: string | null;
	waitingForPublic: boolean;
}): JSX.Element {
	return (
		<>
			<dt className="text-muted-foreground">
				{named ? `Links · ${port.name}` : "Links"}
			</dt>
			<dd className="flex min-w-0 flex-col gap-1">
				<span className="flex min-w-0 items-baseline gap-2">
					<span className="w-12 shrink-0 text-muted-foreground text-xs">
						Local
					</span>
					<PortLink href={port.local} />
				</span>
				{port.remote !== null && (
					<span className="flex min-w-0 items-baseline gap-2">
						<span className="w-12 shrink-0 text-muted-foreground text-xs">
							Public
						</span>
						<span className="flex min-w-0 items-baseline gap-1.5">
							{slotEmoji !== null && (
								<span aria-hidden="true" className="shrink-0">
									{slotEmoji}
								</span>
							)}
							<PortLink href={port.remote} />
						</span>
					</span>
				)}
				{port.remote === null && waitingForPublic && (
					<span className="flex min-w-0 items-baseline gap-2">
						<span className="w-12 shrink-0 text-muted-foreground text-xs">
							Public
						</span>
						<span className="text-muted-foreground text-xs">
							Waiting for URL…
						</span>
					</span>
				)}
			</dd>
		</>
	);
}

const TONES: Record<number, string> = {
	31: "text-[oklch(0.7_0.17_27)]",
	32: "text-[oklch(0.75_0.14_152)]",
	33: "text-[oklch(0.8_0.13_80)]",
	34: "text-[oklch(0.72_0.12_241)]",
	35: "text-[oklch(0.72_0.14_320)]",
	36: "text-[oklch(0.76_0.1_200)]",
	90: "opacity-60",
};

function LogLine({ text }: { text: string }): JSX.Element {
	return (
		<div className="whitespace-pre-wrap break-all">
			{renderAnsiLine(text).map((span, index) => (
				<span
					// biome-ignore lint/suspicious/noArrayIndexKey: a line's spans never move
					key={index}
					className={cn(
						span.fg !== null && TONES[span.fg],
						span.bold && "font-bold",
						span.dim && "opacity-60",
					)}
				>
					{span.text}
				</span>
			))}
			{text === "" && " "}
		</div>
	);
}

function PortLink({ href }: { href: string }): JSX.Element {
	return (
		<a
			href={href}
			target="_blank"
			rel="noreferrer"
			className="min-w-0 truncate underline underline-offset-2"
		>
			{bare(href)}
		</a>
	);
}

/** `href` without its scheme, as a link reads on a small screen. */
function bare(href: string): string {
	return href.replace(/^https?:\/\//, "");
}
