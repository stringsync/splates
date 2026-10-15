import { useReactive } from "@webappwiz/react";
import { PanelLeftCloseIcon, PanelLeftOpenIcon } from "lucide-react";
import { type JSX, useEffect, useRef } from "react";
import { useShortcutLabel } from "#dev/hooks/use-shortcut.ts";
import { cn } from "#dev/lib/utils.ts";
import type { Snapshot } from "../snapshot";
import { SlotMark } from "./app-header";
import { ProjectSwitcher } from "./projects";
import type { Sidebar } from "./sidebar";
import { BarButton } from "./top-bar";

/**
 * Heads the sidebar, floating at its top over the row of bars: which slot
 * this is, the project switcher, cut short within the sidebar's width, and
 * right of it the button that hides or shows the sidebar, as ⌘B does. It
 * stays once the sidebar hides, and tells the bars how wide it is, so they
 * start clear of it.
 */
export function SidebarHead({
	name,
	snapshot,
	sidebar,
}: {
	name: string;
	snapshot: Snapshot | null;
	sidebar: Sidebar;
}): JSX.Element {
	const { shown } = useReactive(
		sidebar,
		(sidebar) => ({ shown: sidebar.shown }),
		["changed"],
	);
	const key = useShortcutLabel("shortcuts.sidebar");
	const ref = useRef<HTMLElement>(null);
	useEffect(() => {
		const head = ref.current;
		if (head === null) {
			return;
		}
		const root = document.documentElement.style;
		const measure = () =>
			root.setProperty("--top-bar-start", `${head.offsetWidth}px`);
		measure();
		const resized = new ResizeObserver(measure);
		resized.observe(head);
		return () => {
			resized.disconnect();
			root.removeProperty("--top-bar-start");
		};
	}, []);
	const label = shown ? "Hide sidebar" : "Show sidebar";
	return (
		<header
			ref={ref}
			className={cn(
				"fixed top-0 left-0 z-50 flex h-(--top-bar-height) max-w-(--sidebar-width) items-center gap-2 pr-2 pl-6",
				shown && "w-(--sidebar-width)",
			)}
		>
			<SlotMark snapshot={snapshot} />
			<ProjectSwitcher name={name} />
			<BarButton
				label={key === null ? label : `${label} (${key})`}
				onClick={() => sidebar.toggle()}
			>
				{shown ? <PanelLeftCloseIcon /> : <PanelLeftOpenIcon />}
			</BarButton>
		</header>
	);
}
