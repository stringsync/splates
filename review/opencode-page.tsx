import { useState } from "react";
import { createRoot } from "react-dom/client";
import { Button } from "../dev/components/ui/button";
import {
	NativeSelect,
	NativeSelectOption,
} from "../dev/components/ui/native-select";
import { ConversationFeed } from "../dev/conversation-feed";
import { SetupPage } from "../dev/setup-page";
import { SetupContext, useSetupState } from "../dev/setup-state";

const feed = new ConversationFeed();
function Review() {
	const setup = useSetupState(null);
	const [revision, setRevision] = useState(0);
	const [opened, setOpened] = useState<string | null>(null);
	return (
		<main className="mx-auto flex max-w-xl flex-col gap-4 p-4">
			<p className="text-sm">
				Fixture review · synthetic OpenCode 2.0.0 · no account, credentials or
				paid prompts. Console confirmation is simulated; do not open a real
				account.
			</p>
			<label htmlFor="fixture">Review scenario</label>
			<NativeSelect
				id="fixture"
				defaultValue="saved"
				onChange={async (event) => {
					await fetch("/fixture", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ scenario: event.target.value }),
					});
					setOpened(null);
					setup.settle(await (await fetch("/api/setup")).json());
					setRevision((value) => value + 1);
				}}
			>
				{[
					"saved",
					"fresh",
					"missing-login",
					"invalid-model",
					"conflict",
					"offline",
				].map((value) => (
					<NativeSelectOption key={value} value={value}>
						{value}
					</NativeSelectOption>
				))}
			</NativeSelect>
			{opened ? (
				<section className="flex flex-col gap-4">
					<h1>Empty OpenCode conversation</h1>
					<p>Selected main model: opencode-go/Main</p>
					<p>No prompt sent. This fixture cannot run inference.</p>
					<Button
						onClick={() => {
							setOpened(null);
							setup.refresh();
						}}
					>
						Return to setup
					</Button>
				</section>
			) : (
				<SetupContext value={setup}>
					<SetupPage key={revision} feed={feed} onOpen={setOpened} />
				</SetupContext>
			)}
		</main>
	);
}
const root = document.getElementById("root");
if (root) {
	createRoot(root).render(<Review />);
}
