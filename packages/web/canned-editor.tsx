import { useReactive } from "core/react";
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, XIcon } from "lucide-react";
import type { JSX } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { Input } from "#web/components/ui/input.tsx";
import { type CannedGroup, canned } from "./canned-responses";

/** Add, rename, reorder and remove canned reply groups and the replies in them. */
export function CannedEditor(): JSX.Element {
	const { groups, edited } = useReactive(
		canned,
		(store) => ({ groups: store.get(), edited: store.edited }),
		["changed"],
	);
	const save = (next: readonly CannedGroup[]) => canned.set(next);
	const edit = (index: number, group: CannedGroup) =>
		save(groups.map((other, i) => (i === index ? group : other)));

	return (
		<div className="flex flex-col gap-4">
			<div className="flex items-center justify-between gap-2">
				<p className="text-muted-foreground text-xs">
					Replies the answer box offers with one tap.
				</p>
				<Button
					variant="outline"
					size="sm"
					disabled={!edited}
					onClick={() => canned.reset()}
				>
					Reset to default
				</Button>
			</div>
			{groups.map((group, gi) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: edited in place by position
				<div key={gi} className="flex flex-col gap-2 rounded-md border p-3">
					<div className="flex items-center gap-1">
						<Input
							aria-label="Group name"
							value={group.label}
							onChange={(event) =>
								edit(gi, { ...group, label: event.target.value })
							}
							className="font-medium"
						/>
						<Button
							variant="ghost"
							size="icon"
							aria-label="Move group up"
							disabled={gi === 0}
							onClick={() => save(move(groups, gi, gi - 1))}
						>
							<ArrowUpIcon />
						</Button>
						<Button
							variant="ghost"
							size="icon"
							aria-label="Move group down"
							disabled={gi === groups.length - 1}
							onClick={() => save(move(groups, gi, gi + 1))}
						>
							<ArrowDownIcon />
						</Button>
						<Button
							variant="ghost"
							size="icon"
							aria-label="Remove group"
							onClick={() => save(groups.filter((_, i) => i !== gi))}
						>
							<XIcon />
						</Button>
					</div>
					{group.replies.map((reply, ri) => (
						// biome-ignore lint/suspicious/noArrayIndexKey: edited in place by position
						<div key={ri} className="flex items-start gap-1">
							<textarea
								aria-label="Reply"
								value={reply}
								rows={2}
								onChange={(event) =>
									edit(gi, {
										...group,
										replies: group.replies.map((other, i) =>
											i === ri ? event.target.value : other,
										),
									})
								}
								className="min-h-9 flex-1 resize-y rounded-md border bg-transparent px-2.5 py-1.5 text-sm"
							/>
							<div className="flex flex-col">
								<Button
									variant="ghost"
									size="icon-xs"
									aria-label="Move reply up"
									disabled={ri === 0}
									onClick={() =>
										edit(gi, {
											...group,
											replies: move(group.replies, ri, ri - 1),
										})
									}
								>
									<ArrowUpIcon />
								</Button>
								<Button
									variant="ghost"
									size="icon-xs"
									aria-label="Move reply down"
									disabled={ri === group.replies.length - 1}
									onClick={() =>
										edit(gi, {
											...group,
											replies: move(group.replies, ri, ri + 1),
										})
									}
								>
									<ArrowDownIcon />
								</Button>
							</div>
							<Button
								variant="ghost"
								size="icon"
								aria-label="Remove reply"
								onClick={() =>
									edit(gi, {
										...group,
										replies: group.replies.filter((_, i) => i !== ri),
									})
								}
							>
								<XIcon />
							</Button>
						</div>
					))}
					<Button
						variant="outline"
						size="sm"
						className="self-start"
						onClick={() =>
							edit(gi, { ...group, replies: [...group.replies, ""] })
						}
					>
						<PlusIcon /> Add reply
					</Button>
				</div>
			))}
			<Button
				variant="outline"
				size="sm"
				className="self-start"
				onClick={() => save([...groups, { label: "New group", replies: [] }])}
			>
				<PlusIcon /> Add group
			</Button>
		</div>
	);
}

function move<T>(list: readonly T[], from: number, to: number): T[] {
	const next = [...list];
	const [item] = next.splice(from, 1);
	next.splice(to, 0, item as T);
	return next;
}

/** Whether the Settings category `category` is the canned replies and a search for `query` finds them. */
export function matchesCanned(category: string, query: string): boolean {
	return (
		category === "Canned replies" &&
		(query === "" || "canned replies".includes(query.toLowerCase()))
	);
}
