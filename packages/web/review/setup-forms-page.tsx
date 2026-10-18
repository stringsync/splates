import type { AreaProgress } from "@stringsync/splates-server/setup";
import { type JSX, useState } from "react";
import { createRoot } from "react-dom/client";
import { Button } from "../components/ui/button";
import { Field, FieldLabel } from "../components/ui/field";
import { Input } from "../components/ui/input";
import {
	NativeSelect,
	NativeSelectOption,
} from "../components/ui/native-select";
import { Switch } from "../components/ui/switch";
import {
	CredField,
	JourneyDone,
	type NextState,
	SetupIndex,
	StepForm,
} from "../setup-form";

/** An area with `done` of `steps` steps done, for the index. */
function area(id: string, title: string, done: number, steps: number) {
	return {
		id,
		title,
		done,
		skipped: 0,
		left: steps - done,
		steps: Array.from({ length: steps }, () => ({})),
	} as unknown as AreaProgress;
}
const AREAS = [
	area("opencode", "OpenCode", 4, 4),
	area("claude", "Claude", 2, 2),
	area("codex", "Codex", 0, 2),
	area("remote-access", "Remote access", 1, 3),
	area("notifications", "Notifications", 0, 2),
	area("dictation", "Dictation", 1, 1),
];
const leave = () => {};
const agent = () => {};

/** Each screen the design shows, by its `?screen=` name. */
const SCREENS: Record<string, () => JSX.Element> = {
	index: () => <SetupIndex areas={AREAS} onSelect={leave} />,
	cred: () => (
		<Form
			title="Paste your OpenCode Go API key"
			why="splates keeps it, and hands OpenCode its own copy."
			at={2}
			of={4}
		>
			<CredField
				name="OPENCODE_GO_API_KEY"
				label="API key"
				help={
					<>
						Make one under API keys in the{" "}
						<a href="https://opencode.ai/auth">OpenCode Console</a>.
					</>
				}
			/>
		</Form>
	),
	select: () => (
		<Form
			title="Choose models"
			why="The main model does the work; the small one names and sums up."
			at={3}
			of={4}
		>
			<Field>
				<FieldLabel htmlFor="main">Main model</FieldLabel>
				<NativeSelect id="main" defaultValue="kimi">
					<NativeSelectOption value="kimi">Kimi K2.6</NativeSelectOption>
					<NativeSelectOption value="glm">GLM-5.1</NativeSelectOption>
				</NativeSelect>
			</Field>
			<Field>
				<FieldLabel htmlFor="small">Small model</FieldLabel>
				<NativeSelect id="small" defaultValue="minimax">
					<NativeSelectOption value="minimax">MiniMax M2.7</NativeSelectOption>
				</NativeSelect>
			</Field>
			<Field orientation="horizontal">
				<Switch id="balance" />
				<FieldLabel htmlFor="balance">
					"Use balance" is off in my OpenCode Console
				</FieldLabel>
			</Field>
		</Form>
	),
	text: () => (
		<Form
			title="Where should splates live?"
			why="A host on your Cloudflare zone, and who may sign in to it."
			at={2}
			of={3}
		>
			<Field>
				<FieldLabel htmlFor="host">Host</FieldLabel>
				<Input id="host" placeholder="splates.example.com" />
			</Field>
			<Field>
				<FieldLabel htmlFor="emails">Emails that may sign in</FieldLabel>
				<Input id="emails" placeholder="you@example.com" />
			</Field>
		</Form>
	),
	working: () => (
		<Form
			title="Install OpenCode"
			why="splates runs OpenCode from your PATH."
			at={1}
			of={4}
			next={{ kind: "working", doing: "Installing OpenCode with npm…" }}
		/>
	),
	failed: () => (
		<Form
			title="Install Claude Code and sign in"
			why={
				<>
					Run <code>npm i -g @anthropic-ai/claude-code</code>, then{" "}
					<code>claude</code> once to sign in.
				</>
			}
			at={1}
			of={2}
			next={{
				kind: "failed",
				problem: "Claude Code is installed but not signed in.",
			}}
		/>
	),
	done: () => (
		<JourneyDone title="OpenCode" onLeave={leave}>
			<Button>Start an OpenCode conversation</Button>
		</JourneyDone>
	),
};

function Form({
	next: start = { kind: "ready" },
	...props
}: {
	title: string;
	why: JSX.Element | string;
	at: number;
	of: number;
	next?: NextState;
	children?: JSX.Element | JSX.Element[];
}): JSX.Element {
	// Next works for a second, then passes, so the screens can be clicked through.
	const [next, setNext] = useState<NextState>(start);
	return (
		<StepForm
			{...props}
			next={next}
			onNext={() => {
				setNext({ kind: "working" });
				setTimeout(() => setNext({ kind: "ready" }), 1000);
			}}
			onAgent={agent}
			onLeave={leave}
		/>
	);
}

const screen = new URLSearchParams(location.search).get("screen") ?? "index";
const root = document.getElementById("root");
if (root) {
	createRoot(root).render(
		<main style={{ padding: "2rem 1rem" }}>
			{(SCREENS[screen] ?? SCREENS.index)?.()}
		</main>,
	);
}
