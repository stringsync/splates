import type { Lineup } from "@splates/server/autopick";
import { LINEUP_COLORS } from "@splates/server/autopick/browser";
import { useReactive } from "core/react";
import { PlusIcon } from "lucide-react";
import { type JSX, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { Card } from "#web/components/ui/card.tsx";
import { Input } from "#web/components/ui/input.tsx";
import { cn } from "#web/lib/utils.ts";
import { useWide } from "./app-nav";
import { LineupPicks } from "./autopick-lineup-picks";
import { LINEUP_LOOKS, LineupDot, pickNames } from "./autopick-looks";
import type { RulesEditor } from "./autopick-rules";
import { PageSection } from "./page-section";
import { Refusal, useRefusal } from "./refusal";

/** Edit Autopick lineups; Apply saves one lineup and Cancel drops its edits. */
export function LineupsTab({ editor }: { editor: RulesEditor }): JSX.Element {
	const lineups = useReactive(editor, (each) => each.draft.lineups, [
		"changed",
	]);
	const [open, setOpen] = useState<string | null>(null);
	const { refusal, attempt } = useRefusal();
	const wide = useWide();
	const finish = async (id: string) => {
		await editor.apply({ lineup: id });
		setOpen(null);
	};
	const remove = async (id: string) => {
		await editor.deleteLineup(id);
		setOpen(null);
	};
	return (
		<PageSection
			title="Lineups"
			aside={
				<Button
					variant="outline"
					size="sm"
					disabled={open !== null}
					onClick={() => setOpen(editor.addLineup())}
				>
					<PlusIcon data-icon="inline-start" />
					New lineup
				</Button>
			}
			description="First choice first. The next pick steps in when a plan runs low."
		>
			<Card className="divide-y">
				{lineups.map((lineup) => (
					<section key={lineup.id} aria-label={`Lineup ${lineup.name}`}>
						<div className="flex items-center gap-3 px-4 py-3">
							<div className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-center sm:gap-6">
								<span className="flex items-center gap-2 font-semibold text-sm sm:w-36">
									<LineupDot color={lineup.color} />
									{lineup.name || "Untitled"}
								</span>
								<span className="truncate text-muted-foreground text-xs">
									{lineup.picks
										.map((pick) => {
											const names = pickNames(editor.agents, pick);
											return `${names.agent} · ${names.model}`;
										})
										.join(" → ")}
								</span>
							</div>
							<span className="hidden text-muted-foreground text-xs sm:block">
								{editor.uses(lineup.id).length} routes
							</span>
							<Button
								variant="ghost"
								size="sm"
								aria-label={`Edit ${lineup.name}`}
								disabled={open !== null && open !== lineup.id}
								onClick={() => setOpen(lineup.id)}
							>
								Edit
							</Button>
						</div>
						{open === lineup.id && (
							<div className="flex flex-col gap-4 border-t bg-muted/20 p-4">
								<LineupEditor
									editor={editor}
									lineup={lineup}
									phone={!wide}
									onDeleted={() =>
										void attempt(remove(lineup.id), "Lineup not deleted")
									}
								/>
								<div className="flex justify-end gap-2">
									<Button
										variant="outline"
										onClick={() => {
											editor.discardLineup(lineup.id);
											setOpen(null);
										}}
									>
										Cancel
									</Button>
									<Button
										onClick={() =>
											void attempt(finish(lineup.id), "Lineup not applied")
										}
									>
										Apply
									</Button>
								</div>
							</div>
						)}
					</section>
				))}
			</Card>
			<Refusal refusal={refusal} />
		</PageSection>
	);
}

/** A lineup's name, color and picks, and Delete while no cell sends it tasks. */
function LineupEditor({
	editor,
	lineup,
	phone = false,
	onDeleted,
}: {
	editor: RulesEditor;
	lineup: Lineup;
	phone?: boolean;
	onDeleted: () => void;
}): JSX.Element {
	const used = editor.uses(lineup.id).length > 0;
	const remove = (
		<Button
			type="button"
			variant="outline"
			size={phone ? "default" : "sm"}
			disabled={used}
			onClick={() => {
				onDeleted();
			}}
			className={cn(phone && "w-full")}
		>
			{phone ? (used ? "Delete lineup · in use" : "Delete lineup") : "Delete"}
		</Button>
	);
	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-col gap-1.5">
				<div className="flex flex-wrap items-center gap-3">
					<Input
						aria-label="Lineup name"
						value={lineup.name}
						onChange={(event) =>
							editor.rename(lineup.id, event.currentTarget.value)
						}
						className={cn("font-semibold", phone ? "w-full" : "w-64")}
					/>
					<div role="radiogroup" aria-label="Color" className="flex gap-1.5">
						{LINEUP_COLORS.map((color) => (
							// biome-ignore lint/a11y/useSemanticElements: a color swatch as a radio
							<button
								key={color}
								type="button"
								role="radio"
								aria-checked={lineup.color === color}
								aria-label={color}
								onClick={() => editor.recolor(lineup.id, color)}
								className={cn(
									"size-7 rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
									LINEUP_LOOKS[color].dot,
									lineup.color === color &&
										"ring-2 ring-foreground ring-offset-2 ring-offset-card",
								)}
							/>
						))}
					</div>
					{!phone && <span className="ml-auto">{remove}</span>}
				</div>
				{!phone && used && (
					<p className="text-muted-foreground text-xs">
						Delete is off while cells use this lineup.
					</p>
				)}
			</div>
			<span className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
				Tried in order
			</span>
			<LineupPicks editor={editor} lineup={lineup} phone={phone} />
			{phone && remove}
		</div>
	);
}
