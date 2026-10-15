import { useReactive, useResource } from "@webappwiz/react";
import { PlusIcon } from "lucide-react";
import {
	type ComponentProps,
	type JSX,
	type ReactNode,
	useContext,
	useId,
	useRef,
} from "react";
import { ATTACH } from "#dev/components/assistant-ui/elements/attachment.aui.tsx";
import { TooltipIconButton } from "#dev/components/assistant-ui/elements/tooltip-icon-button.tsx";
import { cn } from "#dev/lib/utils.ts";
import { BoxDictation } from "./box-dictation";
import { BoxMic } from "./dictate-button";
import type { Dictation } from "./dictation";
import { DictationContext } from "./dictation-context";
import { DictationNotice, DictationStatus } from "./dictation-status";
import { FileList, type Files } from "./files";

type Props = Omit<ComponentProps<"textarea">, "value" | "onChange"> & {
	value: string;
	onValue: (text: string) => void;
	/** Where what is attached to it goes; null where a reply carries no files. */
	files: Files | null;
	/** Sized for a finger, as the one question on a phone's screen. */
	roomy?: boolean;
};

/**
 * A card's answer box as a small composer: the text, the files attached to
 * it, and under them a row with a plus to attach on the left and the mic on
 * the right, as in the composer. The row shows only while the box has the
 * focus or a take writes in it, so a card of several boxes shows one row at
 * most. A paste of files attaches them.
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
	value,
	onValue,
	files,
	roomy = false,
	className,
	box,
	...props
}: Props & { box: BoxDictation | null }): JSX.Element {
	const inset = roomy ? "px-4" : "px-3";
	return (
		<div
			className={cn(
				"group/box flex flex-col border border-border/70 bg-muted/30 transition-[background-color,border-color,box-shadow] duration-150 hover:border-border focus-within:border-ring focus-within:bg-background focus-within:ring-3 focus-within:ring-ring/20",
				roomy ? "rounded-xl" : "rounded-lg",
			)}
		>
			<textarea
				{...props}
				value={value}
				onChange={(event) => {
					onValue(event.target.value);
					box?.typed(event.target.value);
				}}
				onPaste={(event) => files?.paste(event)}
				className={cn(
					"field-sizing-content w-full resize-none bg-transparent outline-none placeholder:text-muted-foreground/70",
					inset,
					roomy ? "py-3 text-base" : "py-2 text-sm pointer-coarse:text-base",
					className,
				)}
			/>
			{files !== null && <Attached files={files} inset={inset} />}
			{box !== null ? (
				<>
					<DictationNotice by={box.by} />
					<MicRow box={box} files={files} />
				</>
			) : (
				files !== null && (
					<Row shown={false}>
						<AttachPlus files={files} />
					</Row>
				)
			)}
		</div>
	);
}

/** The files attached to a box, once it holds any. */
function Attached({
	files,
	inset,
}: {
	files: Files;
	inset: string;
}): JSX.Element | null {
	const any = useReactive(files, (each) => each.files.length > 0, ["changed"]);
	return any ? (
		<div className={cn(inset, "pt-1 pb-2")}>
			<FileList files={files} />
		</div>
	) : null;
}

/**
 * The row of a box with a mic: the plus on the left, or while a take writes
 * in the box, what the mic is doing, as the composer says it there.
 */
function MicRow({
	box,
	files,
}: {
	box: BoxDictation;
	files: Files | null;
}): JSX.Element {
	const taking = useReactive(box, (each) => each.taking, ["changed"]);
	return (
		<Row shown={taking}>
			{taking ? (
				<DictationStatus />
			) : (
				files !== null && <AttachPlus files={files} />
			)}
			{/* On the right, with or without the plus. */}
			<div className="ml-auto flex">
				<BoxMic box={box} />
			</div>
		</Row>
	);
}

/** A box's row under its text, while the box has the focus or `shown`. */
function Row({
	shown,
	children,
}: {
	shown: boolean;
	children: ReactNode;
}): JSX.Element {
	return (
		<div
			className={cn(
				"items-center gap-2 px-1.5 pb-1.5",
				shown ? "flex" : "hidden group-focus-within/box:flex",
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
