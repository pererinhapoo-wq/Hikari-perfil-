import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  MessageSquare, 
  ExternalLink, 
  ThumbsUp, 
  MessageCircle, 
  EyeOff, 
  Tv,
  Calendar,
  ChevronDown
} from 'lucide-react';
import { HikariComment } from '../../types';
import { useCurrentTime, formatRelativeTime, formatExactDateTime } from '../../utils/relativeTime';

/**
 * Leaf component that subscribes to useCurrentTime() so timer ticks do NOT
 * cause the parent CommentsTab or all rendered comments to re-render.
 */
const CommentTimeSpan: React.FC<{
  timestamp: number | undefined;
  fallbackText?: string;
}> = ({ timestamp, fallbackText = '' }) => {
  const now = useCurrentTime();
  return <>{formatRelativeTime(timestamp, now, fallbackText, false)}</>;
};

interface CommentsTabProps {
  profileId?: string;
  comments: HikariComment[];
  showCommentsOnProfile: boolean;
  isOwnProfile: boolean;
  userName: string;
  highlightedCommentId?: string;
}

const COMMENTS_BATCH_SIZE = 12;

const persistentCommentsVisibleCount = new Map<string, number>();

export const CommentsTab: React.FC<CommentsTabProps> = ({
  profileId,
  comments,
  showCommentsOnProfile,
  isOwnProfile,
  userName,
  highlightedCommentId
}) => {
  const profileKey = profileId || '__default__';

  // Determine initial batch size, ensuring highlighted comment or previously scrolled batch is visible
  const initialBatch = useMemo(() => {
    const saved = persistentCommentsVisibleCount.get(profileKey) ?? COMMENTS_BATCH_SIZE;
    if (!highlightedCommentId) return Math.max(COMMENTS_BATCH_SIZE, saved);
    const idx = comments.findIndex((c) => c.id === highlightedCommentId);
    return idx >= 0 ? Math.max(COMMENTS_BATCH_SIZE, saved, idx + 1) : Math.max(COMMENTS_BATCH_SIZE, saved);
  }, [comments, highlightedCommentId, profileKey]);

  const [prevProfileKey, setPrevProfileKey] = useState(profileKey);
  const [visibleCount, setVisibleCount] = useState<number>(initialBatch);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  if (prevProfileKey !== profileKey) {
    setPrevProfileKey(profileKey);
    setVisibleCount(persistentCommentsVisibleCount.get(profileKey) ?? COMMENTS_BATCH_SIZE);
  }

  useEffect(() => {
    persistentCommentsVisibleCount.set(profileKey, visibleCount);
  }, [profileKey, visibleCount]);

  // Reset or adjust visible count when comments list length or highlighted ID changes
  useEffect(() => {
    if (highlightedCommentId) {
      const idx = comments.findIndex((c) => c.id === highlightedCommentId);
      if (idx >= 0 && idx >= visibleCount) {
        setVisibleCount(idx + 1);
      }
    }
  }, [highlightedCommentId, comments, visibleCount]);

  // Progressive infinite scroll via IntersectionObserver
  useEffect(() => {
    if (visibleCount >= comments.length) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisibleCount((prev) => Math.min(comments.length, prev + COMMENTS_BATCH_SIZE));
        }
      },
      { rootMargin: '300px 0px' }
    );

    const el = sentinelRef.current;
    if (el) observer.observe(el);
    return () => {
      if (el) observer.unobserve(el);
    };
  }, [visibleCount, comments.length]);

  // If user disabled comments on profile and viewer is not the owner:
  if (!showCommentsOnProfile && !isOwnProfile) {
    return (
      <div className="rounded-2xl border border-purple-900/30 bg-[#130E24]/60 p-10 text-center">
        <EyeOff className="mx-auto h-10 w-10 text-purple-400/50" />
        <h3 className="mt-3 text-base font-bold text-white">Histórico de Comentários Privado</h3>
        <p className="mt-1 text-xs text-purple-300/60 max-w-md mx-auto">
          {userName} optou por não exibir seu histórico de comentários do site principal Hikari em seu perfil público.
        </p>
      </div>
    );
  }

  const visibleComments = comments.slice(0, visibleCount);
  const remainingCount = Math.max(0, comments.length - visibleCount);

  return (
    <div className="space-y-4">
      {/* Notice for owner if comments are hidden for others */}
      {!showCommentsOnProfile && isOwnProfile && (
        <div className="flex items-center gap-2 rounded-xl border border-amber-600/30 bg-amber-950/30 p-3 text-xs text-amber-200">
          <EyeOff className="h-4 w-4 shrink-0 text-amber-400" />
          <span>
            <strong>Aviso de Privacidade:</strong> Seu histórico de comentários está oculto para outros visitantes nas suas configurações de perfil.
          </span>
        </div>
      )}

      {comments.length === 0 ? (
        <div className="rounded-2xl border border-purple-900/30 bg-[#130E24]/60 p-12 text-center">
          <MessageSquare className="mx-auto h-10 w-10 text-purple-400/40" />
          <h3 className="mt-3 text-base font-bold text-white">Nenhum comentário registrado</h3>
          <p className="mt-1 text-xs text-purple-300/60 max-w-sm mx-auto">
            Quando você publicar comentários e participar de discussões no site principal Hikari, eles aparecerão organizados aqui.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {visibleComments.map((comment) => {
            const isHighlighted = comment.id === highlightedCommentId;
            return (
              <div
                key={comment.id}
                id={`hikari-comment-${comment.id}`}
                className={`group rounded-2xl border transition-all duration-300 p-4 sm:p-5 shadow-lg ${
                  isHighlighted 
                    ? 'border-purple-500 bg-[#1e153b] ring-2 ring-purple-500/60 shadow-xl shadow-purple-900/50' 
                    : 'border-purple-900/30 bg-[#130E24] hover:border-purple-600/40 hover:bg-[#16102a]'
                }`}
              >
                {/* Header: Anime and Episode reference */}
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-purple-900/30 pb-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-purple-950/80 border border-purple-800/40 text-purple-300">
                      <Tv className="h-3.5 w-3.5" />
                    </div>
                    <div>
                      <span className="font-semibold text-sm text-white">{comment.animeTitle}</span>
                      {comment.episodeNumber && (
                        <span className="ml-2 font-mono text-xs text-purple-400/80 tabular-nums">
                          Episódio {comment.episodeNumber}
                        </span>
                      )}
                    </div>
                    {isHighlighted && (
                      <span className="inline-flex items-center rounded-md bg-purple-900/80 px-2 py-0.5 text-[10px] font-semibold text-purple-200 border border-purple-500/40">
                        Comentário da Notificação
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-3">
                    <div
                      className="flex items-center gap-1 text-[11px] text-purple-300/60"
                      title={formatExactDateTime(comment.createdAtTimestamp) || undefined}
                    >
                      <Calendar className="h-3 w-3" />
                      <CommentTimeSpan timestamp={comment.createdAtTimestamp} fallbackText={comment.createdAt} />
                    </div>

                    {/* Link to open on Hikari */}
                    <a
                      href={comment.originUrl}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => {
                        e.preventDefault();
                      }}
                      className="flex items-center gap-1 rounded-lg bg-purple-950/60 border border-purple-800/40 px-2.5 py-1 text-xs font-medium text-purple-300 hover:bg-purple-800/50 hover:text-white transition-colors"
                    >
                      <span>Abrir no Hikari</span>
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                </div>

                {/* Discussion topic tag if present */}
                {comment.discussionTopic && (
                  <div className="mt-2 text-[11px] font-medium text-purple-400/80">
                    Tópico: {comment.discussionTopic}
                  </div>
                )}

                {/* Comment Body */}
                <div className="mt-3 text-sm leading-relaxed text-purple-100/90 whitespace-pre-line">
                  "{comment.content}"
                </div>

                {/* Footer: Likes, replies feedback */}
                <div className="mt-4 flex items-center gap-4 text-xs text-purple-300/60 pt-2 border-t border-purple-900/20">
                  <div className="flex items-center gap-1.5 font-mono tabular-nums">
                    <ThumbsUp className="h-3.5 w-3.5 text-purple-400" />
                    <span>{comment.likesCount} curtidas</span>
                  </div>
                  <div className="flex items-center gap-1.5 font-mono tabular-nums">
                    <MessageCircle className="h-3.5 w-3.5 text-purple-400" />
                    <span>{comment.repliesCount} respostas</span>
                  </div>
                </div>
              </div>
            );
          })}

          {/* Sentinel and Progressive Loader */}
          {remainingCount > 0 && (
            <div ref={sentinelRef} className="py-4 text-center">
              <button
                type="button"
                onClick={() => setVisibleCount((prev) => Math.min(comments.length, prev + COMMENTS_BATCH_SIZE))}
                className="inline-flex items-center gap-1.5 rounded-xl border border-purple-800/50 bg-[#16102a] hover:bg-purple-900/40 px-4 py-2 text-xs font-semibold text-purple-200 hover:text-white transition-all cursor-pointer shadow-md"
              >
                <span>Mostrar mais comentários ({remainingCount} restantes)</span>
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
