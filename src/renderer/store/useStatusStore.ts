import { create } from 'zustand';
import { ToolId, ToolStatus, AgentState } from '../common/types';

interface StatusStore {
  statuses: Record<ToolId, ToolStatus>;
  updateStatus: (status: ToolStatus) => void;
  setInitialStatuses: (statuses: ToolStatus[]) => void;
}

export const useStatusStore = create<StatusStore>((set) => ({
  statuses: {},
  updateStatus: (status) =>
    set((state) => ({
      statuses: { ...state.statuses, [status.toolId]: status }
    })),
  setInitialStatuses: (statuses) =>
    set({
      statuses: statuses.reduce((acc, s) => ({ ...acc, [s.toolId]: s }), {}),
    }),
}));
