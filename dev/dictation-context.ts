import { createContext } from "react";
import type { Dictation } from "./dictation";

/**
 * The page's one dictation, which every composer's mic button records with:
 * null where the browser has no mic to give, as over plain HTTP.
 */
export const DictationContext = createContext<Dictation | null>(null);
