import { useState, useEffect } from 'react';

interface SharedClockBucket {
  intervalMs: number;
  currentNow: number;
  intervalId: ReturnType<typeof setInterval> | null;
  subscribers: Set<(nowMs: number) => void>;
}

const clockBuckets = new Map<number, SharedClockBucket>();
let visibilityListenerRegistered = false;

function isDocumentHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

function startBucketTimer(bucket: SharedClockBucket): void {
  if (bucket.intervalId !== null || bucket.subscribers.size === 0) return;
  if (typeof window === 'undefined' || isDocumentHidden()) return;

  bucket.intervalId = setInterval(() => {
    if (isDocumentHidden()) {
      stopBucketTimer(bucket);
      return;
    }
    const tickNow = Date.now();
    bucket.currentNow = tickNow;
    for (const notify of bucket.subscribers) {
      notify(tickNow);
    }
  }, bucket.intervalMs);
}

function stopBucketTimer(bucket: SharedClockBucket): void {
  if (bucket.intervalId !== null) {
    clearInterval(bucket.intervalId);
    bucket.intervalId = null;
  }
}

function handleGlobalVisibilityChange(): void {
  const hidden = isDocumentHidden();
  const now = Date.now();

  for (const bucket of clockBuckets.values()) {
    if (hidden) {
      stopBucketTimer(bucket);
    } else if (bucket.subscribers.size > 0) {
      bucket.currentNow = now;
      for (const notify of bucket.subscribers) {
        notify(now);
      }
      startBucketTimer(bucket);
    }
  }
}

function attachGlobalVisibilityListener(): void {
  if (visibilityListenerRegistered || typeof document === 'undefined') return;
  document.addEventListener('visibilitychange', handleGlobalVisibilityChange);
  visibilityListenerRegistered = true;
}

function detachGlobalVisibilityListenerIfIdle(): void {
  if (!visibilityListenerRegistered || typeof document === 'undefined') return;
  let totalSubscribers = 0;
  for (const bucket of clockBuckets.values()) {
    totalSubscribers += bucket.subscribers.size;
  }
  if (totalSubscribers === 0) {
    document.removeEventListener('visibilitychange', handleGlobalVisibilityChange);
    visibilityListenerRegistered = false;
  }
}

/**
 * Assinatura imperativa ao relógio compartilhado centralizado por intervalMs.
 * Garante no máximo 1 timer por intervalo em toda a aplicação, pausando automaticamente
 * quando document.visibilityState === 'hidden' e limpando recursos quando não há inscritos.
 */
export function subscribeToSharedClock(
  listener: (nowMs: number) => void,
  intervalMs = 15000
): () => void {
  const normalizedInterval = Math.max(1000, Math.floor(intervalMs));
  let bucket = clockBuckets.get(normalizedInterval);
  if (!bucket) {
    bucket = {
      intervalMs: normalizedInterval,
      currentNow: Date.now(),
      intervalId: null,
      subscribers: new Set(),
    };
    clockBuckets.set(normalizedInterval, bucket);
  }

  bucket.subscribers.add(listener);
  attachGlobalVisibilityListener();
  startBucketTimer(bucket);

  return () => {
    const activeBucket = clockBuckets.get(normalizedInterval);
    if (!activeBucket) return;
    activeBucket.subscribers.delete(listener);
    if (activeBucket.subscribers.size === 0) {
      stopBucketTimer(activeBucket);
      clockBuckets.delete(normalizedInterval);
    }
    detachGlobalVisibilityListenerIfIdle();
  };
}

/**
 * Métricas diagnósticas do relógio compartilhado para verificação automatizada de timers ativos.
 */
export function getSharedClockDiagnostics(): {
  activeTimersCount: number;
  totalSubscribersCount: number;
} {
  let activeTimersCount = 0;
  let totalSubscribersCount = 0;
  for (const bucket of clockBuckets.values()) {
    if (bucket.intervalId !== null) {
      activeTimersCount++;
    }
    totalSubscribersCount += bucket.subscribers.size;
  }
  return { activeTimersCount, totalSubscribersCount };
}

/**
 * Hook que retorna o instante atual (ms) compartilhando um único timer centralizado
 * e pausando automaticamente quando a aba está em segundo plano.
 */
export function useCurrentTime(intervalMs = 15000): number {
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    if (typeof window === 'undefined') return;
    return subscribeToSharedClock((tickNow) => {
      setNow(tickNow);
    }, intervalMs);
  }, [intervalMs]);

  return now;
}

/**
 * Hook otimizado para rótulos de tempo relativo:
 * - Não cria assinatura de timer se o item usar apenas texto fixo (sem timestamp numérico).
 * - Compartilha o único relógio centralizado para itens dinâmicos.
 * - Só dispara re-renderização do componente folha quando o texto formatado realmente muda
 *   (ex: evita re-renderizar "Há 3 dias" a cada 15 segundos).
 */
export function useRelativeTimeLabel(
  timestamp: number | undefined,
  fallbackText = '',
  lowercase = false,
  intervalMs = 15000
): string {
  const hasNumericTimestamp =
    typeof timestamp === 'number' && Number.isFinite(timestamp) && timestamp > 0;

  const [label, setLabel] = useState<string>(() =>
    formatRelativeTime(timestamp, Date.now(), fallbackText, lowercase)
  );

  useEffect(() => {
    setLabel(formatRelativeTime(timestamp, Date.now(), fallbackText, lowercase));

    if (!hasNumericTimestamp || typeof window === 'undefined') {
      return;
    }

    return subscribeToSharedClock((tickNow) => {
      const nextLabel = formatRelativeTime(timestamp, tickNow, fallbackText, lowercase);
      setLabel((prev) => (prev === nextLabel ? prev : nextLabel));
    }, intervalMs);
  }, [timestamp, fallbackText, lowercase, intervalMs, hasNumericTimestamp]);

  return label;
}

/**
 * Formata um timestamp (ms) para tempo relativo natural em português.
 * - Menos de 60s: "Agora" (ou "agora")
 * - 1 a 59 min: "Há X minuto(s)"
 * - 1 a 23 h: "Há X hora(s)"
 * - 1 a 6 dias: "Há X dia(s)"
 * - 7 a 29 dias: "Há X semana(s)"
 * - 30 a 364 dias: "Há X mês/meses"
 * - 365+ dias: "Há X ano(s)"
 */
export function formatRelativeTime(
  timestamp: number | undefined,
  nowMs: number,
  fallbackText = '',
  lowercase = false
): string {
  if (!timestamp || !Number.isFinite(timestamp)) {
    return fallbackText;
  }

  const diffSeconds = Math.max(0, Math.floor((nowMs - timestamp) / 1000));
  const prefix = lowercase ? 'há' : 'Há';

  if (diffSeconds < 60) {
    return lowercase ? 'agora' : 'Agora';
  }

  const minutes = Math.floor(diffSeconds / 60);
  if (minutes < 60) {
    return minutes === 1 ? `${prefix} 1 minuto` : `${prefix} ${minutes} minutos`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return hours === 1 ? `${prefix} 1 hora` : `${prefix} ${hours} horas`;
  }

  const days = Math.floor(hours / 24);
  if (days < 7) {
    return days === 1 ? `${prefix} 1 dia` : `${prefix} ${days} dias`;
  }

  if (days < 30) {
    const weeks = Math.floor(days / 7);
    return weeks === 1 ? `${prefix} 1 semana` : `${prefix} ${weeks} semanas`;
  }

  if (days < 365) {
    const months = Math.floor(days / 30);
    return months === 1 ? `${prefix} 1 mês` : `${prefix} ${months} meses`;
  }

  const years = Math.floor(days / 365);
  return years === 1 ? `${prefix} 1 ano` : `${prefix} ${years} anos`;
}

/**
 * Formata data completa para exibição em tooltips de acessibilidade.
 */
export function formatExactDateTime(timestamp: number | undefined): string {
  if (!timestamp || !Number.isFinite(timestamp)) return '';
  return new Date(timestamp).toLocaleString('pt-BR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Infere um deslocamento em milissegundos a partir de um rótulo textual legado
 * (ex: "Há 2 horas", "Há 3 dias", "Há 1 semana") para converter dados iniciais sem timestamp numérico.
 */
export function inferOffsetMsFromLabel(label: string): number {
  const normalized = label.trim().toLowerCase();
  if (!normalized || normalized === 'agora' || normalized === 'agora mesmo') {
    return 0;
  }
  const match = normalized.match(/(\d+)\s*(minuto|hora|dia|semana|m[eê]s|ano)/);
  if (!match) return 0;

  const value = parseInt(match[1], 10);
  const unit = match[2];

  if (unit.startsWith('minuto')) return value * 60 * 1000;
  if (unit.startsWith('hora')) return value * 3600 * 1000;
  if (unit.startsWith('dia')) return value * 86400 * 1000;
  if (unit.startsWith('semana')) return value * 7 * 86400 * 1000;
  if (unit.startsWith('m')) return value * 30 * 86400 * 1000;
  if (unit.startsWith('ano')) return value * 365 * 86400 * 1000;
  return 0;
}
