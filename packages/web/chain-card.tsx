import {
	CHAIN_VISIBLE_DEPTH,
	type ChainNode,
	type ChainRow,
	type ChainView,
	chainRows,
	tokensShort,
} from "@splates/server/queue/browser";
import { BotIcon, ChevronRightIcon } from "lucide-react";
import {
	createContext,
	type JSX,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogTitle,
} from "#web/components/ui/dialog.tsx";
import { cn } from "#web/lib/utils.ts";
import { readAgentChain } from "./api";
import { arriveAtQueued } from "./arrivals";
import { Board } from "./board";
import { queuedAddress } from "./conversation-address";
import { ThreadBar } from "./thread-bar";

/** How often a conversation in a chain asks the server for the chain again. */
const REFRESH_MS = 15_000;

/**
 * The chain `conversation` belongs to, kept fresh, or null when it is in none
 * (or the server has not said yet, or `conversation` is null).
 */
export function useChain(conversation: string | null): ChainView | null {
	const [chain, setChain] = useState<ChainView | null>(null);
	const load = useCallback(() => {
		if (conversation === null) {
			return Promise.resolve();
		}
		return readAgentChain(conversation).then(
			(next) => setChain(next),
			() => {},
		);
	}, [conversation]);
	useEffect(() => {
		if (conversation === null) {
			setChain(null);
			return;
		}
		void load();
		const timer = setInterval(() => void load(), REFRESH_MS);
		return () => clearInterval(timer);
	}, [conversation, load]);
	return chain;
}

interface ChainState {
	conversation: string;
	chain: ChainView | null;
	arrivedTask: number | null;
	onOpen: (address: string) => void;
	openTree: () => void;
}

const ChainContext = createContext<ChainState | null>(null);

/**
 * For an inline list of the queued tasks `ids`: whether the thread just
 * arrived at one of them, and what opens the chain's tree, null outside a chain.
 */
export function useQueuedTree(ids: readonly number[]): {
	arrived: boolean;
	openTree: (() => void) | null;
} {
	const shared = useContext(ChainContext);
	return {
		arrived:
			shared !== null &&
			shared.arrivedTask !== null &&
			ids.includes(shared.arrivedTask),
		openTree: shared?.chain != null ? shared.openTree : null,
	};
}

/**
 * Shares a conversation's task chain and its tree dialog between the top
 * `ChainBanner` and any inline `QueuedBar`s in the thread.
 */
export function ChainProvider({
	conversation,
	active = true,
	arrivedTask = null,
	onOpen,
	children,
}: {
	conversation: string;
	active?: boolean;
	arrivedTask?: number | null;
	onOpen: (address: string) => void;
	children: ReactNode;
}): JSX.Element {
	const chain = useChain(active ? conversation : null);
	const [open, setOpen] = useState(false);
	const openTree = useCallback(() => setOpen(true), []);
	const value = useMemo<ChainState>(
		() => ({ conversation, chain, arrivedTask, onOpen, openTree }),
		[conversation, chain, arrivedTask, onOpen, openTree],
	);
	return (
		<ChainContext value={value}>
			{children}
			{chain !== null && (
				<ChainDialog
					open={open}
					onOpenChange={setOpen}
					chain={chain}
					current={conversation}
					onOpen={onOpen}
				/>
			)}
		</ChainContext>
	);
}

function ChainDialog({
	open,
	onOpenChange,
	chain,
	current,
	onOpen,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	chain: ChainView;
	current: string;
	onOpen: (address: string) => void;
}): JSX.Element {
	// Focus lands on the dialog, not its first row, which is no pick.
	const dialog = useRef<HTMLDivElement>(null);
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				ref={dialog}
				initialFocus={dialog}
				className="max-h-[85%] grid-cols-1 gap-0 overflow-y-auto p-0 sm:max-w-md"
			>
				<ChainTree
					chain={chain}
					current={current}
					onOpen={(address) => {
						onOpenChange(false);
						onOpen(address);
					}}
				/>
			</DialogContent>
		</Dialog>
	);
}

/** Where a chain task opens: its conversation, or its queued page while it waits. */
function addressOf(node: ChainNode): string {
	return node.conversation ?? queuedAddress(node.id);
}

/** "#14", "#14 and #15", or "#14, #15 and 2 more". */
function listed(nodes: readonly { id: number }[]): string {
	const ids = nodes.map((node) => `#${node.id}`);
	if (ids.length <= 2) {
		return ids.join(" and ");
	}
	return `${ids.slice(0, 2).join(", ")} and ${ids.length - 2} more`;
}

/**
 * The inline bar where an agent enqueued tasks in a conversation, using the
 * shared `ThreadBar` (`Queued #4626, #4627 and 2 more` + ghost `View ›`) and
 * opening the connected conversations tree dialog on click.
 */
export function QueuedBar({
	tasks,
}: {
	tasks: readonly { id: number; subject: string }[];
}): JSX.Element {
	const shared = useContext(ChainContext);
	const board = useContext(Board);
	const arrived =
		shared !== null &&
		shared.arrivedTask !== null &&
		tasks.some((task) => task.id === shared.arrivedTask);
	const openTask = (id: number) => {
		const node = shared?.chain?.nodes.find((each) => each.id === id);
		if (node !== undefined && shared !== null) {
			shared.onOpen(addressOf(node));
			return;
		}
		const todo = board.todos.find((each) => each.id === id);
		if (board.openQueuedConversation?.(id, todo?.takenBy ?? null, null)) {
			return;
		}
		if (shared !== null) {
			shared.onOpen(queuedAddress(id));
			return;
		}
		board.open(id);
	};
	const firstTask = tasks[0];
	const onPress =
		shared?.chain != null
			? shared.openTree
			: firstTask !== undefined && tasks.length === 1
				? () => openTask(firstTask.id)
				: undefined;
	return (
		<div
			role="status"
			aria-label="queued tasks"
			data-queued-tasks={tasks.map((task) => task.id).join(",")}
			className="my-4"
		>
			<ThreadBar
				Icon={BotIcon}
				iconTone="neutral"
				label={`Queued ${listed(tasks)}`}
				cta={onPress !== undefined ? "View" : undefined}
				onPress={onPress}
				className={arrived ? "ring-2 ring-primary/60" : undefined}
			/>
		</div>
	);
}

/**
 * The banner atop a conversation in a task chain, saying what it is connected
 * to on a single-line `ThreadBar`, whose click opens the whole tree and the
 * chain's budget in a dialog. Nothing for a conversation in no chain.
 */
export function ChainBanner({
	conversation,
	onOpen,
}: {
	conversation: string;
	onOpen: (address: string) => void;
}): JSX.Element | null {
	const shared = useContext(ChainContext);
	const usesShared = shared !== null && shared.conversation === conversation;
	const ownChain = useChain(usesShared ? null : conversation);
	const chain = usesShared ? shared.chain : ownChain;
	const [open, setOpen] = useState(false);
	if (chain === null) {
		return null;
	}
	const known = new Set(chain.nodes.map((node) => node.id));
	const parentOf = (node: ChainNode) =>
		node.parent !== null && known.has(node.parent) ? node.parent : null;
	const self = chain.nodes.find((node) => node.conversation === conversation);
	const isRoot = self === undefined;
	const queued = chain.nodes.filter(
		(node) => parentOf(node) === (self?.id ?? null),
	);
	const by =
		self === undefined
			? undefined
			: chain.nodes.find((node) => node.id === parentOf(self));
	const label = isRoot
		? `Queued ${listed(queued)}`
		: `Queued by ${by === undefined ? chain.root.title : `#${by.id} ${by.title}`}${queued.length > 0 ? ` · queued ${queued.length} more` : ""}`;
	return (
		<div role="status" aria-label="task chain" className="md:mx-2">
			<ThreadBar
				Icon={BotIcon}
				iconTone="neutral"
				label={label}
				cta="View"
				onPress={() => (usesShared ? shared.openTree() : setOpen(true))}
			/>
			{!usesShared && (
				<ChainDialog
					open={open}
					onOpenChange={setOpen}
					chain={chain}
					current={conversation}
					onOpen={onOpen}
				/>
			)}
		</div>
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
	running: "running",
	merged: "merged",
	queued: "queued",
	held: "reserve",
	removed: "removed",
};

function share(chain: ChainView): number {
	return chain.budget > 0 ? Math.min(1, chain.spent / chain.budget) : 1;
}

/** The dialog's body: the chain's budget bar and its whole tree. */
function ChainTree({
	chain,
	current,
	onOpen,
}: {
	chain: ChainView;
	/** The conversation showing it, whose row says "you". */
	current: string;
	onOpen: (address: string) => void;
}): JSX.Element {
	const rows = chainRows(chain.nodes);
	const out = share(chain) >= 1;
	const self = chain.nodes.find((node) => node.conversation === current);
	const openAddress = (targetConversation: string | null, address: string) => {
		if (self !== undefined && targetConversation !== null) {
			arriveAtQueued(targetConversation, self.id);
		}
		onOpen(address);
	};
	return (
		<div className="flex flex-col text-sm">
			<div className="flex flex-col gap-1 px-5 pt-5 pb-3">
				<DialogTitle>Connected conversations</DialogTitle>
				<DialogDescription>
					{chain.nodes.length + 1} conversations · click one to open it
				</DialogDescription>
			</div>
			<div className="flex flex-col gap-1.5 px-5 pb-3">
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
			<ul className="flex flex-col gap-px px-3 pb-4">
				<li>
					<TreeButton
						depth={0}
						current={chain.root.conversation === current}
						onClick={() =>
							openAddress(chain.root.conversation, chain.root.conversation)
						}
					>
						<span className="size-2 shrink-0 rounded-full bg-foreground" />
						<span className="min-w-0 flex-1 truncate">{chain.root.title}</span>
						{chain.root.conversation === current && (
							<span className="text-muted-foreground text-xs">you</span>
						)}
					</TreeButton>
				</li>
				{rows.map((row) => (
					<ChainRowView
						key={row.kind === "task" ? row.node.id : `more-${row.under}`}
						row={row}
						current={current}
						onOpen={openAddress}
					/>
				))}
			</ul>
		</div>
	);
}

function TreeButton({
	depth,
	current,
	onClick,
	children,
}: {
	depth: number;
	current: boolean;
	onClick: () => void;
	children: ReactNode;
}): JSX.Element {
	return (
		<button
			type="button"
			onClick={onClick}
			style={{ paddingLeft: `${depth * 1.25 + 0.5}rem` }}
			className={cn(
				"flex min-h-9 w-full items-center gap-2.5 rounded-md py-1.5 pr-2 text-left hover:bg-accent",
				current && "bg-accent",
			)}
		>
			{children}
		</button>
	);
}

function ChainRowView({
	row,
	current,
	onOpen,
}: {
	row: ChainRow;
	current: string;
	onOpen: (targetConversation: string | null, address: string) => void;
}): JSX.Element {
	if (row.kind === "more") {
		return (
			<li
				className="flex items-center gap-1 py-1 text-muted-foreground text-xs"
				style={{ paddingLeft: `${(CHAIN_VISIBLE_DEPTH - 1) * 1.25 + 1.4}rem` }}
			>
				<ChevronRightIcon className="size-3" />
				{row.count} more under #{row.under}
			</li>
		);
	}
	const { node } = row;
	const you = node.conversation !== null && node.conversation === current;
	return (
		<li>
			<TreeButton
				depth={row.depth}
				current={you}
				onClick={() => onOpen(node.conversation, addressOf(node))}
			>
				<span
					className={cn("size-2 shrink-0 rounded-full", DOT[node.status])}
				/>
				<span className="min-w-0 flex-1 truncate">
					#{node.id} {node.title}
				</span>
				<span className="shrink-0 text-muted-foreground text-xs">
					{you ? "you" : SAID[node.status]}
				</span>
			</TreeButton>
		</li>
	);
}
