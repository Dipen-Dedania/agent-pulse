import React from 'react';
import { BacklogSchedulerConfig, BacklogSchedulerStatus } from '../../../common/backlog-types';
import { Modal } from '../Shared';
import { BacklogSchedulerSection } from './BacklogSchedulerSection';

// ⚙ in the board header opens the Backlog Scheduler here instead of on a
// Settings tab. Its windows, idle gate, usage gate, and notifications govern
// this board, and cards run on either agent, so neither tool's Plans & Limits
// sub-tab is the right home. Config ownership stays with SettingsPanel (one
// loader + config-updated subscription for the whole panel); the board threads
// it through. autoFocus is off: the first <input> is a slot's start time, well
// below the status glance the dialog should open on.

interface Props {
  config: BacklogSchedulerConfig;
  status: BacklogSchedulerStatus | null;
  onChange: (partial: Partial<BacklogSchedulerConfig>) => void;
  onClose: () => void;
}

export const BacklogSchedulerModal: React.FC<Props> = ({ config, status, onChange, onClose }) => (
  <Modal
    eyebrow='Night session'
    title='Backlog Scheduler'
    onClose={onClose}
    maxWidthClass='max-w-2xl'
    autoFocus={false}
  >
    <BacklogSchedulerSection config={config} status={status} onChange={onChange} />
  </Modal>
);
