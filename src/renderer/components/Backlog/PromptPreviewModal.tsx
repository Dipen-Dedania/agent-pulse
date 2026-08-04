import React, { useState } from 'react';
import { BacklogTaskType } from '../../../common/backlog-types';
import { Button, Modal } from '../Shared';

// Read-only view of the exact prompt the runner will send for this card. The
// string is assembled by the caller (CardEditorModal) via buildPreviewPrompt so
// this component stays dumb. Opened over the card editor — `portal` mounts it on
// document.body so it paints above the editor's inline z-50 overlay.

const TYPE_LABEL: Record<BacklogTaskType, string> = {
  research: 'Research',
  execution: 'Execution',
  qa: 'QA',
};

interface Props {
  prompt: string;
  taskType: BacklogTaskType;
  onClose: () => void;
}

export const PromptPreviewModal: React.FC<Props> = ({ prompt, taskType, onClose }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — leave the label as-is */
    }
  };

  return (
    <Modal
      title='Prompt preview'
      eyebrow={`${TYPE_LABEL[taskType]} task`}
      onClose={onClose}
      portal
      maxWidthClass='max-w-2xl'
      footer={
        <>
          <Button variant='secondary' onClick={() => void handleCopy()}>
            {copied ? 'Copied ✓' : 'Copy'}
          </Button>
          <Button onClick={onClose}>Close</Button>
        </>
      }
    >
      <p className='text-xs text-muted -mt-1'>
        The exact prompt the executor runs for this card. Attachment file bodies are inlined when the
        card runs — the preview shows a placeholder for files already saved to the card.
      </p>
      <pre className='apple-scroll glass-secondary shrink-0 p-4 text-xs leading-relaxed text-body font-mono whitespace-pre-wrap break-words max-h-[60vh] overflow-auto'>
        {prompt}
      </pre>
    </Modal>
  );
};
