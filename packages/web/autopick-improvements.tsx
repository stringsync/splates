import { ArrowDownIcon, SendIcon } from "lucide-react";
import { type JSX, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import {
	dismissAutopickImprovements,
	sendAutopickImprovements,
} from "./autopick-api";
import { PageSection } from "./page-section";
import {
	refreshAutopickImprovements,
	useAutopickImprovements,
} from "./use-autopick-improvements";

/** Render on the Autopick page to offer its possible improvements to an agent, or Dismiss them; renders nothing while there are none. */
export function AutopickImprovements(): JSX.Element | null {
	// It names nothing: the board task it sends carries the lineups, cells and
	// numbers. A dismissed or sent set stays hidden until what is flagged changes.
	const improvements = useAutopickImprovements();
	const [sent, setSent] = useState<number | null>(null);
	const [busy, setBusy] = useState(false);
	const [refused, setRefused] = useState<string | null>(null);
	if (sent === null && (improvements === null || improvements.count === 0)) {
		return null;
	}
	const respond = async (action: "send" | "dismiss") => {
		setBusy(true);
		setRefused(null);
		try {
			if (action === "send") {
				setSent(await sendAutopickImprovements());
			} else if (improvements !== null) {
				await dismissAutopickImprovements(improvements.key);
			}
			await refreshAutopickImprovements();
		} catch (error) {
			setRefused(error instanceof Error ? error.message : String(error));
		} finally {
			setBusy(false);
		}
	};
	return (
		<PageSection title="Possible improvements">
			<div className="flex flex-wrap items-center gap-3.5 rounded-lg border border-warning/35 bg-warning/10 px-4 py-3.5">
				<span className="flex size-8 flex-none items-center justify-center rounded-lg bg-warning/20 text-warning">
					<ArrowDownIcon aria-hidden className="size-4" />
				</span>
				<div className="min-w-40 flex-1">
					<p className="font-medium text-sm">
						Autopick found possible improvements
					</p>
					<p className="text-muted-foreground text-xs">
						An agent can review them and propose changes to the rules.
					</p>
					{refused !== null && (
						<p role="alert" className="text-destructive text-xs">
							{refused}
						</p>
					)}
				</div>
				<div className="ml-auto flex items-center gap-2">
					{sent === null ? (
						<>
							<Button
								size="sm"
								disabled={busy}
								onClick={() => void respond("send")}
							>
								<SendIcon aria-hidden data-icon="inline-start" />
								Send to agent
							</Button>
							<Button
								size="sm"
								variant="outline"
								disabled={busy}
								onClick={() => void respond("dismiss")}
							>
								Dismiss
							</Button>
						</>
					) : (
						<span className="text-muted-foreground text-sm">
							Sent as task #{sent}
						</span>
					)}
				</div>
			</div>
		</PageSection>
	);
}
