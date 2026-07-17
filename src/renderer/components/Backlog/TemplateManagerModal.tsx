import React, { useState } from 'react';
import { BacklogTemplate } from '../../../common/backlog-types';
import { useBacklogStore } from '../../store/useBacklogStore';

// Edit the quick-task template list (backlog.md: "Templates live in a simple
// editable list so users can add their own"). Opens on top of the card editor,
// hence z-[60] vs its z-50. Saves through backlog:templates:update, which
// revalidates rows and broadcasts the kept list to every window.

interface Props {
  onClose: () => void;
}

const inputClass =
  'bg-glass/60 border border-edge/70 rounded-lg px-3 py-1.5 text-sm text-strong focus:outline-none focus:border-blue-500/60';

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
    <div className='fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm' onClick={onClose}>
      <div
        className='apple-scroll relative w-full max-w-2xl mx-4 bg-overlay/95 border border-edge/70 rounded-2xl shadow-2xl p-6 flex flex-col gap-4 max-h-[85vh] overflow-y-auto'
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className='absolute top-4 right-4 w-7 h-7 flex items-center justify-center rounded-full bg-control/60 hover:bg-control-strong text-muted hover:text-strong transition-colors text-sm cursor-pointer'
          aria-label='Close'
        >
          ✕
        </button>

        <div>
          <h2 className='text-lg font-bold text-strong leading-tight'>Quick-task templates</h2>
          <p className='text-sm text-muted mt-1'>
            Picking a template in the card editor pre-fills the title and description. Edit freely —
            the description is the prompt the executor runs.
          </p>
        </div>

        {rows.length === 0 ? (
          <p className='text-sm text-muted'>No templates. Add one below.</p>
        ) : (
          <div className='flex flex-col gap-3'>
            {rows.map((tpl) => (
              <div key={tpl.id} className='bg-glass/40 border border-edge/50 rounded-xl p-3 flex flex-col gap-2'>
                <div className='flex gap-2'>
                  <input
                    value={tpl.name}
                    onChange={(e) => patchRow(tpl.id, { name: e.target.value })}
                    className={`${inputClass} w-44`}
                    placeholder='Chip label'
                  />
                  <input
                    value={tpl.title}
                    onChange={(e) => patchRow(tpl.id, { title: e.target.value })}
                    className={`${inputClass} flex-1 min-w-0`}
                    placeholder='Card title'
                  />
                  <button
                    onClick={() => removeRow(tpl.id)}
                    className='w-8 shrink-0 flex items-center justify-center rounded-lg bg-control/50 hover:bg-red-500/30 text-muted hover:text-danger text-sm cursor-pointer transition-colors'
                    title='Remove template'
                    aria-label='Remove template'
                  >
                    ✕
                  </button>
                </div>
                <textarea
                  value={tpl.description}
                  onChange={(e) => patchRow(tpl.id, { description: e.target.value })}
                  rows={2}
                  className={`${inputClass} resize-y leading-relaxed`}
                  placeholder='Card description — the research prompt'
                />
              </div>
            ))}
          </div>
        )}

        <div className='flex items-center gap-2'>
          <button
            onClick={addRow}
            className='px-3 py-1.5 rounded-lg text-xs font-medium bg-control hover:bg-control-strong text-primary cursor-pointer transition-colors'
          >
            + Add template
          </button>
          {!valid && <span className='text-xs text-warn'>Every template needs a chip label and a card title.</span>}
          <div className='ml-auto flex items-center gap-2'>
            <button
              onClick={onClose}
              className='px-4 py-2 rounded-lg text-sm font-medium bg-control hover:bg-control-strong text-body cursor-pointer transition-colors'
            >
              Cancel
            </button>
            <button
              onClick={() => void handleSave()}
              disabled={!valid || saving}
              className='px-4 py-2 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-500 disabled:bg-control/40 disabled:text-faint text-white transition-colors cursor-pointer'
            >
              {saving ? 'Saving…' : 'Save templates'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
