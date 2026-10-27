import type { Rule } from "@stringsync/splates-server/auto-pick";
import {
	ANY,
	CLARITIES,
	DEPTHS,
	KINDS,
} from "@stringsync/splates-server/auto-pick/browser";
import type { AgentPick } from "@stringsync/splates-server/models";
import { useReactive } from "@webappwiz/react";
import {
	ArrowDownIcon,
	ArrowUpIcon,
	PlusIcon,
	RotateCcwIcon,
	XIcon,
} from "lucide-react";
import { type JSX, useEffect, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import {
	Field,
	FieldDescription,
	FieldLabel,
} from "#web/components/ui/field.tsx";
import { Input } from "#web/components/ui/input.tsx";
import {
	NativeSelect,
	NativeSelectOption,
} from "#web/components/ui/native-select.tsx";
import { Switch } from "#web/components/ui/switch.tsx";
import { cn } from "#web/lib/utils.ts";
import { PickRows } from "./auto-pick-pick-rows";
import type { RulesEditor } from "./auto-pick-rules";
import { ReadingNow } from "./countdown";
import { Refusal, useRefusal } from "./refusal";

/**
 * The Auto pick rules as a list to edit: each rule's kind and depth and
 * its ordered picks, the last rule fixed as any kind and any depth, the
 * confidence threshold, when a pick's plan is used too fast, and Save and Reset, each shown at once and said
 * beside it when the server refuses.
 */
export function RulesEditorView({
	editor,
	mark = null,
	picks = [],
	onLog,
}: {
	editor: RulesEditor;
	/** How many picks each rule has made, by its place from 0. */
	picks?: readonly number[];
	/** Lists the picks rule `rule` made, by its place from 0; without it, no offer. */
	onLog?: (rule: number) => void;
	/** The rule to draw the eye to, by its place from 0, scrolled into view; null for none. */
	mark?: number | null;
}): JSX.Element {
	const {
		draft,
		dirty,
		problem,
		fileProblem,
		loadProblem,
		saved,
		percent,
		pace,
	} = useReactive(
		editor,
		(each) => ({
			draft: each.draft,
			dirty: each.dirty,
			problem: each.problem,
			fileProblem: each.fileProblem,
			loadProblem: each.loadProblem,
			saved: each.saved,
			percent: each.percent,
			pace: each.pace,
		}),
		["changed"],
	);
	const { refusal, attempt } = useRefusal();
	useEffect(() => void editor.load(), [editor]);
	if (loadProblem !== null) {
		return (
			<p role="alert" className="text-destructive text-sm">
				Could not read your rules: {loadProblem}
			</p>
		);
	}
	if (saved === null) {
		return <ReadingNow label="Reading your rules…" />;
	}
	return (
		<div className="flex flex-col gap-6">
			{fileProblem !== null && (
				<p role="alert" className="text-destructive text-sm">
					{fileProblem} Saving here replaces it.
				</p>
			)}
			<ol aria-label="Auto pick rules" className="flex flex-col gap-3">
				{draft.rules.map((rule, index) => (
					<RuleRow
						// Rules have no ids: a row is its place in the list.
						// biome-ignore lint/suspicious/noArrayIndexKey: see above
						key={index}
						editor={editor}
						index={index}
						kind={rule.kind}
						depth={rule.depth}
						clarity={rule.clarity ?? ANY}
						picks={rule.picks}
						made={picks[index] ?? 0}
						onLog={onLog}
						last={index === draft.rules.length - 1}
						marked={index === mark}
					/>
				))}
			</ol>
			<Button
				type="button"
				variant="outline"
				className="self-start"
				onClick={() => editor.addRule()}
			>
				<PlusIcon data-icon="inline-start" /> Add rule
			</Button>
			<Field>
				<FieldLabel htmlFor="auto-pick-threshold">
					How sure the judge has to be, in percent
				</FieldLabel>
				<div>
					<PercentInput
						id="auto-pick-threshold"
						value={percent}
						onCommit={(value) => editor.setPercent(value)}
					/>
				</div>
				<FieldDescription>
					Below it, only rules accepting any value for that kind, depth or
					certainty match. Certainty means how settled the requested behavior
					is, not how confident the user sounds.
				</FieldDescription>
			</Field>
			<Field orientation="horizontal">
				<Switch
					id="auto-pick-paced"
					checked={pace.on}
					onCheckedChange={(checked) => editor.setPaced(checked)}
				/>
				<FieldLabel htmlFor="auto-pick-paced">
					Pass over a pick whose plan is used faster than its window goes by
				</FieldLabel>
			</Field>
			<Field data-disabled={!pace.on || undefined}>
				<FieldLabel htmlFor="auto-pick-slack">
					How far ahead of its window a plan may run, in percent
				</FieldLabel>
				<div>
					<PercentInput
						id="auto-pick-slack"
						disabled={!pace.on}
						value={Math.round(pace.slack * 100)}
						onCommit={(value) => editor.setSlackPercent(value)}
					/>
				</div>
				<FieldDescription>
					Two hours into a five-hour window, 40% of it has gone by: at 10, a
					pick is passed over once its plan is past 50% used, while the next on
					its row has plan left.
				</FieldDescription>
			</Field>
			<Field>
				<FieldLabel htmlFor="auto-pick-spent">
					How much of a plan a pick may use at all, in percent
				</FieldLabel>
				<div>
					<PercentInput
						id="auto-pick-spent"
						value={Math.round(pace.spent * 100)}
						onCommit={(value) => editor.setSpentPercent(value)}
					/>
				</div>
				<FieldDescription>
					Past it, a pick is passed over for the next on its row, pace or not.
					When every pick is past it, the least used is picked.
				</FieldDescription>
			</Field>
			{problem !== null && (
				<p role="alert" className="text-destructive text-sm">
					{problem}
				</p>
			)}
			<div className="flex flex-wrap items-center gap-3">
				<Button
					type="button"
					disabled={!dirty || problem !== null}
					onClick={() => void attempt(editor.save(), "Not saved")}
				>
					Save rules
				</Button>
				<Button
					type="button"
					variant="ghost"
					onClick={() =>
						void attempt(editor.reset(), "Not reset to the defaults")
					}
				>
					<RotateCcwIcon data-icon="inline-start" /> Reset to defaults
				</Button>
				<span role="status" className="text-muted-foreground text-sm">
					{dirty ? "Unsaved changes" : "Saved"}
				</span>
			</div>
			<Refusal refusal={refusal} className="text-sm" />
		</div>
	);
}

/** One rule: what it matches, or that it matches everything, and its picks. */
function RuleRow({
	editor,
	index,
	kind,
	depth,
	clarity,
	picks,
	made,
	onLog,
	last,
	marked,
}: {
	editor: RulesEditor;
	index: number;
	kind: string;
	depth: string;
	clarity: string;
	picks: readonly AgentPick[];
	made: number;
	onLog?: (rule: number) => void;
	last: boolean;
	marked: boolean;
}): JSX.Element {
	const name = `rule ${index + 1}`;
	return (
		<li
			aria-label={name}
			ref={
				marked
					? (node) => node?.scrollIntoView?.({ block: "center" })
					: undefined
			}
			className={cn(
				"flex flex-col gap-3 rounded-lg border bg-card p-3",
				marked && "border-amber-500/60 bg-amber-500/5 ring-2 ring-amber-500/30",
			)}
		>
			<div className="flex flex-wrap items-center gap-2">
				<span className="w-5 text-right text-muted-foreground text-sm tabular-nums">
					{index + 1}
				</span>
				{last ? (
					<span className="flex-1 text-sm">
						Any kind, any depth, any certainty{" "}
						<span className="text-muted-foreground">
							· last, so every task maps somewhere
						</span>
					</span>
				) : (
					<>
						<NativeSelect
							size="sm"
							aria-label={`${name} kind`}
							value={kind}
							onChange={(event) =>
								editor.setKind(index, event.currentTarget.value as Rule["kind"])
							}
						>
							<NativeSelectOption value={ANY}>Any kind</NativeSelectOption>
							{KINDS.map((each) => (
								<NativeSelectOption key={each.id} value={each.id}>
									{each.label}
								</NativeSelectOption>
							))}
						</NativeSelect>
						<NativeSelect
							size="sm"
							aria-label={`${name} depth`}
							value={depth}
							onChange={(event) =>
								editor.setDepth(
									index,
									event.currentTarget.value as Rule["depth"],
								)
							}
						>
							<NativeSelectOption value={ANY}>Any depth</NativeSelectOption>
							{DEPTHS.map((each) => (
								<NativeSelectOption key={each.id} value={each.id}>
									{each.label}
								</NativeSelectOption>
							))}
						</NativeSelect>
						<NativeSelect
							size="sm"
							aria-label={`${name} certainty`}
							value={clarity}
							onChange={(event) =>
								editor.setClarity(
									index,
									event.currentTarget.value as NonNullable<Rule["clarity"]>,
								)
							}
						>
							<NativeSelectOption value={ANY}>Any certainty</NativeSelectOption>
							{CLARITIES.map((each) => (
								<NativeSelectOption key={each.id} value={each.id}>
									{each.label}
								</NativeSelectOption>
							))}
						</NativeSelect>
						<span className="ml-auto flex">
							<Button
								type="button"
								variant="ghost"
								size="icon-sm"
								aria-label={`Move ${name} up`}
								disabled={index === 0}
								onClick={() => editor.moveRule(index, -1)}
							>
								<ArrowUpIcon />
							</Button>
							<Button
								type="button"
								variant="ghost"
								size="icon-sm"
								aria-label={`Move ${name} down`}
								disabled={editor.fixed(index + 1)}
								onClick={() => editor.moveRule(index, 1)}
							>
								<ArrowDownIcon />
							</Button>
							<Button
								type="button"
								variant="ghost"
								size="icon-sm"
								aria-label={`Remove ${name}`}
								onClick={() => editor.removeRule(index)}
							>
								<XIcon />
							</Button>
						</span>
					</>
				)}
			</div>
			<PickRows list={editor.picksOf(index)} picks={picks} />
			{onLog !== undefined && made > 0 && (
				<button
					type="button"
					className="self-start text-muted-foreground text-xs underline"
					onClick={() => onLog(index)}
				>
					{made === 1 ? "1 pick" : `${made} picks`} by {name} in the log
				</button>
			)}
		</li>
	);
}

/**
 * A percent field that keeps what is typed, empty included, until it loses
 * focus; each whole number in it is passed on as it is typed, and the
 * field shows the value in force again once it is left.
 */
function PercentInput({
	id,
	value,
	disabled,
	onCommit,
}: {
	id: string;
	value: number;
	disabled?: boolean;
	onCommit: (value: number) => void;
}): JSX.Element {
	const [typed, setTyped] = useState<string | null>(null);
	return (
		<Input
			id={id}
			type="number"
			inputMode="numeric"
			min={0}
			max={100}
			step={5}
			className="w-24"
			disabled={disabled}
			value={typed ?? value}
			onChange={(event) => {
				const text = event.currentTarget.value;
				setTyped(text);
				if (text !== "") {
					onCommit(event.currentTarget.valueAsNumber);
				}
			}}
			onBlur={() => setTyped(null)}
		/>
	);
}
