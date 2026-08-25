import React from 'react';

/**
 * SegmentedControl - Modern tab navigation component
 * Provides a premium, animated tab switcher with smooth transitions
 */
export default function SegmentedControl({ tabs, activeTab, onChange }) {
  return (
    <div className="inline-flex items-center gap-1 p-1 rounded-xl bg-slate-900/60 border border-slate-700/50">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={`
            relative px-4 py-2.5 rounded-lg text-sm font-bold transition-all duration-200
            flex items-center gap-2 whitespace-nowrap
            ${
              activeTab === tab.id
                ? 'text-white bg-gradient-to-r from-indigo-600 to-purple-600 shadow-lg shadow-indigo-500/20'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
            }
          `}
        >
          {tab.icon && <span className="text-base">{tab.icon}</span>}
          <span className="hidden sm:inline">{tab.label}</span>
          <span className="sm:hidden">{tab.icon}</span>
        </button>
      ))}
    </div>
  );
}
