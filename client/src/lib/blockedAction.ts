import type { MouseEvent } from 'react';
import toast from 'react-hot-toast';

/* ═══════════════════════════════════════════════════════════════════════
   A button that refuses, and says why.

   MEASURED BEFORE THIS LANDED: the app blocked actions by setting
   `disabled`, and Button.tsx added `disabled:pointer-events-none` on top.
   Several gates were conjunctions of four or five conditions and offered
   one grey rectangle between them.

   THE PART THAT MAKES THIS WORTH A SHARED FILE:

   Two of those call sites had already written the explanation out -

       disabled={sendingTest || !testEmailTo || !effectiveSmtp || ...}
       title={!effectiveSmtp ? 'Choose a sending account' : ...}

   - and it never appeared. A disabled control dispatches no pointer
     events, so browsers do not show its title; Chrome never does. Somebody
     did the thoughtful thing and the platform threw it away silently.

   So the answer is not "add a title". It is to stop using `disabled` for
   something the person could act on. aria-disabled tells assistive
   technology the control is unavailable, the styling says the same to
   everybody else, and because the element is still live it can be
   hovered, focused and asked.

   `disabled` still has a job: something briefly busy, where the label
   already reads "Saving..." and there is nothing to explain.
   ═══════════════════════════════════════════════════════════════════════ */

export interface BlockedProps<E extends HTMLElement = HTMLElement> {
  'aria-disabled': true | undefined;
  title: string | undefined;
  'data-blocked': '' | undefined;
  onClick: (e: MouseEvent<E>) => void;
}

/**
 * Props for any button-ish element that may be blocked.
 *
 * The single definition behind both `<Button blockedBy=...>` and the raw
 * `<button>` elements that carry their own styling - two copies of this
 * would agree right up until one of them was edited.
 *
 * Deliberately does NOT return `disabled`. That attribute is what makes a
 * blocked control unreachable, which is the whole problem.
 */
export function blockedProps<E extends HTMLElement = HTMLElement>(
  reason: string | null | undefined,
  onClick?: (e: MouseEvent<E>) => void,
): BlockedProps<E> {
  const blocked = !!reason;
  return {
    'aria-disabled': blocked || undefined,
    title: reason || undefined,
    'data-blocked': blocked ? '' : undefined,
    onClick: (e: MouseEvent<E>) => {
      if (blocked) {
        /*
         * preventDefault as well as swallowing the handler: without it a
         * type="submit" button inside a form would still submit, which is
         * exactly the thing being refused.
         */
        e.preventDefault();
        e.stopPropagation();
        // A direct answer to a deliberate click, read where the attention
        // already is. The same reason is on hover and on focus for anyone
        // who would rather not click to find out.
        toast.error(reason!);
        return;
      }
      onClick?.(e);
    },
  };
}

/** The look of a blocked control. No pointer-events-none, on purpose. */
export const BLOCKED_CLASS = 'opacity-45 cursor-not-allowed';
