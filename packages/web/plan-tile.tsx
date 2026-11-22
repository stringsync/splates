import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { goalLine } from "@splates/server/plans/browser";
import { useReactive } from "core/react";
import {
	ChevronRightIcon,
	ExternalLinkIcon,
	FileTextIcon,
	PencilIcon,
	XIcon,
} from "lucide-react";
import { type JSX, type ReactNode, useContext, useRef, useState } from "react";
import { Button, buttonVariants } from "#web/components/ui/button.tsx";
import { cn } from "#web/lib/utils.ts";
import type { Annotation } from "./annotation";
import { type CardRecord, cardRecord } from "./before-after";
import type { Shown } from "./lightbox";
import { MarkList } from "./mark-notes";
import { MergeCardContext } from "./merge-card";
import {
	CommentButton,
	CommentList,
	type PlanComment,
	usePlanSelection,
} from "./plan-comments";
import { PlanMarkup } from "./plan-markup";
import { capturePlan, type PlanMarkups } from "./plan-markups";
import { PlanRecord } from "./plan-record";
import { PlanText } from "./plan-text";

/** A control on the dark around the plan, in either theme, as the lightbox's. */
const LIGHT = "text-white hover:bg-white/15 hover:text-white";

/** What a plan is called where it shows: its task, and what the task is for. */
export interface PlanName {
	/** The task's slug; null outside a task. */
	slug: string | null;
	/** The first line of the task's After; null when it says nothing yet. */
	brief: string | null;
}

/** The plan of the task the open thread runs in, by its slug and After line. */
export function usePlanName(): PlanName {
	const task = useContext(MergeCardContext)?.task ?? null;
	return {
		slug: task?.task ?? null,
		brief: task?.plan == null ? null : goalLine(task.plan),
	};
}

/** The open thread's task as a plan in text, its Before and After; null with none. */
export function usePlanRecord(): CardRecord | null {
	return cardRecord(useContext(MergeCardContext)?.task?.plan);
}

/**
 * The plan an approval question asks about, inside the question. With a
 * plan page, a live thumbnail of it, named for its task; click it to open
 * the page. Without one, a line naming the task says there is no full plan.
 */
export function PlanTile({
	name,
	page,
	onOpen,
}: {
	name: PlanName;
	/** The plan's page; null when the agent made none. */
	page: Shown | null;
	onOpen: () => void;
}): JSX.Element {
	// With no page, the plan is the task's Before and After as text.
	const record = usePlanRecord();
	const slug = (
		<>
			<FileTextIcon className="size-4 shrink-0 text-muted-foreground" />
			<span className="min-w-0 flex-1 truncate font-mono text-[13px]">
				{name.slug ?? "Plan"}
			</span>
		</>
	);
	if (page === null && record !== null) {
		return (
			<button
				type="button"
				aria-label="open plan"
				onClick={onOpen}
				className="mt-1 flex w-full cursor-pointer items-center gap-2.5 rounded-lg border border-border/70 bg-muted/30 px-3 py-2 text-left transition-colors hover:border-border focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
			>
				{slug}
				<span className="flex shrink-0 items-center gap-0.5 font-medium text-xs">
					Read plan
					<ChevronRightIcon className="size-3.5" />
				</span>
			</button>
		);
	}
	if (page === null) {
		return (
			<section
				aria-label="plan"
				className="flex w-full items-center gap-2.5 rounded-lg border border-border/70 bg-muted/30 px-3 py-2"
			>
				{slug}
				<span className="shrink-0 text-muted-foreground text-xs">
					No full plan
				</span>
			</section>
		);
	}
	return (
		<button
			type="button"
			aria-label="open plan"
			onClick={onOpen}
			className="relative h-36 w-full cursor-pointer overflow-hidden rounded-lg border border-border/70 bg-white text-left transition-colors hover:border-border focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
		>
			<iframe
				src={page.url}
				title={`${name.slug ?? "plan"} preview`}
				aria-hidden
				// As sandboxed as the lightbox's frame, so a page its scripts draw
				// shows; pointer events off, so it is a picture to click.
				sandbox="allow-scripts"
				referrerPolicy="no-referrer"
				loading="lazy"
				tabIndex={-1}
				className="pointer-events-none absolute top-0 left-0 h-[360px] w-[250%] origin-top-left scale-40 border-0"
			/>
			<span className="absolute inset-x-0 bottom-0 flex items-center gap-2.5 border-border/70 border-t bg-card/95 px-3 py-2 text-card-foreground">
				{slug}
				<span className="flex shrink-0 items-center gap-0.5 font-medium text-xs">
					Open plan
					<ChevronRightIcon className="size-3.5" />
				</span>
			</span>
		</button>
	);
}

/**
 * Opens a plan's page in the lightbox while `open`, titled with its task and
 * brief, with `questions` under it to answer there; `onClose` closes it.
 */
export function PlanLightbox({
	page,
	name,
	open,
	onClose,
	questions,
	onReference,
	comments,
	onComments,
	markups,
}: {
	page: Shown | null;
	markups: PlanMarkups;
	name: PlanName;
	open: boolean;
	onClose: () => void;
	/** The card's questions and its Send, answered as one with the card. */
	questions: ReactNode;
	/** Adds a saved review's `#rec:<name>` to the answer. */
	onReference: (reference: string) => void;
	/** The comments made on the page, kept here, sent with the answer. */
	comments: PlanComment[];
	onComments: (next: PlanComment[]) => void;
}): JSX.Element {
	const frame = useRef<HTMLIFrameElement>(null);
	const [active, setActive] = useState<Annotation | null>(null);
	const [capturing, setCapturing] = useState(false);
	const [captureError, setCaptureError] = useState<string | null>(null);
	const annotations = useReactive(markups, (each) => [...each.annotations], [
		"changed",
	]);
	const capture = async () => {
		if (frame.current === null || capturing) {
			return;
		}
		setCapturing(true);
		setCaptureError(null);
		try {
			setActive(await markups.add(await capturePlan(frame.current)));
		} catch (error) {
			setCaptureError(
				error instanceof Error ? error.message : "Could not capture the plan.",
			);
		} finally {
			setCapturing(false);
		}
	};
	const record = usePlanRecord();
	const [selection, clearSelection] = usePlanSelection(frame, open);
	// The questions sit outside the page's frame, so the page cannot answer them.
	return (
		<DialogPrimitive.Root
			open={open}
			onOpenChange={(next) => {
				if (!next) {
					onClose();
				}
			}}
		>
			<DialogPrimitive.Portal>
				<DialogPrimitive.Backdrop
					forceRender
					className="fixed inset-0 z-50 bg-black duration-150 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0"
				/>
				<DialogPrimitive.Popup
					data-slot="lightbox"
					onClick={(event) => {
						if (event.target === event.currentTarget) {
							onClose();
						}
					}}
					className="fixed inset-0 z-50 flex flex-col items-center gap-3 px-3 pt-[max(0.75rem,env(safe-area-inset-top))] pb-[max(0.75rem,env(safe-area-inset-bottom))] text-white outline-none duration-150 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 sm:px-6"
				>
					<div className="flex w-full max-w-5xl shrink-0 items-start gap-3">
						<div className="flex min-w-0 flex-1 flex-col">
							<DialogPrimitive.Title className="truncate font-medium font-mono text-sm">
								{name.slug ?? page?.alt ?? "plan"}
							</DialogPrimitive.Title>
							{name.brief !== null && (
								<DialogPrimitive.Description className="line-clamp-2 text-sm text-white/70">
									{name.brief}
								</DialogPrimitive.Description>
							)}
						</div>
						<div className="flex shrink-0 items-center gap-1 rounded-md bg-black/60">
							{page !== null && (
								<>
									<Button
										variant="ghost"
										size="sm"
										className={LIGHT}
										aria-label="Markup"
										disabled={capturing || active !== null}
										onClick={() => void capture()}
									>
										<PencilIcon />
										<span className="hidden sm:inline">
											{capturing ? "Capturing…" : "Markup"}
										</span>
									</Button>
									<PlanRecord
										url={page.url}
										open={open}
										onReference={onReference}
									/>
									<a
										href={page.url}
										target="_blank"
										rel="noreferrer"
										aria-label="open in a new tab"
										className={cn(
											buttonVariants({ variant: "ghost", size: "icon-sm" }),
											LIGHT,
										)}
									>
										<ExternalLinkIcon />
									</a>
								</>
							)}
							<DialogPrimitive.Close
								render={
									<Button
										variant="ghost"
										size="icon-sm"
										aria-label="close"
										className={LIGHT}
									/>
								}
							>
								<XIcon />
							</DialogPrimitive.Close>
						</div>
					</div>
					{page === null ? (
						record !== null && (
							<PlanText
								record={record}
								comments={comments}
								onComments={onComments}
							/>
						)
					) : (
						<div className="relative flex min-h-0 w-full max-w-5xl flex-1 flex-col gap-3 md:flex-row">
							<div className="relative min-h-0 flex-1">
								<iframe
									ref={frame}
									key={page.url}
									// Asks the page to report what is selected in it.
									src={`${page.url}${page.url.includes("?") ? "&" : "?"}select`}
									title={name.slug ?? page?.alt ?? "plan"}
									// Scripts and nothing more, as any page an agent made.
									sandbox="allow-scripts"
									referrerPolicy="no-referrer"
									className={cn(
										"size-full rounded-md bg-white",
										active !== null && "invisible",
									)}
								/>
								{active !== null && (
									<PlanMarkup
										annotation={active}
										onLive={() => {
											active.select(null);
											setActive(null);
										}}
									/>
								)}
								{captureError !== null && (
									<p
										role="alert"
										className="absolute bottom-2 left-2 rounded bg-red-950 p-2 text-sm text-white"
									>
										{captureError}
									</p>
								)}
								{active === null && selection !== null && (
									<CommentButton
										selection={selection}
										onComment={() => {
											onComments([
												...comments,
												{ quote: selection.text, note: "" },
											]);
											clearSelection();
										}}
									/>
								)}
							</div>
							<div className="flex max-h-44 shrink-0 flex-col gap-3 overflow-y-auto md:max-h-none md:w-64">
								<CommentList
									comments={comments}
									onChange={onComments}
									className="flex shrink-0 flex-col gap-1.5"
								/>
								{annotations.map((annotation, at) => (
									<section
										// biome-ignore lint/suspicious/noArrayIndexKey: captures only append until the reply clears all
										key={at}
										className="flex shrink-0 flex-col gap-1.5"
									>
										<Button
											variant="ghost"
											size="sm"
											className={LIGHT}
											onClick={() => setActive(annotation)}
										>
											Markup {at + 1} · Edit
										</Button>
										<MarkList annotation={annotation} />
									</section>
								))}
							</div>
						</div>
					)}
					<div
						ref={toFoot}
						className="max-h-[70%] w-full max-w-5xl shrink-0 overflow-y-auto rounded-md bg-card text-card-foreground"
					>
						{questions}
					</div>
				</DialogPrimitive.Popup>
			</DialogPrimitive.Portal>
		</DialogPrimitive.Root>
	);
}

/** Opens the questions at their foot, where the approval question and Send sit. */
function toFoot(panel: HTMLDivElement | null): void {
	if (panel !== null) {
		panel.scrollTop = panel.scrollHeight;
	}
}
