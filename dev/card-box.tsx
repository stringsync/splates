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
 * and mic show only while the box has the focus, the pointer, or a take
 * writing in it, so a card of several boxes stays quiet. A paste of files
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
	return <Box {...props} box={box} />;
}

function Box({
	onValue,
	files,
	roomy = false,
	className,
	box,
	...props
}: Props & { box: BoxDictation | null }): JSX.Element {
	const shell = useRef<HTMLDivElement>(null);
	return (
		<div
			ref={shell}
			className={cn(
				"group/box relative flex flex-col border border-border/70 bg-muted/30 transition-[background-color,border-color,box-shadow] duration-150 hover:border-border focus-within:border-ring focus-within:bg-background focus-within:ring-3 focus-within:ring-ring/20",
				roomy ? "rounded-xl" : "rounded-lg",
			)}
		>
			<div className="relative min-h-(--suffix-height)">
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
						LAST_LINE_ROOM,
						className,
					)}
				/>
				{box !== null ? (
					<MicSuffix box={box} files={files} roomy={roomy} shell={shell} />
				) : (
					files !== null && (
						<Suffix shown={false} roomy={roomy} shell={shell}>
							<AttachPlus files={files} />
						</Suffix>
					)
				)}
			</div>
			{box !== null && <DictationNotice by={box.by} />}
		</div>
	);
}

/**
 * Room for the suffix at the end of the text's last line, as wide as the
 * suffix, so the lines above run the box's full width. A last line ending in
 * a line break, as an empty box's does, keeps none: the room would sit on a
 * line of its own.
 */
const LAST_LINE_ROOM =
	"[&_p:last-child:not(:has(>br:last-child))]:after:inline-block [&_p:last-child:not(:has(>br:last-child))]:after:w-(--suffix-width)";

/**
 * The suffix of a box with a mic: the plus, or while a take writes in the
 * box, what the mic is doing, as the composer says it there, then the mic.
 */
function MicSuffix({
	box,
	files,
	roomy,
	shell,
}: {
	box: BoxDictation;
	files: Files | null;
	roomy: boolean;
	shell: RefObject<HTMLDivElement | null>;
}): JSX.Element {
	const taking = useReactive(box, (each) => each.taking, ["changed"]);
	return (
		<Suffix shown={taking} roomy={roomy} shell={shell}>
			{taking ? (
				<DictationStatus />
			) : (
				files !== null && <AttachPlus files={files} />
			)}
			<BoxMic box={box} />
		</Suffix>
	);
}

/**
 * A box's buttons in its bottom corner, beside its last line however many
 * it wraps to. Its room is kept whether it shows or not, so the focus that
 * shows it moves nothing; it shows while the box has the focus or `shown`.
 * Its size goes to the box's shell, for the room the last line keeps and
 * the height of a box of one line.
 */
function Suffix({
	shown,
	roomy,
	shell,
	children,
}: {
	shown: boolean;
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
				"absolute right-0 bottom-0 flex items-center transition-opacity duration-150",
				roomy ? "p-1.5" : "p-1",
				shown
					? "opacity-100"
					: "opacity-0 group-focus-within/box:opacity-100 group-hover/box:opacity-100",
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
