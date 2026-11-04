import type { JSX } from "react";
import { useCallback, useEffect, useState } from "react";
import { Button, buttonVariants } from "#web/components/ui/button.tsx";
import { keptCreds, saveCred } from "./api";
import { Paste } from "./cred-paste";

interface OptionalKey {
	name: string;
	title: string;
	about: string;
	href: string;
}

/** The keys rec can use but does not need. */
export const OPTIONAL_KEYS: OptionalKey[] = [
	{
		name: "OPENAI_API_KEY",
		title: "Timestamped dictation",
		about:
			"Turns what you say into a timestamped transcript with whisper-1, so an agent can read it. Without it the audio is still saved, and you can transcribe it later.",
		href: "https://platform.openai.com/api-keys",
	},
	{
		name: "TYPESAFE_API_KEY",
		title: "Smarter moment ranking",
		about:
			"Ranks moments by what you said using Jev. Without it they rank by code signals alone.",
		href: "https://typesafe.ai",
	},
];

/** Forms for the optional keys not yet saved on this device, saved once for rec and dictation. */
export function RecKeys(): JSX.Element | null {
	const [saved, setSaved] = useState<string[] | null>(null);
	const [hidden, setHidden] = useState<string[]>(() =>
		OPTIONAL_KEYS.filter(
			(each) => localStorage.getItem(hiddenKey(each.name)) === "1",
		).map((each) => each.name),
	);
	const read = useCallback(() => {
		keptCreds().then(
			(creds) =>
				setSaved(
					creds.kept
						.filter((each) => each.scope === "device")
						.map((each) => each.name),
				),
			() => {},
		);
	}, []);
	useEffect(read, [read]);

	const shown = OPTIONAL_KEYS.filter(
		(each) => !(saved ?? []).includes(each.name) && !hidden.includes(each.name),
	);
	if (saved === null || shown.length === 0) {
		return null;
	}
	return (
		<div className="flex flex-col gap-3">
			<span className="text-muted-foreground text-xs">
				Optional: rec works without these
			</span>
			{shown.map((each) => (
				<div
					key={each.name}
					className="flex flex-col gap-2 rounded-lg border bg-card p-4 text-sm"
				>
					<div className="flex flex-col gap-0.5">
						<span className="font-medium">{each.title}</span>
						<code className="text-muted-foreground text-xs">{each.name}</code>
						<span className="text-muted-foreground text-xs">{each.about}</span>
					</div>
					<Paste
						name={each.name}
						save={(value) => saveCred(each.name, value, "device")}
						onSaved={read}
						besides={
							<>
								<a
									href={each.href}
									target="_blank"
									rel="noreferrer"
									className={buttonVariants({ variant: "ghost", size: "sm" })}
								>
									Get a key
								</a>
								<Button
									type="button"
									variant="ghost"
									size="sm"
									onClick={() => {
										localStorage.setItem(hiddenKey(each.name), "1");
										setHidden([...hidden, each.name]);
									}}
								>
									Not now
								</Button>
							</>
						}
					/>
				</div>
			))}
		</div>
	);
}

function hiddenKey(name: string): string {
	return `splates.rec.keys.hidden.${name}`;
}
