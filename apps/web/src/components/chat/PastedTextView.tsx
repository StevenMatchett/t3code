import { useId, useState, type ComponentProps } from "react";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";

import { AttachmentFilePreview } from "../files/AttachmentFilePreview";

type PastedTextFile = Pick<
  ComponentProps<typeof AttachmentFilePreview>,
  "name" | "mimeType" | "sizeBytes" | "file" | "asset"
> & { id: string };

/** Reveal folded clipboard text without changing the draft or its attachment. */
export function PastedTextView({ files }: { files: readonly PastedTextFile[] }) {
  const [expanded, setExpanded] = useState(false);
  const contentId = useId();
  if (files.length === 0) return null;

  return (
    <div className="my-2 min-w-0">
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={contentId}
        className="flex items-center gap-1 text-xs text-secondary-label hover:text-foreground focus-visible:outline-2"
        onClick={() => setExpanded((value) => !value)}
      >
        {expanded ? (
          <ChevronDownIcon className="size-3.5" />
        ) : (
          <ChevronRightIcon className="size-3.5" />
        )}
        {expanded ? "Hide pasted text" : "Show pasted text"}
      </button>
      <div id={contentId} hidden={!expanded} className="mt-2 space-y-2">
        {expanded &&
          files.map(({ id, ...file }) => (
            <div
              key={id}
              className="flex h-80 flex-col overflow-hidden rounded-lg border border-border/70"
            >
              <AttachmentFilePreview {...file} origin="Pasted text" />
            </div>
          ))}
      </div>
    </div>
  );
}
