import React from 'react';
import {
  Loader2,
  Pause,
  Play,
  RotateCcw,
  CheckCircle2,
  AlertCircle,
  X,
  Layers,
} from 'lucide-react';
import type { ImportCheckpoint, ImportProvider } from '../../services/importSyncManager';

interface ImportProgressCardProps {
  checkpoint: ImportCheckpoint;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
  onRetry: () => void;
  onDismiss?: () => void;
}

export const ImportProgressCard: React.FC<ImportProgressCardProps> = ({
  checkpoint,
  onPause,
  onResume,
  onCancel,
  onRetry,
  onDismiss,
}) => {
  const isMAL = checkpoint.provider === 'mal';
  const providerLabel = isMAL ? 'MyAnimeList' : 'AniList';
  const accentColor = isMAL ? '#2E51A2' : '#8B5CF6';

  const hasEstimatedTotal =
    typeof checkpoint.totalEstimated === 'number' && checkpoint.totalEstimated > 0;

  const percentage = hasEstimatedTotal
    ? Math.min(100, Math.round((checkpoint.recordsReceived / checkpoint.totalEstimated!) * 100))
    : null;

  const statusLabel =
    checkpoint.status === 'in_progress'
      ? 'Em andamento'
      : checkpoint.status === 'paused'
      ? 'Pausada'
      : checkpoint.status === 'error'
      ? 'Interrompida por erro'
      : checkpoint.status === 'completed'
      ? 'Concluída'
      : 'Aguardando';

  return (
    <div
      role="region"
      aria-label={`Progresso de importação do ${providerLabel}`}
      className="rounded-xl border p-3.5 sm:p-4 space-y-3 transition-all animate-in fade-in"
      style={{
        backgroundColor: isMAL ? '#0c1122' : '#140e29',
        borderColor: isMAL ? 'rgba(46, 81, 162, 0.45)' : 'rgba(139, 92, 246, 0.4)',
      }}
    >
      {/* Header with Account and Status Badge */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Layers className="h-4 w-4 shrink-0" style={{ color: accentColor }} />
          <div className="min-w-0">
            <span className="text-xs font-bold text-white truncate block">
              Sincronização Incremental: @{checkpoint.accountIdentifier} ({providerLabel})
            </span>
            <span className="text-[10px] text-purple-300/60 block">
              Checkpoint persistente · Retomável a qualquer momento
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {checkpoint.status === 'in_progress' && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-purple-950/80 border border-purple-500/50 px-2.5 py-0.5 text-[11px] font-semibold text-purple-300">
              <Loader2 className="h-3 w-3 animate-spin text-purple-400" />
              <span>{statusLabel}</span>
            </span>
          )}

          {checkpoint.status === 'paused' && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-950/80 border border-amber-500/50 px-2.5 py-0.5 text-[11px] font-semibold text-amber-300">
              <Pause className="h-3 w-3 text-amber-400" />
              <span>{statusLabel}</span>
            </span>
          )}

          {checkpoint.status === 'error' && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-950/80 border border-rose-500/50 px-2.5 py-0.5 text-[11px] font-semibold text-rose-300">
              <AlertCircle className="h-3 w-3 text-rose-400" />
              <span>{statusLabel}</span>
            </span>
          )}

          {checkpoint.status === 'completed' && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-950/80 border border-emerald-500/50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-300">
              <CheckCircle2 className="h-3 w-3 text-emerald-400" />
              <span>{statusLabel}</span>
            </span>
          )}
        </div>
      </div>

      {/* Progress Bar & Counters */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs">
          <span className="text-purple-200/90 font-medium">
            {hasEstimatedTotal
              ? `${checkpoint.recordsReceived.toLocaleString('pt-BR')} de ${checkpoint.totalEstimated!.toLocaleString('pt-BR')} animes recebidos`
              : `${checkpoint.recordsReceived.toLocaleString('pt-BR')} animes recebidos`}
          </span>
          {percentage !== null ? (
            <span className="font-bold text-white text-xs">{percentage}%</span>
          ) : (
            <span className="text-[11px] text-purple-300/60 font-mono">
              Lote ativo: {checkpoint.cursor}
            </span>
          )}
        </div>

        {/* Visual Bar */}
        <div className="relative h-2 w-full overflow-hidden rounded-full bg-black/50 border border-purple-900/40">
          {percentage !== null ? (
            <div
              className="h-full rounded-full transition-all duration-300 ease-out"
              style={{
                width: `${percentage}%`,
                background: isMAL
                  ? 'linear-gradient(90deg, #2E51A2 0%, #4a77d4 100%)'
                  : 'linear-gradient(90deg, #7c3aed 0%, #a855f7 100%)',
              }}
            />
          ) : checkpoint.status === 'in_progress' ? (
            <div
              className="h-full w-1/3 rounded-full animate-pulse"
              style={{
                backgroundColor: accentColor,
              }}
            />
          ) : (
            <div
              className="h-full w-full rounded-full opacity-40"
              style={{ backgroundColor: accentColor }}
            />
          )}
        </div>

        {/* Metrics Sub-row */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-purple-300/70 pt-0.5">
          <span>
            <strong className="text-emerald-400 font-semibold">+{checkpoint.addedCount}</strong> novos
          </span>
          <span>·</span>
          <span>
            <strong className="text-indigo-300 font-semibold">{checkpoint.updatedCount}</strong> atualizados
          </span>
          <span>·</span>
          <span>
            <strong className="text-purple-300/80 font-semibold">{checkpoint.unchangedCount}</strong> mantidos
          </span>
          {(checkpoint.preservedFieldsCount ?? 0) > 0 && (
            <>
              <span>·</span>
              <span className="text-purple-400/80">
                {checkpoint.preservedFieldsCount} campos manuais preservados
              </span>
            </>
          )}
        </div>
      </div>

      {/* Error Message if interrupted */}
      {checkpoint.status === 'error' && checkpoint.errorMessage && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-rose-500/40 bg-rose-950/40 p-2.5 text-xs text-rose-200"
        >
          <AlertCircle className="h-4 w-4 shrink-0 text-rose-400 mt-0.5" />
          <div className="flex-1">
            <span className="font-semibold block text-rose-100">Falha transitória na sincronização</span>
            <span className="text-[11px] leading-relaxed block text-rose-200/90 mt-0.5">
              {checkpoint.errorMessage}
            </span>
          </div>
        </div>
      )}

      {/* Interactive Controls Bar */}
      <div className="flex items-center justify-between pt-1 border-t border-purple-900/30">
        <div className="text-[10px] text-purple-400/60 truncate pr-2">
          {checkpoint.status === 'in_progress' && 'Você pode fechar esta tela; a importação continua em segundo plano.'}
          {checkpoint.status === 'paused' && 'Importação interrompida de forma segura. Retome quando desejar.'}
          {checkpoint.status === 'error' && 'Seus dados já importados estão 100% seguros. Clique para tentar novamente.'}
          {checkpoint.status === 'completed' && 'Todos os registros foram importados e sincronizados com sucesso.'}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {checkpoint.status === 'in_progress' && (
            <>
              <button
                type="button"
                onClick={onPause}
                className="inline-flex items-center gap-1 rounded-lg border border-amber-500/40 bg-amber-950/50 hover:bg-amber-900/60 px-3 py-1 text-xs font-semibold text-amber-200 transition-colors cursor-pointer"
              >
                <Pause className="h-3 w-3" />
                <span>Pausar</span>
              </button>
              <button
                type="button"
                onClick={onCancel}
                className="text-xs text-purple-300/70 hover:text-rose-300 transition-colors px-2 py-1 cursor-pointer"
              >
                Cancelar
              </button>
            </>
          )}

          {checkpoint.status === 'paused' && (
            <>
              <button
                type="button"
                onClick={onResume}
                className="inline-flex items-center gap-1 rounded-lg bg-purple-600 hover:bg-purple-500 px-3 py-1 text-xs font-semibold text-white shadow-sm transition-colors cursor-pointer"
              >
                <Play className="h-3 w-3" />
                <span>Retomar</span>
              </button>
              <button
                type="button"
                onClick={onCancel}
                className="text-xs text-purple-300/70 hover:text-rose-300 transition-colors px-2 py-1 cursor-pointer"
              >
                Cancelar
              </button>
            </>
          )}

          {checkpoint.status === 'error' && (
            <>
              <button
                type="button"
                onClick={onRetry}
                className="inline-flex items-center gap-1 rounded-lg bg-rose-600 hover:bg-rose-500 px-3 py-1 text-xs font-semibold text-white shadow-sm transition-colors cursor-pointer"
              >
                <RotateCcw className="h-3 w-3" />
                <span>Tentar Novamente</span>
              </button>
              <button
                type="button"
                onClick={onCancel}
                className="text-xs text-purple-300/70 hover:text-rose-300 transition-colors px-2 py-1 cursor-pointer"
              >
                Cancelar
              </button>
            </>
          )}

          {checkpoint.status === 'completed' && onDismiss && (
            <button
              type="button"
              onClick={onDismiss}
              className="inline-flex items-center gap-1 rounded-lg border border-purple-700/40 bg-purple-950/60 hover:bg-purple-900 px-3 py-1 text-xs font-medium text-purple-200 transition-colors cursor-pointer"
            >
              <X className="h-3 w-3" />
              <span>Dispensar</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
