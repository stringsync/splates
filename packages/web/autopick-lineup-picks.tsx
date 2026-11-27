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
import type { Lineup } from "@splates/server/autopick";
import type { AgentPick } from "@splates/server/models";
import {
	CheckIcon,
	ChevronDownIcon,
	ChevronRightIcon,
	GripVerticalIcon,
	PlusIcon,
	XIcon,
} from "lucide-react";
import type { JSX, ReactElement, ReactNode } from "react";
import { Button } from "#web/components/ui/button.tsx";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuTrigger,
} from "#web/components/ui/dropdown-menu.tsx";
import {
	NativeSelect,
	NativeSelectOption,
} from "#web/components/ui/native-select.tsx";
import { cn } from "#web/lib/utils.ts";
import { AgentMark } from "./agent-icons";
import { effortLabel, pickNames } from "./autopick-looks";
import type { RulesEditor } from "./autopick-rules";

/**
 * Choose one model per agent and drag picks into fallback order.
 * Use Add a fallback to choose another agent.
 */
export function LineupPicks({
	editor,
	lineup,
	phone,
}: {
	editor: RulesEditor;
	lineup: Lineup;
	phone: boolean;
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
	const ids = lineup.picks.map((_, at) => String(at));
	return (
		<DndContext
			sensors={sensors}
			collisionDetection={closestCenter}
			modifiers={[restrictToVerticalAxis]}
			onDragEnd={({ active, over }) => {
				if (over !== null && active.id !== over.id) {
					editor.movePick(lineup.id, Number(active.id), Number(over.id));
				}
			}}
		>
			<SortableContext items={ids} strategy={verticalListSortingStrategy}>
				<ol aria-label={`${lineup.name} picks`} className="flex flex-col gap-2">
					{lineup.picks.map((pick, at) => (
						<PickRow
							// biome-ignore lint/suspicious/noArrayIndexKey: a pick is its place in the lineup
							key={at}
							editor={editor}
							lineup={lineup}
							index={at}
							pick={pick}
							phone={phone}
						/>
					))}
				</ol>
			</SortableContext>
			<ModelMenu
				editor={editor}
				lineup={lineup}
				label={`Add a fallback to ${lineup.name}`}
				onPick={(agent, model) => editor.addPick(lineup.id, agent, model)}
				trigger={
					<Button
						type="button"
						variant={phone ? "outline" : "ghost"}
						className={cn(
							phone
								? "w-full border-dashed"
								: "self-start text-muted-foreground",
						)}
					/>
				}
			>
				<PlusIcon data-icon="inline-start" /> Add a fallback
			</ModelMenu>
			{lineup.picks.length > 1 && (
				<p className="text-muted-foreground text-xs">
					A pick is passed over for the next one while its plan is nearly spent
					or used too fast.
				</p>
			)}
		</DndContext>
	);
}

/** One pick: its grip, place, model and effort, and remove. */
function PickRow({
	editor,
	lineup,
	index,
	pick,
	phone,
}: {
	editor: RulesEditor;
	lineup: Lineup;
	index: number;
	pick: AgentPick;
	phone: boolean;
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
	const name = `${lineup.name} pick ${index + 1}`;
	const names = pickNames(editor.agents, pick);
	const efforts = editor.efforts(pick.agent);
	const grip = (
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
	);
	const effort = (
		<NativeSelect
			aria-label={`${name} effort`}
			value={pick.effort ?? ""}
			className={cn(phone ? "w-full" : "w-32 shrink-0")}
			onChange={(event) =>
				editor.setEffort(
					lineup.id,
					index,
					event.currentTarget.value || undefined,
				)
			}
		>
			<NativeSelectOption value="">Default effort</NativeSelectOption>
			{pick.effort !== undefined && !efforts.includes(pick.effort) && (
				<NativeSelectOption value={pick.effort}>
					{effortLabel(pick.effort)}
				</NativeSelectOption>
			)}
			{efforts.map((each) => (
				<NativeSelectOption key={each} value={each}>
					{effortLabel(each)}
				</NativeSelectOption>
			))}
		</NativeSelect>
	);
	const remove = (
		<Button
			type="button"
			variant="ghost"
			size="icon-sm"
			className="shrink-0 text-muted-foreground"
			aria-label={`Remove ${name}`}
			disabled={lineup.picks.length < 2}
			onClick={() => editor.removePick(lineup.id, index)}
		>
			<XIcon />
		</Button>
	);
	const choose = (agent: string, model: string | undefined) =>
		editor.setModel(lineup.id, index, agent, model);
	return (
		<li
			ref={setNodeRef}
			aria-label={name}
			style={{ transform: CSS.Translate.toString(transform), transition }}
			className={cn(
				"relative rounded-lg border bg-background",
				isDragging && "z-10 shadow-md",
			)}
		>
			{phone ? (
				<div className="flex gap-2 p-2.5">
					{grip}
					<div className="flex min-w-0 flex-1 flex-col gap-2">
						<div className="flex items-center gap-2">
							<AgentMark agent={pick.agent} className="size-5" />
							<span className="min-w-0 flex-1 truncate">
								<span className="text-muted-foreground">{names.agent}</span>{" "}
								<span className="font-semibold">{names.model}</span>
							</span>
							{remove}
						</div>
						<div className="grid grid-cols-2 gap-2">
							<ModelMenu
								editor={editor}
								lineup={lineup}
								label={`${name} model`}
								current={{ pick, index }}
								onPick={choose}
								trigger={
									<Button
										type="button"
										variant="outline"
										className="justify-between"
									/>
								}
							>
								Change model
								<ChevronRightIcon data-icon="inline-end" />
							</ModelMenu>
							{effort}
						</div>
					</div>
				</div>
			) : (
				<div className="flex items-center gap-3 p-2">
					{grip}
					<span className="w-4 text-center text-muted-foreground text-sm tabular-nums">
						{index + 1}
					</span>
					<ModelMenu
						editor={editor}
						lineup={lineup}
						label={`${name} model`}
						current={{ pick, index }}
						onPick={choose}
						trigger={
							<Button
								type="button"
								variant="outline"
								className="min-w-0 flex-1 justify-start gap-2"
							/>
						}
					>
						<AgentMark agent={pick.agent} />
						<span className="text-muted-foreground">{names.agent}</span>
						<span className="min-w-0 truncate font-semibold">
							{names.model}
						</span>
						<ChevronDownIcon
							data-icon="inline-end"
							className="ml-auto text-muted-foreground"
						/>
					</ModelMenu>
					{effort}
					{remove}
				</div>
			)}
		</li>
	);
}

/**
 * A menu of every agent's models with their marks, those another pick of
 * the lineup names already off, the current one ticked.
 */
function ModelMenu({
	editor,
	lineup,
	label,
	current,
	onPick,
	trigger,
	children,
}: {
	editor: RulesEditor;
	lineup: Lineup;
	label: string;
	/** The pick the menu changes, whose own model stays on; none to add one. */
	current?: { pick: AgentPick; index: number };
	onPick: (agent: string, model: string | undefined) => void;
	trigger: ReactElement;
	children: ReactNode;
}): JSX.Element {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger render={trigger} aria-label={label}>
				{children}
			</DropdownMenuTrigger>
			<DropdownMenuContent className="max-h-96 w-64">
				{editor.agents.map((agent) => (
					<DropdownMenuGroup key={agent.id}>
						<DropdownMenuLabel className="flex items-center gap-2">
							<AgentMark agent={agent.id} />
							{agent.name}
						</DropdownMenuLabel>
						{[{ id: undefined, name: "Default model" }, ...agent.models].map(
							(model) => {
								const on =
									current !== undefined &&
									current.pick.agent === agent.id &&
									current.pick.model === model.id;
								const named = editor.has(
									lineup.id,
									agent.id,
									model.id,
									current?.index,
								);
								return (
									<DropdownMenuItem
										key={model.id ?? "default"}
										disabled={named}
										onClick={() => onPick(agent.id, model.id)}
									>
										{model.name}
										{on && <CheckIcon className="ml-auto" />}
										{named && (
											<span className="ml-auto text-muted-foreground text-xs">
												agent already picked
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
