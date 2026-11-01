import React, { useState } from 'react';
import { 
  X, 
  Search, 
  UserCheck, 
  UserPlus, 
  Check, 
  Trash2, 
  ShieldAlert, 
  Clock, 
  UserX,
  Users
} from 'lucide-react';
import { FollowUser, FollowRequest } from '../../types';

interface FollowersModalProps {
  isOpen: boolean;
  initialTab?: 'followers' | 'following' | 'requests';
  followers: FollowUser[];
  following: FollowUser[];
  requests: FollowRequest[];
  isOwnProfile: boolean;
  onClose: () => void;
  onUnfollow: (userId: string) => void;
  onRemoveFollower: (userId: string) => void;
  onAcceptRequest: (requestId: string) => void;
  onRejectRequest: (requestId: string) => void;
  onBlockUser: (userId: string) => void;
}

export const FollowersModal: React.FC<FollowersModalProps> = ({
  isOpen,
  initialTab = 'followers',
  followers,
  following,
  requests,
  isOwnProfile,
  onClose,
  onUnfollow,
  onRemoveFollower,
  onAcceptRequest,
  onRejectRequest,
  onBlockUser
}) => {
  const [activeTab, setActiveTab] = useState<'followers' | 'following' | 'requests'>(initialTab);
  const [searchQuery, setSearchQuery] = useState('');

  if (!isOpen) return null;

  const currentList = activeTab === 'followers' 
    ? followers 
    : activeTab === 'following' 
    ? following 
    : [];

  const filteredUsers = currentList.filter(user => 
    user.displayName.toLowerCase().includes(searchQuery.toLowerCase()) ||
    user.username.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150 overscroll-contain"
      onClick={onClose}
      onTouchMove={(e) => {
        if (e.target === e.currentTarget) {
          e.preventDefault();
        }
      }}
    >
      <div 
        className="relative w-full max-w-lg rounded-2xl border border-purple-900/40 bg-[#130E24] shadow-2xl flex flex-col max-h-[85vh] overscroll-contain"
        onClick={(e) => e.stopPropagation()}
        onTouchMove={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-purple-900/30 px-5 py-4">
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-purple-400" />
            <h2 className="text-base font-bold text-white">Conexões Sociais</h2>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-purple-400 hover:bg-purple-900/30 hover:text-white transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Tab Controls */}
        <div className="flex border-b border-purple-900/30 bg-[#100b21] px-5">
          <button
            onClick={() => setActiveTab('followers')}
            className={`flex items-center gap-2 py-3 px-3 border-b-2 text-xs font-semibold transition-colors ${
              activeTab === 'followers'
                ? 'border-purple-500 text-white'
                : 'border-transparent text-purple-400/70 hover:text-purple-200'
            }`}
          >
            <span>Seguidores</span>
            <span className="rounded bg-purple-950 px-1.5 py-0.2 font-mono text-[10px] tabular-nums text-purple-300">
              {followers.length}
            </span>
          </button>

          <button
            onClick={() => setActiveTab('following')}
            className={`flex items-center gap-2 py-3 px-3 border-b-2 text-xs font-semibold transition-colors ${
              activeTab === 'following'
                ? 'border-purple-500 text-white'
                : 'border-transparent text-purple-400/70 hover:text-purple-200'
            }`}
          >
            <span>Seguindo</span>
            <span className="rounded bg-purple-950 px-1.5 py-0.2 font-mono text-[10px] tabular-nums text-purple-300">
              {following.length}
            </span>
          </button>

          {isOwnProfile && (
            <button
              onClick={() => setActiveTab('requests')}
              className={`flex items-center gap-2 py-3 px-3 border-b-2 text-xs font-semibold transition-colors ${
                activeTab === 'requests'
                  ? 'border-purple-500 text-white'
                  : 'border-transparent text-purple-400/70 hover:text-purple-200'
              }`}
            >
              <span>Solicitações</span>
              {requests.length > 0 && (
                <span className="rounded bg-purple-600 px-1.5 py-0.2 font-mono text-[10px] font-bold text-white">
                  {requests.length}
                </span>
              )}
            </button>
          )}
        </div>

        {/* Search inside modal */}
        {activeTab !== 'requests' && (
          <div className="p-4 border-b border-purple-900/20">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-purple-400/60" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Pesquisar por nome ou @username..."
                className="w-full rounded-xl border border-purple-900/40 bg-[#0A0713] py-2 pl-9 pr-3 text-xs text-purple-100 placeholder:text-purple-400/40 focus:border-purple-500 focus:outline-none"
              />
            </div>
          </div>
        )}

        {/* List Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {activeTab === 'requests' ? (
            requests.length === 0 ? (
              <div className="py-12 text-center text-xs text-purple-300/50">
                Nenhuma solicitação de seguidor pendente.
              </div>
            ) : (
              <div className="space-y-3">
                {requests.map((req) => (
                  <div
                    key={req.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-purple-900/30 bg-[#17112c] p-3 shadow-md"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <img
                        src={req.user.avatarUrl}
                        alt={req.user.displayName}
                        className="h-10 w-10 rounded-full object-cover border border-purple-500/30 shrink-0"
                      />
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-white truncate">{req.user.displayName}</div>
                        <div className="text-[11px] text-purple-400 truncate">@{req.user.username}</div>
                        <div className="text-[10px] text-purple-300/50">{req.requestedAt}</div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={() => onAcceptRequest(req.id)}
                        className="flex items-center gap-1 rounded-lg bg-purple-600 hover:bg-purple-500 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors"
                      >
                        <Check className="h-3.5 w-3.5" />
                        <span>Aceitar</span>
                      </button>
                      <button
                        onClick={() => onRejectRequest(req.id)}
                        className="rounded-lg bg-neutral-800 hover:bg-neutral-700 px-2.5 py-1.5 text-xs font-medium text-neutral-300 transition-colors"
                      >
                        Recusar
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )
          ) : filteredUsers.length === 0 ? (
            <div className="py-12 text-center text-xs text-purple-300/50">
              Nenhum usuário encontrado.
            </div>
          ) : (
            filteredUsers.map((user) => (
              <div
                key={user.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-purple-900/30 bg-[#17112c]/60 p-3 hover:bg-[#1a1333] transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <img
                    src={user.avatarUrl}
                    alt={user.displayName}
                    className="h-9 w-9 rounded-full object-cover border border-purple-500/30 shrink-0"
                  />
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-white truncate">{user.displayName}</div>
                    <div className="text-[11px] text-purple-400 truncate">@{user.username}</div>
                    <div className="text-[10px] text-purple-300/60 truncate max-w-xs">{user.bio}</div>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1.5 shrink-0">
                  {activeTab === 'following' && isOwnProfile && (
                    <button
                      onClick={() => onUnfollow(user.id)}
                      className="rounded-lg border border-purple-800/40 bg-purple-950/60 hover:bg-rose-950/80 hover:text-rose-200 hover:border-rose-500/50 px-2.5 py-1.5 text-xs font-medium text-purple-300 transition-colors"
                    >
                      Deixar de seguir
                    </button>
                  )}

                  {activeTab === 'followers' && isOwnProfile && (
                    <button
                      onClick={() => onRemoveFollower(user.id)}
                      className="rounded-lg border border-purple-900/40 bg-purple-950/40 hover:bg-rose-950/80 hover:text-rose-300 px-2.5 py-1.5 text-xs font-medium text-purple-300 transition-colors"
                      title="Remover seguidor"
                    >
                      Remover
                    </button>
                  )}

                  {isOwnProfile && (
                    <button
                      onClick={() => onBlockUser(user.id)}
                      className="rounded-lg p-1.5 text-purple-400 hover:bg-rose-950/50 hover:text-rose-300 transition-colors"
                      title="Bloquear usuário"
                    >
                      <ShieldAlert className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
