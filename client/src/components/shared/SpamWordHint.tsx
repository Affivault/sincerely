import { AlertTriangle } from 'lucide-react';
import { checkSpamSignals, hasSpamSignals } from '../../lib/spamCheck';

export function SpamWordHint({ subject, bodyHtml }: { subject: string; bodyHtml: string }) {
  const result = checkSpamSignals(subject, bodyHtml);
  if (!hasSpamSignals(result)) return null;

  const notes: string[] = [];
  if (result.hasExcessiveCaps) notes.push('subject is mostly caps');
  if (result.hasExcessivePunctuation) notes.push('subject has excessive punctuation');

  return (
    <div className="flex items-start gap-1.5 mt-1 px-0.5">
      <AlertTriangle className="h-3 w-3 text-amber-500 flex-shrink-0 mt-px" />
      <p className="text-[10.5px] text-amber-600 dark:text-amber-400 leading-snug">
        May trigger spam filters
        {result.matches.length > 0 && (
          <>: <span className="font-medium">{result.matches.join(', ')}</span></>
        )}
        {notes.length > 0 && <> ({notes.join(', ')})</>}
      </p>
    </div>
  );
}
