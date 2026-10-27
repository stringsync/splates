import {
	closestCenter,
	DndContext,
	KeyboardSensor,
	MouseSensor,
	TouchSensor,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
	SortableContext,
	sortableKeyboardCoordinates,
	useSortable,
	verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { AgentPick } from "@stringsync/splates-server/models";
import { GripVerticalIcon, PlusIcon, XIcon } from "lucide-react";
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
import type { PickList } from "./auto-pick-pick-chips";

/** Renders `picks` for editing through `list`, in their fallback order. */
export function PickRows({
	list,
	picks,
}: {
	list: PickList;
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
			modifiers={[restrictToVerticalAxis]}
			onDragEnd={({ active, over }) => {
				if (over !== null && active.id !== over.id) {
					list.move(Number(active.id), Number(over.id));
				}
			}}
		>
			<SortableContext items={ids} strategy={verticalListSortingStrategy}>
				<div className="flex flex-col gap-2 pl-7">
					<ol
						aria-label={`${list.label} picks`}
						className="flex flex-col divide-y divide-border/60"
					>
						{picks.map((pick, at) => (
							<SortablePick
								// biome-ignore lint/suspicious/noArrayIndexKey: a pick is its place on the rule
								key={at}
								list={list}
								index={at}
								pick={pick}
								count={picks.length}
							/>
						))}
						<li className="py-2">
							<AddPick list={list} />
						</li>
					</ol>
					{picks.length > 1 && list.note !== null && (
						<p className="text-muted-foreground text-xs">{list.note}</p>
					)}
				</div>
			</SortableContext>
		</DndContext>
	);
}

/** One pick: its grip, place, agent, model and thinking, and remove action. */
function SortablePick({
	list,
	index,
	pick,
	count,
}: {
	list: PickList;
	index: number;
	pick: AgentPick;
	count: number;
}): JSX.Element {
	const {
		attributes,
		listeners,
		setNodeRef,
		setActivatorNodeRef,
		transform,
		transition,
		isDragging,
	} = useSortable({ id: String(index) });
	const name = `${list.label} pick ${index + 1}`;
	const agent = list.agents.find((each) => each.id === pick.agent);
	const model = agent?.models.find((each) => each.id === pick.model);
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
			style={{ transform: CSS.Translate.toString(transform), transition }}
			className={cn("relative", isDragging && "z-10")}
		>
			<div
				className={cn(
					"flex min-h-11 items-center gap-2 py-1.5",
					isDragging && "rounded-md bg-card shadow-md",
				)}
			>
				<button
					type="button"
					ref={setActivatorNodeRef}
					aria-label={`Drag ${name}`}
					className="flex shrink-0 cursor-grab touch-none items-center self-stretch rounded-sm text-muted-foreground/60 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 active:cursor-grabbing"
					{...attributes}
					{...listeners}
				>
					<GripVerticalIcon className="size-4" />
				</button>
				<span className="grid size-5 shrink-0 place-items-center rounded-full bg-foreground text-[11px] text-background tabular-nums">
					{index + 1}
				</span>
				<div className="min-w-0 flex-1 truncate font-medium text-sm">
					{agent?.name ?? `${pick.agent} (not on the roster)`}
				</div>
				<Popover>
					<PopoverTrigger
						render={
							<Button
								type="button"
								variant="ghost"
								size="xs"
								aria-label={`Edit ${name}`}
								className="max-w-48 truncate text-muted-foreground"
							/>
						}
					>
						{detail}
					</PopoverTrigger>
					<PopoverContent className="flex w-64 flex-col gap-3">
						<PickFields list={list} index={index} pick={pick} />
					</PopoverContent>
				</Popover>
				<Button
					type="button"
					variant="ghost"
					size="icon-xs"
					className="shrink-0 text-muted-foreground"
					aria-label={`Remove ${name}`}
					disabled={count <= list.least}
					onClick={() => list.remove(index)}
				>
					<XIcon />
				</Button>
			</div>
		</li>
	);
}

/** The model and thinking controls a row opens. */
function PickFields({
	list,
	index,
	pick,
}: {
	list: PickList;
	index: number;
	pick: AgentPick;
}): JSX.Element {
	const name = `${list.label} pick ${index + 1}`;
	const agent = list.agents.find((each) => each.id === pick.agent);
	const model = agent?.models.find((each) => each.id === pick.model);
	const efforts = list.efforts(pick.agent);
	return (
		<>
			<Field>
				<FieldLabel htmlFor={`${name}-model`}>Model</FieldLabel>
				<NativeSelect
					id={`${name}-model`}
					size="sm"
					className="w-full"
					aria-label={`${name} model`}
					value={pick.model ?? ""}
					onChange={(event) =>
						list.setModel(index, event.currentTarget.value || undefined)
					}
				>
					<NativeSelectOption
						value=""
						disabled={list.has(pick.agent, undefined, index)}
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
							disabled={list.has(pick.agent, each.id, index)}
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
						list.setEffort(index, event.currentTarget.value || undefined)
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
		</>
	);
}

/** The dashed row: a menu of each agent's models, those already named off. */
function AddPick({ list }: { list: PickList }): JSX.Element {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={
					<Button
						type="button"
						variant="outline"
						size="sm"
						aria-label={`Add an agent to ${list.label}`}
						className="w-full justify-start border-dashed text-muted-foreground"
					/>
				}
			>
				<PlusIcon data-icon="inline-start" /> Add agent
			</DropdownMenuTrigger>
			<DropdownMenuContent className="w-60">
				{list.agents.map((agent) => (
					<DropdownMenuGroup key={agent.id}>
						<DropdownMenuLabel>{agent.name}</DropdownMenuLabel>
						{[{ id: undefined, name: "Default model" }, ...agent.models].map(
							(model) => {
								const named = list.has(agent.id, model.id);
								return (
									<DropdownMenuItem
										key={model.id ?? "default"}
										disabled={named}
										onClick={() => list.add(agent.id, model.id)}
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
