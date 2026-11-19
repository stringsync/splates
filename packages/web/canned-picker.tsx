import { useReactive } from "core/react";
import { MessageSquareTextIcon } from "lucide-react";
import type { JSX } from "react";
import { TooltipIconButton } from "#web/components/assistant-ui/elements/tooltip-icon-button.tsx";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "#web/components/ui/dropdown-menu.tsx";
import { canned } from "./canned-responses";

/** A button listing canned replies; a pick is handed to `onPick`, which adds it. */
export function CannedPicker({
	onPick,
}: {
	onPick: (reply: string) => void;
}): JSX.Element {
	const groups = useReactive(canned, (store) => store.get(), ["changed"]);
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={
					<TooltipIconButton
						tooltip="Canned replies"
						side="bottom"
						type="button"
						variant="ghost"
						size="icon"
						aria-label="Canned replies"
						className="size-7 rounded-full text-muted-foreground hover:text-foreground pointer-coarse:size-11"
					>
						<MessageSquareTextIcon className="size-4 pointer-coarse:size-5" />
					</TooltipIconButton>
				}
			/>
			<DropdownMenuContent
				align="end"
				className="w-80 max-w-[calc(100vw-2rem)]"
			>
				{groups
					.filter((group) => group.replies.length > 0)
					.map((group, index) => (
						<DropdownMenuGroup key={group.label}>
							{index > 0 && <DropdownMenuSeparator />}
							<DropdownMenuLabel>{group.label}</DropdownMenuLabel>
							{group.replies.map((reply) => (
								<DropdownMenuItem
									key={reply}
									className="items-start py-2 pointer-coarse:py-3"
									onClick={() => onPick(reply)}
								>
									{reply}
								</DropdownMenuItem>
							))}
						</DropdownMenuGroup>
					))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
