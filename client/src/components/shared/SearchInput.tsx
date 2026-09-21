import { Search, X } from 'lucide-react';
import { cn } from '../../lib/utils';

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

export function SearchInput({ value, onChange, placeholder = 'Search…', className }: SearchInputProps) {
  return (
    <div className={cn('relative flex items-center', className)}>
      <Search className="absolute left-2.5 h-3.5 w-3.5 text-[var(--text-tertiary)] pointer-events-none" />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-8 w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-app)] pl-8 pr-7 text-strong text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] hover:border-[var(--border-strong)] focus:border-[var(--indigo)] focus:outline-none focus:shadow-[0_0_0_3px_rgba(99,102,241,0.12)] transition-[border-color,box-shadow] duration-150"
      />
      {value && (
        <button
          onClick={() => onChange('')}
          className="absolute right-2 flex items-center justify-center h-4 w-4 rounded text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}
