import { PlusIcon } from "lucide-react";
import { type JSX, useContext } from "react";
import { UuidProvider } from "webappwiz/id";
import { Button } from "#web/components/ui/button.tsx";
import { Kbd } from "#web/components/ui/kbd.tsx";
import { NEW, withDraft } from "./conversation-address";
import { type Drafts, newDraft } from "./drafts";
import { useHeld } from "./hooks/use-held";
import {
	useHeldKey,
	useShortcut,
	useShortcutLabel,
} from "./hooks/use-shortcut";
import { lastProject, ShownRoot, useOpenNew } from "./new-conversation-project";
import { shownProject } from "./project-places";
import type { Terminals } from "./terminals";

const ids = new UuidProvider();

/** New, atop the sidebar: each click or shortcut opens a fresh conversation. */
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
	const openNew = useOpenNew(onOpen);
	const root = useContext(ShownRoot);
	const another = () => {
		const last = lastProject();
		const shown = shownProject();
		const project =
			last === null ||
			root === null ||
			last.root === root ||
			last.slug === shown
				? shown
				: last.slug;
		const key = newDraft(project);
		openNew(
			drafts.isOpen(key) || drafts.holds(key)
				? withDraft(NEW, ids.next())
				: NEW,
		);
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
