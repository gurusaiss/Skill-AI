import React from 'react';

// Full-width page wrapper. Pages fill the screen on every side: only a small,
// consistent gutter, no centred max-w-* column that leaves empty bands left and
// right. Use `narrow` ONLY for single-column forms and reading pages (login,
// profile edit form), never for dashboards, tables or lists.
export default function PageContainer({ children, className = '', narrow = false, as: Tag = 'div' }) {
  return (
    <Tag
      className={`w-full min-w-0 px-3 sm:px-5 lg:px-6 2xl:px-8 py-4 sm:py-6 ${narrow ? 'max-w-3xl mx-auto' : ''} ${className}`}
    >
      {children}
    </Tag>
  );
}
