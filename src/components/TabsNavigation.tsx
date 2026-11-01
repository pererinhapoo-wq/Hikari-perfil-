import React from 'react';
import { 
  LayoutDashboard, 
  Tv, 
  MessageSquare, 
  UserCircle2, 
  Activity 
} from 'lucide-react';
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
  const tabs: { id: ProfileTab; label: string; icon: React.ReactNode; count?: number; lockedWhenPrivate?: boolean }[] = [
    {
      id: 'overview',
      label: 'Visão geral',
      icon: <LayoutDashboard className="h-4 w-4" />
    },
    {
      id: 'animes',
      label: 'Animes',
      icon: <Tv className="h-4 w-4" />,
      count: animeCount,
      lockedWhenPrivate: true
    },
    {
      id: 'comments',
      label: 'Comentários',
      icon: <MessageSquare className="h-4 w-4" />,
      count: commentsCount,
      lockedWhenPrivate: true
    },
    {
      id: 'about',
      label: 'Sobre',
      icon: <UserCircle2 className="h-4 w-4" />
    },
    {
      id: 'activity',
      label: 'Atividade',
      icon: <Activity className="h-4 w-4" />,
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
              onClick={() => onTabChange(tabId as ProfileTab)}
              className={`flex items-center gap-2 whitespace-nowrap rounded-xl px-4 py-2 text-xs sm:text-sm font-medium transition-all ${
                isActive
                  ? 'bg-purple-600/90 text-white shadow-md shadow-purple-900/40 border border-purple-400/30'
                  : 'text-purple-300/70 hover:bg-purple-900/20 hover:text-white'
              }`}
            >
              <span className={isActive ? 'text-white' : 'text-purple-400'}>
                {tab.icon}
              </span>
              <span>{tab.label}</span>
              {tab.count !== undefined && !isLocked && (
                <span className={`ml-1 font-mono text-[11px] tabular-nums rounded px-1.5 py-0.2 ${
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
