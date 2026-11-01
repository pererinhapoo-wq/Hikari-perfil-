import { useState, useEffect } from 'react';

/**
 * Periodically updates the current epoch timestamp (ms) while the page remains open
 * so relative labels ("Agora", "Há 1 minuto", "Há 2 horas", etc.) advance without reload.
 */
export function useCurrentTime(intervalMs = 15000): number {
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    const timerId = window.setInterval(() => {
      setNow(Date.now());
    }, intervalMs);
    return () => window.clearInterval(timerId);
  }, [intervalMs]);

  return now;
}

/**
 * Formats an epoch timestamp (ms) as a Portuguese relative duration.
 * Examples:
 * - capitalized (default): "Agora", "Há 1 minuto", "Há 2 minutos", "Há 2 horas", "Há 3 dias"
 * - lowercase (for inline suffix after "— "): "agora", "há 1 minuto", "há 2 minutos"
 */
export function formatRelativeTime(
  createdAtTimestamp: number | undefined,
  now: number,
  fallbackText = '',
  lowercase = false
): string {
  if (typeof createdAtTimestamp !== 'number' || !Number.isFinite(createdAtTimestamp)) {
    return lowercase && fallbackText ? fallbackText.charAt(0).toLowerCase() + fallbackText.slice(1) : fallbackText;
  }

  const diffMs = Math.max(0, now - createdAtTimestamp);
  const diffSec = Math.floor(diffMs / 1000);

  if (diffSec < 60) {
    return lowercase ? 'agora' : 'Agora';
  }

  const prefix = lowercase ? 'há' : 'Há';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin === 1) return `${prefix} 1 minuto`;
  if (diffMin < 60) return `${prefix} ${diffMin} minutos`;

  const diffHour = Math.floor(diffMin / 60);
  if (diffHour === 1) return `${prefix} 1 hora`;
  if (diffHour < 24) return `${prefix} ${diffHour} horas`;

  const diffDay = Math.floor(diffHour / 24);
  if (diffDay === 1) return `${prefix} 1 dia`;
  if (diffDay < 7) return `${prefix} ${diffDay} dias`;

  const diffWeek = Math.floor(diffDay / 7);
  if (diffWeek === 1) return `${prefix} 1 semana`;
  if (diffWeek < 5) return `${prefix} ${diffWeek} semanas`;

  const diffMonth = Math.floor(diffDay / 30);
  if (diffMonth === 1) return `${prefix} 1 mês`;
  if (diffMonth < 12) return `${prefix} ${diffMonth} meses`;

  const diffYear = Math.floor(diffDay / 365);
  if (diffYear === 1) return `${prefix} 1 ano`;
  return `${prefix} ${diffYear} anos`;
}

/**
 * Formats an epoch timestamp (ms) as an exact localized pt-BR date and time string for tooltips.
 */
export function formatExactDateTime(createdAtTimestamp: number | undefined): string {
  if (typeof createdAtTimestamp !== 'number' || !Number.isFinite(createdAtTimestamp)) {
    return '';
  }
  return new Date(createdAtTimestamp).toLocaleString('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short'
  });
}

/**
 * Converts legacy human-readable labels ("Há 2 horas", "Ontem", "Há 3 dias", "Há 1 semana")
 * into an initial millisecond offset once on initial seed so original timestamps stay fixed across reloads.
 */
export function inferOffsetMsFromLabel(label: string): number {
  const normalized = label.trim().toLowerCase();
  const MINUTE = 60 * 1000;
  const HOUR = 60 * MINUTE;
  const DAY = 24 * HOUR;

  if (normalized === 'agora') return 0;
  if (normalized === 'ontem') return DAY;

  const match = normalized.match(/(\d+)\s*(minuto|minutos|hora|horas|dia|dias|semana|semanas|mês|meses)/);
  if (!match) return HOUR;

  const amount = parseInt(match[1], 10);
  const unit = match[2];

  if (unit.startsWith('minuto')) return amount * MINUTE;
  if (unit.startsWith('hora')) return amount * HOUR;
  if (unit.startsWith('dia')) return amount * DAY;
  if (unit.startsWith('semana')) return amount * 7 * DAY;
  if (unit.startsWith('mês') || unit.startsWith('mes')) return amount * 30 * DAY;

  return HOUR;
}
