import { useReactive, useResource } from "@webappwiz/react";
import { PlusIcon } from "lucide-react";
import {
	type ComponentProps,
	type JSX,
	type ReactNode,
	useContext,
	useEffect,
	useId,
	useRef,
	useState,
} from "react";
import { ATTACH } from "#dev/components/assistant-ui/elements/attachment.aui.tsx";
import { TooltipIconButton } from "#dev/components/assistant-ui/elements/tooltip-icon-button.tsx";
import { cn } from "#dev/lib/utils.ts";
import { BoxDictation } from "./box-dictation";
import { useThreadSources } from "./box-references";
import { BoxMic } from "./dictate-button";
import type { Dictation } from "./dictation";
import { DictationContext } from "./dictation-context";
import { DictationNotice, DictationStatus } from "./dictation-status";
import { FileList, type Files } from "./files";
import { Mentions, useMentions } from "./mentions";

type Props = Omit<ComponentProps<"textarea">, "value" | "onChange"> & {
	value: string;
	onValue: (text: string) => void;
	/** Where what is attached to it goes; null where a reply carries no files. */
	files: Files | null;
	/** Sized for a finger, as the one question on a phone's screen. */
	roomy?: boolean;
};

/**
 * A card's answer box as a small composer: the text, with a plus to attach
 * and the mic at its end, and under it the files attached to it. The plus
 * and mic show only while the box has the focus, the pointer, or a take
 * writing in it, so a card of several boxes stays quiet. A paste of files
 * attaches them, and `@` and `#` offer what the thread's composer does.
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
	ref,
	onKeyDown,
	...props
}: Props & { box: BoxDictation | null }): JSX.Element {
	const inset = roomy ? "px-4" : "px-3";
	const typed = useBoxMentions(value, onValue);
	return (
		<div
			className={cn(
				"group/box relative flex flex-col border border-border/70 bg-muted/30 transition-[background-color,border-color,box-shadow] duration-150 hover:border-border focus-within:border-ring focus-within:bg-background focus-within:ring-3 focus-within:ring-ring/20",
				roomy ? "rounded-xl" : "rounded-lg",
			)}
		>
			<div className="flex items-end">
				<textarea
					{...props}
					ref={(textarea) => {
						typed.ref.current = textarea;
						if (typeof ref === "function") {
							ref(textarea);
						} else if (ref != null) {
							ref.current = textarea;
						}
					}}
					value={value}
					onChange={(event) => {
						typed.onChange(event);
						box?.typed(event.target.value);
					}}
					onSelect={typed.onSelect}
					onClick={typed.onClick}
					onKeyDown={(event) => {
						if (!typed.onKeyDown(event)) {
							onKeyDown?.(event);
						}
					}}
					onPaste={(event) => files?.paste(event)}
					className={cn(
						"field-sizing-content min-w-0 flex-1 resize-none bg-transparent outline-none placeholder:text-muted-foreground/70",
						inset,
						roomy ? "py-3 text-base" : "py-2 text-sm pointer-coarse:text-base",
						className,
					)}
				/>
				{box !== null ? (
					<MicSuffix box={box} files={files} roomy={roomy} />
				) : (
					files !== null && (
						<Suffix shown={false} roomy={roomy}>
							<AttachPlus files={files} />
						</Suffix>
					)
				)}
			</div>
			{box !== null && <DictationNotice by={box.by} />}
			{files !== null && <Attached files={files} inset={inset} />}
			{typed.menu}
		</div>
	);
}

/**
 * The box's words as `Mentions` reads them, for the `@` and `#` the thread
 * offers, kept to `value`, which a take or a draft writes too: a pick from
 * the list is written through `onValue`.
 */
function useBoxMentions(value: string, onValue: (text: string) => void) {
	const sources = useThreadSources();
	const [mentions] = useState(() => new Mentions(sources, value));
	const typed = useMentions<HTMLTextAreaElement>(mentions);
	const told = useRef(onValue);
	told.current = onValue;
	const shown = useRef(value);
	shown.current = value;
	useEffect(() => {
		if (mentions.text !== value) {
			mentions.write(value, typed.ref.current?.selectionStart ?? value.length);
		}
	}, [mentions, value, typed.ref]);
	useEffect(
		() =>
			mentions.events.on("changed", () => {
				if (mentions.text !== shown.current) {
					told.current(mentions.text);
				}
			}),
		[mentions],
	);
	return typed;
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
		<div className={cn(inset, "pb-2")}>
			<FileList files={files} />
		</div>
	) : null;
}

/**
 * The suffix of a box with a mic: the plus, or while a take writes in the
 * box, what the mic is doing, as the composer says it there, then the mic.
 */
function MicSuffix({
	box,
	files,
	roomy,
}: {
	box: BoxDictation;
	files: Files | null;
	roomy: boolean;
}): JSX.Element {
	const taking = useReactive(box, (each) => each.taking, ["changed"]);
	return (
		<Suffix shown={taking} roomy={roomy}>
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
 * A box's buttons at the end of its text, beside its last line however many
 * it wraps to. Its room is kept whether it shows or not, so the focus that
 * shows it moves nothing; it shows while the box has the focus or `shown`.
 */
function Suffix({
	shown,
	roomy,
	children,
}: {
	shown: boolean;
	roomy: boolean;
	children: ReactNode;
}): JSX.Element {
	return (
		<div
			className={cn(
				"flex shrink-0 items-center transition-opacity duration-150",
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
