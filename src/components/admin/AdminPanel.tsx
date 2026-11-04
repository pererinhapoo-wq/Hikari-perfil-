import React, { useState, useEffect, useCallback } from 'react';
import {
  LayoutDashboard,
  Users,
  Film,
  ShieldAlert,
  BarChart3,
  ShieldCheck,
  ArrowLeft,
  RefreshCw,
  Search,
  CheckCircle2,
  Clock,
  Lock,
  Eye,
  Server,
  Cpu,
  Layers,
  AlertTriangle,
  Info,
  X,
  ExternalLink,
  ChevronRight,
  Shield,
  Zap,
} from 'lucide-react';
import { HikariEternalBadge } from '../badge/HikariEternalBadge';
import { AetherAnimatedName } from '../badge/AetherAnimatedName';
import {
  fetchAdminOverview,
  fetchAdminUsers,
  fetchAdminAnimes,
  fetchAdminModeration,
  fetchAdminMetrics,
  fetchAdminSecurity,
  runAdminHealthCheck,
  type AdminOverviewData,
  type AdminUserData,
  type AdminAnimeData,
  type AdminModerationData,
  type AdminMetricsData,
  type AdminSecurityData,
} from '../../services/adminService';
import { AUTHORIZED_ADMIN_UID } from '../../types';

export type AdminSection = 'overview' | 'users' | 'animes' | 'moderation' | 'metrics' | 'security';

export interface AdminPanelProps {
  onReturnToApp: () => void;
  idToken?: string | null;
}

export const AdminPanel: React.FC<AdminPanelProps> = ({ onReturnToApp, idToken }) => {
  const [activeTab, setActiveTab] = useState<AdminSection>('overview');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Estados de dados específicos de cada seção
  const [overview, setOverview] = useState<AdminOverviewData | null>(null);
  const [users, setUsers] = useState<AdminUserData[]>([]);
  const [usersTotal, setUsersTotal] = useState<number>(0);
  const [userSearch, setUserSearch] = useState<string>('');
  const [selectedUser, setSelectedUser] = useState<AdminUserData | null>(null);

  const [animes, setAnimes] = useState<AdminAnimeData[]>([]);
  const [animesTotal, setAnimesTotal] = useState<number>(0);
  const [animeSearch, setAnimeSearch] = useState<string>('');

  const [moderation, setModeration] = useState<AdminModerationData | null>(null);
  const [metrics, setMetrics] = useState<AdminMetricsData | null>(null);
  const [security, setSecurity] = useState<AdminSecurityData | null>(null);

  const [healthCheckStatus, setHealthCheckStatus] = useState<{
    running: boolean;
    result?: { status: string; message: string; timestamp: number };
    error?: string;
  }>({ running: false });

  // Carregamento de dados por seção
  const loadActiveSectionData = useCallback(async (tab: AdminSection) => {
    setIsLoading(true);
    setError(null);
    try {
      if (tab === 'overview') {
        const data = await fetchAdminOverview(idToken);
        setOverview(data);
      } else if (tab === 'users') {
        const data = await fetchAdminUsers(userSearch, idToken);
        setUsers(data.users);
        setUsersTotal(data.total);
      } else if (tab === 'animes') {
        const data = await fetchAdminAnimes(animeSearch, idToken);
        setAnimes(data.animes);
        setAnimesTotal(data.total);
      } else if (tab === 'moderation') {
        const data = await fetchAdminModeration(idToken);
        setModeration(data);
      } else if (tab === 'metrics') {
        const data = await fetchAdminMetrics(idToken);
        setMetrics(data);
      } else if (tab === 'security') {
        const data = await fetchAdminSecurity(idToken);
        setSecurity(data);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao carregar informações da seção.');
    } finally {
      setIsLoading(false);
    }
  }, [idToken, userSearch, animeSearch]);

  useEffect(() => {
    loadActiveSectionData(activeTab);
  }, [activeTab, loadActiveSectionData]);

  // Busca rápida de usuários com debounce
  const handleUserSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    loadActiveSectionData('users');
  };

  // Busca rápida de animes
  const handleAnimeSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    loadActiveSectionData('animes');
  };

  // Execução do diagnóstico de integridade
  const handleRunHealthCheck = async () => {
    setHealthCheckStatus({ running: true });
    try {
      const res = await runAdminHealthCheck(idToken);
      setHealthCheckStatus({ running: false, result: res });
    } catch (err) {
      setHealthCheckStatus({
        running: false,
        error: err instanceof Error ? err.message : 'Falha na validação.',
      });
    }
  };

  const navItems = [
    { id: 'overview' as const, label: 'Visão Geral', icon: LayoutDashboard },
    { id: 'users' as const, label: 'Usuários', icon: Users, badge: usersTotal || undefined },
    { id: 'animes' as const, label: 'Animes', icon: Film, badge: animesTotal || undefined },
    { id: 'moderation' as const, label: 'Moderação', icon: ShieldAlert },
    { id: 'metrics' as const, label: 'Estatísticas', icon: BarChart3 },
    { id: 'security' as const, label: 'Segurança', icon: ShieldCheck },
  ];

  function formatUptime(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    if (hours > 0) return `${hours}h ${mins}m`;
    if (mins > 0) return `${mins}m ${secs}s`;
    return `${secs}s`;
  }

  return (
    <div className="min-h-screen bg-[#0A0713] text-[#EDE8F5] flex flex-col selection:bg-purple-600 selection:text-white">
      {/* Topbar do Painel Administrativo */}
      <header className="sticky top-0 z-40 border-b border-purple-900/40 bg-[#0E091C]/90 backdrop-blur-xl px-4 sm:px-6 py-3">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
          {/* Lado Esquerdo: Identificação e Voltar */}
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={onReturnToApp}
              className="flex items-center gap-2 rounded-xl border border-purple-800/40 bg-purple-950/40 px-3 py-1.5 text-xs font-medium text-purple-300 hover:bg-purple-900/40 hover:text-white transition-colors cursor-pointer shrink-0"
              title="Voltar para a visualização pública dos perfis"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Voltar ao Perfil</span>
            </button>

            <div className="h-4 w-[1px] bg-purple-900/50 hidden sm:block" />

            <div className="flex items-center gap-2 min-w-0">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-purple-800 to-indigo-900 border border-purple-500/40 text-purple-200 shrink-0 shadow-sm">
                <Shield className="h-4 w-4 text-purple-200" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-white tracking-tight truncate">
                    Painel de Administração
                  </span>
                  <span className="hidden md:inline-flex rounded-full bg-purple-950/80 border border-purple-700/50 px-2 py-0.2 text-[10px] font-semibold text-purple-300">
                    Privado
                  </span>
                </div>
                <div className="text-[11px] text-purple-400/70 truncate">
                  Hikari Perfil · Gestão Segura
                </div>
              </div>
            </div>
          </div>

          {/* Lado Direito: Identidade Aether + Selo Hikari Eternal */}
          <div className="flex items-center gap-3 shrink-0">
            <div className="flex items-center gap-2 rounded-full border border-purple-800/40 bg-purple-950/30 px-3 py-1 text-xs">
              <AetherAnimatedName name="Aether" profileOrUid={AUTHORIZED_ADMIN_UID} className="text-xs" />
              <HikariEternalBadge profileOrUid={AUTHORIZED_ADMIN_UID} size="sm" />
            </div>

            <button
              type="button"
              onClick={() => loadActiveSectionData(activeTab)}
              disabled={isLoading}
              title="Recarregar dados da seção"
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-purple-900/40 bg-[#160E2A] text-purple-300 hover:bg-purple-900/30 hover:text-white transition-colors cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
      </header>

      {/* Navegação Adaptada para Celular (Scroll Horizontal) */}
      <div className="lg:hidden sticky top-[57px] z-30 border-b border-purple-900/30 bg-[#0E091C]/95 backdrop-blur-md px-2 py-2 overflow-x-auto no-scrollbar">
        <div className="flex items-center gap-1.5 min-w-max">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium transition-all cursor-pointer whitespace-nowrap ${
                  isActive
                    ? 'bg-purple-600 text-white shadow-sm shadow-purple-950'
                    : 'text-purple-300/80 hover:bg-purple-950/50 hover:text-white'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                <span>{item.label}</span>
                {item.badge !== undefined && (
                  <span
                    className={`rounded-full px-1.5 py-0.2 text-[10px] font-bold ${
                      isActive ? 'bg-purple-900 text-purple-100' : 'bg-purple-950 text-purple-400'
                    }`}
                  >
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Corpo Principal com Navegação Lateral no Desktop */}
      <div className="mx-auto flex w-full max-w-7xl flex-1 px-4 sm:px-6 py-6 gap-6">
        {/* Navegação Lateral Desktop */}
        <aside className="hidden lg:flex w-64 flex-col shrink-0 gap-4">
          <nav className="rounded-2xl border border-purple-900/40 bg-[#120B22] p-2 space-y-1 shadow-lg shadow-black/40">
            <div className="px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-purple-400/60">
              Módulos de Gestão
            </div>
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveTab(item.id)}
                  className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-sm font-medium transition-all cursor-pointer ${
                    isActive
                      ? 'bg-gradient-to-r from-purple-700 to-indigo-800 text-white shadow-md shadow-purple-950/60 font-semibold'
                      : 'text-purple-300/80 hover:bg-purple-950/40 hover:text-white'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <Icon className={`h-4 w-4 ${isActive ? 'text-white' : 'text-purple-400'}`} />
                    <span>{item.label}</span>
                  </div>
                  {item.badge !== undefined && (
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-bold ${
                        isActive ? 'bg-purple-950 text-purple-100' : 'bg-purple-950/80 text-purple-400'
                      }`}
                    >
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          {/* Cartão de Segurança na Barra Lateral */}
          <div className="rounded-2xl border border-purple-900/30 bg-[#120B22]/80 p-3.5 space-y-2 text-xs text-purple-300/70">
            <div className="flex items-center gap-2 font-semibold text-purple-200">
              <ShieldCheck className="h-4 w-4 text-emerald-400" />
              <span>Autorização de Servidor</span>
            </div>
            <p className="text-[11px] leading-relaxed text-purple-400/60">
              Sessão verificada no backend por UID imutável do proprietário.
            </p>
            <div className="font-mono text-[10px] text-purple-400/50 truncate">
              UID: {AUTHORIZED_ADMIN_UID.substring(0, 12)}...
            </div>
          </div>
        </aside>

        {/* Área de Conteúdo da Seção Ativa */}
        <main className="flex-1 min-w-0">
          {error && (
            <div className="mb-4 flex items-center gap-3 rounded-xl border border-rose-500/40 bg-rose-950/30 p-3.5 text-xs text-rose-200">
              <AlertTriangle className="h-4 w-4 text-rose-400 shrink-0" />
              <div className="flex-1">{error}</div>
              <button
                type="button"
                onClick={() => loadActiveSectionData(activeTab)}
                className="text-xs font-semibold underline hover:text-white cursor-pointer"
              >
                Tentar novamente
              </button>
            </div>
          )}

          {/* ============================================================ */}
          {/* SEÇÃO 1: VISÃO GERAL */}
          {/* ============================================================ */}
          {activeTab === 'overview' && (
            <div className="space-y-6 animate-in fade-in duration-150">
              <div>
                <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
                  Visão Geral do Sistema
                </h2>
                <p className="text-xs sm:text-sm text-purple-300/70 mt-1">
                  Resumo operacional, métricas de runtime e integridade dos serviços do Hikari Perfil.
                </p>
              </div>

              {/* Cards de Indicadores Principais */}
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                <div className="rounded-2xl border border-purple-900/40 bg-[#120B22] p-4 shadow-sm">
                  <div className="flex items-center justify-between text-purple-400">
                    <span className="text-xs font-medium text-purple-300/70">Estado do Servidor</span>
                    <Server className="h-4 w-4 text-emerald-400" />
                  </div>
                  <div className="mt-2 text-2xl font-bold text-white flex items-center gap-2">
                    <span className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-400 animate-pulse" />
                    Online
                  </div>
                  <div className="mt-1 text-[11px] text-purple-400/60">
                    Uptime: {overview ? formatUptime(overview.server.uptimeSeconds) : '...'}
                  </div>
                </div>

                <div className="rounded-2xl border border-purple-900/40 bg-[#120B22] p-4 shadow-sm">
                  <div className="flex items-center justify-between text-purple-400">
                    <span className="text-xs font-medium text-purple-300/70">Usuários Cadastrados</span>
                    <Users className="h-4 w-4 text-purple-400" />
                  </div>
                  <div className="mt-2 text-2xl font-bold text-white">
                    {overview?.counts.registeredUsers ?? '...'}
                  </div>
                  <div className="mt-1 text-[11px] text-purple-400/60">
                    Base conhecida pelo sistema
                  </div>
                </div>

                <div className="rounded-2xl border border-purple-900/40 bg-[#120B22] p-4 shadow-sm">
                  <div className="flex items-center justify-between text-purple-400">
                    <span className="text-xs font-medium text-purple-300/70">Catálogo de Animes</span>
                    <Film className="h-4 w-4 text-indigo-400" />
                  </div>
                  <div className="mt-2 text-2xl font-bold text-white">
                    {overview?.counts.catalogAnimes ?? '...'}
                  </div>
                  <div className="mt-1 text-[11px] text-purple-400/60">
                    Registros oficiais indexados
                  </div>
                </div>

                <div className="rounded-2xl border border-purple-900/40 bg-[#120B22] p-4 shadow-sm">
                  <div className="flex items-center justify-between text-purple-400">
                    <span className="text-xs font-medium text-purple-300/70">Alertas do Sistema</span>
                    <ShieldCheck className="h-4 w-4 text-emerald-400" />
                  </div>
                  <div className="mt-2 text-2xl font-bold text-white">
                    {overview?.counts.activeAlerts ?? '0'} Ativos
                  </div>
                  <div className="mt-1 text-[11px] text-purple-400/60">
                    Todos os serviços protegidos
                  </div>
                </div>
              </div>

              {/* Alertas e Verificações do Sistema */}
              <div className="rounded-2xl border border-purple-900/40 bg-[#120B22] p-5 shadow-sm space-y-4">
                <div className="flex items-center justify-between border-b border-purple-900/40 pb-3">
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <Zap className="h-4 w-4 text-purple-400" />
                    <span>Integridade dos Mecanismos de Proteção</span>
                  </h3>
                  <span className="text-xs text-purple-400/60">
                    Verificado em tempo real
                  </span>
                </div>

                <div className="space-y-3">
                  {overview?.systemAlerts.map((alert) => (
                    <div
                      key={alert.id}
                      className="flex items-start gap-3 rounded-xl border border-purple-900/30 bg-[#160E2A]/60 p-3.5 text-xs"
                    >
                      <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
                      <div>
                        <div className="font-semibold text-white">{alert.title}</div>
                        <div className="text-purple-300/70 mt-0.5 leading-relaxed">
                          {alert.message}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Informações de Runtime */}
              {overview && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                  <div className="rounded-xl border border-purple-900/30 bg-[#120B22] p-3.5">
                    <span className="text-purple-400/60 block">Versão do Node.js:</span>
                    <span className="font-mono text-purple-200 mt-1 block">{overview.server.nodeVersion}</span>
                  </div>
                  <div className="rounded-xl border border-purple-900/30 bg-[#120B22] p-3.5">
                    <span className="text-purple-400/60 block">Memória Alocada (RSS):</span>
                    <span className="font-mono text-purple-200 mt-1 block">{overview.server.memoryRssMb} MB</span>
                  </div>
                  <div className="rounded-xl border border-purple-900/30 bg-[#120B22] p-3.5">
                    <span className="text-purple-400/60 block">Heap em Uso:</span>
                    <span className="font-mono text-purple-200 mt-1 block">{overview.server.memoryHeapUsedMb} MB</span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ============================================================ */}
          {/* SEÇÃO 2: USUÁRIOS */}
          {/* ============================================================ */}
          {activeTab === 'users' && (
            <div className="space-y-5 animate-in fade-in duration-150">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
                    Gestão de Usuários
                  </h2>
                  <p className="text-xs sm:text-sm text-purple-300/70 mt-1">
                    Consulta segura da base de usuários cadastrados e verificação de status.
                  </p>
                </div>

                {/* Barra de Pesquisa */}
                <form onSubmit={handleUserSearchSubmit} className="flex items-center gap-2">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-purple-400/60" />
                    <input
                      type="text"
                      value={userSearch}
                      onChange={(e) => setUserSearch(e.target.value)}
                      placeholder="Pesquisar por nome ou @..."
                      className="w-48 sm:w-64 rounded-xl border border-purple-900/40 bg-[#160E2A] pl-9 pr-3 py-1.5 text-xs text-white placeholder-purple-400/40 focus:border-purple-500 focus:outline-none"
                    />
                  </div>
                  <button
                    type="submit"
                    className="rounded-xl bg-purple-600 hover:bg-purple-500 px-3 py-1.5 text-xs font-medium text-white transition-colors cursor-pointer"
                  >
                    Buscar
                  </button>
                </form>
              </div>

              {/* Garantia de Privacidade Explícita */}
              <div className="flex items-center gap-2 rounded-xl border border-indigo-900/40 bg-indigo-950/20 px-3.5 py-2 text-xs text-indigo-300">
                <Info className="h-4 w-4 shrink-0 text-indigo-400" />
                <span>
                  Proteção por menor privilégio: senhas, credenciais de autenticação e chats privados não são expostos na interface.
                </span>
              </div>

              {/* Lista / Tabela de Usuários */}
              <div className="rounded-2xl border border-purple-900/40 bg-[#120B22] overflow-hidden shadow-sm">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-purple-900/40 bg-[#160E2A]/70 text-[11px] font-bold uppercase tracking-wider text-purple-400/70">
                      <tr>
                        <th className="px-4 py-3">Usuário</th>
                        <th className="px-4 py-3">Cadastro</th>
                        <th className="px-4 py-3">Privacidade</th>
                        <th className="px-4 py-3">Seguidores</th>
                        <th className="px-4 py-3">Status</th>
                        <th className="px-4 py-3 text-right">Ação</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-purple-900/20">
                      {users.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="px-4 py-8 text-center text-purple-400/60">
                            Nenhum usuário localizado para o critério informado.
                          </td>
                        </tr>
                      ) : (
                        users.map((u) => (
                          <tr key={u.id} className="hover:bg-purple-950/20 transition-colors">
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-3">
                                {u.avatarUrl ? (
                                  <img
                                    src={u.avatarUrl}
                                    alt={u.displayName}
                                    className="h-8 w-8 rounded-full object-cover border border-purple-700/40 shrink-0"
                                  />
                                ) : (
                                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-purple-800 to-indigo-900 border border-purple-500/30 text-white font-bold text-xs shrink-0">
                                    {(u.displayName || u.username || 'U').charAt(0).toUpperCase()}
                                  </div>
                                )}
                                <div className="min-w-0">
                                  <div className="flex items-center gap-1.5 font-semibold text-white truncate">
                                    {u.isOwner ? (
                                      <AetherAnimatedName name={u.displayName} profileOrUid={u.id} />
                                    ) : (
                                      <span>{u.displayName}</span>
                                    )}
                                    {u.isOwner && <HikariEternalBadge profileOrUid={u.id} size="sm" />}
                                  </div>
                                  <div className="text-[11px] text-purple-400/70 truncate">@{u.username}</div>
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-3 text-purple-300/70 whitespace-nowrap">
                              {u.createdAt}
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap">
                              {u.isPrivate ? (
                                <span className="inline-flex items-center gap-1 rounded-md bg-amber-950/50 border border-amber-800/40 px-2 py-0.5 text-[10px] font-medium text-amber-300">
                                  <Lock className="h-3 w-3" />
                                  Privado
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 rounded-md bg-emerald-950/40 border border-emerald-800/40 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
                                  <Eye className="h-3 w-3" />
                                  Público
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-purple-300 font-mono whitespace-nowrap">
                              {u.followersCount}
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap">
                              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-950/50 border border-emerald-700/40 px-2.5 py-0.5 text-[11px] font-medium text-emerald-300">
                                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                                {u.status}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-right whitespace-nowrap">
                              <button
                                type="button"
                                onClick={() => setSelectedUser(u)}
                                className="rounded-lg border border-purple-800/40 bg-purple-950/40 hover:bg-purple-900/40 text-purple-300 hover:text-white px-2.5 py-1 text-xs transition-colors cursor-pointer"
                              >
                                Detalhes
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Modal de Detalhes do Usuário */}
              {selectedUser && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-100">
                  <div className="w-full max-w-md rounded-2xl border border-purple-800/50 bg-[#130E24] p-5 sm:p-6 shadow-2xl space-y-4">
                    <div className="flex items-center justify-between border-b border-purple-900/40 pb-3">
                      <div className="flex items-center gap-2">
                        <Users className="h-4 w-4 text-purple-400" />
                        <h3 className="font-bold text-white text-sm sm:text-base">Dados Administrativos</h3>
                      </div>
                      <button
                        type="button"
                        onClick={() => setSelectedUser(null)}
                        className="rounded-lg p-1 text-purple-400 hover:bg-purple-900/30 hover:text-white transition-colors cursor-pointer"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>

                    <div className="space-y-3 text-xs">
                      <div className="flex items-center gap-3">
                        <div className="h-12 w-12 rounded-full bg-purple-950 border border-purple-700/50 flex items-center justify-center text-white font-bold text-sm shrink-0">
                          {(selectedUser.displayName || 'U').charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <div className="font-bold text-white text-sm">{selectedUser.displayName}</div>
                          <div className="text-purple-400/80">@{selectedUser.username}</div>
                          <div className="text-[10px] font-mono text-purple-400/50 mt-0.5">UID: {selectedUser.id}</div>
                        </div>
                      </div>

                      {selectedUser.bio && (
                        <div className="rounded-xl bg-[#170E2B] p-3 border border-purple-900/30 text-purple-200/80">
                          {selectedUser.bio}
                        </div>
                      )}

                      <div className="grid grid-cols-2 gap-2 text-purple-300/80">
                        <div className="rounded-xl bg-[#160E2A]/70 p-2.5 border border-purple-900/20">
                          <span className="text-[10px] text-purple-400/60 block">Data de Criação</span>
                          <span className="font-semibold text-white">{selectedUser.createdAt}</span>
                        </div>
                        <div className="rounded-xl bg-[#160E2A]/70 p-2.5 border border-purple-900/20">
                          <span className="text-[10px] text-purple-400/60 block">Visibilidade</span>
                          <span className="font-semibold text-white">
                            {selectedUser.isPrivate ? 'Perfil Privado' : 'Perfil Público'}
                          </span>
                        </div>
                      </div>

                      <div className="rounded-xl border border-purple-900/40 bg-purple-950/20 p-3 text-[11px] text-purple-300/70">
                        Conta externa sincronizada: AniList ({selectedUser.connectedServices.anilist ? 'Sim' : 'Não'})
                      </div>
                    </div>

                    <div className="pt-2 flex justify-end">
                      <button
                        type="button"
                        onClick={() => setSelectedUser(null)}
                        className="rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-medium px-4 py-2 text-xs transition-colors cursor-pointer"
                      >
                        Fechar
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ============================================================ */}
          {/* SEÇÃO 3: ANIMES */}
          {/* ============================================================ */}
          {activeTab === 'animes' && (
            <div className="space-y-5 animate-in fade-in duration-150">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
                    Catálogo de Animes
                  </h2>
                  <p className="text-xs sm:text-sm text-purple-300/70 mt-1">
                    Consulta do catálogo e conferência de integridade das entradas oficiais.
                  </p>
                </div>

                <form onSubmit={handleAnimeSearchSubmit} className="flex items-center gap-2">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-purple-400/60" />
                    <input
                      type="text"
                      value={animeSearch}
                      onChange={(e) => setAnimeSearch(e.target.value)}
                      placeholder="Buscar por título ou gênero..."
                      className="w-48 sm:w-64 rounded-xl border border-purple-900/40 bg-[#160E2A] pl-9 pr-3 py-1.5 text-xs text-white placeholder-purple-400/40 focus:border-purple-500 focus:outline-none"
                    />
                  </div>
                  <button
                    type="submit"
                    className="rounded-xl bg-purple-600 hover:bg-purple-500 px-3 py-1.5 text-xs font-medium text-white transition-colors cursor-pointer"
                  >
                    Buscar
                  </button>
                </form>
              </div>

              {/* Informação sobre Integridade do Catálogo */}
              <div className="flex items-center gap-2 rounded-xl border border-purple-900/40 bg-purple-950/20 px-3.5 py-2 text-xs text-purple-300">
                <Info className="h-4 w-4 shrink-0 text-purple-400" />
                <span>
                  Catálogo oficial protegido contra alterações e exclusões automáticas não autorizadas.
                </span>
              </div>

              {/* Grade de Registros de Animes */}
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3.5">
                {animes.map((anime) => (
                  <div
                    key={anime.id}
                    className="flex gap-3 rounded-2xl border border-purple-900/40 bg-[#120B22] p-3 shadow-sm hover:border-purple-700/40 transition-colors"
                  >
                    <img
                      src={anime.posterUrl}
                      alt={anime.title}
                      className="h-24 w-16 rounded-xl object-cover border border-purple-900/40 shrink-0"
                    />
                    <div className="flex-1 min-w-0 flex flex-col justify-between">
                      <div>
                        <div className="font-bold text-white text-xs truncate" title={anime.title}>
                          {anime.title}
                        </div>
                        <div className="text-[11px] text-purple-400/60 truncate" title={anime.titleRomaji}>
                          {anime.titleRomaji}
                        </div>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {anime.genres.slice(0, 2).map((g) => (
                            <span
                              key={g}
                              className="rounded bg-purple-950/60 border border-purple-800/30 px-1.5 py-0.2 text-[9px] text-purple-300"
                            >
                              {g}
                            </span>
                          ))}
                        </div>
                      </div>

                      <div className="mt-2 flex items-center justify-between text-[11px] text-purple-300/80 border-t border-purple-900/30 pt-1.5">
                        <span>Ano: {anime.year}</span>
                        <span className="font-semibold text-purple-200">★ {anime.rating}/10</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ============================================================ */}
          {/* SEÇÃO 4: MODERAÇÃO */}
          {/* ============================================================ */}
          {activeTab === 'moderation' && (
            <div className="space-y-6 animate-in fade-in duration-150">
              <div>
                <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
                  Moderação e Denúncias
                </h2>
                <p className="text-xs sm:text-sm text-purple-300/70 mt-1">
                  Acompanhamento de infrações e preparação de ferramentas de moderação.
                </p>
              </div>

              {moderation?.reports?.length ? (
                <div className="space-y-3">
                  {moderation.reports.map((report) => (
                    <article key={report.id} className="rounded-xl border border-purple-900/40 bg-[#120B22] p-4 space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-white">Denúncia de perfil · {report.reason}</span>
                        <span className="rounded-md border border-amber-600/30 bg-amber-950/30 px-2 py-1 text-[10px] font-semibold text-amber-200">{report.status || 'pending'}</span>
                      </div>
                      <p className="text-xs text-purple-200/80">Perfil denunciado: <span className="font-mono">{report.targetId || 'Não informado'}</span></p>
                      {report.details && <p className="text-xs leading-relaxed text-purple-300/80">{report.details}</p>}
                      <p className="text-[10px] text-purple-400/60">Denunciante: {report.reporterUid || 'Não informado'} · {report.createdAt || 'Data indisponível'}</p>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="rounded-2xl border border-purple-900/40 bg-[#120B22] p-6 text-center space-y-3">
                  <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-950/40 border border-emerald-700/40 text-emerald-400">
                    <CheckCircle2 className="h-6 w-6" />
                  </div>
                  <h3 className="text-base font-bold text-white">Nenhuma Denúncia Pendente</h3>
                  <p className="text-xs text-purple-300/70 max-w-md mx-auto leading-relaxed">
                    {moderation?.systemNotice || 'Nenhuma denúncia pendente registrada no momento.'}
                  </p>
                </div>
              )}

              {/* Diretriz de Não-Punição Automática */}
              <div className="rounded-2xl border border-purple-900/40 bg-[#120B22] p-5 space-y-3 text-xs">
                <div className="font-bold text-white flex items-center gap-2">
                  <ShieldAlert className="h-4 w-4 text-purple-400" />
                  <span>Diretrizes de Moderação Responsável</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-purple-300/80">
                  <div className="rounded-xl bg-[#160E2A]/70 p-3.5 border border-purple-900/30">
                    <div className="font-semibold text-white">Sem Punições Automáticas</div>
                    <div className="text-[11px] text-purple-400/70 mt-1 leading-relaxed">
                      Todas as ações de moderação requerem análise do proprietário para garantir ausência de falsos positivos.
                    </div>
                  </div>
                  <div className="rounded-xl bg-[#160E2A]/70 p-3.5 border border-purple-900/30">
                    <div className="font-semibold text-white">Dados Autênticos</div>
                    <div className="text-[11px] text-purple-400/70 mt-1 leading-relaxed">
                      Nenhuma denúncia fictícia é gerada. A lista reflete unicamente ocorrências reais do sistema.
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ============================================================ */}
          {/* SEÇÃO 5: ESTATÍSTICAS */}
          {/* ============================================================ */}
          {activeTab === 'metrics' && (
            <div className="space-y-6 animate-in fade-in duration-150">
              <div>
                <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
                  Estatísticas do Sistema
                </h2>
                <p className="text-xs sm:text-sm text-purple-300/70 mt-1">
                  Métricas reais consolidadas com separação explícita de informações indisponíveis.
                </p>
              </div>

              {/* Métricas Reais Disponíveis */}
              <div className="rounded-2xl border border-purple-900/40 bg-[#120B22] p-5 space-y-4">
                <div className="flex items-center gap-2 font-bold text-white text-sm border-b border-purple-900/40 pb-3">
                  <BarChart3 className="h-4 w-4 text-purple-400" />
                  <span>Métricas Reais Disponíveis</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5 text-xs">
                  <div className="rounded-xl bg-[#160E2A] p-3.5 border border-purple-900/30">
                    <span className="text-purple-400/60 block">Total de Usuários Conhecidos</span>
                    <span className="text-xl font-bold text-white mt-1 block">
                      {metrics?.realMetrics.totalUsersKnown ?? '...'}
                    </span>
                    <span className="text-[10px] text-purple-400/50 mt-0.5 block">
                      {metrics?.realMetrics.publicProfilesCount} públicos / {metrics?.realMetrics.privateProfilesCount} privados
                    </span>
                  </div>

                  <div className="rounded-xl bg-[#160E2A] p-3.5 border border-purple-900/30">
                    <span className="text-purple-400/60 block">Catálogo Oficial de Animes</span>
                    <span className="text-xl font-bold text-white mt-1 block">
                      {metrics?.realMetrics.totalCatalogAnimes ?? '...'}
                    </span>
                    <span className="text-[10px] text-purple-400/50 mt-0.5 block">
                      Nota média: {metrics?.realMetrics.averageCatalogRating}/10
                    </span>
                  </div>

                  <div className="rounded-xl bg-[#160E2A] p-3.5 border border-purple-900/30">
                    <span className="text-purple-400/60 block">Uptime do Servidor</span>
                    <span className="text-xl font-bold text-white mt-1 block">
                      {metrics ? formatUptime(metrics.realMetrics.serverUptimeSeconds) : '...'}
                    </span>
                    <span className="text-[10px] text-purple-400/50 mt-0.5 block">
                      Heap: {metrics?.realMetrics.memoryHeapUsedMb} MB
                    </span>
                  </div>
                </div>
              </div>

              {/* Informações Indisponíveis (Claramente Segregadas) */}
              <div className="rounded-2xl border border-purple-900/30 bg-[#120B22]/70 p-5 space-y-3">
                <div className="flex items-center gap-2 font-bold text-white text-sm border-b border-purple-900/30 pb-2">
                  <Info className="h-4 w-4 text-purple-400/70" />
                  <span>Informações Indisponíveis por Política de Privacidade</span>
                </div>
                <div className="space-y-2">
                  {metrics?.unavailableMetrics.map((unav, idx) => (
                    <div
                      key={idx}
                      className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 rounded-xl bg-[#160E2A]/40 px-3.5 py-2.5 text-xs border border-purple-900/20"
                    >
                      <div className="font-medium text-purple-200">{unav.metric}</div>
                      <div className="text-[11px] text-purple-400/60">{unav.reason}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ============================================================ */}
          {/* SEÇÃO 6: SEGURANÇA */}
          {/* ============================================================ */}
          {activeTab === 'security' && (
            <div className="space-y-6 animate-in fade-in duration-150">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
                    Mecanismos de Segurança
                  </h2>
                  <p className="text-xs sm:text-sm text-purple-300/70 mt-1">
                    Auditoria do estado da autenticação administrativa e validação de regras de blindagem.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={handleRunHealthCheck}
                  disabled={healthCheckStatus.running}
                  className="flex items-center gap-2 rounded-xl bg-purple-600 hover:bg-purple-500 px-3.5 py-2 text-xs font-semibold text-white transition-colors cursor-pointer shrink-0 disabled:opacity-50"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${healthCheckStatus.running ? 'animate-spin' : ''}`} />
                  <span>Executar Diagnóstico</span>
                </button>
              </div>

              {/* Resultado do Diagnóstico */}
              {healthCheckStatus.result && (
                <div className="flex items-center gap-3 rounded-2xl border border-emerald-500/40 bg-emerald-950/20 p-4 text-xs text-emerald-200">
                  <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0" />
                  <div>
                    <div className="font-bold text-white">{healthCheckStatus.result.message}</div>
                    <div className="text-[11px] text-emerald-300/70 mt-0.5">
                      Resposta do endpoint protegido confirmada em {new Date(healthCheckStatus.result.timestamp).toLocaleTimeString()}.
                    </div>
                  </div>
                </div>
              )}

              {/* Auditoria de Mecanismos */}
              <div className="rounded-2xl border border-purple-900/40 bg-[#120B22] p-5 space-y-4">
                <div className="font-bold text-white text-sm border-b border-purple-900/40 pb-3 flex items-center justify-between">
                  <span>Mecanismos de Blindagem Ativos</span>
                  <span className="text-xs text-emerald-400 font-semibold">● Estado: Blindado</span>
                </div>

                <div className="space-y-3">
                  {security?.checks.map((check) => (
                    <div
                      key={check.id}
                      className="rounded-xl border border-purple-900/30 bg-[#160E2A]/70 p-3.5 text-xs space-y-1"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-white">{check.name}</span>
                        <span className="rounded-full bg-emerald-950/60 border border-emerald-700/40 px-2 py-0.2 text-[10px] font-semibold text-emerald-300">
                          {check.status}
                        </span>
                      </div>
                      <div className="text-purple-300/70 text-[11px] leading-relaxed">
                        {check.description}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Regra de Imutabilidade do UID */}
              <div className="rounded-2xl border border-amber-800/40 bg-amber-950/20 p-4 text-xs text-amber-200 flex items-start gap-3">
                <Lock className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <div className="font-bold text-amber-100">Imutabilidade Mandatória</div>
                  <div className="text-[11px] text-amber-300/80 mt-1 leading-relaxed">
                    O UID autorizado é gravado como constante no código-fonte e verificado no backend. Nenhuma interface gráfica ou requisição cliente possui permissão para alterar o proprietário.
                  </div>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
};
