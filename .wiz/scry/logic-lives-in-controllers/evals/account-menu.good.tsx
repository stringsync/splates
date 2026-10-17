import { useState } from "react";
import type { Session } from "./session";

export function AccountMenu({ session }: { session: Session }) {
	const [open, setOpen] = useState(false);

	return (
		<div>
			<button type="button" aria-expanded={open} onClick={() => setOpen(!open)}>
				{session.name}
			</button>
			{open && (
				<ul>
					<li>
						<button type="button" onClick={() => session.signOut()}>
							Sign out
						</button>
					</li>
				</ul>
			)}
		</div>
	);
}
