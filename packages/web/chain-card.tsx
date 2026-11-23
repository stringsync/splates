import {
	CHAIN_VISIBLE_DEPTH,
	type ChainNode,
	type ChainRow,
	type ChainView,
	chainRows,
	chainStats,
	tokensShort,
} from "@splates/server/queue/browser";
import { BotIcon, ChevronRightIcon, ExternalLinkIcon } from "lucide-react";
import { type JSX, useCallback, useEffect, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import {
	Dialog,
	DialogContent,
	DialogTitle,
} from "#web/components/ui/dialog.tsx";
import { cn } from "#web/lib/utils.ts";
import { readAgentChain, stopAgentChain } from "./api";
import { queuedAddress } from "./conversation-address";

/** How often an open chain widget asks the server for the chain again. */
const REFRESH_MS = 15_000;

/**
 * The chain `conversation` belongs to, kept fresh while `active`, or null when
 * it is in none (or the server has not said yet).
 */
export function useChain(
	conversation: string,
	active: boolean,
): { chain: ChainView | null; stop: () => void } {
	const [chain, setChain] = useState<ChainView | null>(null);
	const load = useCallback(
		() =>
			readAgentChain(conversation).then(
				(next) => setChain(next),
				() => {},
			),
		[conversation],
	);
	useEffect(() => {
		if (!active) {
			return;
		}
		void load();
		const timer = setInterval(() => void load(), REFRESH_MS);
		return () => clearInterval(timer);
	}, [active, load]);
	const stop = useCallback(() => {
		void stopAgentChain(conversation).then(load, () => {});
	}, [conversation, load]);
	return { chain, stop };
}

/**
 * The widget card for the chain `conversation` is part of, beside its
 * messages: nothing for a conversation in no chain.
 */
export function ChainCard({
	conversation,
	open,
	onOpen,
}: {
	conversation: string;
	/** Fetches the chain only while the widgets are open. */
	open: boolean;
	onOpen: (address: string) => void;
}): JSX.Element | null {
	const { chain, stop } = useChain(conversation, open);
	if (chain === null) {
		return null;
	}
	return (
		<section
			aria-label="task chain"
			data-widget
			className="overflow-hidden rounded-lg border bg-background"
		>
			<ChainBody
				chain={chain}
				current={conversation}
				onOpen={onOpen}
				onStop={stop}
				hint="Each row opens its conversation"
				phone={false}
			/>
		</section>
	);
}

/**
 * On a phone, the bar above the composer showing the chain's budget, which
 * opens the chain as a sheet. Nothing for a conversation in no chain.
 */
export function ChainBar({
	conversation,
	onOpen,
}: {
	conversation: string;
	onOpen: (address: string) => void;
}): JSX.Element | null {
	const { chain, stop } = useChain(conversation, true);
	const [sheet, setSheet] = useState(false);
	if (chain === null) {
		return null;
	}
	const out = share(chain) >= 1;
	return (
		<>
			<button
				type="button"
				onClick={() => setSheet(true)}
				className="flex min-h-12 w-full items-center gap-2 rounded-lg border bg-background px-3 text-sm"
			>
				<BotIcon className="size-3.5 text-primary" />
				<span>Chain</span>
				<span
					aria-hidden
					className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"
				>
					<span
						className={cn(
							"block h-full",
							out ? "bg-destructive" : "bg-foreground",
						)}
						style={{ width: `${share(chain) * 100}%` }}
					/>
				</span>
				<span className="text-muted-foreground text-xs">
					{tokensShort(chain.spent)} / {tokensShort(chain.budget)}
				</span>
				<ChevronRightIcon className="size-4 text-muted-foreground" />
			</button>
			<Dialog open={sheet} onOpenChange={setSheet}>
				<DialogContent
					showCloseButton={false}
					className="top-auto bottom-0 left-0 max-h-[85%] max-w-none translate-x-0 translate-y-0 grid-cols-1 overflow-y-auto rounded-b-none p-0 sm:max-w-none"
				>
					<DialogTitle className="sr-only">Task chain</DialogTitle>
					<ChainBody
						chain={chain}
						current={conversation}
						onOpen={(address) => {
							setSheet(false);
							onOpen(address);
						}}
						onStop={stop}
						hint="Tap a task to open its conversation"
						phone
					/>
				</DialogContent>
			</Dialog>
		</>
	);
}

const DOT: Record<ChainNode["status"], string> = {
	running: "bg-blue-500",
	merged: "bg-green-600",
	queued: "border border-muted-foreground",
	held: "bg-orange-500",
	removed: "bg-muted-foreground/50",
};

const SAID: Record<ChainNode["status"], string> = {
	running: "",
	merged: "",
	queued: "queued",
	held: "reserve",
	removed: "removed",
};

function share(chain: ChainView): number {
	return chain.budget > 0 ? Math.min(1, chain.spent / chain.budget) : 1;
}

/** The chain's tasks and numbers: meter, tree, stats and Stop auto. */
function ChainBody({
	chain,
	current,
	onOpen,
	onStop,
	hint,
	phone,
}: {
	chain: ChainView;
	/** The conversation showing it, whose row says "you". */
	current: string;
	onOpen: (address: string) => void;
	onStop: () => void;
	hint: string;
	phone: boolean;
}): JSX.Element {
	const rows = chainRows(chain.nodes);
	const stats = chainStats(chain.nodes);
	const out = share(chain) >= 1;
	const open = (node: ChainNode) =>
		onOpen(node.conversation ?? queuedAddress(node.id));
	return (
		<div className="flex flex-col text-sm">
			<div className="flex flex-col gap-1.5 px-3 pt-3 pb-2.5">
				<div className="flex items-center justify-between text-muted-foreground text-xs">
					<span className="flex items-center gap-1.5 font-semibold uppercase tracking-wide">
						<BotIcon className="size-3.5 text-primary" />
						Task chain
					</span>
					<span>{chain.stopped ? "auto stopped" : "auto on"}</span>
				</div>
				<div className="flex items-baseline justify-between text-muted-foreground text-xs">
					<span>
						<strong className="font-semibold text-foreground">
							{tokensShort(chain.spent)}
						</strong>{" "}
						of {tokensShort(chain.budget)} tokens
					</span>
					<span>
						{tokensShort(Math.max(0, chain.budget - chain.spent))} left
					</span>
				</div>
				<div
					role="progressbar"
					aria-label="chain budget"
					aria-valuemin={0}
					aria-valuemax={chain.budget}
					aria-valuenow={chain.spent}
					className="h-1.5 overflow-hidden rounded-full bg-muted"
				>
					<div
						className={cn("h-full", out ? "bg-destructive" : "bg-foreground")}
						style={{ width: `${share(chain) * 100}%` }}
					/>
				</div>
			</div>
			<ul className="flex flex-col gap-px rule-t [--rule-inset:0.75rem] p-1.5">
				<li>
					<button
						type="button"
						onClick={() => onOpen(chain.root.conversation)}
						className={cn(
							"flex w-full items-center gap-2 rounded-md bg-accent px-2 py-1.5 text-left",
							phone && "min-h-12",
						)}
					>
						<span className="size-2 shrink-0 rounded-full bg-foreground" />
						<span className="min-w-0 flex-1 truncate">{chain.root.title}</span>
						{chain.root.conversation === current && (
							<span className="text-muted-foreground text-xs">you</span>
						)}
					</button>
				</li>
				{rows.map((row) => (
					<ChainRowView
						key={row.kind === "task" ? row.node.id : `more-${row.under}`}
						row={row}
						phone={phone}
						onOpen={open}
					/>
				))}
			</ul>
			<dl className="grid grid-cols-4 rule-t [--rule-inset:0.75rem] text-center">
				{(
					[
						["running", stats.running],
						["queued", stats.queued],
						["merged", stats.merged],
						["held", stats.held],
					] as const
				).map(([name, count]) => (
					<div key={name} className="flex flex-col py-2 not-last:border-r">
						<dd className="font-semibold">{count}</dd>
						<dt className="text-muted-foreground text-xs">{name}</dt>
					</div>
				))}
			</dl>
			<div className="flex items-center justify-between gap-2 rule-t [--rule-inset:0.75rem] px-3 py-2 text-muted-foreground text-xs">
				<span>{hint}</span>
				{!chain.stopped && (
					<Button
						variant="link"
						size="sm"
						className="h-auto p-0 text-xs underline"
						onClick={onStop}
					>
						Stop auto
					</Button>
				)}
			</div>
		</div>
	);
}

function ChainRowView({
	row,
	phone,
	onOpen,
}: {
	row: ChainRow;
	phone: boolean;
	onOpen: (node: ChainNode) => void;
}): JSX.Element {
	const indent = { paddingLeft: `${(row.depth - 1) * 0.9 + 0.5}rem` };
	if (row.kind === "more") {
		return (
			<li
				className="flex items-center gap-1 px-2 py-1 text-muted-foreground text-xs"
				style={{ paddingLeft: `${(CHAIN_VISIBLE_DEPTH - 1) * 0.9 + 1.4}rem` }}
			>
				<ChevronRightIcon className="size-3" />
				{row.count} more under #{row.under}
			</li>
		);
	}
	const { node } = row;
	return (
		<li>
			<button
				type="button"
				onClick={() => onOpen(node)}
				style={indent}
				className={cn(
					"flex w-full items-center gap-2 rounded-md py-1.5 pr-2 text-left hover:bg-accent",
					phone && "min-h-12",
				)}
			>
				<span
					className={cn("size-2 shrink-0 rounded-full", DOT[node.status])}
				/>
				<span className="min-w-0 flex-1 truncate">
					#{node.id} {node.title}
				</span>
				<span className="shrink-0 text-muted-foreground text-xs">
					{SAID[node.status] ||
						(node.tokens > 0 ? tokensShort(node.tokens) : "")}
				</span>
				{phone ? (
					<ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />
				) : (
					<ExternalLinkIcon className="size-3 shrink-0 text-muted-foreground" />
				)}
			</button>
		</li>
	);
}
