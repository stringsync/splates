import { useState } from "react";

type Props = {
	onSubmit: (body: string) => void;
};

export function CommentComposer({ onSubmit }: Props) {
	const [body, setBody] = useState("");

	return (
		<form
			onSubmit={(event) => {
				event.preventDefault();
				onSubmit(body);
				setBody("");
			}}
		>
			<textarea value={body} onChange={(event) => setBody(event.target.value)} />
			<button type="submit" disabled={body.trim() === ""}>
				Post
			</button>
		</form>
	);
}
