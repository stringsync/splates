import { useReactive } from "core/react";

import { type JSX, useEffect, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import {
	Field,
	FieldDescription,
	FieldLabel,
} from "#web/components/ui/field.tsx";
import { Input } from "#web/components/ui/input.tsx";
import { Switch } from "#web/components/ui/switch.tsx";
import { LineupsTab } from "./autopick-lineups";
import { RoutesTab } from "./autopick-routes";
import type { RulesEditor } from "./autopick-rules";
import { ReadingNow } from "./countdown";
import { Refusal, useRefusal } from "./refusal";

/**
 * Lineups, route assignments and settings, each applied independently.
 */
export function RulesEditorView({
	editor,
	mark = null,
	counts = {},
	onLog,
}: {
	editor: RulesEditor;
	/** The cell to set the routes on, `bugfix.deep`; null for none. */
	mark?: string | null;
	/** How many picks the log holds for each cell, by `cellKey`. */
	counts?: Readonly<Record<string, number>>;
	/** Lists the picks made for `cell`; without it, no offer. */
	onLog?: (cell: string) => void;
}): JSX.Element {
	const { fileProblem, loadProblem, saved, saving } = useReactive(
		editor,
		(each) => ({
			dirty: each.dirty,
			problem: each.problem,
			fileProblem: each.fileProblem,
			loadProblem: each.loadProblem,
			saved: each.saved,
			saving: each.saving,
		}),
		["changed"],
	);
	const { refusal, attempt } = useRefusal();

	useEffect(() => void editor.load(), [editor]);
	if (loadProblem !== null) {
		return (
			<p role="alert" className="text-destructive text-sm">
				Could not read your Autopick settings: {loadProblem}
			</p>
		);
	}
	if (saved === null) {
		return <ReadingNow label="Reading your Autopick settings…" />;
	}
	return (
		<div className="flex flex-col gap-6">
			{fileProblem !== null && (
				<p role="alert" className="text-destructive text-sm">
					{fileProblem} Applying replaces it.
				</p>
			)}
			<fieldset disabled={saving} className="min-w-0">
				<LineupsTab editor={editor} />
			</fieldset>
			<section
				aria-label="Route assignments"
				className="flex min-w-0 flex-col gap-3"
			>
				<h2 className="font-semibold">Routes</h2>
				<p className="text-muted-foreground text-sm">
					Select cells to assign them to a lineup.
				</p>
				<RoutesTab
					key={mark ?? ""}
					editor={editor}
					mark={mark}
					counts={counts}
					onLog={onLog}
				/>
			</section>
			<section aria-label="Settings" className="flex min-w-0 flex-col gap-3">
				<h2 className="font-semibold">Settings</h2>
				<p className="text-muted-foreground text-sm">
					Confidence, plan limits and the holdout.
				</p>
				<fieldset disabled={saving} className="flex min-w-0 flex-col gap-4">
					<Threshold editor={editor} />
					<Pacing editor={editor} />
					<HoldingOut editor={editor} />
					<Button
						className="self-end"
						disabled={
							saving ||
							(editor.draft.threshold === saved.threshold &&
								JSON.stringify(editor.draft.pace) ===
									JSON.stringify(saved.pace) &&
								JSON.stringify(editor.draft.holdout) ===
									JSON.stringify(saved.holdout))
						}
						onClick={() =>
							void attempt(editor.apply("settings"), "Settings not applied")
						}
					>
						Apply settings
					</Button>
				</fieldset>
				<Refusal refusal={refusal} />
			</section>
		</div>
	);
}

/** How sure the judge has to be before a kind or depth is not unsure. */
function Threshold({ editor }: { editor: RulesEditor }): JSX.Element {
	const percent = useReactive(editor, (each) => each.percent, ["changed"]);
	return (
		<Field className="rounded-xl border bg-card p-4">
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
				Below it, the task's kind or difficulty counts as Unsure, and it takes
				that row or column.
			</FieldDescription>
		</Field>
	);
}

/** When a pick is passed over for the next in its lineup because of its plan. */
function Pacing({ editor }: { editor: RulesEditor }): JSX.Element {
	const pace = useReactive(editor, (each) => each.pace, ["changed"]);
	return (
		<section
			aria-label="When a plan runs low"
			className="flex flex-col gap-4 rounded-xl border bg-card p-4"
		>
			<h3 className="font-medium text-sm">When a plan runs low</h3>
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
					pick is passed over once its plan is past 50% used, while the next in
					its lineup has plan left.
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
					Past it, a pick is passed over for the next in its lineup, pace or
					not. When every pick is past it, the least used is picked.
				</FieldDescription>
			</Field>
		</section>
	);
}

/**
 * Whether a share of tasks starts one difficulty easier than judged, as an
 * experiment measuring whether a lineup is stronger than its tasks need.
 */
function HoldingOut({ editor }: { editor: RulesEditor }): JSX.Element {
	const holdout = useReactive(editor, (each) => each.holdout, ["changed"]);
	return (
		<section
			aria-label="Holdout"
			className="flex flex-col gap-4 rounded-xl border bg-card p-4"
		>
			<h3 className="font-medium text-sm">Holdout</h3>
			<Field orientation="horizontal">
				<Switch
					id="auto-pick-held-out"
					checked={holdout.on}
					onCheckedChange={(checked) => editor.setHeldOut(checked)}
				/>
				<FieldLabel htmlFor="auto-pick-held-out">
					Start a share of tasks one difficulty easier, as an experiment
				</FieldLabel>
			</Field>
			<Field data-disabled={!holdout.on || undefined}>
				<FieldLabel htmlFor="auto-pick-holdout-share">
					How many tasks to hold out, in percent
				</FieldLabel>
				<div>
					<PercentInput
						id="auto-pick-holdout-share"
						disabled={!holdout.on}
						value={Math.round(holdout.share * 100)}
						onCommit={(value) => editor.setHoldoutPercent(value)}
					/>
				</div>
				<FieldDescription>
					A held-out Deep task starts on its Moderate cell's pick, a Moderate
					one on its Shallow cell's, on the same agent, so their outcomes show
					whether a lineup is stronger than its tasks need. It trades some
					quality for knowing; its conversation says so, with an Undo.
				</FieldDescription>
			</Field>
		</section>
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
