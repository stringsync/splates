import {
	depthLabel,
	kindLabel,
	ROUTE_DEPTHS,
	ROUTE_KINDS,
} from "@splates/server/autopick/browser";
import { useReactive } from "core/react";
import { ChevronsUpDownIcon } from "lucide-react";
import { type JSX, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogTitle,
} from "#web/components/ui/dialog.tsx";
import { Input } from "#web/components/ui/input.tsx";
import {
	Popover,
	PopoverContent,
	PopoverTitle,
	PopoverTrigger,
} from "#web/components/ui/popover.tsx";
import { cn } from "#web/lib/utils.ts";
import { useWide } from "./app-nav";
import { KindIcon, LINEUP_LOOKS, LineupDot, pickNames } from "./autopick-looks";
import {
	type Cell,
	cellKey,
	cellKeyLabel,
	type RulesEditor,
} from "./autopick-rules";
import { Refusal, useRefusal } from "./refusal";

/** Route grid with an attached assignment bar, shared by desktop and phone. */
export function RoutesTab({
	editor,
	mark = null,
	counts = {},
	onLog,
}: {
	editor: RulesEditor;
	mark?: string | null;
	counts?: Readonly<Record<string, number>>;
	onLog?: (cell: string) => void;
}): JSX.Element {
	useReactive(editor, (each) => each.draft, ["changed"]);
	const saving = useReactive(editor, (each) => each.saving, ["changed"]);
	const [picked, setPicked] = useState<readonly string[]>(
		mark === null ? [] : [mark],
	);
	const [applied, setApplied] = useState(false);
	const toggle = (key: string) => {
		setApplied(false);
		setPicked((now) =>
			now.includes(key) ? now.filter((each) => each !== key) : [...now, key],
		);
	};
	const clear = () => setPicked([]);
	return (
		<div className="min-w-0 rounded-xl border bg-card p-3">
			<div className="overflow-x-auto p-0.5">
				<fieldset
					disabled={saving}
					aria-label="Routes"
					className="grid min-w-[34rem] grid-cols-[minmax(7.5rem,auto)_repeat(4,minmax(0,1fr))] gap-1.5"
				>
					<span />
					{ROUTE_DEPTHS.map((depth) => (
						<span
							key={depth}
							className="px-2 pb-1 text-muted-foreground text-xs"
						>
							{depthLabel(depth)}
						</span>
					))}
					{ROUTE_KINDS.map((kind) => (
						<div key={kind} className="contents">
							<span className="flex items-center gap-2 pr-2 font-medium text-sm">
								<KindIcon kind={kind} />
								{kindLabel(kind)}
							</span>
							{ROUTE_DEPTHS.map((depth) => {
								const key = cellKey({ kind, depth });
								const lineup = editor.saved?.lineups.find(
									(each) => each.id === editor.saved?.routes[kind][depth],
								);
								return (
									<button
										type="button"
										key={depth}
										aria-pressed={picked.includes(key)}
										aria-label={`${cellKeyLabel(key)}: ${lineup?.name ?? "No lineup"}`}
										onClick={() => toggle(key)}
										className={cn(
											"h-10 min-w-0 truncate rounded-md px-2.5 text-left font-medium text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
											lineup === undefined
												? "bg-muted"
												: LINEUP_LOOKS[lineup.color].tile,
											picked.includes(key) &&
												"ring-2 ring-foreground ring-inset",
										)}
									>
										{lineup?.name ?? "No lineup"}
									</button>
								);
							})}
						</div>
					))}
				</fieldset>
			</div>
			{picked.length > 0 ? (
				<aside aria-label="Send to" className="mt-3 border-t pt-3">
					<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
						<div className="flex items-center gap-2">
							<span className="font-semibold text-sm">
								{picked.length} selected
							</span>
							<Button
								variant="ghost"
								size="sm"
								disabled={saving}
								onClick={clear}
							>
								Clear
							</Button>
						</div>
						<Assignment
							key={picked.join(",")}
							editor={editor}
							picked={picked}
							onApplied={() => {
								clear();
								setApplied(true);
							}}
						/>
					</div>
					{picked.length === 1 &&
						onLog !== undefined &&
						(counts[picked[0] ?? ""] ?? 0) > 0 && (
							<Button
								variant="link"
								size="sm"
								disabled={saving}
								onClick={() => onLog(picked[0] ?? "")}
							>
								{counts[picked[0] ?? ""]} picks for{" "}
								{cellKeyLabel(picked[0] ?? "")} in the log
							</Button>
						)}
				</aside>
			) : (
				<p role="status" className="mt-3 text-muted-foreground text-xs">
					{applied
						? "Routes applied. Select cells to assign another lineup."
						: "Pick one or more cells to send them to another lineup."}
				</p>
			)}
		</div>
	);
}

/** A staged choice, persisted only when Apply succeeds. */
function Assignment({
	editor,
	picked,
	onApplied,
}: {
	editor: RulesEditor;
	picked: readonly string[];
	onApplied: () => void;
}): JSX.Element {
	const [chosen, setChosen] = useState<string | null>(null);
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const wide = useWide();
	const saving = useReactive(editor, (each) => each.saving, ["changed"]);
	const { refusal, attempt } = useRefusal();
	const lineups = editor.saved?.lineups ?? [];
	const lineup = lineups.find((each) => each.id === chosen);
	const choose = (id: string) => {
		setChosen(id);
		setOpen(false);
		setQuery("");
	};
	const apply = async () => {
		if (chosen === null) {
			return;
		}
		await editor.apply({ cells: picked.map(cellOf), lineup: chosen });
		onApplied();
	};
	const options = lineups.filter((each) =>
		each.name.toLowerCase().includes(query.toLowerCase()),
	);
	const content = (
		<div className="flex min-w-0 flex-col gap-2">
			<Input
				aria-label="Search lineups"
				placeholder="Search lineups…"
				value={query}
				onChange={(event) => setQuery(event.currentTarget.value)}
			/>
			<div
				role="radiogroup"
				aria-label="Send to"
				className="flex max-h-64 flex-col gap-1 overflow-y-auto"
			>
				{options.map((each) => {
					const first = each.picks[0];
					const names =
						first === undefined ? null : pickNames(editor.agents, first);
					return (
						<label
							key={each.id}
							className={cn(
								"flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-muted",
								chosen === each.id && "bg-muted",
							)}
						>
							<input
								type="radio"
								name="route-lineup"
								value={each.id}
								checked={chosen === each.id}
								onChange={() => choose(each.id)}
							/>
							<LineupDot color={each.color} />
							<span className="flex min-w-0 flex-col gap-0.5">
								<span className="truncate font-medium text-sm">
									{each.name}
								</span>
								{names !== null && (
									<span className="truncate text-muted-foreground text-xs">
										{names.agent} · {names.model} first
									</span>
								)}
							</span>
						</label>
					);
				})}
				{options.length === 0 && (
					<p className="p-3 text-muted-foreground text-sm">No lineups match.</p>
				)}
			</div>
		</div>
	);
	const trigger = (
		<Button
			variant="outline"
			aria-label="Choose lineup"
			disabled={saving}
			className="w-full justify-between sm:w-64"
		>
			<span className="flex min-w-0 items-center gap-2">
				{lineup !== undefined && <LineupDot color={lineup.color} />}
				<span className="truncate">{lineup?.name ?? "Choose lineup"}</span>
			</span>
			<ChevronsUpDownIcon data-icon="inline-end" />
		</Button>
	);
	return (
		<div className="flex flex-col gap-2">
			<div className="flex items-center gap-2">
				{wide ? (
					<Popover open={open} onOpenChange={setOpen}>
						<PopoverTrigger render={trigger} />
						<PopoverContent align="end" className="w-80">
							<PopoverTitle className="sr-only">Choose lineup</PopoverTitle>
							{content}
						</PopoverContent>
					</Popover>
				) : (
					<>
						<Button
							variant="outline"
							aria-label="Choose lineup"
							disabled={saving}
							className="min-w-0 flex-1 justify-between"
							onClick={() => setOpen(true)}
						>
							<span className="truncate">
								{lineup?.name ?? "Choose lineup"}
							</span>
							<ChevronsUpDownIcon data-icon="inline-end" />
						</Button>
						<Dialog open={open} onOpenChange={setOpen}>
							<DialogContent className="top-auto bottom-0 left-0 w-full max-w-none translate-x-0 translate-y-0 rounded-b-none">
								<DialogTitle>Choose lineup</DialogTitle>
								<DialogDescription>
									Select a lineup for the selected cells.
								</DialogDescription>
								{content}
							</DialogContent>
						</Dialog>
					</>
				)}
				<Button
					disabled={chosen === null || saving}
					onClick={() => void attempt(apply(), "Routes not applied")}
				>
					{saving ? "Applying..." : "Apply"}
				</Button>
			</div>
			<Refusal refusal={refusal} />
		</div>
	);
}

/** A grid key back to a route cell. */
function cellOf(key: string): Cell {
	const [kind = "unsure", depth = "unsure"] = key.split(".");
	return { kind, depth } as Cell;
}
