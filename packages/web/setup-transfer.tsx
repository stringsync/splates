import { useReactive } from "@webappwiz/react";
import { DownloadIcon, UploadIcon } from "lucide-react";
import { type JSX, useRef, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { Field, FieldLabel } from "#web/components/ui/field.tsx";
import { Switch } from "#web/components/ui/switch.tsx";
import { exportUrl } from "./api";
import { type ImportState, SetupImport } from "./setup-import";

/**
 * Moving this project's tasks, conversations and the machine's agent
 * settings to another machine, or bringing them here, as `splates config`
 * does: first on a machine set up for the first time, last otherwise.
 */
export function SetupTransfer({ fresh }: { fresh: boolean }): JSX.Element {
	const [conversations, setConversations] = useState(true);
	const [flow] = useState(() => new SetupImport());
	const { importing, busy } = useReactive(
		flow,
		(flow) => ({ importing: flow.state, busy: flow.busy }),
		["changed"],
	);
	const picker = useRef<HTMLInputElement>(null);

	return (
		<section
			aria-label="move to another machine"
			className="flex flex-col gap-3 rounded-lg border bg-card p-4"
		>
			<div className="flex flex-col gap-1">
				<h2 className="font-medium">
					{fresh ? "Coming from another machine?" : "Move to another machine"}
				</h2>
				<p className="text-muted-foreground text-sm">
					{fresh
						? "Import the file you exported there to bring its tasks, conversations, agents and Auto pick rules here, instead of setting them up again."
						: "Export this project's tasks and conversations, with your agents and Auto pick rules, as one file to import on the other machine."}{" "}
					No cred's value goes with it: the import asks for each again on the{" "}
					<a href="#creds" className="underline">
						Creds page
					</a>
					.
				</p>
			</div>
			<div className="flex flex-wrap items-center gap-3">
				<Button
					variant="outline"
					size="sm"
					nativeButton={false}
					render={<a href={exportUrl(conversations)} download />}
				>
					<DownloadIcon aria-hidden /> Export
				</Button>
				<Field orientation="horizontal" className="w-auto">
					<Switch
						id="export-conversations"
						checked={conversations}
						onCheckedChange={setConversations}
					/>
					<FieldLabel htmlFor="export-conversations">
						Include conversations
					</FieldLabel>
				</Field>
				<Button
					variant="outline"
					size="sm"
					disabled={busy}
					onClick={() => picker.current?.click()}
				>
					<UploadIcon aria-hidden />
					Import
				</Button>
				<input
					ref={picker}
					type="file"
					accept="application/json,.json"
					hidden
					aria-label="Export file to import"
					onChange={(event) => {
						const file = event.target.files?.[0];
						event.target.value = "";
						if (file !== undefined) {
							void flow.choose(file);
						}
					}}
				/>
			</div>
			<ImportLine
				importing={importing}
				onOverwrite={() => void flow.overwrite()}
				onCancel={() => flow.cancel()}
			/>
		</section>
	);
}

/** What the import last did, under the buttons. */
function ImportLine({
	importing,
	onOverwrite,
	onCancel,
}: {
	importing: ImportState;
	onOverwrite: () => void;
	onCancel: () => void;
}): JSX.Element | null {
	switch (importing.kind) {
		case "idle":
			return null;
		case "sending":
			return (
				<p role="status" className="text-muted-foreground text-sm">
					Sending the file… {Math.round(importing.share * 100)}%
				</p>
			);
		case "importing":
			return (
				<p role="status" className="text-muted-foreground text-sm">
					Importing…
				</p>
			);
		case "failed":
			return (
				<p role="alert" className="text-destructive text-sm">
					{importing.message}
				</p>
			);
		case "done":
			return (
				<p role="status" className="text-sm">
					Imported {importing.written} file
					{importing.written === 1 ? "" : "s"}.
					{importing.kept > 0 &&
						` ${importing.kept} conversation file${importing.kept === 1 ? "" : "s"} already here stayed as ${importing.kept === 1 ? "it was" : "they were"}.`}
					{importing.asked.length > 0 && (
						<>
							{" "}
							Fill in {importing.asked.join(", ")} on the{" "}
							<a href="#creds" className="underline">
								Creds page
							</a>
							.
						</>
					)}
				</p>
			);
		case "conflicts":
			return (
				<div role="alert" className="flex flex-col gap-2 text-sm">
					<p>
						These files here differ from the export. Overwriting them loses what
						is here:
					</p>
					<ul className="list-disc pl-5 font-mono text-xs">
						{importing.conflicts.map((each) => (
							<li key={each}>{each}</li>
						))}
					</ul>
					<div className="flex gap-2">
						<Button variant="destructive" size="sm" onClick={onOverwrite}>
							Overwrite these
						</Button>
						<Button variant="ghost" size="sm" onClick={onCancel}>
							Cancel
						</Button>
					</div>
				</div>
			);
	}
}
