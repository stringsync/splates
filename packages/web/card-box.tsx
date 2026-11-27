import { useReactive, useResource } from "core/react";
import { PlusIcon, XIcon } from "lucide-react";
import {
	type JSX,
	type ReactNode,
	type RefObject,
	useContext,
	useEffect,
	useId,
	useLayoutEffect,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import { ATTACH } from "#web/components/assistant-ui/elements/attachment.aui.tsx";
import { TooltipIconButton } from "#web/components/assistant-ui/elements/tooltip-icon-button.tsx";
import { cn } from "#web/lib/utils.ts";
import { BoxDictation } from "./box-dictation";
import { BoxEditor, type BoxEditorProps, caretToEnd } from "./box-editor";
import { CannedPicker } from "./canned-picker";
import { withCanned } from "./canned-responses";
import { ReplyContext } from "./card-reply";
import { BoxMic } from "./dictate-button";
import { COMPOSER, type Dictation } from "./dictation";
import { DictationContext } from "./dictation-context";
import { DictationNotice, DictationStatus } from "./dictation-status";
import type { Files } from "./files";

type Props = Omit<BoxEditorProps, "inset"> & {
	/** Sized for a finger, as the one question on a phone's screen. */
	roomy?: boolean;
	/** Stable owner id for dictation, when a parent watches this box's take. */
	dictationOwner?: string;
};

/**
 * A card's answer box: type, paste files, dictate, or add a canned reply
 * from its buttons. Pass `files` to allow attachments and `roomy` on a phone.
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
	dictationOwner,
	...props
}: Props & { dictation: Dictation }): JSX.Element {
	const generated = useId();
	const by = dictationOwner ?? generated;
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
	// The reply carries it to the agent, as the composer's does.
	const dictated = useContext(ReplyContext)?.dictated;
	useEffect(() => {
		if (taking) {
			dictated?.();
		}
	}, [taking, dictated]);
	return <Box {...props} box={box} taking={taking} />;
}

function Box({
	onValue,
	value,
	files,
	roomy = false,
	dictationOwner: _dictationOwner,
	className,
	box,
	taking = false,
	...props
}: Props & { box: BoxDictation | null; taking?: boolean }): JSX.Element {
	const shell = useRef<HTMLDivElement>(null);
	const below = useBelow(shell, value);
	// A take makes the editor inert, which drops its focus; once the take is
	// done the box has it back, caret after the words, so Enter and the arrows
	// work as before. Skipped when the person has moved the focus elsewhere.
	const wasTaking = useRef(false);
	useEffect(() => {
		const done = wasTaking.current && !taking;
		wasTaking.current = taking;
		if (!done) {
			return;
		}
		const active = document.activeElement;
		if (
			active !== null &&
			active !== document.body &&
			!shell.current?.contains(active)
		) {
			return;
		}
		const frame = requestAnimationFrame(() => {
			const editor = shell.current?.querySelector<HTMLElement>(
				"[contenteditable=true]",
			);
			editor?.focus();
			if (editor) {
				caretToEnd(editor);
			}
		});
		return () => cancelAnimationFrame(frame);
	}, [taking]);
	return (
		<div
			ref={shell}
			data-dictation-owner={taking && box !== null ? box.by : undefined}
			className={cn(
				"group/box relative flex flex-col border border-border/70 bg-muted/30 transition-[background-color,border-color,box-shadow] duration-150 hover:border-border focus-within:border-ring focus-within:bg-background focus-within:ring-3 focus-within:ring-ring/20",
				roomy ? "rounded-xl" : "rounded-lg",
			)}
		>
			<div className="relative">
				{/* Kept in place under a take, hidden, so the box holds its height. */}
				<div
					inert={taking}
					aria-hidden={taking || undefined}
					className={cn(
						"relative grid items-center",
						!below && "min-h-(--suffix-height)",
						taking && "invisible",
					)}
				>
					<BoxEditor
						{...props}
						value={value}
						files={files}
						onValue={(text) => {
							onValue(text);
							if (box !== null) {
								box.typed(text);
							}
						}}
						inset={roomy ? "px-4" : "px-3"}
						className={cn(
							roomy
								? "py-3 text-base"
								: "py-2 text-sm pointer-coarse:text-base",
							!below && BUTTON_ROOM,
							className,
						)}
					/>
					<Suffix roomy={roomy} shell={shell} below={below} taking={taking}>
						{files !== null && <AttachPlus files={files} />}
						<CannedPicker
							onPick={(reply) => onValue(withCanned(value, reply))}
						/>
						{box !== null && <BoxMic box={box} />}
					</Suffix>
				</div>
				{taking && box !== null && (
					<div
						className={cn(
							"absolute inset-x-0 flex min-w-0 items-center",
							// Centered in a one-line box, as the buttons it covers are.
							below ? "bottom-0" : "inset-y-0",
							roomy ? "p-1.5" : "p-1",
						)}
					>
						<TooltipIconButton
							tooltip="Discard dictation"
							side="bottom"
							type="button"
							variant="ghost"
							size="icon"
							className="size-7 shrink-0 rounded-full pointer-coarse:size-11"
							aria-label="Discard dictation"
							onClick={() => box.dictation.cancel()}
						>
							<XIcon aria-hidden="true" />
						</TooltipIconButton>
						<DictationStatus expanded />
						<BoxMic box={box} />
					</div>
				)}
			</div>
			{box !== null && <DictationNotice by={box.by} />}
		</div>
	);
}

/**
 * Whether the text spans more than one line, so the buttons take a row of
 * their own under it. With one line they share it. The editor is narrower
 * with the buttons beside it, so once below, the text goes back beside them
 * only when it would fit one line there, which keeps the box from flipping.
 */
function useBelow(shell: RefObject<HTMLDivElement | null>, value: string) {
	const [below, setBelow] = useState(false);
	// biome-ignore lint/correctness/useExhaustiveDependencies: re-measure when the text changes
	useLayoutEffect(() => {
		const root = shell.current;
		const editor = root?.querySelector<HTMLElement>("[contenteditable=true]");
		if (!root || !editor) {
			return;
		}
		const measure = () => {
			if (!editor.textContent) {
				setBelow(false);
				return;
			}
			const style = getComputedStyle(editor);
			const line = Number.parseFloat(style.lineHeight) || 20;
			const padding =
				Number.parseFloat(style.paddingTop) +
				Number.parseFloat(style.paddingBottom);
			const lines = Math.round((editor.scrollHeight - padding) / line);
			if (lines > 1 || editor.textContent?.includes("\n")) {
				setBelow(true);
				return;
			}
			if (!below) {
				return;
			}
			const buttons = root.style.getPropertyValue("--suffix-width");
			const range = document.createRange();
			range.selectNodeContents(editor);
			const text = range.getBoundingClientRect().width;
			const room =
				editor.clientWidth -
				Number.parseFloat(style.paddingLeft) -
				Number.parseFloat(style.paddingRight) -
				(Number.parseFloat(buttons) || 0);
			setBelow(text > room);
		};
		measure();
		const resized = new ResizeObserver(measure);
		resized.observe(editor);
		return () => resized.disconnect();
	}, [shell, value, below]);
	return below;
}

/** Keep wrapped text clear of the buttons, including their full touch height. */
const BUTTON_ROOM = "pr-[calc(var(--suffix-width,0px)+0.75rem)]";

/**
 * A box's buttons in its bottom corner, beside its last line however many
 * it wraps to. Its room is kept whether it shows or not, so the focus that
 * shows it moves nothing; it shows while the box has focus or the pointer, and always on a touch screen.
 * Its size goes to the box's shell, for the space the editor keeps and
 * the height of a box of one line.
 */
function Suffix({
	roomy,
	shell,
	below,
	taking,
	children,
}: {
	roomy: boolean;
	below: boolean;
	/** Dictation covers the buttons, so they stay out of sight, touch screen or not. */
	taking: boolean;
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
				"flex items-center opacity-0 transition-opacity duration-150 group-focus-within/box:opacity-100 group-hover/box:opacity-100 pointer-coarse:opacity-100",
				taking &&
					"opacity-0! group-focus-within/box:opacity-0! group-hover/box:opacity-0! pointer-coarse:opacity-0! transition-none",
				below
					? "col-start-1 row-start-2 justify-end"
					: "absolute inset-y-0 right-0",
				roomy ? "p-1.5" : "p-1",
			)}
		>
			{children}
		</div>
	);
}

/** The composer's plus, attaching to a box of its own. */
export function AttachPlus({ files }: { files: Files }): JSX.Element {
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

/** Finish the card's take before navigation can remove its answer box. */
export function useCardDictationTurn(
	panel: RefObject<HTMLElement | null>,
): (move: () => void) => void {
	const dictation = useContext(DictationContext);
	const turning = useRef(false);
	return (move) => {
		if (turning.current) {
			return;
		}
		const taking = panel.current?.querySelector<HTMLElement>(
			"[data-dictation-owner]",
		);
		if (
			dictation !== null &&
			taking?.dataset.dictationOwner === dictation.owner
		) {
			turning.current = true;
			void dictation.finish().then(() => {
				turning.current = false;
				move();
			});
		} else {
			move();
		}
	};
}

/**
 * Whether a box's take is under way, rather than the composer's: its words
 * are not in the box until it finishes, so an empty card can still send.
 * Pass `owner` to watch one specific box's take.
 */
export function useBoxTaking(owner?: string): boolean {
	const dictation = useContext(DictationContext);
	return useSyncExternalStore(
		(changed) => dictation?.events.on("changed", changed) ?? (() => {}),
		() =>
			dictation !== null &&
			(owner === undefined
				? dictation.owner !== COMPOSER
				: dictation.owner === owner) &&
			["asking", "opening", "recording", "finishing"].includes(
				dictation.state.phase,
			),
	);
}
