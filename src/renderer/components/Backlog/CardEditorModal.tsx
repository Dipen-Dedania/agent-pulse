import React, { useEffect, useState } from 'react';
import {
  AttachmentIntent, BacklogAttachment, BacklogCard, BacklogProject, BacklogTaskType,
  BacklogTemplate, PendingAttachment, QaProvider, RiskTier, isSafeModelId,
} from '../../../common/backlog-types';
import { useBacklogStore } from '../../store/useBacklogStore';
import { appAlert, Button, Select, Tooltip } from '../Shared';
import { TIER_META } from './CardTile';
import { TemplateManagerModal } from './TemplateManagerModal';

function formatBytes(n: number): string {
  return n < 1024 ? `${n} B` : `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
}

// Create/edit a card. Research cards stay read-only (report only); execution
// cards edit files in an isolated worktree and gain the acceptance-criteria +
// QA-provider block below (see backlog-phase2-plan.md).

interface Props {
  card: BacklogCard | null;     // null = create
  projects: BacklogProject[];
  templates: BacklogTemplate[];
  cards: BacklogCard[];         // prereq candidates (all board cards)
  onSave: (
    input: {
      title: string; description: string; projectId: string;
      taskType: BacklogTaskType;
      riskTier: RiskTier;
      model: string | null;
      estimatedMinutes: number | null;
      estimatedCostUsd: number | null;
      prereqIds: string[];
      qaProvider: QaProvider;
      qaCommand: string | null;
      qaUrl: string | null;
      acceptanceCriteria: string[];
      state?: 'refinement' | 'todo';
    },
    attachments: AttachmentIntent,
  ) => void;
  onClose: () => void;
}

// 'browser' is intentionally excluded — it stays disabled until the
// browser-QA phase (see backlog-types.ts).
const QA_PROVIDERS: { value: QaProvider; label: string; hint: string }[] = [
  { value: 'none', label: 'None', hint: 'QA is skipped — the diff goes straight to Done.' },
  { value: 'tests', label: 'Tests', hint: 'runs `npm test` in the worktree after the change' },
  { value: 'lint', label: 'Lint', hint: 'runs `npm run lint` in the worktree after the change' },
  { value: 'typecheck', label: 'Typecheck', hint: 'runs `npx tsc --noEmit` in the worktree after the change' },
  { value: 'custom', label: 'Custom command…', hint: 'runs the command below in the worktree' },
];

// Alias presets the CLI resolves to the latest model of each tier; "custom"
// reveals a free-text input for full ids (e.g. claude-sonnet-4-6). Empty
// value = no --model flag — the run uses the project's own default.
const MODEL_PRESETS: { value: string; label: string }[] = [
  { value: 'haiku', label: 'Haiku — fastest, cheapest' },
  { value: 'sonnet', label: 'Sonnet — balanced' },
  { value: 'opus', label: 'Opus — most capable' },
  { value: 'fable', label: 'Fable — top tier, highest quality' },
];
const isPresetModel = (m: string) => MODEL_PRESETS.some((p) => p.value === m);

const inputClass =
  'bg-glass/60 border border-edge/70 rounded-lg px-3 py-1.5 text-sm text-strong focus:outline-none focus:border-blue-500/60';
const labelClass = 'text-xs uppercase tracking-widest text-faint font-semibold';

// Small "ⓘ" affordance carrying a glass tooltip — uses the shared Tooltip
// primitive so it matches the rest of the app instead of a native browser hint.
const InfoHint: React.FC<{ text: string }> = ({ text }) => (
  <Tooltip content={text}>
    <span
      tabIndex={0}
      aria-label={text}
      className='inline-flex items-center justify-center w-3.5 h-3.5 rounded-full border border-edge/70 text-[9px] leading-none text-faint cursor-help select-none hover:text-body hover:border-edge-strong'
    >
      i
    </span>
  </Tooltip>
);

export const CardEditorModal: React.FC<Props> = ({ card, projects, templates, cards, onSave, onClose }) => {
  const [title, setTitle] = useState(card?.title ?? '');
  const [description, setDescription] = useState(card?.description ?? '');
  const [projectId, setProjectId] = useState(card?.projectId ?? projects[0]?.id ?? '');
  const [taskType, setTaskType] = useState<BacklogTaskType>(card?.taskType ?? 'research');
  const [riskTier, setRiskTier] = useState<RiskTier>(card?.riskTier ?? 'green');
  // One criterion per line in the UI; stored/injected as a string array.
  const [acceptanceCriteria, setAcceptanceCriteria] = useState<string>((card?.acceptanceCriteria ?? []).join('\n'));
  const [qaProvider, setQaProvider] = useState<QaProvider>(card?.qaProvider ?? 'none');
  const [qaCommand, setQaCommand] = useState<string>(card?.qaCommand ?? '');
  const [qaUrl, setQaUrl] = useState<string>(card?.qaUrl ?? '');
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

  // Attachments: existing rows (edit mode) minus any the user removed, plus
  // newly-picked files not yet persisted. The final set is sent on save.
  const listAttachments = useBacklogStore((s) => s.listAttachments);
  const pickAttachments = useBacklogStore((s) => s.pickAttachments);
  const [existingAttachments, setExistingAttachments] = useState<BacklogAttachment[]>([]);
  const [removedIds, setRemovedIds] = useState<string[]>([]);
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const [picking, setPicking] = useState(false);

  useEffect(() => {
    if (!card?.id) return;
    let cancelled = false;
    void listAttachments(card.id).then((rows) => {
      if (!cancelled) setExistingAttachments(rows);
    });
    return () => { cancelled = true; };
  }, [card?.id, listAttachments]);

  const keptExisting = existingAttachments.filter((a) => !removedIds.includes(a.id));

  const handlePickAttachments = async () => {
    setPicking(true);
    try {
      const { items, skipped } = await pickAttachments();
      if (items.length > 0) {
        // De-dupe by filename against what's already staged (last pick wins).
        const staged = new Set([...keptExisting.map((a) => a.filename), ...pendingAttachments.map((a) => a.filename)]);
        setPendingAttachments((prev) => [...prev, ...items.filter((i) => !staged.has(i.filename))]);
      }
      if (skipped.length > 0) {
        void appAlert(
          `Some files were not attached:\n${skipped.map((s) => `• ${s.filename} — ${s.reason}`).join('\n')}`,
          'Attachments',
        );
      }
    } finally {
      setPicking(false);
    }
  };

  const attachmentIntent = (): AttachmentIntent => ({
    keepIds: keptExisting.map((a) => a.id),
    add: pendingAttachments,
  });

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
    taskType,
    riskTier,
    model: modelChoice === '' ? null : modelChoice === 'custom' ? (customModel.trim() || null) : modelChoice,
    // Mirror the engine's [5, 120] budget clamp so the card shows the minutes
    // the run will actually get.
    estimatedMinutes: estimatedMinutes.trim() === '' ? null : Math.min(120, Math.max(5, Number(estimatedMinutes) || 0)),
    estimatedCostUsd: estimatedCostUsd.trim() === '' ? null : Math.max(0, Number(estimatedCostUsd) || 0),
    prereqIds,
    // Provider/command are execution-only, the app URL is qa-only; the others
    // send 'none'/empty so switching a card between types reads cleanly.
    qaProvider: taskType === 'execution' ? qaProvider : 'none',
    qaCommand: taskType === 'execution' && qaProvider === 'custom' ? (qaCommand.trim() || null) : null,
    qaUrl: taskType === 'qa' ? (qaUrl.trim() || null) : null,
    // Criteria are the executor's checklist (execution) or the checks the QA
    // agent actually verifies in the browser (qa).
    acceptanceCriteria: taskType === 'execution' || taskType === 'qa'
      ? acceptanceCriteria.split('\n').map((line) => line.trim()).filter((line) => line.length > 0)
      : [],
    ...(state ? { state } : {}),
  });

  // A custom model must be empty (falls back to default) or a safe id — the
  // store would silently null an unsafe one, so reject it here instead.
  const modelValid = modelChoice !== 'custom' || customModel.trim() === '' || isSafeModelId(customModel.trim());
  const valid = title.trim().length > 0 && projectId.length > 0 && modelValid;

  return (
    <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm' onClick={onClose}>
      <div
        className='apple-scroll relative w-full max-w-xl mx-4 bg-overlay/95 border border-edge/70 rounded-2xl shadow-2xl p-6 flex flex-col gap-4 max-h-[85vh] overflow-y-auto'
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className='absolute top-4 right-4 w-7 h-7 flex items-center justify-center rounded-full bg-control/60 hover:bg-control-strong text-muted hover:text-strong transition-colors text-sm cursor-pointer'
          aria-label='Close'
        >
          ✕
        </button>

        <h2 className='text-lg font-bold text-strong leading-tight'>{card ? 'Edit card' : 'New card'}</h2>

        {/* Quick tasks — templates pre-fill title + description (create only) */}
        {!card && (
          <div className='flex flex-col gap-1.5'>
            <div className='flex items-center gap-2'>
              <span className={labelClass}>Quick tasks</span>
              <Tooltip content='Add, edit, or remove quick-task templates'>
                <button
                  onClick={() => setManagingTemplates(true)}
                  className='text-[11px] text-faint hover:text-body cursor-pointer transition-colors'
                >
                  manage
                </button>
              </Tooltip>
            </div>
            {templates.length === 0 ? (
              <p className='text-xs text-faint'>No templates yet — "manage" to add some.</p>
            ) : (
              <div className='flex gap-2 flex-wrap'>
                {templates.map((tpl) => (
                  <Tooltip key={tpl.id} content={tpl.description}>
                    <Button
                      variant='secondary'
                      size='sm'
                      onClick={() => applyTemplate(tpl)}
                    >
                      {tpl.name}
                    </Button>
                  </Tooltip>
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

        {/* Attachments — text files inlined verbatim into the prompt, so a card
            can carry context that isn't committed to the repo (an isolated
            worktree only sees committed files). */}
        <div className='flex flex-col gap-1.5'>
          <div className='flex items-center gap-2'>
            <span className={labelClass}>Attachments</span>
            <Button
              variant='secondary'
              size='xs'
              type='button'
              onClick={() => void handlePickAttachments()}
              disabled={picking}
            >
              {picking ? 'Choosing…' : '+ Attach files'}
            </Button>
          </div>
          {keptExisting.length === 0 && pendingAttachments.length === 0 ? (
            <p className='text-xs text-faint'>
              Attach text files (specs, plans) to inline them into the prompt — useful for uncommitted files a worktree can’t see.
            </p>
          ) : (
            <div className='flex flex-wrap gap-1.5'>
              {keptExisting.map((a) => (
                <span key={a.id} className='inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-glass/70 border border-edge/60 text-xs text-primary'>
                  <Tooltip content={a.filename}><span className='truncate max-w-48'>{a.filename}</span></Tooltip>
                  <span className='text-faint'>{formatBytes(a.bytes)}</span>
                  <button
                    type='button'
                    onClick={() => setRemovedIds((prev) => [...prev, a.id])}
                    className='text-faint hover:text-danger cursor-pointer'
                    aria-label={`Remove ${a.filename}`}
                  >
                    ✕
                  </button>
                </span>
              ))}
              {pendingAttachments.map((a, i) => (
                <span key={`pending-${a.filename}-${i}`} className='inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-xs text-ok'>
                  <Tooltip content={a.filename}><span className='truncate max-w-48'>{a.filename}</span></Tooltip>
                  <span className='text-ok/80'>{formatBytes(a.bytes)} · new</span>
                  <button
                    type='button'
                    onClick={() => setPendingAttachments((prev) => prev.filter((_, j) => j !== i))}
                    className='text-ok/70 hover:text-danger cursor-pointer'
                    aria-label={`Remove ${a.filename}`}
                  >
                    ✕
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        <div className='grid grid-cols-1 sm:grid-cols-2 gap-4'>
          <label className='flex flex-col gap-1.5'>
            <span className={labelClass}>Project</span>
            <Select
              value={projectId}
              onChange={(v) => setProjectId(v)}
              ariaLabel='Project'
              className={`${inputClass} cursor-pointer`}
              options={
                projects.length === 0
                  ? [{ value: '', label: 'No projects registered' }]
                  : projects.map((p) => ({ value: p.id, label: p.name }))
              }
            />
          </label>

          <div className='flex flex-col gap-1.5'>
            <span className={labelClass}>Task type</span>
            <div className='flex gap-1 p-1 bg-glass/50 border border-edge/60 rounded-xl w-fit'>
              {([
                { value: 'research', label: 'Research', hint: 'Read-only — the agent produces a report.' },
                { value: 'execution', label: 'Execution', hint: 'Edits files in an isolated worktree — delivers a diff + report.' },
                { value: 'qa', label: 'QA', hint: 'Read-only — opens the running app in a headless browser and checks each acceptance criterion. Delivers a report + screenshots.' },
              ] as { value: BacklogTaskType; label: string; hint: string }[]).map((t) => (
                <Tooltip key={t.value} content={t.hint}>
                  <button
                    onClick={() => setTaskType(t.value)}
                    className={`px-3 py-1 rounded-lg text-xs font-medium cursor-pointer transition-colors ${
                      taskType === t.value ? 'bg-control text-strong shadow-inner' : 'text-muted hover:text-strong'
                    }`}
                  >
                    {t.label}
                  </button>
                </Tooltip>
              ))}
            </div>
          </div>

          <div className='flex flex-col gap-1.5'>
            <span className={labelClass}>Risk tier</span>
            <div className='flex gap-1 p-1 bg-glass/50 border border-edge/60 rounded-xl w-fit'>
              {(Object.keys(TIER_META) as RiskTier[]).map((tier) => (
                <Tooltip key={tier} content={TIER_META[tier].hint}>
                  <button
                    onClick={() => setRiskTier(tier)}
                    className={`px-3 py-1 rounded-lg text-xs font-medium cursor-pointer transition-colors flex items-center gap-1.5 ${
                      riskTier === tier ? 'bg-control text-strong shadow-inner' : 'text-muted hover:text-strong'
                    }`}
                  >
                    <span className={`w-2 h-2 rounded-full ${TIER_META[tier].dot}`} />
                    {TIER_META[tier].label}
                  </button>
                </Tooltip>
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
                  <span className='text-[11px] text-danger'>
                    Letters, digits, dots, dashes, and brackets only.
                  </span>
                )}
              </>
            )}
          </label>

          <label className='flex flex-col gap-1.5'>
            <span className={`${labelClass} inline-flex items-center gap-1.5`}>
              Est. minutes
              <InfoHint text='Size-fit + hard time budget. The scheduler only claims this card if it fits the time left in the window, and kills the run if it exceeds this many minutes. Default 30, clamped 5–120.' />
            </span>
            <input
              type='number' min={5} max={120} value={estimatedMinutes}
              onChange={(e) => setEstimatedMinutes(e.target.value)}
              className={`${inputClass} w-28`} placeholder='30'
            />
          </label>

          <label className='flex flex-col gap-1.5'>
            <span className={`${labelClass} inline-flex items-center gap-1.5`}>
              Est. cost ($)
              <InfoHint text='Informational only — feeds the "queue will burn ~$X next window" forecast. It never limits or stops a run. Default $0.50.' />
            </span>
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
            <p className='text-xs text-muted -mt-0.5'>
              Autorun waits until these cards are Done ("Run now" overrides).
            </p>
            <div className='apple-scroll flex flex-col gap-1 max-h-36 overflow-y-auto glass-secondary shrink-0 p-2'>
              {prereqCandidates.map((c) => (
                <label key={c.id} className='flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-glass/60 cursor-pointer'>
                  <input
                    type='checkbox'
                    checked={prereqIds.includes(c.id)}
                    onChange={() => togglePrereq(c.id)}
                    className='accent-blue-500'
                  />
                  <span className='flex-1 min-w-0 text-sm text-primary truncate'>{c.title}</span>
                  <span className={`text-[11px] px-1.5 py-0.5 rounded shrink-0 ${
                    c.state === 'done' ? 'bg-emerald-500/15 text-ok' : 'bg-control/60 text-muted'
                  }`}>
                    {c.state}
                  </span>
                </label>
              ))}
            </div>
          </div>
        )}

        {/* Acceptance criteria & QA provider — execution cards only */}
        {taskType === 'execution' ? (
          <div className='glass-secondary shrink-0 p-4 flex flex-col gap-3'>
            <div>
              <p className='text-sm font-medium text-strong'>Acceptance criteria & QA</p>
              <p className='text-xs text-muted mt-1'>
                The executor edits files in an isolated worktree; QA runs the chosen check afterward and gates Done.
              </p>
            </div>

            <label className='flex flex-col gap-1.5'>
              <span className={labelClass}>Acceptance criteria</span>
              <textarea
                value={acceptanceCriteria}
                onChange={(e) => setAcceptanceCriteria(e.target.value)}
                rows={4}
                className={`${inputClass} resize-y leading-relaxed`}
                placeholder='One per line — injected into the executor prompt as a checklist. Not machine-checked yet.'
              />
            </label>

            <label className='flex flex-col gap-1.5'>
              <span className={labelClass}>QA provider</span>
              <select
                value={qaProvider}
                onChange={(e) => setQaProvider(e.target.value as QaProvider)}
                className={`${inputClass} cursor-pointer w-full sm:w-56`}
              >
                {QA_PROVIDERS.map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
                <option value='browser' disabled>Browser — coming later</option>
              </select>
              <span className='text-[11px] text-faint'>
                {QA_PROVIDERS.find((p) => p.value === qaProvider)?.hint}
              </span>
            </label>

            {qaProvider === 'custom' && (
              <label className='flex flex-col gap-1.5'>
                <span className={labelClass}>Custom QA command</span>
                <input
                  value={qaCommand}
                  onChange={(e) => setQaCommand(e.target.value)}
                  className={inputClass}
                  placeholder='npm run e2e'
                />
                {qaCommand.trim() === '' && (
                  <span className='text-[11px] text-warn'>
                    Required for the custom provider — QA fails with no command to run.
                  </span>
                )}
              </label>
            )}
          </div>
        ) : taskType === 'qa' ? (
          <div className='glass-secondary shrink-0 p-4 flex flex-col gap-3'>
            <div>
              <p className='text-sm font-medium text-strong'>Browser verification</p>
              <p className='text-xs text-muted mt-1'>
                A read-only agent opens the app in a headless browser (chrome-devtools-mcp) and checks
                each criterion against the live UI. The app must already be running — the agent can’t start it.
              </p>
            </div>

            <label className='flex flex-col gap-1.5'>
              <span className={labelClass}>App URL</span>
              <input
                value={qaUrl}
                onChange={(e) => setQaUrl(e.target.value)}
                className={inputClass}
                placeholder='http://localhost:5173'
              />
              {qaUrl.trim() === '' && (
                <span className='text-[11px] text-warn'>
                  Recommended — without a URL the agent only has the description to go on.
                </span>
              )}
            </label>

            <label className='flex flex-col gap-1.5'>
              <span className={labelClass}>Acceptance criteria</span>
              <textarea
                value={acceptanceCriteria}
                onChange={(e) => setAcceptanceCriteria(e.target.value)}
                rows={4}
                className={`${inputClass} resize-y leading-relaxed`}
                placeholder='One per line — the agent checks each against the live UI and reports PASS/FAIL with screenshots.'
              />
            </label>
          </div>
        ) : (
          <div className='glass-secondary shrink-0 p-3 opacity-50'>
            <p className='text-xs text-muted'>
              QA applies to execution tasks — research cards are done when their report is attached.
            </p>
          </div>
        )}

        <div className='flex items-center gap-2 justify-end'>
          <Button variant='secondary' onClick={onClose}>
            Cancel
          </Button>
          {card ? (
            <Button
              onClick={() => valid && onSave(buildInput(), attachmentIntent())}
              disabled={!valid}
            >
              Save
            </Button>
          ) : (
            <>
              <Button
                variant='secondary'
                onClick={() => valid && onSave(buildInput('refinement'), attachmentIntent())}
                disabled={!valid}
              >
                Save to Refinement
              </Button>
              <Button
                onClick={() => valid && onSave(buildInput('todo'), attachmentIntent())}
                disabled={!valid}
              >
                Queue in Todo
              </Button>
            </>
          )}
        </div>

        {managingTemplates && <TemplateManagerModal onClose={() => setManagingTemplates(false)} />}
      </div>
    </div>
  );
};
