import React from 'react';
import { ToolId, AgentState } from '../common/types';
import { motion } from 'framer-motion';
import { useStatusStore } from '../../store/useStatusStore';

interface BubbleProps {
  toolId: ToolId;
}

export const Bubble: React.FC<BubbleProps> = ({ toolId }) => {
  const status = useStatusStore((state) => state.statuses[toolId]);
  const state = status?.state || 'idle';

  const stateColors: Record<AgentState, string> = {
    idle: 'rgba(255, 255, 255, 0.2)',
    working: 'rgba(59, 130, 246, 0.5)', // Blue
    error: 'rgba(239, 68, 68, 0.5)',    // Red
  };

  const animations: Record<AgentState, any> = {
    idle: {
      scale: [1, 1.05, 1],
      opacity: [0.6, 0.8, 0.6],
      transition: { duration: 4, repeat: Infinity, ease: "easeInOut" }
    },
    working: {
      scale: [1, 1.2, 1],
      boxShadow: [
        '0 0 0px 0px rgba(59, 130, 246, 0)',
        '0 0 20px 5px rgba(59, 130, 246, 0.4)',
        '0 0 0px 0px rgba(59, 130, 246, 0)',
      ],
      transition: { duration: 2, repeat: Infinity, ease: "easeInOut" }
    },
    error: {
      x: [0, -5, 5, -5, 5, 0],
      transition: { duration: 0.5, repeat: Infinity, repeatDelay: 2 }
    },
  };

  return (
    <div className="flex items-center justify-center h-full w-full p-4">
      <motion.div
        animate={animations[state]}
        className="relative w-16 h-16 rounded-full flex items-center justify-center cursor-pointer"
        style={{
          background: `radial-gradient(circle, ${stateColors[state]} 0%, rgba(255,255,255,0.1) 100%)`,
          backdropFilter: 'blur(12px)',
          border: '1px solid rgba(255, 255, 255, 0.3)',
          boxShadow: '0 8px 32px 0 rgba(31, 38, 135, 0.37)',
        }}
      >
        {/* Tool Icon Placeholder */}
        <span className="text-xs font-bold text-white opacity-80 uppercase">
          {toolId.split('-')[0]}
        </span>

        {/* Orbiting Particle for Working state */}
        {state === 'working' && (
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
            className="absolute w-20 h-20 border-2 border-dashed border-blue-400/30 rounded-full"
          />
        )}
      </motion.div>
    </div>
  );
};
