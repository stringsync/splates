import {
	CircleCheckIcon,
	ExternalLinkIcon,
	LoaderCircleIcon,
} from "lucide-react";
import { type JSX, useId, useState } from "react";
import { Button, buttonVariants } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { cn } from "./lib/utils";
import type { StepPrompt } from "./ship-run-summary";

/** Every prompt button is the size of the Ships page's Next, easy on a phone. */
const PROMPT_BUTTON = "h-11 w-full";

/**
 * What a waiting step asks, opened under the ship's progress bar: Yes or No, a
 * sign-in link with its code, or a value to type. `onAnswer` sends the reply.
 */
export function ShipPromptCard({
	target,
	open,
	answering,
	onAnswer,
}: {
	/** The target whose step asks, named at the card's head. */
	target: string;
	open: StepPrompt;
	answering: boolean;
	onAnswer: (value: unknown) => void;
}): JSX.Element {
	const { prompt } = open;
	return (
		<section
			aria-label={`${target}: ${open.does} needs you`}
			className="flex flex-col gap-2 rounded-lg border bg-card p-3"
		>
			<div className="flex items-baseline gap-2">
				<span className="min-w-0 flex-1 truncate font-semibold text-sm">
					{target}
				</span>
				<span className="shrink-0 rounded border border-foreground/50 px-1.5 text-[11px]">
					needs you
				</span>
			</div>
			<span className="-mt-1.5 font-semibold text-muted-foreground text-xs uppercase">
				{prompt.kind === "link"
					? `Sign in at ${hostOf(prompt.url)}`
					: open.does}
			</span>
			{prompt.kind === "confirm" && (
				<>
					<p className="break-words text-sm">{prompt.question}</p>
					<div className="flex gap-2">
						<Button
							variant="outline"
							className={cn(PROMPT_BUTTON, "flex-1")}
							disabled={answering}
							onClick={() => onAnswer(false)}
						>
							No, stop
						</Button>
						<Button
							className={cn(PROMPT_BUTTON, "flex-1")}
							disabled={answering}
							onClick={() => onAnswer(true)}
						>
							Yes
						</Button>
					</div>
				</>
			)}
			{prompt.kind === "link" && (
				<>
					<p className="text-sm">{open.does}</p>
					<a
						href={outsideApp(prompt.url)}
						target="_blank"
						rel="noreferrer"
						className={cn(buttonVariants(), PROMPT_BUTTON)}
					>
						Open sign-in link
						<ExternalLinkIcon aria-hidden />
					</a>
					{prompt.code !== undefined && (
						<>
							<p className="text-muted-foreground text-xs">
								Check the page shows this code:
							</p>
							<p className="rounded-md border border-dashed py-2 text-center font-mono font-semibold text-2xl tracking-[0.2em]">
								{prompt.code}
							</p>
						</>
					)}
					<p className="flex items-center gap-1.5 text-muted-foreground text-xs">
						<LoaderCircleIcon aria-hidden className="size-3.5 animate-spin" />
						Waiting for you to finish signing in…
					</p>
					<p className="text-muted-foreground text-xs">
						Signed in but landed elsewhere, as happens when you were logged out?
						Tap the link above again: the site can drop the sign-in step after a
						fresh login.
					</p>
					<Button
						variant="outline"
						className={PROMPT_BUTTON}
						disabled={answering}
						onClick={() => onAnswer(true)}
					>
						I've signed in
					</Button>
				</>
			)}
			{prompt.kind === "ask" && (
				<AskForm
					question={prompt.question}
					answering={answering}
					onAnswer={onAnswer}
				/>
			)}
		</section>
	);
}

/** The value a step asks for, typed on the keyboard its question calls for. */
function AskForm({
	question,
	answering,
	onAnswer,
}: {
	question: string;
	answering: boolean;
	onAnswer: (value: string) => void;
}): JSX.Element {
	const [value, setValue] = useState("");
	const id = useId();
	const code = isCode(question);
	return (
		<form
			className="flex flex-col gap-2"
			onSubmit={(event) => {
				event.preventDefault();
				if (value !== "") {
					onAnswer(value);
				}
			}}
		>
			<label htmlFor={id} className="break-words text-sm">
				{question}
			</label>
			<Input
				id={id}
				value={value}
				onChange={(event) => setValue(event.target.value)}
				autoComplete={code ? "one-time-code" : "off"}
				inputMode={code ? "numeric" : "text"}
				className={code ? "h-12 font-mono text-xl tracking-[0.3em]" : "h-10"}
			/>
			<Button
				type="submit"
				className={PROMPT_BUTTON}
				disabled={answering || value === ""}
			>
				{code ? "Send code" : "Send"}
			</Button>
		</form>
	);
}

/** A sign-in link a running step went through, folded to one line. */
export function ShipSignedIn({ url }: { url: string }): JSX.Element {
	return (
		<p className="flex items-center gap-1.5 text-xs">
			<CircleCheckIcon aria-hidden className="size-3.5 text-green-600" />
			Signed in at {hostOf(url)}
		</p>
	);
}

/** Whether `question` asks for a one-time code, which takes a number pad. */
export function isCode(question: string): boolean {
	return /\b(one[- ]time|otp|2fa|mfa|code)\b/i.test(question);
}

/**
 * The href to give a link to `url` so it opens in Safari, where the user is
 * already signed in, even from the installed iOS web app.
 */
export function outsideApp(url: string): string {
	const standalone =
		typeof navigator !== "undefined" &&
		(navigator as Navigator & { standalone?: boolean }).standalone === true;
	return standalone ? `x-safari-${url}` : url;
}

function hostOf(url: string): string {
	try {
		return new URL(url).host;
	} catch {
		return url;
	}
}
