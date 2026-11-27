import {
	createContext,
	useCallback,
	useContext,
	useSyncExternalStore,
} from "react";

/** Where expanded conversation ids are kept in this browser. */
const STORAGE_KEY = "splates.imagePreviews";

/** Cap kept ids so localStorage stays bounded over time. */
const MAX_KEPT = 200;

const changed = new Set<() => void>();

/** Fallback when storage is unavailable (such as a private window). */
let fallback = new Set<string>();

/** Whether image previews in the current conversation are expanded inline. */
export const ImagePreviewsContext = createContext(false);

/** Whether inline media in this tree should render expanded instead of as compact cards. */
export function useImagePreviewsExpanded(): boolean {
	return useContext(ImagePreviewsContext);
}

/**
 * Whether `conversationId` has its image previews expanded inline in this
 * browser, and a toggle scoped strictly to that conversation.
 */
export function useConversationImagePreviews(conversationId: string): {
	expanded: boolean;
	toggle: () => void;
} {
	const expanded = useSyncExternalStore(subscribe, () =>
		isExpanded(conversationId),
	);
	const toggle = useCallback(
		() => setExpanded(conversationId, !isExpanded(conversationId)),
		[conversationId],
	);
	return { expanded, toggle };
}

function readExpanded(): string[] {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (raw === null) {
			return [];
		}
		const parsed: unknown = JSON.parse(raw);
		return Array.isArray(parsed)
			? parsed.filter((each): each is string => typeof each === "string")
			: [];
	} catch {
		return [...fallback];
	}
}

function isExpanded(conversationId: string): boolean {
	return readExpanded().includes(conversationId);
}

function setExpanded(conversationId: string, expanded: boolean): void {
	const current = readExpanded().filter((each) => each !== conversationId);
	if (expanded) {
		current.push(conversationId);
	}
	const next = current.slice(-MAX_KEPT);
	fallback = new Set(next);
	try {
		if (next.length === 0) {
			localStorage.removeItem(STORAGE_KEY);
		} else {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
		}
	} catch {
		// Private windows may refuse storage; fallback keeps the state for this session.
	}
	for (const notify of changed) {
		notify();
	}
}

function subscribe(notify: () => void): () => void {
	changed.add(notify);
	const onStorage = (event: StorageEvent) => {
		if (event.key === null || event.key === STORAGE_KEY) {
			notify();
		}
	};
	addEventListener("storage", onStorage);
	return () => {
		changed.delete(notify);
		removeEventListener("storage", onStorage);
	};
}
