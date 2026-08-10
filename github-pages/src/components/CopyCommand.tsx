/**
 * CopyCommand — a monospace command block with a copy-to-clipboard button.
 * Shows transient "Copied" feedback. Falls back silently if the Clipboard API
 * is unavailable (e.g. non-secure context).
 */
import { useState } from 'react';

export default function CopyCommand({ command, label }: { command: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable — no-op; the command is still selectable.
    }
  };

  return (
    <div className="flex items-stretch overflow-hidden rounded-buttons border border-mist-border bg-paper">
      <code className="flex-1 overflow-x-auto whitespace-nowrap px-4 py-3 text-left font-mono text-[13px] text-midnight-navy">
        {label ? <span className="select-none text-steel-blue">{label} </span> : null}
        {command}
      </code>
      <button
        type="button"
        onClick={copy}
        aria-label={copied ? 'Copied' : 'Copy command'}
        className="shrink-0 border-l border-mist-border px-4 text-caption font-semibold text-signal-blue transition-colors hover:bg-fog"
      >
        {copied ? 'Copied ✓' : 'Copy'}
      </button>
    </div>
  );
}
