import React, { useState } from 'react';
import { BacklogTemplate } from '../../../common/backlog-types';
import { useBacklogStore } from '../../store/useBacklogStore';
import { Button, IconButton, Input, Modal, Textarea, Tooltip } from '../Shared';

// Edit the quick-task template list (backlog.md: "Templates live in a simple
// editable list so users can add their own"). Opens on top of the card editor,
// hence z-[60] vs its z-50. Saves through backlog:templates:update, which
// revalidates rows and broadcasts the kept list to every window.

interface Props {
  onClose: () => void;
}

export const TemplateManagerModal: React.FC<Props> = ({ onClose }) => {
  const templates = useBacklogStore((s) => s.templates);
  const updateTemplates = useBacklogStore((s) => s.updateTemplates);
  const [rows, setRows] = useState<BacklogTemplate[]>(templates.map((t) => ({ ...t })));
  const [saving, setSaving] = useState(false);

  const patchRow = (id: string, patch: Partial<BacklogTemplate>) =>
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const removeRow = (id: string) => setRows((prev) => prev.filter((r) => r.id !== id));
  const addRow = () =>
    setRows((prev) => [...prev, { id: `tpl-${Date.now()}`, name: '', title: '', description: '' }]);

  // Untouched blank rows are dropped silently; a half-filled row blocks Save
  // (main would drop it on validation, losing the user's typing).
  const cleaned = rows.filter((r) => r.name.trim() || r.title.trim() || r.description.trim());
  const valid = cleaned.every((r) => r.name.trim().length > 0 && r.title.trim().length > 0);

  const handleSave = async () => {
    setSaving(true);
    const saved = await updateTemplates(cleaned.map((r) => ({
      ...r,
      name: r.name.trim(),
      title: r.title.trim(),
    })));
    setSaving(false);
    if (saved) onClose();
  };

  return (
    <Modal
      title='Quick-task templates'
      onClose={onClose}
      // Portal + a raised z: this opens from inside the card editor's animated
      // panel, which is a containing block for `position: fixed`, and both
      // modals would otherwise tie at z-50.
      portal
      zClass='z-[60]'
      maxWidthClass='max-w-2xl'
      footer={
        <>
          <Button variant='secondary' size='md' onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant='primary'
            size='md'
            onClick={() => void handleSave()}
            disabled={!valid || saving}
          >
            {saving ? 'Saving…' : 'Save templates'}
          </Button>
        </>
      }
    >
      <p className='text-sm text-muted -mt-2'>
        Picking a template in the card editor pre-fills the title and description. Edit freely —
        the description is the prompt the executor runs.
      </p>

      {rows.length === 0 ? (
        <p className='text-sm text-muted'>No templates. Add one below.</p>
      ) : (
        <div className='flex flex-col gap-3'>
          {rows.map((tpl) => (
            <div key={tpl.id} className='glass-secondary shrink-0 p-3 flex flex-col gap-2'>
              <div className='flex gap-2'>
                <Input
                  value={tpl.name}
                  onChange={(e) => patchRow(tpl.id, { name: e.target.value })}
                  className='w-44'
                  placeholder='Chip label'
                />
                <Input
                  value={tpl.title}
                  onChange={(e) => patchRow(tpl.id, { title: e.target.value })}
                  className='flex-1 min-w-0'
                  placeholder='Card title'
                />
                <Tooltip content='Remove template'>
                  {/* Stretches to the adjacent Input's height, so it overrides
                      the size's fixed box. */}
                  <IconButton
                    shape='square'
                    tone='danger'
                    className='w-8 h-auto self-stretch'
                    onClick={() => removeRow(tpl.id)}
                    aria-label='Remove template'
                  >
                    ✕
                  </IconButton>
                </Tooltip>
              </div>
              <Textarea
                value={tpl.description}
                onChange={(e) => patchRow(tpl.id, { description: e.target.value })}
                rows={2}
                placeholder='Card description — the research prompt'
              />
            </div>
          ))}
        </div>
      )}

      <div className='flex items-center gap-2'>
        <Button
          variant='secondary'
          size='sm'
          onClick={addRow}
        >
          + Add template
        </Button>
        {!valid && <span className='text-xs text-warn'>Every template needs a chip label and a card title.</span>}
      </div>
    </Modal>
  );
};
