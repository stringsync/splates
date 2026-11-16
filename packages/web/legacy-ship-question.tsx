import { useReactive } from "core/react";
import { type JSX, useState } from "react";
import { Button } from "./components/ui/button";
import { ShipQuestionAnswer } from "./legacy-ship-question-answer";
/** Answer a running ship’s question to continue or stop it. */
export function ShipQuestion({
	id,
	project,
	started,
	question,
}: {
	id: string;
	project: string;
	started: string;
	question: {
		questionId: string;
		question: string;
		link?: string;
		code?: string;
	};
}): JSX.Element {
	const [controller] = useState(
		() =>
			new ShipQuestionAnswer({
				id,
				project,
				started,
				questionId: question.questionId,
			}),
	);
	const { pending, error } = useReactive(
		controller,
		(source) => ({ pending: source.pending, error: source.error }),
		["changed"],
	);
	const { link, code } = question;
	const signIn = link !== undefined && code !== undefined;
	return (
		<section
			className="my-2 ml-5 flex flex-col gap-3 rounded-md border p-3"
			aria-label={question.question}
		>
			<p className="text-sm font-medium">{question.question}</p>
			{signIn ? (
				<>
					<p className="font-mono text-lg tracking-widest">{code}</p>
					<div className="flex items-center gap-3">
						<Button
							size="sm"
							variant="outline"
							onClick={() => window.open(link, "_blank", "noreferrer")}
						>
							Open
						</Button>
						<p className="text-sm text-muted-foreground">
							Waiting for you to sign in. The ship continues by itself.
						</p>
					</div>
				</>
			) : (
				<>
					<p className="text-sm text-muted-foreground">
						{pending
							? "Sending your answer…"
							: "The ship waits for your answer."}
					</p>
					<div className="flex gap-2">
						<Button
							size="sm"
							variant="outline"
							disabled={pending}
							onClick={() => void controller.send(true)}
						>
							Yes
						</Button>
						<Button
							size="sm"
							variant="outline"
							disabled={pending}
							onClick={() => void controller.send(false)}
						>
							No
						</Button>
					</div>
				</>
			)}
			{error && (
				<p role="alert" className="text-sm text-destructive">
					{error}
				</p>
			)}
		</section>
	);
}
