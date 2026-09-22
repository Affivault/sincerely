import { clsx, type ClassValue } from 'clsx';
import { formatDate } from '@lemlist/shared';

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
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
 * Format a past date as a human-readable relative time string.
 * Returns strings like "just now", "5m ago", "3h ago", "yesterday", "3 days ago",
 * falling back to an absolute date for anything older than 30 days.
 */
export function formatRelativeTime(date: string | Date | null | undefined): string {
  if (!date) return '—';
  const d = new Date(date);
  if (isNaN(d.getTime())) return '—';
  const diffMs = Date.now() - d.getTime();
  if (diffMs < 0) return formatDate(d);
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  return formatDate(d);
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
