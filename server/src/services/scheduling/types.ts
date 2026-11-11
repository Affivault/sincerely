/** One person booked into one meeting, as Calendly or Cal.com reports it. */
export interface ExternalBooking {
  /** Stable per booking and person: "<booking id>:<email>". */
  key: string;
  /** The booking itself (a Calendly event uuid, a Cal.com booking uid), for cancellations. */
  bookingId: string;
  email: string;
  name: string;
  title: string;
  start: string;
  end: string | null;
  timezone: string | null;
  location: string | null;
  /** What they wrote in the booking form. */
  answers: string | null;
  cancelled: boolean;
  cancelReason?: string | null;
  /** The booking this one replaces, when it was a reschedule. */
  rescheduledFrom?: string | null;
}

export interface SchedulingAccount {
  /** Calendly user URI / Cal.com user id. */
  id: string;
  name: string | null;
  /** Calendly organization URI (needed to subscribe). */
  organization?: string | null;
}

export interface SchedulingAdapter {
  provider: 'calendly' | 'calcom';
  label: string;
  me(): Promise<SchedulingAccount>;
  /** Ask for instant notifications. 'unavailable' when the plan does not allow it (we check on a schedule instead). */
  subscribe(url: string, secret: string, account: SchedulingAccount): Promise<{ id: string } | 'unavailable'>;
  unsubscribe(id: string): Promise<void>;
  /** Check a notification really came from the tool. */
  verify(rawBody: string, headers: Record<string, string | string[] | undefined>, secret: string): boolean;
  /** Bookings in one notification (usually one), or null for one we do not act on. */
  parse(body: any): ExternalBooking[] | null;
  /** Bookings made or cancelled recently, for accounts without notifications. */
  recent(account: SchedulingAccount, since: string): Promise<{ bookings: ExternalBooking[]; cancelledIds: string[] }>;
}
