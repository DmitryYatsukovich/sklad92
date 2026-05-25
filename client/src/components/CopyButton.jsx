import { useState } from 'react';

export async function copyTextToClipboard(text) {
  const s = String(text ?? '');
  if (!s) return false;
  try {
    await navigator.clipboard.writeText(s);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = s;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  }
}

export default function CopyButton({ value, title = 'Копировать', className = '' }) {
  const [copied, setCopied] = useState(false);
  const str = value != null && value !== '' ? String(value) : '';
  if (!str) return null;

  const onCopy = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const ok = await copyTextToClipboard(str);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    }
  };

  return (
    <button
      type="button"
      onClick={onCopy}
      title={copied ? 'Скопировано' : title}
      className={`shrink-0 p-1 rounded text-slate-500 hover:text-brand-400 hover:bg-slate-700/80 transition-opacity ${className}`}
      aria-label={title}
    >
      {copied ? (
        <span className="text-emerald-400 text-xs">✓</span>
      ) : (
        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <rect x="9" y="9" width="13" height="13" rx="2" />
          <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
        </svg>
      )}
    </button>
  );
}

export function CopyFieldRow({ label, copyValue, children, hint }) {
  const cv = copyValue != null && copyValue !== '' ? String(copyValue) : '';
  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-1">
        <label className="label mb-0">{label}</label>
        {cv ? <CopyButton value={cv} title={`Копировать: ${label}`} /> : null}
      </div>
      {children}
      {hint ? <p className="text-2xs text-slate-500 mt-1">{hint}</p> : null}
    </div>
  );
}

export function CopyTableCell({ value, children, className = '' }) {
  const cv = value != null && value !== '' ? String(value) : '';
  if (!cv && !children) {
    return <td className={className}>—</td>;
  }
  return (
    <td className={`${className} group`}>
      <div className="flex items-center gap-1 min-w-0">
        <span className="min-w-0 truncate flex-1">{children ?? cv}</span>
        {cv ? (
          <CopyButton
            value={cv}
            className="opacity-0 group-hover:opacity-100 focus:opacity-100"
          />
        ) : null}
      </div>
    </td>
  );
}
