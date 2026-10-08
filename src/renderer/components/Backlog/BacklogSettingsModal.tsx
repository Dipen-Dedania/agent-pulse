import React, { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { BacklogPopulationConfig, BacklogSchedulerConfig, BacklogSchedulerStatus } from '../../../common/backlog-types';
import { Modal, Tabs } from '../Shared';
import { tabContent, tabContentTransition } from '../../motion';
import { BacklogSchedulerSection } from './BacklogSchedulerSection';
import { BacklogPopulationSection } from './BacklogPopulationSection';

// ⚙ in the board header opens the board's own settings here instead of on a
// Settings tab. Both tabs govern this board, not one tool: the night session
// runs cards on either agent (Claude Code or Codex, per card), and issue
// population feeds the board from GitLab / Linear / JIRA — so neither tool's
// Plans & Limits sub-tab is the right home. Config ownership stays with
// SettingsPanel (one loader + config-updated subscription per config for the
// whole panel); the board threads both through. autoFocus is off: the first
// <input> is a slot's start time, well below the status glance the dialog
// should open on.

export type BacklogSettingsTab = 'scheduler' | 'population';

const TABS: { value: BacklogSettingsTab; label: string }[] = [
  { value: 'scheduler', label: 'Night session' },
  { value: 'population', label: 'Issue population' },
];

interface Props {
  config: BacklogSchedulerConfig;
  status: BacklogSchedulerStatus | null;
  onChange: (partial: Partial<BacklogSchedulerConfig>) => void;
  /** null until SettingsPanel's config load resolves. */
  populationConfig: BacklogPopulationConfig | null;
  onPopulationChange: (partial: Partial<BacklogPopulationConfig>) => void;
  initialTab?: BacklogSettingsTab;
  onClose: () => void;
}

export const BacklogSettingsModal: React.FC<Props> = ({
  config,
  status,
  onChange,
  populationConfig,
  onPopulationChange,
  initialTab = 'scheduler',
  onClose,
}) => {
  const [tab, setTab] = useState<BacklogSettingsTab>(initialTab);

  return (
    <Modal
      eyebrow='Backlog'
      title='Backlog settings'
      onClose={onClose}
      maxWidthClass='max-w-2xl'
      autoFocus={false}
    >
      {/* shrink-0: the Modal panel is a max-height flex column that scrolls, and
          .glass-secondary is overflow-hidden, so without it this track is the
          one child allowed to shrink and collapses to a sliver once the Night
          session body outgrows the panel. */}
      <Tabs
        tabs={TABS}
        value={tab}
        onChange={(v) => setTab(v as BacklogSettingsTab)}
        tone='blue'
        className='glass-secondary w-fit shrink-0'
        ariaLabel='Backlog settings sections'
      />
      {/* Tab body — the panel's standard cross-fade + settle-in (same
          variants as SettingsPanel's tab swap). */}
      <AnimatePresence mode='wait'>
        <motion.div
          key={tab}
          variants={tabContent}
          initial='initial'
          animate='animate'
          exit='exit'
          transition={tabContentTransition}
        >
          {tab === 'scheduler' ? (
            <BacklogSchedulerSection config={config} status={status} onChange={onChange} />
          ) : populationConfig ? (
            <BacklogPopulationSection config={populationConfig} onChange={onPopulationChange} />
          ) : (
            <p className='text-sm text-muted'>Loading issue population settings…</p>
          )}
        </motion.div>
      </AnimatePresence>
    </Modal>
  );
};
