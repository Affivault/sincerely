import { useQuery } from '@tanstack/react-query';
import { Copy } from 'lucide-react';
import { plural } from '@lemlist/shared';
import { contactsApi } from '../../api/contacts.api';
import { PageHeader } from '../../components/shared/PageHeader';
import { AsyncPanel } from '../../components/ui/AsyncPanel';
import { DuplicateGroups } from '../../components/contacts/Duplicates';

/**
 * Every likely duplicate in the account, one card per person.
 *
 * Reached from the line above the contacts table. Each card says why its
 * records were matched, so "merge" is a decision somebody makes with the
 * evidence in front of them, not a button they press on faith.
 */
export function DuplicatesPage() {
  const q = useQuery({
    queryKey: ['contact-duplicates', 'all'],
    queryFn: () => contactsApi.duplicates(100),
    retry: false,
  });

  return (
    <div className="space-y-5">
      <PageHeader
        icon={Copy}
        title="Possible duplicates"
        breadcrumbs={[{ label: 'Contacts', href: '/contacts' }, { label: 'Possible duplicates' }]}
        description="Records that look like the same person: the same address (ignoring case, +tags and Gmail dots), the same LinkedIn profile, or the same name at the same company."
        meta={q.data && q.data.total > q.data.groups.length
          ? <span className="text-caption text-[var(--text-tertiary)]">Showing {q.data.groups.length} of {plural(q.data.total, 'group')}</span>
          : undefined}
      />
      <AsyncPanel
        query={q}
        skeleton="cards"
        skeletonRows={4}
        isEmpty={(d) => d.groups.length === 0}
        empty={{
          icon: Copy,
          title: 'No duplicates found',
          description: 'Nobody in your contacts looks like the same person twice. New imports are checked whenever you come back here.',
        }}
      >
        {(d) => <DuplicateGroups groups={d.groups} />}
      </AsyncPanel>
    </div>
  );
}
