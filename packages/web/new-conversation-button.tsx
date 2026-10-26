import { PlusIcon } from "lucide-react";
import type { JSX } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { Kbd } from "#web/components/ui/kbd.tsx";
import { focusComposer } from "./composer-editor";
import { NEW } from "./conversation-address";
import { type Drafts, newDraft } from "./drafts";
import { useHeld } from "./hooks/use-held";
import {
	useHeldKey,
	useShortcut,
	useShortcutLabel,
} from "./hooks/use-shortcut";
import { useTouch } from "./hooks/use-touch";
import { shownProject } from "./project-places";
import type { Terminals } from "./terminals";

/** New, atop the sidebar: a click or the shortcut opens the page's project's new conversation already there, else a fresh one. */
export function NewConversation({
	drafts,
	terminals,
	onOpen,
}: {
	drafts: Drafts;
	terminals: Terminals;
	onOpen: (id: string | null) => void;
}): JSX.Element {
	const held = useHeld();
	const touch = useTouch();
	const another = () => {
		const key = newDraft(shownProject());
		const place =
			drafts.isOpen(key) || drafts.holds(key)
				? (drafts.placeOf(key) ?? NEW)
				: NEW;
		// On a new conversation already, nothing mounts to focus its composer.
		const there = location.hash.startsWith(`#conversations/${NEW}`);
		onOpen(place);
		if (there && !touch) {
			focusComposer();
		}
	};
	useShortcut("shortcuts.new", another);
	const newKey = useHeldKey("shortcuts.new");
	const shortcut = useShortcutLabel("shortcuts.new");
	useShortcut("shortcuts.newTerminal", () => onOpen(terminals.another()));
	return (
		<Button
			variant="outline"
			className="mt-2 mb-3 h-10 flex-none justify-start gap-2.5 px-3"
			title={shortcut ?? undefined}
			onClick={another}
		>
			<PlusIcon data-icon="inline-start" />
			<span className="flex-1 text-left">New</span>
			{held && newKey !== null && <Kbd aria-hidden>{newKey}</Kbd>}
		</Button>
	);
}
