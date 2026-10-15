import { CheckIcon } from "lucide-react";
import { type JSX, type ReactNode, useState } from "react";
import { Button } from "#dev/components/ui/button.tsx";
import { Input } from "#dev/components/ui/input.tsx";
import { useWide } from "./app-nav";
import { CredPrivacy } from "./cred-privacy";

/**
 * A field to paste a value into, and Save, which reads Saved in place once
 * it is kept, over a line on how the value stays private. The value goes to the store and the field empties: nothing
 * holds it after. On a phone the field takes the width, and Save goes under
 * the privacy line, as a form's footer.
 */
export function Paste({
	name,
	save,
	saved: savedBefore = false,
	onSaved,
	besides,
}: {
	name: string;
	save: (value: string) => Promise<void>;
	/** Whether it is kept already, so the field offers to replace it. */
	saved?: boolean;
	onSaved?: () => void;
	/** Another action, such as Dismiss, after Save. */
	besides?: ReactNode;
}): JSX.Element {
	const wide = useWide();
	const [value, setValue] = useState("");
	const [saved, setSaved] = useState(savedBefore);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const actions = (
		<>
			{wide ? null : besides}
			<Button
				type="submit"
				size="sm"
				disabled={busy || (value.trim() === "" && !saved)}
			>
				{saved && value === "" ? (
					<>
						<CheckIcon /> Saved
					</>
				) : (
					"Save"
				)}
			</Button>
			{wide ? besides : null}
		</>
	);
	return (
		<form
			className="flex flex-col gap-1.5"
			onSubmit={(event) => {
				event.preventDefault();
				if (value.trim() === "") {
					return;
				}
				setBusy(true);
				save(value)
					.then(() => {
						setValue("");
						setSaved(true);
						setError(null);
						onSaved?.();
					})
					.catch((caught: Error) => setError(caught.message))
					.finally(() => setBusy(false));
			}}
		>
			<div className="flex items-center gap-2">
				<Input
					type="password"
					autoComplete="off"
					aria-label={`Value of ${name}`}
					placeholder={
						saved ? "Saved. Paste again to replace it" : "Paste the value"
					}
					value={value}
					onChange={(event) => setValue(event.target.value)}
					className="font-mono max-md:placeholder:font-sans"
				/>
				{wide && actions}
			</div>
			{error !== null && (
				<p role="alert" className="text-destructive text-xs">
					{error}
				</p>
			)}
			<CredPrivacy />
			{!wide && (
				<div className="flex justify-end gap-2 pt-1 [&>button]:h-10 [&>button]:px-4">
					{actions}
				</div>
			)}
		</form>
	);
}
