import React, { useEffect, useState } from 'react';
import { BacklogCard, BacklogProject, BacklogTemplate, RiskTier, isSafeModelId } from '../../../common/backlog-types';
import { TIER_META } from './CardTile';
import { TemplateManagerModal } from './TemplateManagerModal';

// Create/edit a card. Phase 1: acceptance criteria and QA provider render
// disabled — they arrive with execution tasks (see backlog.md).

interface Props {
  card: BacklogCard | null;     // null = create
  projects: BacklogProject[];
  templates: BacklogTemplate[];
  cards: BacklogCard[];         // prereq candidates (all board cards)
  onSave: (input: {
    title: string; description: string; projectId: string;
    riskTier: RiskTier;
    model: string | null;
    estimatedMinutes: number | null;
    estimatedCostUsd: number | null;
    prereqIds: string[];
    state?: 'refinement' | 'todo';
  }) => void;
  onClose: () => void;
}

// Alias presets the CLI resolves to the latest model of each tier; "custom"
// reveals a free-text input for full ids (e.g. claude-sonnet-4-6). Empty
// value = no --model flag — the run uses the project's own default.
const MODEL_PRESETS: { value: string; label: string }[] = [
  { value: 'haiku', label: 'Haiku — fastest, cheapest' },
  { value: 'sonnet', label: 'Sonnet — balanced' },
  { value: 'opus', label: 'Opus — most capable' },
];
const isPresetModel = (m: string) => MODEL_PRESETS.some((p) => p.value === m);

const inputClass =
  'bg-slate-900/60 border border-slate-700/70 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500/60';
const labelClass = 'text-xs uppercase tracking-widest text-slate-500 font-semibold';

export const CardEditorModal: React.FC<Props> = ({ card, projects, templates, cards, onSave, onClose }) => {
  const [title, setTitle] = useState(card?.title ?? '');
  const [description, setDescription] = useState(card?.description ?? '');
  const [projectId, setProjectId] = useState(card?.projectId ?? projects[0]?.id ?? '');
  const [riskTier, setRiskTier] = useState<RiskTier>(card?.riskTier ?? 'green');
  const [estimatedMinutes, setEstimatedMinutes] = useState<string>(card?.estimatedMinutes?.toString() ?? '');
  const [estimatedCostUsd, setEstimatedCostUsd] = useState<string>(card?.estimatedCostUsd?.toString() ?? '');
  const [prereqIds, setPrereqIds] = useState<string[]>(card?.prereqIds ?? []);
  // '' = project default, preset alias, or 'custom' (free-text id below).
  const [modelChoice, setModelChoice] = useState<string>(
    card?.model ? (isPresetModel(card.model) ? card.model : 'custom') : '',
  );
  const [customModel, setCustomModel] = useState<string>(
    card?.model && !isPresetModel(card.model) ? card.model : '',
  );
  const [projectDefaultModel, setProjectDefaultModel] = useState<string | null>(null);
  const [managingTemplates, setManagingTemplates] = useState(false);

  // Resolve what "Project default" means for the selected project (its
  // .claude/settings.json chain) so the picker's default option says which
  // model a flag-less run would actually use.
  useEffect(() => {
    let cancelled = false;
    setProjectDefaultModel(null);
    if (!projectId) return;
    window.electron.invoke('backlog:project-default-model', { projectId })
      .then((res: { model: string | null }) => {
        if (!cancelled) setProjectDefaultModel(res?.model ?? null);
      })
      .catch(() => { /* best-effort label — leave it generic */ });
    return () => { cancelled = true; };
  }, [projectId]);

  // Any other card on the board can gate this one (the board is global, so
  // cross-project prereqs are allowed). Checked ones sort first for viz.
  const prereqCandidates = cards
    .filter((c) => c.id !== card?.id)
    .sort((a, b) => Number(prereqIds.includes(b.id)) - Number(prereqIds.includes(a.id)));

  const togglePrereq = (id: string) =>
    setPrereqIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const applyTemplate = (tpl: BacklogTemplate) => {
    setTitle(tpl.title);
    setDescription(tpl.description);
  };

  const buildInput = (state?: 'refinement' | 'todo') => ({
    title: title.trim(),
    description,
    projectId,
    riskTier,
    model: modelChoice === '' ? null : modelChoice === 'custom' ? (customModel.trim() || null) : modelChoice,
    // Mirror the engine's [5, 120] budget clamp so the card shows the minutes
    // the run will actually get.
    estimatedMinutes: estimatedMinutes.trim() === '' ? null : Math.min(120, Math.max(5, Number(estimatedMinutes) || 0)),
    estimatedCostUsd: estimatedCostUsd.trim() === '' ? null : Math.max(0, Number(estimatedCostUsd) || 0),
    prereqIds,
    ...(state ? { state } : {}),
  });

  // A custom model must be empty (falls back to default) or a safe id — the
  // store would silently null an unsafe one, so reject it here instead.
  const modelValid = modelChoice !== 'custom' || customModel.trim() === '' || isSafeModelId(customModel.trim());
  const valid = title.trim().length > 0 && projectId.length > 0 && modelValid;

  return (
    <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm' onClick={onClose}>
      <div
        className='apple-scroll relative w-full max-w-xl mx-4 bg-slate-900/95 border border-slate-700/70 rounded-2xl shadow-2xl p-6 flex flex-col gap-4 max-h-[85vh] overflow-y-auto'
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className='absolute top-4 right-4 w-7 h-7 flex items-center justify-center rounded-full bg-slate-700/60 hover:bg-slate-600 text-slate-400 hover:text-white transition-colors text-sm cursor-pointer'
          aria-label='Close'
        >
          ✕
        </button>

        <h2 className='text-lg font-bold text-white leading-tight'>{card ? 'Edit card' : 'New card'}</h2>

        {/* Quick tasks — templates pre-fill title + description (create only) */}
        {!card && (
          <div className='flex flex-col gap-1.5'>
            <div className='flex items-center gap-2'>
              <span className={labelClass}>Quick tasks</span>
              <button
                onClick={() => setManagingTemplates(true)}
                className='text-[11px] text-slate-500 hover:text-slate-300 cursor-pointer transition-colors'
                title='Add, edit, or remove quick-task templates'
              >
                manage
              </button>
            </div>
            {templates.length === 0 ? (
              <p className='text-xs text-slate-500'>No templates yet — "manage" to add some.</p>
            ) : (
              <div className='flex gap-2 flex-wrap'>
                {templates.map((tpl) => (
                  <button
                    key={tpl.id}
                    onClick={() => applyTemplate(tpl)}
                    className='px-3 py-1 rounded-lg text-xs font-medium bg-slate-700 hover:bg-slate-600 text-slate-200 cursor-pointer transition-colors'
                    title={tpl.description}
                  >
                    {tpl.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <label className='flex flex-col gap-1.5'>
          <span className={labelClass}>Title</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputClass} placeholder='What should the agent research?' />
        </label>

        <label className='flex flex-col gap-1.5'>
          <span className={labelClass}>Description</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={5}
            className={`${inputClass} resize-y leading-relaxed`}
            placeholder='The prompt the executor runs. Be specific — the output is a markdown report.'
          />
        </label>

        <div className='grid grid-cols-1 sm:grid-cols-2 gap-4'>
          <label className='flex flex-col gap-1.5'>
            <span className={labelClass}>Project</span>
            <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className={`${inputClass} cursor-pointer`}>
              {projects.length === 0 && <option value=''>No projects registered</option>}
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </label>

          <div className='flex flex-col gap-1.5'>
            <span className={labelClass}>Risk tier</span>
            <div className='flex gap-1 p-1 bg-slate-900/50 border border-slate-700/60 rounded-xl w-fit'>
              {(Object.keys(TIER_META) as RiskTier[]).map((tier) => (
                <button
                  key={tier}
                  onClick={() => setRiskTier(tier)}
                  title={TIER_META[tier].hint}
                  className={`px-3 py-1 rounded-lg text-xs font-medium cursor-pointer transition-colors flex items-center gap-1.5 ${
                    riskTier === tier ? 'bg-slate-700 text-white shadow-inner' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <span className={`w-2 h-2 rounded-full ${TIER_META[tier].dot}`} />
                  {TIER_META[tier].label}
                </button>
              ))}
            </div>
          </div>

          <label className='flex flex-col gap-1.5 sm:col-span-2'>
            <span className={labelClass}>Model</span>
            <select
              value={modelChoice}
              onChange={(e) => setModelChoice(e.target.value)}
              className={`${inputClass} cursor-pointer`}
            >
              <option value=''>
                Project default{projectDefaultModel ? ` (${projectDefaultModel})` : ''}
              </option>
              {MODEL_PRESETS.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
              <option value='custom'>Custom model id…</option>
            </select>
            {modelChoice === 'custom' && (
              <>
                <input
                  value={customModel}
                  onChange={(e) => setCustomModel(e.target.value)}
                  className={inputClass}
                  placeholder='e.g. claude-sonnet-4-6'
                />
                {!modelValid && (
                  <span className='text-[11px] text-red-300'>
                    Letters, digits, dots, dashes, and brackets only.
                  </span>
                )}
              </>
            )}
          </label>

          <label className='flex flex-col gap-1.5'>
            <span className={labelClass}>Est. minutes</span>
            <input
              type='number' min={5} max={120} value={estimatedMinutes}
              onChange={(e) => setEstimatedMinutes(e.target.value)}
              className={`${inputClass} w-28`} placeholder='30'
            />
          </label>

          <label className='flex flex-col gap-1.5'>
            <span className={labelClass}>Est. cost ($)</span>
            <input
              type='number' min={0} step={0.1} value={estimatedCostUsd}
              onChange={(e) => setEstimatedCostUsd(e.target.value)}
              className={`${inputClass} w-28`} placeholder='0.50'
            />
          </label>
        </div>

        {/* Prerequisites — gate autorun until the checked cards are Done */}
        {prereqCandidates.length > 0 && (
          <div className='flex flex-col gap-1.5'>
            <span className={labelClass}>Prerequisites</span>
            <p className='text-xs text-slate-400 -mt-0.5'>
              Autorun waits until these cards are Done ("Run now" overrides).
            </p>
            <div className='apple-scroll flex flex-col gap-1 max-h-36 overflow-y-auto bg-slate-900/40 border border-slate-700/50 rounded-xl p-2'>
              {prereqCandidates.map((c) => (
                <label key={c.id} className='flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-slate-800/60 cursor-pointer'>
                  <input
                    type='checkbox'
                    checked={prereqIds.includes(c.id)}
                    onChange={() => togglePrereq(c.id)}
                    className='accent-blue-500'
                  />
                  <span className='flex-1 min-w-0 text-sm text-slate-200 truncate'>{c.title}</span>
                  <span className={`text-[11px] px-1.5 py-0.5 rounded shrink-0 ${
                    c.state === 'done' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-slate-700/60 text-slate-400'
                  }`}>
                    {c.state}
                  </span>
                </label>
              ))}
            </div>
          </div>
        )}

        {/* Phase 1: present but disabled — arrives with execution tasks */}
        <div className='bg-slate-900/40 border border-slate-700/50 rounded-xl p-4 opacity-50'>
          <p className='text-sm font-medium text-white'>Acceptance criteria & QA provider</p>
          <p className='text-xs text-slate-400 mt-1'>
            Coming with execution tasks — research cards are done when their report is attached.
          </p>
          <div className='mt-3 flex gap-3'>
            <input disabled className={`${inputClass} flex-1`} placeholder='Acceptance criterion…' />
            <select disabled className={`${inputClass} w-32`}>
              <option>none</option>
            </select>
          </div>
        </div>

        <div className='flex items-center gap-2 justify-end'>
          <button
            onClick={onClose}
            className='px-4 py-2 rounded-lg text-sm font-medium bg-slate-700 hover:bg-slate-600 text-slate-300 cursor-pointer transition-colors'
          >
            Cancel
          </button>
          {card ? (
            <button
              onClick={() => valid && onSave(buildInput())}
              disabled={!valid}
              className='px-4 py-2 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700/40 disabled:text-slate-500 text-white transition-colors cursor-pointer'
            >
              Save
            </button>
          ) : (
            <>
              <button
                onClick={() => valid && onSave(buildInput('refinement'))}
                disabled={!valid}
                className='px-4 py-2 rounded-lg text-sm font-medium bg-slate-700 hover:bg-slate-600 disabled:bg-slate-700/40 disabled:text-slate-500 text-slate-200 transition-colors cursor-pointer'
              >
                Save to Refinement
              </button>
              <button
                onClick={() => valid && onSave(buildInput('todo'))}
                disabled={!valid}
                className='px-4 py-2 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700/40 disabled:text-slate-500 text-white transition-colors cursor-pointer'
              >
                Queue in Todo
              </button>
            </>
          )}
        </div>

        {managingTemplates && <TemplateManagerModal onClose={() => setManagingTemplates(false)} />}
      </div>
    </div>
  );
};
