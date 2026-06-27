import { useState, useRef, useEffect } from 'react';
import { ChevronDown, User, Building2, Briefcase, Mail, Phone, Globe, Linkedin, Hash, Sparkles, MapPin, Globe2 } from 'lucide-react';

export interface MergeTag {
  label: string;
  value: string;
  icon: React.ElementType;
  category: string;
  description: string;
}

const MERGE_TAGS: MergeTag[] = [
  // Contact Info
  { label: 'First Name', value: '{{first_name}}', icon: User, category: 'Contact', description: 'Contact\'s first name' },
  { label: 'Last Name', value: '{{last_name}}', icon: User, category: 'Contact', description: 'Contact\'s last name' },
  { label: 'Full Name', value: '{{full_name}}', icon: User, category: 'Contact', description: 'First + last name' },
  { label: 'Email', value: '{{email}}', icon: Mail, category: 'Contact', description: 'Contact\'s email address' },
  { label: 'Phone', value: '{{phone}}', icon: Phone, category: 'Contact', description: 'Contact\'s phone number' },
  { label: 'City', value: '{{city}}', icon: MapPin, category: 'Contact', description: 'Contact\'s city' },
  { label: 'Country', value: '{{country}}', icon: Globe2, category: 'Contact', description: 'Contact\'s country' },

  // Professional
  { label: 'Company', value: '{{company}}', icon: Building2, category: 'Professional', description: 'Company name' },
  { label: 'Job Title', value: '{{job_title}}', icon: Briefcase, category: 'Professional', description: 'Job title or role' },
  { label: 'Website', value: '{{website}}', icon: Globe, category: 'Professional', description: 'Website URL' },
  { label: 'LinkedIn', value: '{{linkedin_url}}', icon: Linkedin, category: 'Professional', description: 'LinkedIn profile URL' },

  // Custom
  { label: 'Custom Field 1', value: '{{custom_field_1}}', icon: Hash, category: 'Custom', description: 'Custom field 1' },
  { label: 'Custom Field 2', value: '{{custom_field_2}}', icon: Hash, category: 'Custom', description: 'Custom field 2' },

  // Dynamic
  { label: 'Unsubscribe Link', value: '{{unsubscribe_link}}', icon: Sparkles, category: 'Dynamic', description: 'Opt-out link' },
];

interface PersonalizationDropdownProps {
  onInsert: (tag: string) => void;
  variant?: 'button' | 'icon';
}

export function PersonalizationDropdown({ onInsert, variant = 'button' }: PersonalizationDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setSearch('');
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filteredTags = MERGE_TAGS.filter(
    (tag) =>
      tag.label.toLowerCase().includes(search.toLowerCase()) ||
      tag.value.toLowerCase().includes(search.toLowerCase()) ||
      tag.category.toLowerCase().includes(search.toLowerCase())
  );

  const categories = [...new Set(filteredTags.map((t) => t.category))];

  const handleInsert = (tag: MergeTag) => {
    onInsert(tag.value);
    setIsOpen(false);
    setSearch('');
  };

  return (
    <div className="relative" ref={dropdownRef}>
      {variant === 'button' ? (
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-[var(--text-primary)] bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded-lg hover:bg-[var(--bg-hover)] hover:border-[var(--border-default)] transition-all duration-200"
        >
          <Sparkles className="h-4 w-4" />
          Personalize
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="p-2 text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] rounded-lg transition-colors"
          title="Insert personalization"
        >
          <Sparkles className="h-4 w-4" />
        </button>
      )}

      {isOpen && (
        <div className="absolute right-0 top-full mt-2 w-80 bg-[var(--bg-surface)] rounded-xl border border-[var(--border-subtle)] shadow-xl z-50 animate-fade-in overflow-hidden">
          {/* Search */}
          <div className="p-3 border-b border-[var(--border-subtle)]">
            <input
              type="text"
              placeholder="Search variables..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full h-9 px-3 text-sm rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] focus:border-[var(--border-default)] focus:bg-[var(--bg-surface)] focus:outline-none focus:ring-2 focus:ring-[var(--text-primary)]/10 transition-all"
              autoFocus
            />
          </div>

          {/* Tags list */}
          <div className="max-h-64 overflow-y-auto py-2">
            {categories.map((category) => (
              <div key={category}>
                <p className="px-4 py-1.5 text-xs font-semibold text-[var(--text-tertiary)] uppercase tracking-wider">
                  {category}
                </p>
                {filteredTags
                  .filter((t) => t.category === category)
                  .map((tag) => (
                    <button
                      key={tag.value}
                      type="button"
                      onClick={() => handleInsert(tag)}
                      className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-[var(--bg-hover)] transition-colors text-left"
                    >
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--bg-elevated)] text-[var(--text-secondary)]">
                        <tag.icon className="h-4 w-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-[var(--text-primary)]">{tag.label}</p>
                        <p className="text-xs text-[var(--text-tertiary)] truncate">{tag.description}</p>
                      </div>
                      <code className="text-xs text-[var(--text-secondary)] bg-[var(--bg-elevated)] px-1.5 py-0.5 rounded font-mono">
                        {tag.value}
                      </code>
                    </button>
                  ))}
              </div>
            ))}

            {filteredTags.length === 0 && (
              <p className="px-4 py-6 text-sm text-[var(--text-tertiary)] text-center">No variables found</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export { MERGE_TAGS };
