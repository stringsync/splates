import {
	type HTMLAttributes,
	type RefObject,
	useLayoutEffect,
	useRef,
	useState,
} from "react";

/**
 * Lines of an initial or user message shown before it is clicked open: four on
 * a wider screen and twelve on a phone.
 */
export const CLAMP = "max-h-24 max-sm:max-h-[12lh]";

/** Where a cut message fades: its last lines. */
export const CUT_FADE =
	"[mask-image:linear-gradient(to_bottom,black_calc(100%-2.5rem),transparent)]";

/**
 * Clamps a message body to `CLAMP` until toggled open, reporting whether it
 * overflows (`more`), whether it is open (`open`), and button props for the
 * container that toggles it while leaving inner links and buttons alone.
 */
export function useClamped(_watch: string): {
	ref: RefObject<HTMLDivElement | null>;
	open: boolean;
	more: boolean;
	interactive: boolean;
	triggerProps: Pick<
		HTMLAttributes<HTMLElement>,
		| "role"
		| "tabIndex"
		| "aria-expanded"
		| "aria-label"
		| "onClick"
		| "onKeyDown"
	>;
} {
	const ref = useRef<HTMLDivElement>(null);
	const [open, setOpen] = useState(false);
	const [more, setMore] = useState(false);
	useLayoutEffect(() => {
		const box = ref.current;
		if (box === null) {
			return;
		}
		const measure = () => setMore(box.scrollHeight > box.clientHeight + 1);
		measure();
		const watching = new ResizeObserver(measure);
		watching.observe(box);
		return () => watching.disconnect();
	}, []);
	const interactive = more || open;
	const toggle = () => interactive && setOpen(!open);
	return {
		ref,
		open,
		more,
		interactive,
		triggerProps: {
			role: interactive ? "button" : undefined,
			tabIndex: interactive ? 0 : undefined,
			"aria-expanded": interactive ? open : undefined,
			"aria-label": interactive ? (open ? "Show less" : "Show all") : undefined,
			// A link or a button in the words, such as a code block's copy,
			// does its own thing rather than open or close the message.
			onClick: (event) =>
				event.target instanceof Element &&
				event.target.closest("a, button") !== null
					? undefined
					: toggle(),
			onKeyDown: (event) => {
				if (event.key === "Enter" || event.key === " ") {
					event.preventDefault();
					toggle();
				}
			},
		},
	};
}
