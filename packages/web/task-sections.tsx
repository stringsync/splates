import type { JSX, ReactNode } from "react";
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "#web/components/ui/tabs.tsx";

/*
 * The shape every task's dialog takes, whether opened from the task list or
 * as a card from the board, so the two read the same.
 */

/**
 * A steady height on a wide screen, so moving between tabs keeps the footer
 * where it is.
 */
export const TASK_DIALOG =
	"max-h-[85dvh] grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)_auto] gap-3 sm:h-[min(34rem,85dvh)] sm:max-w-2xl";

/**
 * The dialog on a phone: a sheet up from the bottom edge, within a thumb's
 * reach, its footer clear of the home indicator.
 */
export const PHONE_SHEET =
	"max-md:top-auto max-md:bottom-0 max-md:max-h-[90dvh] max-md:max-w-full max-md:-translate-y-0 max-md:rounded-b-none max-md:data-closed:slide-out-to-bottom max-md:data-open:slide-in-from-bottom max-md:data-closed:zoom-out-100 max-md:data-open:zoom-in-100 max-md:[&_[data-slot=dialog-footer]]:pb-[max(1rem,env(safe-area-inset-bottom))]";

/**
 * A task dialog's tabs under its header: `tabs`, each a `SectionTab`, in a
 * line, and `children`, a `Section` for each.
 */
export function SectionTabs({
	value,
	onValueChange,
	tabs,
	children,
}: {
	value: string;
	onValueChange: (value: string) => void;
	tabs: ReactNode;
	children: ReactNode;
}): JSX.Element {
	return (
		<Tabs
			value={value}
			onValueChange={(next: string) => onValueChange(next)}
			className="-mx-4 min-h-0 gap-0"
		>
			<TabsList
				variant="line"
				aria-label="sections"
				className="h-9! w-full justify-start gap-3 rounded-none border-b px-4 py-0 max-md:h-11!"
			>
				{tabs}
			</TabsList>
			{children}
		</Tabs>
	);
}

/** A tab of a task's dialog, as the board's todo dialog has too. */
export function SectionTab({
	value,
	children,
}: {
	value: string;
	children: ReactNode;
}): JSX.Element {
	return (
		<TabsTrigger
			value={value}
			className="flex-none px-0 text-xs group-data-horizontal/tabs:after:bottom-[-1.5px]"
		>
			{children}
		</TabsTrigger>
	);
}

/** What a `SectionTab` shows, scrolling on its own under the header. */
export function Section({
	value,
	keepMounted = false,
	children,
}: {
	value: string;
	/** Whether it keeps its state while another tab shows, as what is written in a card. */
	keepMounted?: boolean;
	children: ReactNode;
}): JSX.Element {
	return (
		<TabsContent
			value={value}
			keepMounted={keepMounted}
			className="min-h-0 overflow-y-auto px-4 pt-3 pb-1 data-[hidden]:hidden"
		>
			{children}
		</TabsContent>
	);
}

/** How pressing where a task stands is, as its label's color says. */
export type Tone = "waiting" | "ready" | "working" | "failed" | "quiet";

/** The label's colors for each tone. */
export const TONES: Record<Tone, string> = {
	waiting: "bg-warning/15 text-warning",
	ready: "bg-success/15 text-success",
	working: "bg-primary/10 text-primary",
	failed: "bg-destructive/10 text-destructive",
	quiet: "bg-muted text-muted-foreground",
};

/** What splates knows of a task beside its SPLATES.md, a row each, its Details tab. */
export function FactList({
	facts,
}: {
	facts: [string, ReactNode][];
}): JSX.Element {
	return (
		<dl
			aria-label="about the task"
			className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-xs"
		>
			{facts.map(([name, fact]) => (
				<div key={name} className="contents">
					<dt className="text-muted-foreground">{name}</dt>
					<dd className="min-w-0 tabular-nums">{fact}</dd>
				</div>
			))}
		</dl>
	);
}
