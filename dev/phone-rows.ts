/**
 * The look a page's list takes on a phone, the inbox's: rows the screen's
 * full width and tall enough to tap, each led by a round tile. Every class
 * here applies only below `WIDE`, so a page beside a sidebar keeps its own.
 */

/** A row, out to the screen's edges past the page's padding. */
export const PHONE_ROW =
	"max-md:-mx-4 max-md:w-[calc(100%+2rem)] max-md:min-h-16 max-md:gap-3 max-md:rounded-none max-md:px-4 max-md:py-2.5 max-md:hover:bg-transparent max-md:active:bg-muted";

/** The round tile leading a row, shown only on a phone. */
export const PHONE_TILE =
	"flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-foreground/80 md:hidden [&_svg]:size-5";

/** A row's name, as large as the inbox's. */
export const PHONE_NAME = "max-md:font-medium max-md:text-[15px]";

/** The line under a row's name. */
export const PHONE_LINE = "max-md:text-sm";

/** A section's heading, as the inbox's. */
export const PHONE_HEADING =
	"max-md:font-medium max-md:text-muted-foreground max-md:text-xs max-md:uppercase max-md:tracking-wide";

/** The page's own title, which the phone's bar already says. */
export const PHONE_TITLED = "max-md:sr-only";
