import { useReactive, useResource } from "@webappwiz/react";
import { PlusIcon } from "lucide-react";
import {
	type JSX,
	type ReactNode,
	type RefObject,
	useContext,
	useEffect,
	useId,
	useRef,
} from "react";
import { ATTACH } from "#dev/components/assistant-ui/elements/attachment.aui.tsx";
import { TooltipIconButton } from "#dev/components/assistant-ui/elements/tooltip-icon-button.tsx";
import { cn } from "#dev/lib/utils.ts";
import { BoxDictation } from "./box-dictation";
import { BoxEditor, type BoxEditorProps } from "./box-editor";
import { BoxMic } from "./dictate-button";
import type { Dictation } from "./dictation";
import { DictationContext } from "./dictation-context";
import { DictationNotice, DictationStatus } from "./dictation-status";
import type { Files } from "./files";

type Props = Omit<BoxEditorProps, "inset"> & {
	/** Sized for a finger, as the one question on a phone's screen. */
	roomy?: boolean;
};

/**
 * A card's answer box as a small composer: the text, with a plus to attach
 * and the mic at its end, and under it the files attached to it. The plus
 * and mic show only while the box has the focus or pointer. During a take,
 * a full-width waveform and stop control replace the editor. A paste of files
 * attaches them, and `@` and `#` offer what the thread's composer does; what
 * is picked or attached is a chip in the words, as in the composer.
 */
export function CardBox(props: Props): JSX.Element {
	const dictation = useContext(DictationContext);
	return dictation === null ? (
		<Box {...props} box={null} />
	) : (
		<DictatedBox {...props} dictation={dictation} />
	);
}

function DictatedBox({
	dictation,
	...props
}: Props & { dictation: Dictation }): JSX.Element {
	const by = useId();
	// Read as the take writes, which can be long after this render.
	const value = useRef(props.value);
	value.current = props.value;
	const onValue = useRef(props.onValue);
	onValue.current = props.onValue;
	const box = useResource(
		() =>
			new BoxDictation(dictation, by, {
				read: () => value.current,
				write: (text) => onValue.current(text),
			}),
		[dictation, by],
	);
	const taking = useReactive(box, (each) => each.taking, ["changed"]);
	return <Box {...props} box={box} taking={taking} />;
}

function Box({
	onValue,
	files,
	roomy = false,
	className,
	box,
	taking = false,
	...props
}: Props & { box: BoxDictation | null; taking?: boolean }): JSX.Element {
	const shell = useRef<HTMLDivElement>(null);
	return (
		<div
			ref={shell}
			className={cn(
				"group/box relative flex flex-col border border-border/70 bg-muted/30 transition-[background-color,border-color,box-shadow] duration-150 hover:border-border focus-within:border-ring focus-within:bg-background focus-within:ring-3 focus-within:ring-ring/20",
				roomy ? "rounded-xl" : "rounded-lg",
			)}
		>
			<div hidden={taking} className="relative min-h-(--suffix-height)">
				<BoxEditor
					{...props}
					files={files}
					onValue={(text) => {
						onValue(text);
						box?.typed(text);
					}}
					inset={roomy ? "px-4" : "px-3"}
					className={cn(
						roomy ? "py-3 text-base" : "py-2 text-sm pointer-coarse:text-base",
						(box !== null || files !== null) && BUTTON_ROOM,
						className,
					)}
				/>
				{(box !== null || files !== null) && (
					<Suffix roomy={roomy} shell={shell}>
						{files !== null && <AttachPlus files={files} />}
						{box !== null && <BoxMic box={box} />}
					</Suffix>
				)}
			</div>
			{taking && box !== null && (
				<div
					className={cn("flex min-w-0 items-center", roomy ? "p-1.5" : "p-1")}
				>
					<DictationStatus expanded />
					<BoxMic box={box} />
				</div>
			)}
			{box !== null && <DictationNotice by={box.by} />}
		</div>
	);
}

/** Keep wrapped text clear of the buttons, including their full touch height. */
const BUTTON_ROOM = "pr-[calc(var(--suffix-width,0px)+0.75rem)]";

/**
 * A box's buttons in its bottom corner, beside its last line however many
 * it wraps to. Its room is kept whether it shows or not, so the focus that
 * shows it moves nothing; it shows while the box has focus or the pointer.
 * Its size goes to the box's shell, for the space the editor keeps and
 * the height of a box of one line.
 */
function Suffix({
	roomy,
	shell,
	children,
}: {
	roomy: boolean;
	shell: RefObject<HTMLDivElement | null>;
	children: ReactNode;
}): JSX.Element {
	const ref = useRef<HTMLDivElement>(null);
	useEffect(() => {
		const suffix = ref.current;
		const style = shell.current?.style;
		if (suffix === null || style === undefined) {
			return;
		}
		const measure = () => {
			style.setProperty("--suffix-width", `${suffix.offsetWidth}px`);
			style.setProperty("--suffix-height", `${suffix.offsetHeight}px`);
		};
		measure();
		const resized = new ResizeObserver(measure);
		resized.observe(suffix);
		return () => {
			resized.disconnect();
			style.removeProperty("--suffix-width");
			style.removeProperty("--suffix-height");
		};
	}, [shell]);
	return (
		<div
			ref={ref}
			className={cn(
				"absolute right-0 bottom-0 flex items-center opacity-0 transition-opacity duration-150 group-focus-within/box:opacity-100 group-hover/box:opacity-100",
				roomy ? "p-1.5" : "p-1",
			)}
		>
			{children}
		</div>
	);
}

/** The composer's plus, attaching to a box of its own. */
function AttachPlus({ files }: { files: Files }): JSX.Element {
	const picker = useRef<HTMLInputElement>(null);
	return (
		<>
			<TooltipIconButton
				tooltip="Attach files"
				side="bottom"
				type="button"
				variant="ghost"
				size="icon"
				aria-label="Attach files"
				onClick={() => picker.current?.click()}
				className={cn(
					ATTACH,
					"size-7 rounded-full text-muted-foreground hover:text-foreground pointer-coarse:size-11",
				)}
			>
				<PlusIcon className="size-4 pointer-coarse:size-5" />
			</TooltipIconButton>
			<input
				ref={picker}
				type="file"
				multiple
				hidden
				onChange={(event) => {
					files.add(event.target.files ?? []);
					event.target.value = "";
				}}
			/>
		</>
	);
}
