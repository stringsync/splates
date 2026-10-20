import { useReactive } from "@webappwiz/react";
import { type JSX, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import {
	Dialog,
	DialogContent,
	DialogTitle,
} from "#web/components/ui/dialog.tsx";
import { BoardGroomer } from "./board-groomer";
import { GroomerForm } from "./groomer-card";
import { Refusal } from "./refusal";

/** Starts the configured groomer, or lets the person choose its agent here. */
export function GroomUntriaged({ empty }: { empty: boolean }): JSX.Element {
	const [groomer] = useState(() => new BoardGroomer());
	const { picking, pending, refusal } = useReactive(
		groomer,
		(groomer) => ({
			picking: groomer.picking,
			pending: groomer.pending,
			refusal: groomer.refusal,
		}),
		["changed"],
	);
	return (
		<>
			<Button
				size="xs"
				variant="outline"
				disabled={empty || pending}
				onClick={() => void groomer.start()}
			>
				Groom
			</Button>
			<Refusal refusal={refusal} />
			<Dialog open={picking} onOpenChange={(open) => groomer.setPicking(open)}>
				<DialogContent>
					<DialogTitle>Groom Untriaged</DialogTitle>
					<GroomerForm
						pick={null}
						title="Choose the groomer"
						submit="Groom"
						onCancel={() => groomer.setPicking(false)}
						onSubmit={(pick) => void groomer.choose(pick)}
					/>
				</DialogContent>
			</Dialog>
		</>
	);
}
