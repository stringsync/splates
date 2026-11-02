import {
	BACKLOG_LANE,
	type BoardRecord,
	DEFAULT_BOARD,
} from "@splates/server/board/browser";
import { type JSX, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#web/components/ui/dialog.tsx";
import {
	NativeSelect,
	NativeSelectOption,
} from "#web/components/ui/native-select.tsx";

/** Confirm board deletion and choose where its lanes move. Pass a null board to close the dialog. */
export function DeleteBoard({
	board,
	others,
	lanes,
	count,
	onClose,
	onArchive,
	onDelete,
}: {
	board: BoardRecord | null;
	others: BoardRecord[];
	lanes: number[];
	count: number;
	onClose: () => void;
	onArchive: (board: BoardRecord) => void;
	onDelete: (board: BoardRecord, to: number, lanes: number[]) => Promise<void>;
}): JSX.Element {
	const [to, setTo] = useState(DEFAULT_BOARD);
	const moving = lanes.filter((each) => each !== BACKLOG_LANE);
	const target = others.some((each) => each.id === to)
		? to
		: (others[0]?.id ?? DEFAULT_BOARD);
	return (
		<Dialog open={board !== null} onOpenChange={(next) => !next && onClose()}>
			<DialogContent showCloseButton={false}>
				<DialogHeader>
					<DialogTitle>Delete {board?.name}?</DialogTitle>
					<DialogDescription>
						{moving.length === 0
							? "It has no lanes."
							: `It holds ${moving.length} lane${moving.length === 1 ? "" : "s"} with ${count} task${count === 1 ? "" : "s"}. They move to the board below; archive it instead to keep it as it is.`}
					</DialogDescription>
				</DialogHeader>
				{moving.length === 0 ? null : (
					<div className="flex items-center gap-2 text-sm">
						<span>Move lanes to</span>
						<NativeSelect
							aria-label="Move lanes to"
							value={target}
							onChange={(event) => setTo(Number(event.target.value))}
						>
							{others.map((each) => (
								<NativeSelectOption key={each.id} value={each.id}>
									{each.name}
								</NativeSelectOption>
							))}
						</NativeSelect>
					</div>
				)}
				<DialogFooter>
					<DialogClose render={<Button variant="outline" />}>
						Cancel
					</DialogClose>
					<Button
						variant="outline"
						onClick={() => {
							if (board !== null) {
								onArchive(board);
							}
							onClose();
						}}
					>
						Archive instead
					</Button>
					<Button
						variant="destructive"
						onClick={() => {
							if (board !== null) {
								void onDelete(board, target, moving);
							}
							onClose();
						}}
					>
						Delete board
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
