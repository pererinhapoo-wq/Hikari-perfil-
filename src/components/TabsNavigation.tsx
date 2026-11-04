import React from 'react';
import { ProfileTab } from '../types';

interface TabsNavigationProps {
  activeTab: ProfileTab;
  onTabChange: (tab: ProfileTab) => void;
  animeCount: number;
  commentsCount: number;
  favoritesCount: number;
  isPrivateLocked: boolean;
}

export const TabsNavigation: React.FC<TabsNavigationProps> = ({
  activeTab,
  onTabChange,
  animeCount,
  commentsCount,
  favoritesCount,
  isPrivateLocked
}) => {
  const tabs: { id: ProfileTab; label: string; count?: number; lockedWhenPrivate?: boolean }[] = [
    {
      id: 'overview',
      label: 'Visão geral',
      lockedWhenPrivate: true
    },
    {
      id: 'animes',
      label: 'Animes',
      count: animeCount,
      lockedWhenPrivate: true
    },
    {
      id: 'comments',
      label: 'Comentários',
      count: commentsCount,
      lockedWhenPrivate: true
    },
    {
      id: 'about',
      label: 'Sobre',
      lockedWhenPrivate: true
    },
    {
      id: 'activity',
      label: 'Atividade',
      lockedWhenPrivate: true
    }
  ];

  return (
    <div className="w-full border-b border-purple-900/30 bg-[#0A0713]/70 backdrop-blur-md">
      <nav className="flex space-x-2 overflow-x-auto py-2 no-scrollbar" aria-label="Abas do Perfil">
        {tabs.map((tab) => {
          const tabId = tab.id;
          const isActive = activeTab === tabId;
          const isLocked = isPrivateLocked && tab.lockedWhenPrivate;

          return (
            <button
              key={tabId}
              type="button"
              onClick={() => onTabChange(tabId as ProfileTab)}
              className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-xl px-3.5 sm:px-4 py-2 text-xs sm:text-sm font-medium transition-all cursor-pointer ${
                isActive
                  ? 'bg-purple-600/90 text-white shadow-md shadow-purple-900/40 border border-purple-400/30'
                  : 'text-purple-300/70 hover:bg-purple-900/20 hover:text-white'
              }`}
            >
              <span>{tab.label}</span>
              {tab.count !== undefined && !isLocked && (
                <span className={`font-mono text-[11px] tabular-nums rounded px-1.5 py-0.5 leading-none ${
                  isActive ? 'bg-purple-800 text-purple-100' : 'bg-purple-950/60 text-purple-300/80 border border-purple-900/40'
                }`}>
                  {tab.count}
                </span>
              )}
            </button>
          );
        })}
      </nav>
    </div>
  );
};
