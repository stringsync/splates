import {
	closestCenter,
	DndContext,
	KeyboardSensor,
	MouseSensor,
	TouchSensor,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import { restrictToHorizontalAxis } from "@dnd-kit/modifiers";
import {
	horizontalListSortingStrategy,
	SortableContext,
	sortableKeyboardCoordinates,
	useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { AgentPick } from "@stringsync/splates-server/models";
import { PlusIcon, XIcon } from "lucide-react";
import type { JSX } from "react";
import { Button } from "#web/components/ui/button.tsx";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuTrigger,
} from "#web/components/ui/dropdown-menu.tsx";
import { Field, FieldLabel } from "#web/components/ui/field.tsx";
import {
	NativeSelect,
	NativeSelectOption,
} from "#web/components/ui/native-select.tsx";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "#web/components/ui/popover.tsx";
import { cn } from "#web/lib/utils.ts";
import type { RulesEditor } from "./auto-pick-rules";

/**
 * A rule's picks as chips in the order they are tried: dragged, or moved with
 * the keyboard from a focused chip, to reorder; a chip's menu sets its model
 * and thinking level or removes it; the dashed chip adds an agent and model
 * the rule does not name yet.
 */
export function PickChips({
	editor,
	rule,
	picks,
}: {
	editor: RulesEditor;
	rule: number;
	picks: readonly AgentPick[];
}): JSX.Element {
	const sensors = useSensors(
		useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
		useSensor(TouchSensor, {
			activationConstraint: { delay: 200, tolerance: 6 },
		}),
		useSensor(KeyboardSensor, {
			coordinateGetter: sortableKeyboardCoordinates,
		}),
	);
	const ids = picks.map((_, at) => String(at));
	return (
		<DndContext
			sensors={sensors}
			collisionDetection={closestCenter}
			modifiers={[restrictToHorizontalAxis]}
			onDragEnd={({ active, over }) => {
				if (over !== null && active.id !== over.id) {
					editor.movePick(rule, Number(active.id), Number(over.id));
				}
			}}
		>
			<SortableContext items={ids} strategy={horizontalListSortingStrategy}>
				<ol
					aria-label={`rule ${rule + 1} picks`}
					className="flex flex-wrap items-center gap-2 pl-7"
				>
					{picks.map((pick, at) => (
						<PickChip
							// biome-ignore lint/suspicious/noArrayIndexKey: a pick is its place on the rule
							key={at}
							editor={editor}
							rule={rule}
							index={at}
							pick={pick}
							count={picks.length}
						/>
					))}
					<li>
						<AddPick editor={editor} rule={rule} />
					</li>
				</ol>
			</SortableContext>
			{picks.length > 1 && (
				<p className="pl-7 text-muted-foreground text-xs">
					Tried left to right; the next is used once a plan is nearly spent.
				</p>
			)}
		</DndContext>
	);
}

/** One pick as a chip: its place, agent, model and thinking, with a menu to edit it. */
function PickChip({
	editor,
	rule,
	index,
	pick,
	count,
}: {
	editor: RulesEditor;
	rule: number;
	index: number;
	pick: AgentPick;
	count: number;
}): JSX.Element {
	const name = `rule ${rule + 1} pick ${index + 1}`;
	const {
		attributes,
		listeners,
		setNodeRef,
		transform,
		transition,
		isDragging,
	} = useSortable({ id: String(index) });
	const agent = editor.agents.find((each) => each.id === pick.agent);
	const model = agent?.models.find((each) => each.id === pick.model);
	const efforts = editor.efforts(pick.agent);
	const detail = [
		pick.model === undefined ? "default model" : (model?.name ?? pick.model),
		pick.effort,
	]
		.filter(Boolean)
		.join(" · ");
	return (
		<li
			ref={setNodeRef}
			aria-label={name}
			style={{
				transform: CSS.Translate.toString(transform),
				transition,
			}}
			className={cn(
				"flex items-center gap-1 rounded-full border bg-card py-1 pr-1 pl-2 text-sm shadow-xs",
				isDragging && "z-10 border-foreground shadow-md",
			)}
		>
			<button
				type="button"
				aria-label={`Drag ${name}`}
				className="flex cursor-grab touch-none items-center gap-2 rounded-full focus-visible:outline-2"
				{...attributes}
				{...listeners}
			>
				<span className="grid size-[18px] place-items-center rounded-full bg-foreground text-[11px] text-background tabular-nums">
					{index + 1}
				</span>
				<span className="font-medium">
					{agent?.name ?? `${pick.agent} (not on the roster)`}
				</span>
			</button>
			<Popover>
				<PopoverTrigger
					render={
						<Button
							type="button"
							variant="ghost"
							size="xs"
							aria-label={`Edit ${name}`}
							className="rounded-full text-muted-foreground"
						/>
					}
				>
					{detail}
				</PopoverTrigger>
				<PopoverContent className="flex w-64 flex-col gap-3">
					<Field>
						<FieldLabel htmlFor={`${name}-model`}>Model</FieldLabel>
						<NativeSelect
							id={`${name}-model`}
							size="sm"
							className="w-full"
							aria-label={`${name} model`}
							value={pick.model ?? ""}
							onChange={(event) =>
								editor.setModel(
									rule,
									index,
									event.currentTarget.value || undefined,
								)
							}
						>
							<NativeSelectOption
								value=""
								disabled={editor.has(rule, pick.agent, undefined, index)}
							>
								Default model
							</NativeSelectOption>
							{pick.model !== undefined &&
								agent !== undefined &&
								model === undefined && (
									<NativeSelectOption value={pick.model}>
										{pick.model}
									</NativeSelectOption>
								)}
							{(agent?.models ?? []).map((each) => (
								<NativeSelectOption
									key={each.id}
									value={each.id}
									disabled={editor.has(rule, pick.agent, each.id, index)}
								>
									{each.name}
								</NativeSelectOption>
							))}
						</NativeSelect>
					</Field>
					<Field>
						<FieldLabel htmlFor={`${name}-thinking`}>Thinking</FieldLabel>
						<NativeSelect
							id={`${name}-thinking`}
							size="sm"
							className="w-full"
							aria-label={`${name} thinking`}
							value={pick.effort ?? ""}
							onChange={(event) =>
								editor.setEffort(
									rule,
									index,
									event.currentTarget.value || undefined,
								)
							}
						>
							<NativeSelectOption value="">Default thinking</NativeSelectOption>
							{pick.effort !== undefined && !efforts.includes(pick.effort) && (
								<NativeSelectOption value={pick.effort}>
									{pick.effort}
								</NativeSelectOption>
							)}
							{efforts.map((each) => (
								<NativeSelectOption key={each} value={each}>
									{each}
								</NativeSelectOption>
							))}
						</NativeSelect>
					</Field>
				</PopoverContent>
			</Popover>
			<Button
				type="button"
				variant="ghost"
				size="icon-xs"
				className="rounded-full"
				aria-label={`Remove ${name}`}
				disabled={count === 1}
				onClick={() => editor.removePick(rule, index)}
			>
				<XIcon />
			</Button>
		</li>
	);
}

/** The dashed chip: a menu of each agent's models, those the rule names already shown but off. */
function AddPick({
	editor,
	rule,
}: {
	editor: RulesEditor;
	rule: number;
}): JSX.Element {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={
					<Button
						type="button"
						variant="outline"
						size="sm"
						aria-label={`Add an agent to rule ${rule + 1}`}
						className="rounded-full border-dashed text-muted-foreground"
					/>
				}
			>
				<PlusIcon data-icon="inline-start" /> Add agent
			</DropdownMenuTrigger>
			<DropdownMenuContent className="w-60">
				{editor.agents.map((agent) => (
					<DropdownMenuGroup key={agent.id}>
						<DropdownMenuLabel>{agent.name}</DropdownMenuLabel>
						{[{ id: undefined, name: "Default model" }, ...agent.models].map(
							(model) => {
								const named = editor.has(rule, agent.id, model.id);
								return (
									<DropdownMenuItem
										key={model.id ?? "default"}
										disabled={named}
										onClick={() => editor.addPick(rule, agent.id, model.id)}
									>
										{model.name}
										{named && (
											<span className="ml-auto text-muted-foreground text-xs">
												already added
											</span>
										)}
									</DropdownMenuItem>
								);
							},
						)}
					</DropdownMenuGroup>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
