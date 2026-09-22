/* ═══════════════════════════════════════════════════════════════════════
   Dragging a stretch of time out of a grid.

   MEASURED BEFORE THIS LANDED. The calendar could move a block and resize
   a block, and that was the whole of its direct manipulation. To say "I am
   busy from two until four" you clicked empty space, which booked a
   default-length meeting at two, and then dragged its bottom edge to four.
   Two gestures and a guess for the thing a calendar is most often asked to
   do.

   Availability was worse: the hours people may book you were set with
   `<input type="time">` and five `<select>`s. A working week is a shape,
   and the page made you describe that shape in words.

   Both want the same three answers and neither had them written down:

     - where does a press-and-drag start and end, given people drag UPWARDS
       as often as down, and a range must never come out backwards

     - what happens when a new stretch lands on top of one that already
       exists - because the server rejects overlapping availability
       windows outright, so a painting gesture that does not merge is a
       painting gesture that 400s

     - what happens at the two edges of the day, where `snapMinutes`
       clamped to 23:45 and so nothing could ever be made to end at
       midnight

   Pure minute arithmetic, no DOM: this is the part that is invisible until
   it is wrong, and it is wrong in ways that read as a rendering bug.
   ═══════════════════════════════════════════════════════════════════════ */

/** Minutes in a day. The y axis of every grid in the app. */
export const DAY_MINUTES = 1440;

/** The step every drag lands on unless something says otherwise. */
export const DEFAULT_STEP = 15;

/** A stretch of one day, in minutes from midnight. Half-open: [start, end). */
export interface MinuteRange {
  startMinute: number;
  endMinute: number;
}

/**
 * Snap a position to the grid, anywhere in the day INCLUDING midnight.
 *
 * `snapMinutes` in calendar.types.ts deliberately clamps to
 * `DAY_MINUTES - step` because it answers "where does this START", and a
 * meeting starting at midnight-at-the-end-of-the-day is not a thing.
 *
 * An END is the other case, and sharing one function between them is why
 * dragging a block's bottom edge to the very bottom of the grid stopped at
 * 23:45 - the one time of day you most obviously want, and the one the
 * grid visibly has room for.
 */
export function snapToStep(minutes: number, step: number = DEFAULT_STEP): number {
  if (!Number.isFinite(minutes)) return 0;
  const s = Math.max(1, Math.round(step));
  const snapped = Math.round(minutes / s) * s;
  return Math.max(0, Math.min(DAY_MINUTES, snapped));
}

/**
 * The range described by pressing at one minute and releasing at another.
 *
 * `anchor` is where the press landed and does not move; `current` follows
 * the pointer. Dragging upward is not an error and not a no-op - it is how
 * people select the hour before the thing they are looking at - so the
 * result is ordered rather than assuming the press came first.
 *
 * `min` keeps a range that has barely moved from collapsing to nothing.
 * A zero-height block cannot be seen, cannot be clicked, and on release
 * would commit a meeting with no duration.
 *
 * The clamp preserves LENGTH rather than truncating: dragging past the
 * bottom of the grid should give you the last `min` minutes of the day,
 * not an invisible range sitting on the boundary.
 */
export function dragRange(
  anchorMinute: number,
  currentMinute: number,
  step: number = DEFAULT_STEP,
  min: number = step,
): MinuteRange {
  const s = Math.max(1, Math.round(step));
  const floor = Math.max(s, Math.min(Math.round(min), DAY_MINUTES));

  const anchor = snapToStep(anchorMinute, s);
  const current = snapToStep(currentMinute, s);

  let startMinute: number;
  let endMinute: number;
  if (current < anchor) {
    // Dragging up: the anchor is the END of what is being described.
    endMinute = anchor;
    startMinute = Math.min(current, anchor - floor);
  } else {
    startMinute = anchor;
    endMinute = Math.max(current, anchor + floor);
  }

  // Slide, do not squash. Either edge can be pushed out of the day by the
  // minimum length near midnight.
  if (startMinute < 0) {
    endMinute += -startMinute;
    startMinute = 0;
  }
  if (endMinute > DAY_MINUTES) {
    startMinute -= endMinute - DAY_MINUTES;
    endMinute = DAY_MINUTES;
  }
  return {
    startMinute: Math.max(0, startMinute),
    endMinute: Math.min(DAY_MINUTES, endMinute),
  };
}

/** Sorted, with nothing zero-length. The shape every function here expects. */
function tidy(ranges: readonly MinuteRange[]): MinuteRange[] {
  return ranges
    .filter((r) => Number.isFinite(r.startMinute) && Number.isFinite(r.endMinute))
    .filter((r) => r.endMinute > r.startMinute)
    .map((r) => ({ startMinute: r.startMinute, endMinute: r.endMinute }))
    .sort((a, b) => a.startMinute - b.startMinute || a.endMinute - b.endMinute);
}

/**
 * Add a stretch to a day, absorbing anything it lands on.
 *
 * NOT optional tidiness. `replaceWindows` on the server refuses a day whose
 * windows overlap - it has to, because two overlapping windows offer the
 * same slot twice - so painting 9 to 11 over an existing 10 to 12 without
 * merging produces a week that cannot be saved, and the only feedback is a
 * red toast some time later.
 *
 * Touching counts as overlapping here, which is the opposite of the rule in
 * `overlaps()`. That function answers "do these two meetings clash", where
 * back-to-back must stay legal or every hour loses a slot. This one answers
 * "how few windows describe the same time", and 9-to-12 plus 12-to-5 is one
 * working day written twice.
 */
export function addRange(ranges: readonly MinuteRange[], add: MinuteRange): MinuteRange[] {
  const all = tidy([...ranges, add]);
  const out: MinuteRange[] = [];
  for (const r of all) {
    const last = out[out.length - 1];
    if (last && r.startMinute <= last.endMinute) {
      if (r.endMinute > last.endMinute) last.endMinute = r.endMinute;
    } else {
      out.push({ ...r });
    }
  }
  return out;
}

/**
 * Cut a stretch out of a day.
 *
 * A cut through the middle of a window leaves TWO windows, which is exactly
 * how somebody takes their lunch hour out of nine-to-five. A version that
 * only trims the edges silently refuses that, and the day either keeps the
 * hour or loses the afternoon.
 */
export function removeRange(ranges: readonly MinuteRange[], cut: MinuteRange): MinuteRange[] {
  if (!(cut.endMinute > cut.startMinute)) return tidy(ranges);
  const out: MinuteRange[] = [];
  for (const r of tidy(ranges)) {
    if (cut.endMinute <= r.startMinute || cut.startMinute >= r.endMinute) {
      out.push(r);
      continue;
    }
    if (r.startMinute < cut.startMinute) {
      out.push({ startMinute: r.startMinute, endMinute: cut.startMinute });
    }
    if (cut.endMinute < r.endMinute) {
      out.push({ startMinute: cut.endMinute, endMinute: r.endMinute });
    }
  }
  return out;
}

/**
 * Slide a stretch to a new start, keeping how long it is.
 *
 * Dragging a block moves it; it does not reshape it. Clamping the START
 * alone would let a two-hour window dragged to 23:00 run to 01:00 the next
 * morning, which is not a thing a weekday window can express.
 */
export function moveRange(
  range: MinuteRange,
  newStartMinute: number,
  step: number = DEFAULT_STEP,
): MinuteRange {
  const length = Math.max(1, range.endMinute - range.startMinute);
  const start = Math.max(0, Math.min(snapToStep(newStartMinute, step), DAY_MINUTES - length));
  return { startMinute: start, endMinute: start + length };
}

/**
 * Change one edge of a stretch, keeping the other where it is.
 *
 * The floor is applied AWAY from the edge being dragged, so pulling a
 * block's bottom up past its top leaves the top alone and gives you the
 * shortest legal block - rather than a range that has turned inside out.
 */
export function resizeRange(
  range: MinuteRange,
  edge: 'start' | 'end',
  toMinute: number,
  step: number = DEFAULT_STEP,
  min: number = step,
): MinuteRange {
  const floor = Math.max(1, Math.round(min));
  const at = snapToStep(toMinute, step);
  if (edge === 'start') {
    return {
      startMinute: Math.max(0, Math.min(at, range.endMinute - floor)),
      endMinute: range.endMinute,
    };
  }
  return {
    startMinute: range.startMinute,
    endMinute: Math.min(DAY_MINUTES, Math.max(at, range.startMinute + floor)),
  };
}

/**
 * What is wrong with a day's windows, or null.
 *
 * The server checks all of this and answers with a 400. That is the right
 * place for the last word and the wrong place for the only word: the page
 * lets you type 17:00 to 09:00, looks entirely happy about it, and tells
 * you on save - by which time you have edited four other days and the
 * message names a weekday rather than a field.
 */
export function rangeProblem(ranges: readonly MinuteRange[], dayName: string): string | null {
  for (const r of ranges) {
    if (!Number.isFinite(r.startMinute) || !Number.isFinite(r.endMinute)) {
      return `${dayName} has a time that is not a time.`;
    }
    if (r.endMinute <= r.startMinute) {
      return `${dayName} has a window that ends before it starts.`;
    }
    if (r.startMinute < 0 || r.endMinute > DAY_MINUTES) {
      return `${dayName} has a window outside the day.`;
    }
  }
  const sorted = tidy(ranges);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].startMinute < sorted[i - 1].endMinute) {
      return `Two windows overlap on ${dayName}.`;
    }
  }
  return null;
}
