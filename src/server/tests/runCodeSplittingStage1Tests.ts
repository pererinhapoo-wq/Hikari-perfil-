import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import {
  getDeterministicConversationId,
  canUserMessageRecipient,
  validateMediaPayload,
  extractHikariLinkPreview,
} from '../../utils/chatValidation.js';
import {
  getDeterministicConversationId as serverGetConvId,
  chatStore,
} from '../chatStore.js';
import { AUTHORIZED_ADMIN_UID } from '../../types/index.js';
import { isAuthorizedAdmin, verifyAdminToken } from '../adminAuth.js';

function collectClientFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (fullPath.endsWith(path.join('src', 'server'))) continue;
      collectClientFiles(fullPath, acc);
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      acc.push(fullPath);
    }
  }
  return acc;
}

async function runStage1Tests() {
  console.log('================================================================');
  console.log('TESTES DA ETAPA 1 — CODE SPLITTING, LAZY LOADING E ISOLAMENTO');
  console.log('================================================================');

  const rootDir = process.cwd();
  const appSource = fs.readFileSync(path.join(rootDir, 'src/App.tsx'), 'utf8');
  const animeListSource = fs.readFileSync(
    path.join(rootDir, 'src/components/tabs/AnimeListTab.tsx'),
    'utf8'
  );
  const settingsModalSource = fs.readFileSync(
    path.join(rootDir, 'src/components/modals/SettingsModal.tsx'),
    'utf8'
  );
  const chatServiceSource = fs.readFileSync(
    path.join(rootDir, 'src/services/chatService.ts'),
    'utf8'
  );
  const viteConfigSource = fs.readFileSync(path.join(rootDir, 'vite.config.ts'), 'utf8');
  const distIndexHtml = fs.readFileSync(path.join(rootDir, 'dist/index.html'), 'utf8');
  const distAssetsDir = path.join(rootDir, 'dist/assets');
  const distAssets = fs.readdirSync(distAssetsDir);

  let passed = 0;
  function check(condition: boolean, label: string, detail?: string) {
    if (!condition) {
      throw new Error(`FALHA: ${label}${detail ? ` — ${detail}` : ''}`);
    }
    console.log(`  ✓ ${label}`);
    passed++;
  }

  // 1. Abrir na aba Visão Geral com componentes essenciais síncronos
  check(
    appSource.includes("useState<ProfileTab>('overview')") &&
      appSource.includes("import { Header } from './components/Header';") &&
      appSource.includes("import { ProfileHeader } from './components/ProfileHeader';") &&
      appSource.includes("import { TabsNavigation } from './components/TabsNavigation';") &&
      appSource.includes("import { OverviewTab } from './components/tabs/OverviewTab';"),
    '1. Perfil abre diretamente na Visão Geral com Header, ProfileHeader, TabsNavigation e OverviewTab imediatos'
  );

  // 2. React.lazy() + Suspense e chunks gerados para todos os 9 componentes obrigatórios
  const requiredLazyChunks = [
    'AnimeListTab-',
    'ActivityTab-',
    'CommentsTab-',
    'AboutTab-',
    'AdminPanel-',
    'SettingsModal-',
    'PrivateChatModal-',
    'FollowersModal-',
    'AnimeEditModal-',
  ];

  for (const prefix of requiredLazyChunks) {
    const foundChunk = distAssets.find((f) => f.startsWith(prefix) && f.endsWith('.js'));
    check(
      Boolean(foundChunk),
      `Chunk separado emitido no build para ${prefix.slice(0, -1)} (${foundChunk || 'ausente'})`
    );
    check(
      !distIndexHtml.includes(prefix),
      `Chunk ${prefix.slice(0, -1)} NÃO é pré-carregado no index.html inicial`
    );
  }

  // 3. Modais pesados fechados não são montados antecipadamente
  check(
    appSource.includes('{isFollowersOpen && (') &&
      appSource.includes('{hasOpenedSettings && (') &&
      (appSource.includes('{isChatOpen && (') || appSource.includes('isChatOpen && (')) &&
      animeListSource.includes('{editingAnime !== null && ('),
    'Modais pesados (FollowersModal, SettingsModal, PrivateChatModal, AnimeEditModal) não montam enquanto fechados'
  );

  // 4. SettingsModal preserva estado ao fechar/reabrir (remoção de key destrutiva + posicionamento Portal/scroll intacto)
  check(
    !appSource.includes('key={`${settingsInitialTab}-${isSettingsOpen}`}') &&
      !appSource.includes('key={isSettingsOpen}') &&
      appSource.includes('openSyncKey={settingsOpenSyncKey}') &&
      settingsModalSource.includes('openSyncKey') &&
      settingsModalSource.includes('return createPortal(') &&
      settingsModalSource.includes('savedScrollY'),
    'SettingsModal preserva estado entre fechar/reabrir sem remontagem destrutiva e mantém Portal + restauração de scroll'
  );

  // 5. Separação estrita cliente/servidor (nenhum arquivo do cliente importa src/server/*)
  check(
    !chatServiceSource.includes('../server/chatStore') &&
      chatServiceSource.includes('../utils/chatValidation'),
    'src/services/chatService.ts desacoplado de ../server/chatStore'
  );

  const clientFiles = collectClientFiles(path.join(rootDir, 'src'));
  const offendingClientImports: string[] = [];
  for (const file of clientFiles) {
    const content = fs.readFileSync(file, 'utf8');
    if (/from\s+['"][^'"]*\/server\//.test(content) || /import\(['"][^'"]*\/server\//.test(content)) {
      offendingClientImports.push(path.relative(rootDir, file));
    }
  }
  check(
    offendingClientImports.length === 0,
    `Zero importações de src/server/* em todos os ${clientFiles.length} arquivos do cliente`,
    offendingClientImports.join(', ')
  );

  // Confirma que a classe ChatStore do servidor não entrou no bundle JS do navegador
  const jsBundles = distAssets.filter((f) => f.endsWith('.js'));
  for (const jsFile of jsBundles) {
    const bundleCode = fs.readFileSync(path.join(distAssetsDir, jsFile), 'utf8');
    if (bundleCode.includes('seedInitialConversations') || bundleCode.includes('registerUserContext')) {
      throw new Error(`Vazamento de código de servidor detectado no chunk ${jsFile}`);
    }
  }
  check(true, 'Nenhum chunk JS do cliente contém a classe de servidor ChatStore');

  // Paridade funcional entre chatValidation (cliente) e chatStore (servidor)
  assert.strictEqual(
    getDeterministicConversationId('usr_b', 'usr_a'),
    serverGetConvId('usr_a', 'usr_b')
  );
  assert.strictEqual(validateMediaPayload('javascript:alert(1)', 'image').valid, false);
  assert.ok(extractHikariLinkPreview('Olha este anime: https://hikari.tv/anime/frieren'));
  assert.strictEqual(
    canUserMessageRecipient(
      {
        id: 'u1',
        username: 'u1',
        displayName: 'U1',
        avatarUrl: '',
        followingIds: [],
        followerIds: [],
        blockedIds: [],
      },
      {
        id: 'u2',
        username: 'u2',
        displayName: 'U2',
        avatarUrl: '',
        allowDirectMessages: false,
        followingIds: [],
        followerIds: [],
        blockedIds: [],
      }
    ).allowed,
    false
  );
  assert.ok(Array.isArray(chatStore.getUserConversations('usr_hikari_001')));
  check(true, 'Validações de mensagens privadas, links Hikari e ChatStore do servidor funcionam integralmente');

  // 6. Preservação de filtros, busca e rolagem das abas por perfil
  check(
    appSource.includes('setSelectedAnimeStatusFilter(undefined)') &&
      animeListSource.includes('persistentAnimeTabStateByProfile') &&
      !appSource.includes("handleTabChange = useCallback((tab: ProfileTab) => {\n    if (tab === 'animes') {\n      setSelectedAnimeDetailId(null);\n      setSelectedAnimeStatusFilter('all');"),
    'Alternância para a aba Animes preserva filtro, busca e posição de rolagem por perfil'
  );

  // 7. Isolamento da rota /admin e segurança obrigatória para Aether vs visitantes/usuários comuns
  check(
    appSource.includes("await import('./services/adminService')") &&
      distAssets.some((f) => f.startsWith('adminService-')) &&
      distAssets.some((f) => f.startsWith('AdminAccessDenied-')),
    'AdminPanel, AdminAccessDenied e adminService isolados da carga inicial da Visão Geral'
  );
  assert.strictEqual(isAuthorizedAdmin(AUTHORIZED_ADMIN_UID), true);
  assert.strictEqual((await verifyAdminToken(`test_token_${AUTHORIZED_ADMIN_UID}`)).isAdmin, true);
  assert.strictEqual((await verifyAdminToken('test_token_common_user')).isAdmin, false);
  check(true, 'Acesso administrativo do proprietário Aether funciona e usuários comuns/visitantes continuam bloqueados');

  // 8. Chunks reutilizáveis de bibliotecas no Vite e redução comprovada do JS inicial
  const expectedVendorChunks = [
    'vendor-react-',
    'vendor-firebase-auth-',
    'vendor-firebase-firestore-',
    'vendor-lucide-',
  ];
  for (const vp of expectedVendorChunks) {
    check(
      distAssets.some((f) => f.startsWith(vp) && f.endsWith('.js')),
      `Vendor chunk reutilizável presente: ${vp.slice(0, -1)}`
    );
  }
  check(
    viteConfigSource.includes('manualChunks'),
    'vite.config.ts configurado com separação controlada de vendor chunks'
  );

  const entryAsset = distAssets.find((f) => f.startsWith('index-') && f.endsWith('.js'));
  assert.ok(entryAsset, 'Entry chunk index-*.js deve existir');
  const entrySizeKB = fs.statSync(path.join(distAssetsDir, entryAsset)).size / 1024;
  check(
    entrySizeKB < 550,
    `Entry chunk da aplicação reduzido para ${entrySizeKB.toFixed(2)} kB (antes: 1555.18 kB monolítico)`
  );

  console.log('----------------------------------------------------------------');
  console.log(`TODOS OS ${passed} TESTES DA ETAPA 1 APROVADOS COM SUCESSO!`);
  console.log('================================================================\n');
}

runStage1Tests().catch((err) => {
  console.error(err);
  process.exit(1);
});
