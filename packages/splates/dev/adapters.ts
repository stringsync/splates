import { useContext, useMemo } from "react";
import { FILES } from "./composer-drafts";
import { DictationContext } from "./dictation-context";

/** What a composer's runtime takes files and dictation with. */
export function useAdapters() {
	const dictation = useContext(DictationContext);
	return useMemo(
		() =>
			dictation === null
				? { attachments: FILES }
				: { attachments: FILES, dictation },
		[dictation],
	);
}
