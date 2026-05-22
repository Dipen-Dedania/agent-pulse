import React from 'react';

export function formatDuration(ms: number): string {
  if (!ms || ms < 0) return '0m';
  const totalMinutes = Math.round(ms / 60_000);
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

export function formatCompactNumber(n: number): string {
  if (n < 1000) return n.toString();
  if (n < 1_000_000) return (n / 1000).toFixed(n < 10_000 ? 1 : 0) + 'k';
  return (n / 1_000_000).toFixed(n < 10_000_000 ? 1 : 0) + 'M';
}

export const Card: React.FC<{
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}> = ({ title, subtitle, right, children }) => (
  <div className='mb-5 bg-slate-800/60 backdrop-blur-md border border-slate-700/70 rounded-2xl p-5 shadow-xl'>
    <div className='flex items-start justify-between gap-3 mb-4'>
      <div>
        <h3 className='text-base font-semibold text-white leading-tight'>{title}</h3>
        {subtitle && <p className='text-xs text-slate-400 mt-1'>{subtitle}</p>}
      </div>
      {right && <div className='shrink-0'>{right}</div>}
    </div>
    {children}
  </div>
);

export const Segmented: React.FC<{
  options: { value: string; label: string }[];
  value: string;
  onChange: (next: string) => void;
}> = ({ options, value, onChange }) => (
  <div className='inline-flex gap-1 p-1 bg-slate-800/60 border border-slate-700/60 rounded-lg'>
    {options.map((opt) => {
      const active = opt.value === value;
      return (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={`px-2.5 py-1 rounded-md text-xs font-medium cursor-pointer transition-colors ${
            active ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white'
          }`}
        >
          {opt.label}
        </button>
      );
    })}
  </div>
);

export const InfoPill: React.FC<{ children: React.ReactNode; tone?: 'info' | 'warn' }> = ({ children, tone = 'info' }) => {
  const cls = tone === 'warn'
    ? 'bg-amber-500/15 border-amber-500/30 text-amber-200'
    : 'bg-blue-500/10 border-blue-500/30 text-blue-200';
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border ${cls} text-[11px]`}>
      {children}
    </span>
  );
};

export const EmptyState: React.FC<{ message: string }> = ({ message }) => (
  <div className='flex items-center justify-center py-8 text-sm text-slate-500'>{message}</div>
);

export const SkeletonLine: React.FC<{ width?: string; height?: string }> = ({ width = '100%', height = '0.75rem' }) => (
  <div className='bg-slate-700/40 rounded animate-pulse' style={{ width, height }} />
);
