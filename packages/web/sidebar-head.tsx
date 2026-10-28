import type { Snapshot } from "@stringsync/splates-server/tasks";
import { useReactive } from "@webappwiz/react";
import { PanelLeftCloseIcon, PanelLeftOpenIcon } from "lucide-react";
import { type JSX, useEffect, useRef } from "react";
import { useShortcutLabel } from "#web/hooks/use-shortcut.ts";
import { cn } from "#web/lib/utils.ts";
import { SlotMark } from "./app-header";
import { ProjectSwitcher } from "./projects";
import type { Sidebar } from "./sidebar";
import { BarButton, TITLE } from "./top-bar";

/** Heads the sidebar with its server, project context, and visibility control. */
export function SidebarHead({
	snapshot,
	sidebar,
	name,
	scoped,
}: {
	snapshot: Snapshot | null;
	sidebar: Sidebar;
	/** The project's name. */
	name: string;
	/** Whether the page's own bar names the project. */
	scoped: boolean;
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
			{scoped ? (
				<h1 className={cn(TITLE, "truncate")}>splates</h1>
			) : (
				<ProjectSwitcher
					name={name}
					path={false}
					className="mx-0 min-w-0 flex-1"
				/>
			)}
			<BarButton
				label={key === null ? label : `${label} (${key})`}
				onClick={() => sidebar.toggle()}
			>
				{shown ? <PanelLeftCloseIcon /> : <PanelLeftOpenIcon />}
			</BarButton>
		</header>
	);
}
