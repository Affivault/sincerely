import { clsx, type ClassValue } from 'clsx';

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

export function formatDate(date: string | Date): string {
  return new Date(date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function formatDateTime(date: string | Date): string {
  return new Date(date).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function getInitials(firstName?: string | null, lastName?: string | null, email?: string): string {
  if (firstName && lastName) {
    return `${firstName[0]}${lastName[0]}`.toUpperCase();
  }
  if (firstName) {
    return firstName[0].toUpperCase();
  }
  if (email) {
    return email[0].toUpperCase();
  }
  return '?';
}

export function truncate(str: string, length: number): string {
  if (str.length <= length) return str;
  return str.slice(0, length) + '...';
}

export function percentage(value: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((value / total) * 100 * 10) / 10;
}

/**
 * Format a future date as a human-readable relative time string.
 * Returns strings like "in 3h 15m", "in 2 days", "overdue", or "now".
 */
export function formatTimeUntil(date: string | Date): string {
  const target = new Date(date).getTime();
  const now = Date.now();
  const diffMs = target - now;

  if (diffMs <= 0) return 'overdue';

  const totalSeconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days >= 2) return `in ${days} days`;
  if (days === 1) {
    const remainingHours = hours - 24;
    return remainingHours > 0 ? `in 1d ${remainingHours}h` : 'in 1 day';
  }
  if (hours >= 1) {
    const remainingMins = minutes - hours * 60;
    return remainingMins > 0 ? `in ${hours}h ${remainingMins}m` : `in ${hours}h`;
  }
  if (minutes >= 1) return `in ${minutes}m`;
  return 'now';
}
