import type { FieldProgress } from "@splates/server/setup";
import type { FileDiff } from "@splates/server/tasks";
import {
	createContext,
	type JSX,
	useContext,
	useEffect,
	useState,
} from "react";
import { Alert, AlertDescription } from "#web/components/ui/alert.tsx";
import { Button } from "#web/components/ui/button.tsx";
import { Field, FieldLabel } from "#web/components/ui/field.tsx";
import { taskDiff } from "./api";
import { DiffFiles } from "./changes";
import { Markdown } from "./markdown";
import { restartIdle } from "./project-api";

type ConfigField = Extract<FieldProgress, { kind: "config" }>;

/** How the page has an agent change the config, and approve what it made. */
export interface ConfigChanges {
	/** Starts a conversation that makes `field`'s change, answering its id. */
	start(field: ConfigField): Promise<string>;
	/** Tells that conversation the person approved the diff, so it merges. */
	merge(conversation: string): Promise<void>;
	/** Opens that conversation. */
	open(conversation: string): void;
}

/** The page's config changes; null where no agent can be started. */
export const ConfigChangesContext = createContext<ConfigChanges | null>(null);

/** The conversation making each task's change, which outlives the field. */
const MAKING = new Map<string, string>();

/** How often a started task's diff is read again. */
const POLL_MS = 3000;

/**
 * A step's change to `splates.config.ts`, in three beats: an agent makes it
 * in a task, the task's diff shows to approve, and once it has landed the
 * field offers to restart `splates server`, which reads the config at start.
 */
export function ConfigChangeField({
	field,
	pollMs = POLL_MS,
}: {
	field: ConfigField;
	/** How often the task's diff is read again. */
	pollMs?: number;
}): JSX.Element {
	const changes = useContext(ConfigChangesContext);
	const [conversation, setConversation] = useState(
		MAKING.get(field.task) ?? null,
	);
	const [files, setFiles] = useState<FileDiff[]>([]);
	const [landed, setLanded] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [restarted, setRestarted] = useState(false);
	const [approved, setApproved] = useState(false);
	useEffect(() => {
		let stopped = false;
		let seen = false;
		const read = async () => {
			const now = await taskDiff(field.task).catch(() => null);
			if (stopped) {
				return;
			}
			if (now !== null && now.length > 0) {
				seen = true;
				setFiles(now);
			} else if (seen) {
				// The task's tree went with its merge.
				setFiles([]);
				setLanded(true);
			}
		};
		void read();
		const timer = setInterval(() => void read(), pollMs);
		return () => {
			stopped = true;
			clearInterval(timer);
		};
	}, [field.task, pollMs]);
	const fail = (failed: unknown) =>
		setError(failed instanceof Error ? failed.message : String(failed));
	return (
		<Field>
			<FieldLabel>{field.label}</FieldLabel>
			<p className="text-muted-foreground text-sm">
				<Markdown text={field.change} inline />
			</p>
			{files.length > 0 && <DiffFiles files={files} />}
			<div className="flex flex-wrap items-center gap-3">
				{conversation === null && files.length === 0 && !landed && (
					<Button
						type="button"
						variant="outline"
						disabled={changes === null}
						onClick={() => {
							setError(null);
							changes?.start(field).then((id) => {
								MAKING.set(field.task, id);
								setConversation(id);
							}, fail);
						}}
					>
						Have an agent make this change
					</Button>
				)}
				{files.length > 0 && conversation !== null && !approved && (
					<Button
						type="button"
						onClick={() => {
							setError(null);
							setApproved(true);
							changes?.merge(conversation).catch((failed: unknown) => {
								setApproved(false);
								fail(failed);
							});
						}}
					>
						Approve and merge
					</Button>
				)}
				{conversation !== null && !landed && (
					<Button
						type="button"
						variant="link"
						className="h-auto p-0 text-muted-foreground"
						onClick={() => changes?.open(conversation)}
					>
						Open the conversation
					</Button>
				)}
				{landed && !restarted && (
					<Button
						type="button"
						onClick={() => {
							setError(null);
							restartIdle().then(() => setRestarted(true), fail);
						}}
					>
						Restart server
					</Button>
				)}
			</div>
			{files.length > 0 && conversation === null && (
				<p className="text-muted-foreground text-sm">
					A task holds this change: open its conversation to approve it.
				</p>
			)}
			{landed && (
				<Alert>
					<AlertDescription>
						The change has landed. Restart `splates server` so it reads the
						config, then press Next.
					</AlertDescription>
				</Alert>
			)}
			{restarted && (
				<p role="status" className="text-muted-foreground text-sm">
					Restarting… press Next once the page is back.
				</p>
			)}
			{error !== null && (
				<p role="alert" className="text-destructive text-sm">
					{error}
				</p>
			)}
		</Field>
	);
}
