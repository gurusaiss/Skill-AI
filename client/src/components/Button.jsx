import React from 'react';

// The one button style for the app. Labels are always readable (text-sm or
// larger, never smaller) and the hit area is at least 36px tall.
//   variant: primary | secondary | ghost | danger | success
//   size:    md (40px) | sm (36px)
const VARIANTS = {
  primary:
    'bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-lg shadow-indigo-500/20 hover:from-indigo-500 hover:to-violet-500',
  secondary:
    'border border-slate-600 bg-slate-800/80 text-slate-100 hover:bg-slate-700 hover:border-slate-500',
  ghost: 'text-slate-300 hover:bg-slate-800 hover:text-white',
  danger: 'border border-red-500/40 bg-red-500/10 text-red-300 hover:bg-red-500/20',
  success:
    'bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-lg shadow-emerald-500/20 hover:from-emerald-500 hover:to-teal-500',
};
const SIZES = {
  md: 'h-10 px-4 text-sm gap-2',
  sm: 'h-9 px-3 text-sm gap-1.5',
};

const Button = React.forwardRef(function Button(
  { variant = 'secondary', size = 'md', icon = null, loading = false, disabled = false, className = '', children, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center whitespace-nowrap rounded-lg font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 disabled:cursor-not-allowed disabled:opacity-50 ${SIZES[size] || SIZES.md} ${VARIANTS[variant] || VARIANTS.secondary} ${className}`}
      {...rest}
    >
      {loading ? (
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" aria-hidden="true" />
      ) : icon}
      {children}
    </button>
  );
});

export default Button;
