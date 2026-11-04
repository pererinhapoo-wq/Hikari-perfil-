import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { 
  UserSearch, 
  Search, 
  X, 
  Lock, 
  Globe, 
  Users, 
  Sparkles, 
  ArrowRight, 
  CornerDownLeft,
  Loader2,
  AlertCircle
} from 'lucide-react';
import { UserProfile } from '../../types';
import { HikariEternalBadge } from '../badge/HikariEternalBadge';
import { AetherAnimatedName } from '../badge/AetherAnimatedName';
import { readPublicProfilesMap } from '../../lib/userWorkspaceStorage';
import { searchRemoteUserProfiles } from '../../services/socialService';
import { OTHER_USERS } from '../../data/mockData';

export interface ProfileSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectProfile: (userId: string) => void;
  currentUser: UserProfile;
  otherProfiles?: Record<string, UserProfile>;
  searchableProfiles?: UserProfile[];
}

interface ProfileSearchResult {
  profile: UserProfile;
  isSelf: boolean;
  isPrivate: boolean;
  matchScore: number;
}

function normalizeSearchText(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

export const ProfileSearchModal: React.FC<ProfileSearchModalProps> = ({
  isOpen,
  onClose,
  onSelectProfile,
  currentUser,
  otherProfiles = {},
  searchableProfiles = [],
}) => {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [isDebouncing, setIsDebouncing] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState<number>(-1);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [remoteProfiles, setRemoteProfiles] = useState<UserProfile[]>([]);
  const [isRemoteLoading, setIsRemoteLoading] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const resultsContainerRef = useRef<HTMLDivElement>(null);
  const scrollYRef = useRef<number>(0);

  // Focus input upon opening and reset state
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setDebouncedQuery('');
      setIsDebouncing(false);
      setSelectedIndex(-1);
      setSearchError(null);
      setRemoteProfiles([]);
      setIsRemoteLoading(false);
      // Slight delay to allow portal DOM mounting before focus
      const timer = window.setTimeout(() => {
        inputRef.current?.focus();
      }, 50);
      return () => window.clearTimeout(timer);
    }
  }, [isOpen]);

  // Debounce search query (250ms) to avoid unnecessary processing
  useEffect(() => {
    if (!isOpen) return;

    if (!query.trim()) {
      setDebouncedQuery('');
      setIsDebouncing(false);
      return;
    }

    setIsDebouncing(true);
    const timer = window.setTimeout(() => {
      setDebouncedQuery(query.trim());
      setIsDebouncing(false);
    }, 250);

    return () => window.clearTimeout(timer);
  }, [query, isOpen]);

  // Query authoritative backend profile search so cross-account/cross-tab users are always discoverable
  useEffect(() => {
    if (!isOpen) return;
    const term = debouncedQuery.trim();
    if (!term) {
      setRemoteProfiles([]);
      setIsRemoteLoading(false);
      return;
    }

    let cancelled = false;
    setIsRemoteLoading(true);
    void searchRemoteUserProfiles(term, 12)
      .then((found) => {
        if (!cancelled) {
          setRemoteProfiles(found);
          setIsRemoteLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setIsRemoteLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [debouncedQuery, isOpen]);

  // Independent background scroll lock protocol:
  // Freezes document.body cleanly with top offset and restores exact scroll position on close
  useEffect(() => {
    if (!isOpen || typeof window === 'undefined') return;

    const savedScrollY = window.scrollY || window.pageYOffset || 0;
    scrollYRef.current = savedScrollY;

    const scrollBarWidth = window.innerWidth - document.documentElement.clientWidth;
    const prevBodyOverflow = document.body.style.overflow;
    const prevBodyPosition = document.body.style.position;
    const prevBodyTop = document.body.style.top;
    const prevBodyWidth = document.body.style.width;
    const prevPaddingRight = document.body.style.paddingRight;

    document.body.style.position = 'fixed';
    document.body.style.top = `-${savedScrollY}px`;
    document.body.style.width = '100%';
    document.body.style.overflow = 'hidden';
    if (scrollBarWidth > 0) {
      document.body.style.paddingRight = `${scrollBarWidth}px`;
    }

    return () => {
      document.body.style.position = prevBodyPosition;
      document.body.style.top = prevBodyTop;
      document.body.style.width = prevBodyWidth;
      document.body.style.overflow = prevBodyOverflow;
      document.body.style.paddingRight = prevPaddingRight;
      window.scrollTo({ top: savedScrollY, left: 0, behavior: 'instant' as ScrollBehavior });
    };
  }, [isOpen]);

  // Keyboard shortcut: Escape to close
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Aggregate candidate profiles from all valid local sources without leaking sensitive fields
  const allCandidateProfiles = useMemo<UserProfile[]>(() => {
    if (!isOpen) return [];

    const profileMap = new Map<string, UserProfile>();

    // 1. Current user
    if (currentUser && currentUser.id) {
      profileMap.set(currentUser.id, currentUser);
    }

    // 1.5 Authoritative remote search results (reflects latest cross-account profiles & privacy flags)
    for (const remoteProf of remoteProfiles) {
      if (remoteProf && remoteProf.id && !profileMap.has(remoteProf.id)) {
        profileMap.set(remoteProf.id, remoteProf);
      }
    }

    // 2. Known other profiles from props
    for (const [id, prof] of Object.entries(otherProfiles)) {
      if (id && prof && !profileMap.has(id)) {
        profileMap.set(id, prof);
      }
    }

    // 3. Searchable profiles from props
    for (const prof of searchableProfiles) {
      if (prof && prof.id && !profileMap.has(prof.id)) {
        profileMap.set(prof.id, prof);
      }
    }

    // 4. Cached public projections from storage
    try {
      const publicMap = readPublicProfilesMap(currentUser?.id);
      for (const [id, proj] of Object.entries(publicMap)) {
        if (id && proj?.profile && !profileMap.has(id)) {
          profileMap.set(id, proj.profile);
        }
      }
    } catch {
      // Storage read errors handled gracefully
    }

    // 5. Standard fallback profiles
    for (const [id, prof] of Object.entries(OTHER_USERS)) {
      if (id && prof && !profileMap.has(id)) {
        profileMap.set(id, prof);
      }
    }

    return Array.from(profileMap.values());
  }, [isOpen, currentUser, remoteProfiles, otherProfiles, searchableProfiles]);

  // Filter & score matching profiles
  const searchResults = useMemo<ProfileSearchResult[]>(() => {
    const rawTerm = debouncedQuery.trim();
    if (!rawTerm) return [];

    const cleanTerm = normalizeSearchText(rawTerm.replace(/^@/, ''));
    if (!cleanTerm) return [];

    const matched: ProfileSearchResult[] = [];

    for (const profile of allCandidateProfiles) {
      if (!profile || !profile.id) continue;

      const normName = normalizeSearchText(profile.displayName || '');
      const normUser = normalizeSearchText(profile.username || '');

      let score = 0;

      // Exact prefix match on username or display name
      if (normUser.startsWith(cleanTerm)) {
        score += 100;
      } else if (normUser.includes(cleanTerm)) {
        score += 50;
      }

      if (normName.startsWith(cleanTerm)) {
        score += 80;
      } else if (normName.includes(cleanTerm)) {
        score += 40;
      }

      if (score > 0) {
        // Boost current user slightly if matching own name
        const isSelf = profile.id === currentUser.id;
        matched.push({
          profile,
          isSelf,
          isPrivate: Boolean(profile.isPrivate),
          matchScore: score,
        });
      }
    }

    // Sort by match relevance and limit to top 10 profiles (never loading everything at once)
    matched.sort((a, b) => b.matchScore - a.matchScore);
    return matched.slice(0, 10);
  }, [debouncedQuery, allCandidateProfiles, currentUser.id]);

  // Reset selected index when search results change
  useEffect(() => {
    setSelectedIndex(-1);
  }, [searchResults]);

  // Handle keyboard navigation inside results
  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev < searchResults.length - 1 ? prev + 1 : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : searchResults.length - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (selectedIndex >= 0 && selectedIndex < searchResults.length) {
        handleSelect(searchResults[selectedIndex].profile.id);
      } else if (searchResults.length > 0) {
        handleSelect(searchResults[0].profile.id);
      }
    }
  };

  const handleSelect = useCallback(
    (userId: string) => {
      onSelectProfile(userId);
      onClose();
    },
    [onSelectProfile, onClose]
  );

  if (!isOpen || typeof document === 'undefined') return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Busca Exclusiva de Perfis"
      className="fixed inset-0 z-50 flex items-start justify-center p-3 sm:p-4 pt-12 sm:pt-20 overflow-hidden"
    >
      {/* Backdrop: clicks close modal, prevents background scrolling */}
      <div
        className="fixed inset-0 bg-black/80 backdrop-blur-md transition-opacity duration-200 animate-in fade-in"
        onClick={onClose}
        onTouchMove={(e) => {
          if (e.target === e.currentTarget && e.cancelable) {
            e.preventDefault();
          }
        }}
        aria-hidden="true"
      />

      {/* Main Modal Card: Cyber-Hikari Distinct Identity */}
      <div
        className="relative z-10 w-full max-w-xl flex flex-col rounded-2xl border border-purple-500/40 bg-[#0e081c]/95 shadow-[0_0_50px_rgba(147,51,234,0.25)] backdrop-blur-2xl overflow-hidden transition-all duration-200 animate-in fade-in zoom-in-95"
        onClick={(e) => e.stopPropagation()}
        onTouchMove={(e) => e.stopPropagation()}
      >
        {/* Distinctive Header Banner */}
        <div className="relative border-b border-purple-900/50 bg-gradient-to-r from-purple-950/90 via-[#1a0e36]/90 to-purple-950/90 px-4 sm:px-5 py-3.5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-purple-600/30 border border-purple-400/40 text-purple-300 shadow-[0_0_12px_rgba(168,85,247,0.35)]">
                <UserSearch className="h-4 w-4 text-purple-200" />
              </div>
              <div className="flex flex-col">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-bold tracking-tight text-white">
                    Busca de Perfis
                  </h2>
                  <span className="inline-flex items-center gap-1 rounded-full bg-purple-900/60 border border-purple-500/40 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-purple-200">
                    <Sparkles className="h-2.5 w-2.5 text-purple-300" />
                    Hikari ID
                  </span>
                </div>
                <p className="text-[11px] text-purple-300/70">
                  Pesquise exclusivamente contas e membros da comunidade
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              aria-label="Fechar busca"
              title="Fechar (Esc)"
              className="rounded-xl border border-purple-800/40 bg-[#160d2b] p-1.5 text-purple-300 hover:border-purple-500 hover:bg-purple-900/40 hover:text-white transition-all cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Input Bar with Glowing Cyber Focus */}
        <div className="p-3 sm:p-4 border-b border-purple-900/30 bg-[#0b0617]/70">
          <div className="relative flex items-center">
            <div className="pointer-events-none absolute left-3.5 flex items-center justify-center text-purple-400">
              {isDebouncing ? (
                <Loader2 className="h-4 w-4 animate-spin text-purple-400" />
              ) : (
                <Search className="h-4 w-4 text-purple-400" />
              )}
            </div>

            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setSearchError(null);
              }}
              onKeyDown={handleInputKeyDown}
              placeholder="Digite o nome ou @usuário (ex.: mat, shinji, aether)..."
              autoComplete="off"
              autoCorrect="off"
              spellCheck="false"
              className="w-full rounded-xl border border-purple-600/40 bg-[#140b29] py-3 pl-10 pr-20 text-sm text-purple-100 placeholder:text-purple-400/40 focus:border-purple-400 focus:bg-[#1a0f35] focus:outline-none focus:ring-2 focus:ring-purple-500/50 shadow-inner shadow-black/60 transition-all font-medium"
            />

            <div className="absolute right-3 flex items-center gap-1.5">
              {query && (
                <button
                  type="button"
                  onClick={() => {
                    setQuery('');
                    setDebouncedQuery('');
                    inputRef.current?.focus();
                  }}
                  className="rounded-lg p-1 text-purple-400 hover:bg-purple-900/40 hover:text-white transition-colors cursor-pointer"
                  title="Limpar texto"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
              <kbd className="hidden sm:inline-flex items-center rounded border border-purple-700/50 bg-purple-950/80 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-purple-300">
                ESC
              </kbd>
            </div>
          </div>
        </div>

        {/* Scrollable Results List (Self-contained scroll, overscroll contain) */}
        <div
          ref={resultsContainerRef}
          data-testid="profile-search-results-list"
          style={{ overscrollBehavior: 'contain', WebkitOverflowScrolling: 'touch' }}
          className="max-h-[58vh] sm:max-h-[60vh] overflow-y-auto p-3 sm:p-4 space-y-2 overscroll-contain"
          onTouchMove={(e) => e.stopPropagation()}
          onWheel={(e) => e.stopPropagation()}
        >
          {/* Error State */}
          {searchError && (
            <div className="flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-950/20 p-3 text-xs text-red-200">
              <AlertCircle className="h-4 w-4 shrink-0 text-red-400" />
              <span>{searchError}</span>
            </div>
          )}

          {/* Initial State (Query empty) */}
          {!debouncedQuery.trim() && !isDebouncing && (
            <div className="py-8 px-4 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-purple-950/60 border border-purple-800/40 text-purple-400 shadow-md mb-3">
                <Users className="h-6 w-6 text-purple-300" />
              </div>
              <h3 className="text-sm font-semibold text-white">
                Pesquisa instantânea de perfis
              </h3>
              <p className="mt-1 text-xs text-purple-300/60 max-w-sm mx-auto">
                Digite um nome de exibição ou @usuário para visualizar sugestões em tempo real.
              </p>
            </div>
          )}

          {/* Debouncing / Searching Skeleton Feedback */}
          {(isDebouncing || (isRemoteLoading && searchResults.length === 0)) && (
            <div className="py-6 text-center space-y-2">
              <Loader2 className="h-6 w-6 animate-spin text-purple-400 mx-auto" />
              <p className="text-xs text-purple-300/60">Buscando perfis correspondentes...</p>
            </div>
          )}

          {/* Empty Results State */}
          {debouncedQuery.trim() && !isDebouncing && !isRemoteLoading && searchResults.length === 0 && (
            <div className="py-8 px-4 text-center">
              <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-2xl bg-purple-950/40 border border-purple-900/40 text-purple-400/60 mb-2.5">
                <Search className="h-5 w-5" />
              </div>
              <p className="text-sm font-medium text-white">
                Nenhum perfil encontrado para "{debouncedQuery}"
              </p>
              <p className="mt-1 text-xs text-purple-300/60 max-w-xs mx-auto">
                Verifique a ortografia ou tente pesquisar por outro nome ou @username.
              </p>
            </div>
          )}

          {/* Results List */}
          {searchResults.map(({ profile, isSelf, isPrivate }, index) => {
            const isSelected = selectedIndex === index;

            return (
              <button
                key={profile.id}
                type="button"
                onClick={() => handleSelect(profile.id)}
                onMouseEnter={() => setSelectedIndex(index)}
                className={`group w-full flex items-center justify-between gap-3 rounded-xl border p-3 text-left transition-all cursor-pointer ${
                  isSelected
                    ? 'border-purple-400 bg-purple-900/40 shadow-lg shadow-purple-950/80 scale-[1.01]'
                    : 'border-purple-900/40 bg-[#120a24]/80 hover:border-purple-600/50 hover:bg-purple-950/30'
                }`}
              >
                {/* Left: Avatar & Profile Info */}
                <div className="flex items-center gap-3 min-w-0">
                  <div className="relative shrink-0">
                    {profile.avatarUrl ? (
                      <img
                        src={profile.avatarUrl}
                        alt={profile.displayName}
                        referrerPolicy="no-referrer"
                        className="h-10 w-10 rounded-full object-cover border border-purple-500/40 group-hover:border-purple-400 transition-colors"
                      />
                    ) : (
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-purple-700 to-indigo-800 text-sm font-bold text-white border border-purple-500/40 shadow-sm select-none">
                        {(profile.displayName || profile.username || 'U')
                          .charAt(0)
                          .toUpperCase()}
                      </div>
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 truncate">
                      <span className="font-semibold text-sm text-white group-hover:text-purple-200 transition-colors truncate">
                        <AetherAnimatedName name={profile.displayName} profileOrUid={profile.id} />
                      </span>
                      <HikariEternalBadge profileOrUid={profile.id} size="sm" />
                      {isSelf && (
                        <span className="rounded bg-purple-950/90 border border-purple-700/50 px-1.5 py-0.2 text-[10px] font-medium text-purple-300 shrink-0">
                          Você
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2 mt-0.5 truncate text-xs text-purple-300/70">
                      <span className="truncate font-mono">@{profile.username}</span>

                      {/* Privacy Badge: discreet indicator without leaking private data */}
                      {isPrivate ? (
                        <span className="inline-flex items-center gap-1 rounded bg-amber-950/40 border border-amber-600/30 px-1.5 py-0.2 text-[10px] font-medium text-amber-300 shrink-0">
                          <Lock className="h-2.5 w-2.5" />
                          Privado
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded bg-emerald-950/40 border border-emerald-600/30 px-1.5 py-0.2 text-[10px] font-medium text-emerald-300 shrink-0">
                          <Globe className="h-2.5 w-2.5" />
                          Público
                        </span>
                      )}

                      {!isPrivate && typeof profile.followersCount === 'number' && (
                        <span className="text-[11px] text-purple-400/60 hidden sm:inline truncate">
                          · {profile.followersCount} seguidores
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Right: Action Indicator */}
                <div className="flex items-center gap-1.5 shrink-0 pl-2">
                  <span className="hidden sm:inline-flex items-center gap-1 text-[11px] font-medium text-purple-300/60 group-hover:text-purple-200 transition-colors">
                    <span>Acessar</span>
                    <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
                  </span>
                  <div className="sm:hidden flex h-7 w-7 items-center justify-center rounded-lg bg-purple-950/60 text-purple-300 group-hover:text-white">
                    <ArrowRight className="h-3.5 w-3.5" />
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Modal Footer with Keyboard Navigation Hints */}
        <div className="border-t border-purple-900/40 bg-[#090514]/90 px-4 py-2.5 flex items-center justify-between text-[11px] text-purple-400/70">
          <div className="flex items-center gap-3">
            <span className="hidden sm:inline-flex items-center gap-1">
              <kbd className="rounded border border-purple-800/60 bg-purple-950/80 px-1 font-mono text-[10px] text-purple-300">
                ↑
              </kbd>
              <kbd className="rounded border border-purple-800/60 bg-purple-950/80 px-1 font-mono text-[10px] text-purple-300">
                ↓
              </kbd>
              <span>Navegar</span>
            </span>
            <span className="inline-flex items-center gap-1">
              <kbd className="rounded border border-purple-800/60 bg-purple-950/80 px-1.5 font-mono text-[10px] text-purple-300 flex items-center">
                <CornerDownLeft className="h-2.5 w-2.5 mr-0.5" /> Enter
              </kbd>
              <span>Abrir perfil</span>
            </span>
          </div>

          <div className="text-[10px] text-purple-400/50">
            {searchResults.length > 0 && `${searchResults.length} de máx. 10 resultados`}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};
