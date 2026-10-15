import React, { useEffect, useMemo, useRef, useState } from 'react';

export interface SearchableOption {
  value: string;
  label: string;
  /** Extra text matched by the search box (code, department, ...) */
  searchText?: string;
  /** Optional group shown as a small heading / tag (e.g. department) */
  group?: string;
}

interface SearchableSelectProps {
  id?: string;
  value: string;
  options: SearchableOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  /** Wrapper classes (default: full width) */
  className?: string;
  /** Smaller text, for toolbars */
  compact?: boolean;
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * A select you can type into: filters by every word typed (name, code or group),
 * supports ↑ ↓ Enter Esc, and shows the group of each option.
 */
const SearchableSelect: React.FC<SearchableSelectProps> = ({ id, value, options, onChange, placeholder = 'พิมพ์เพื่อค้นหา...', disabled, className = 'w-full', compact }) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const selected = options.find(o => o.value === value);

  const filtered = useMemo(() => {
    const tokens = norm(query).split(' ').filter(Boolean);
    if (tokens.length === 0) return options;
    return options.filter(o => {
      const hay = norm(`${o.label} ${o.searchText || ''} ${o.group || ''}`);
      return tokens.every(t => hay.includes(t));
    });
  }, [options, query]);

  useEffect(() => { setActive(0); }, [query, open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) { setOpen(false); setQuery(''); }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(`[data-idx="${active}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const choose = (o: SearchableOption) => {
    onChange(o.value);
    setOpen(false);
    setQuery('');
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive(a => Math.min(a + 1, filtered.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter') { if (open && filtered[active]) { e.preventDefault(); choose(filtered[active]); } }
    else if (e.key === 'Escape') { setOpen(false); setQuery(''); }
  };

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <input
        id={id}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        autoComplete="off"
        disabled={disabled}
        value={open ? query : (selected?.label || '')}
        placeholder={open ? (selected?.label || placeholder) : placeholder}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onChange={e => { setQuery(e.target.value); setOpen(true); }}
        onKeyDown={onKeyDown}
        className={`w-full p-2 pr-8 border border-slate-300 rounded-md focus:ring-blue-500 focus:border-blue-500 shadow-sm bg-white disabled:bg-slate-50 disabled:cursor-not-allowed ${compact ? 'text-sm' : ''}`}
      />
      <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 text-xs">▾</span>
      {open && (
        <ul ref={listRef} role="listbox" className="absolute z-30 mt-1 min-w-full w-max max-w-[90vw] max-h-64 overflow-y-auto bg-white border border-slate-300 rounded-md shadow-lg py-1">
          {filtered.length === 0 && <li className="px-3 py-2 text-sm text-slate-500">ไม่พบรายการที่ค้นหา</li>}
          {filtered.map((o, i) => {
            const showGroup = o.group && (i === 0 || filtered[i - 1].group !== o.group);
            return (
              <React.Fragment key={o.value}>
                {showGroup && <li className="px-3 pt-2 pb-1 text-[11px] font-semibold text-slate-500 bg-slate-50 sticky top-0">{o.group}</li>}
                <li
                  role="option"
                  aria-selected={o.value === value}
                  data-idx={i}
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={e => { e.preventDefault(); choose(o); }}
                  className={`px-3 py-1.5 text-sm cursor-pointer ${i === active ? 'bg-blue-600 text-white' : 'text-slate-800'} ${o.value === value && i !== active ? 'font-semibold bg-blue-50' : ''}`}
                >
                  {o.label}
                </li>
              </React.Fragment>
            );
          })}
        </ul>
      )}
    </div>
  );
};

export default SearchableSelect;
