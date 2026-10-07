import React from 'react';
import TabBar from './TabBar.jsx';

/**
 * SegmentedControl - kept for backwards compatibility; delegates to the shared
 * TabBar so it can never scroll sideways.
 */
export default function SegmentedControl({ tabs, activeTab, onChange }) {
  return (
    <TabBar
      active={activeTab}
      onChange={onChange}
      tabs={(tabs || []).map((t) => ({ key: t.id, label: t.label, icon: t.icon }))}
    />
  );
}
