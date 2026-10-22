import type { CredRequest } from "@stringsync/splates-server/creds";
import type { JSX } from "react";
import { Markdown } from "./markdown";

/**
 * What a request is for, then how to get it, so the person knows why before
 * going to get it. A record from before requests said what for shows only how.
 */
export function RequestBody({
	request,
}: {
	request: CredRequest;
}): JSX.Element {
	return (
		<div className="flex flex-col gap-2 px-4 py-3 text-sm leading-relaxed">
			{request.purpose !== "" && (
				<p className="font-medium">
					<Markdown text={request.purpose} inline />
				</p>
			)}
			<Markdown
				text={request.instructions}
				className="[&_p:first-child]:mt-0"
			/>
		</div>
	);
}
