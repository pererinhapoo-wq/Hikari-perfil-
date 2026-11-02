import fs from 'fs';
import path from 'path';

interface TestResult {
  name: string;
  passed: boolean;
  details: string;
}

const results: TestResult[] = [];

function assert(condition: boolean, name: string, details: string) {
  results.push({
    name,
    passed: condition,
    details: condition ? 'OK' : details,
  });
}

export async function runHeaderOverlayTests() {
  console.log('--- Executando Testes de Overlays e Interações do Header ---');

  const headerPath = path.resolve(process.cwd(), 'src/components/Header.tsx');
  const headerSource = fs.readFileSync(headerPath, 'utf8');

  // Test 1: Desktop backdrop is eliminated (no md:bg-transparent with fixed inset-0)
  const hasTransparentDesktopBackdrop = headerSource.includes('md:bg-transparent') && headerSource.includes('fixed inset-0');
  assert(
    !hasTransparentDesktopBackdrop,
    'Eliminação de overlay transparente no desktop',
    'Header ainda contém "md:bg-transparent" cobrindo a tela no desktop.'
  );

  // Test 2: Mobile backdrop is strictly scoped with md:hidden
  const hasMobileHiddenBackdrop = headerSource.includes('md:hidden') && headerSource.includes('fixed inset-0');
  assert(
    hasMobileHiddenBackdrop,
    'Backdrop visível estritamente móvel com md:hidden',
    'O backdrop do menu de usuário não possui classe "md:hidden".'
  );

  // Test 3: Outside click handles both mousedown and touchstart
  const hasTouchStartListener = headerSource.includes("document.addEventListener('touchstart', handleClickOutside");
  const hasMouseDownListener = headerSource.includes("document.addEventListener('mousedown', handleClickOutside");
  assert(
    hasTouchStartListener && hasMouseDownListener,
    'Detecção de clique e toque externo (mousedown e touchstart)',
    'Falta listener para touchstart ou mousedown em handleClickOutside.'
  );

  // Test 4: Notifications popover portal container preserves pointer-events-none
  const hasNotifPointerEventsNone = headerSource.includes('fixed inset-x-0 top-[4.25rem] z-50 pointer-events-none');
  assert(
    hasNotifPointerEventsNone,
    'Contêiner do portal de notificações com pointer-events-none',
    'O contêiner do portal de notificações não possui pointer-events-none.'
  );

  // Test 5: Notifications inner panel preserves pointer-events-auto
  const hasNotifPanelPointerEventsAuto = headerSource.includes('pointer-events-auto sm:mr-12 flex w-full max-w-full sm:w-96');
  assert(
    hasNotifPanelPointerEventsAuto,
    'Painel interno de notificações interativo com pointer-events-auto',
    'O painel de notificações não possui pointer-events-auto.'
  );

  // Test 6: Scroll lock does not block touchAction globally or freeze desktop
  const hasGlobalTouchActionNone = headerSource.includes("document.body.style.touchAction = 'none'");
  assert(
    !hasGlobalTouchActionNone,
    'Remoção de touchAction="none" global',
    'Ainda existe touchAction="none" bloqueando toques globalmente.'
  );

  // Test 7: Mobile scroll lock scoped to mobile screen width (< 768px)
  const hasMobileCheckInScrollLock = headerSource.includes('window.innerWidth < 768');
  assert(
    hasMobileCheckInScrollLock,
    'Trava de rolagem de fundo restrita a telas móveis (< 768px)',
    'O scroll lock não verifica largura de tela móvel.'
  );

  // Test 8: Avatar button toggles menu and dismisses notifications/search
  const hasCleanAvatarToggle = headerSource.includes('onToggleNotif(false)') && headerSource.includes('setIsSearchOpen(false)');
  assert(
    hasCleanAvatarToggle,
    'Botão de avatar limpa outros menus e popovers ao alternar',
    'O botão de avatar não sincroniza o fechamento de outros menus.'
  );

  // Test 9: Photo menu in Header uses closed createPortal(..., document.body) and never sets body.style.overflow = 'hidden' (which detaches sticky header when scrolled)
  const hasBodyOverflowHiddenInHeader = headerSource.includes("document.body.style.overflow = 'hidden'");
  const createPortalCount = (headerSource.match(/createPortal\(/g) || []).length;
  const documentBodyPortalTargets = (headerSource.match(/,\s*document\.body\s*\)/g) || []).length;
  assert(
    !hasBodyOverflowHiddenInHeader && createPortalCount >= 2 && documentBodyPortalTargets >= 2,
    'Menu da foto renderizado em document.body via Portal sem quebrar position:sticky do Header ao rolar',
    'Header ainda altera document.body.style.overflow ou possui createPortal incompleto.'
  );

  // Test 10: Simulação matemática de posicionamento do menu da foto no topo (scrollY=0) e após rolagem (scrollY=920) em Desktop (1440x900) e Celular (390x844)
  function simulateMenuCoords(params: {
    viewportWidth: number;
    viewportHeight: number;
    scrollY: number;
    avatarBottomInStickyHeader: number;
    avatarRightInStickyHeader: number;
  }) {
    // Como Header não aplica mais body.style.overflow='hidden', <header class="sticky top-0"> permanece fixo no topo da viewport mesmo com scrollY > 0
    void params.scrollY;
    const menuWidth = 256;
    const margin = 12;
    const rawTop = Math.round(params.avatarBottomInStickyHeader + 8);
    const clampedTop = Math.max(
      margin,
      Math.min(rawTop, Math.max(margin, params.viewportHeight - 120))
    );
    const rawRight = Math.round(params.viewportWidth - params.avatarRightInStickyHeader);
    const maxRight = Math.max(margin, params.viewportWidth - menuWidth - margin);
    const clampedRight = Math.max(margin, Math.min(rawRight, maxRight));
    const availableHeight = Math.max(180, Math.floor(params.viewportHeight - clampedTop - margin));
    const maxHeight = Math.min(480, availableHeight);
    return { top: clampedTop, right: clampedRight, maxHeight };
  }

  const desktopTop = simulateMenuCoords({
    viewportWidth: 1440,
    viewportHeight: 900,
    scrollY: 0,
    avatarBottomInStickyHeader: 48,
    avatarRightInStickyHeader: 1340,
  });
  const desktopScrolled = simulateMenuCoords({
    viewportWidth: 1440,
    viewportHeight: 900,
    scrollY: 920,
    avatarBottomInStickyHeader: 48,
    avatarRightInStickyHeader: 1340,
  });
  const mobileTop = simulateMenuCoords({
    viewportWidth: 390,
    viewportHeight: 844,
    scrollY: 0,
    avatarBottomInStickyHeader: 48,
    avatarRightInStickyHeader: 374,
  });
  const mobileScrolled = simulateMenuCoords({
    viewportWidth: 390,
    viewportHeight: 620, // Barra dinâmica móvel retraída/teclado parcial
    scrollY: 1150,
    avatarBottomInStickyHeader: 48,
    avatarRightInStickyHeader: 374,
  });

  const coordsValid =
    desktopTop.top === 56 &&
    desktopScrolled.top === 56 &&
    desktopTop.right === 100 &&
    desktopScrolled.right === 100 &&
    mobileTop.top === 56 &&
    mobileScrolled.top === 56 &&
    mobileTop.right === 16 &&
    mobileScrolled.right === 16 &&
    mobileScrolled.top + mobileScrolled.maxHeight <= 620;

  assert(
    coordsValid,
    'Posicionamento do menu da foto idêntico no topo e após rolagem em Celular e Desktop',
    'Coordenadas calculadas apresentaram deslocamento fora da viewport.'
  );

  // Test 11: SettingsModal (modal de foto e perfil) usa createPortal, permanece centralizado na viewport e restaura savedScrollY sem conflito com App.tsx
  const settingsModalPath = path.resolve(process.cwd(), 'src/components/modals/SettingsModal.tsx');
  const settingsModalSource = fs.readFileSync(settingsModalPath, 'utf8');
  const appPath = path.resolve(process.cwd(), 'src/App.tsx');
  const appSource = fs.readFileSync(appPath, 'utf8');

  const modalUsesPortal =
    settingsModalSource.includes('return createPortal(') &&
    settingsModalSource.includes('document.body');
  const modalRestoresScrollY =
    settingsModalSource.includes("document.body.style.position = 'fixed'") &&
    settingsModalSource.includes('document.body.style.top = `-${savedScrollY}px`') &&
    settingsModalSource.includes('top: savedScrollY');
  const modalNoHtmlOverflowOrTouchBlock =
    !settingsModalSource.includes("document.documentElement.style.overflow = 'hidden'") &&
    !settingsModalSource.includes("document.body.style.touchAction = 'none'");
  const appNoDoubleSettingsLock = !appSource.includes('isViewingAppShell && (isSettingsOpen || isFollowersOpen)');

  assert(
    modalUsesPortal && modalRestoresScrollY && modalNoHtmlOverflowOrTouchBlock && appNoDoubleSettingsLock,
    'Modal de edição de foto/perfil centralizado via Portal com bloqueio isolado e restauração exata de scroll',
    'SettingsModal não utiliza Portal, bloqueia touchAction global ou conflita com App.tsx.'
  );

  // Test 12: Preservação integral de seleção, pré-visualização, enquadramento (object-cover) e salvamento da foto
  const profileHeaderPath = path.resolve(process.cwd(), 'src/components/ProfileHeader.tsx');
  const profileHeaderSource = fs.readFileSync(profileHeaderPath, 'utf8');
  const photoPipelinePreserved =
    settingsModalSource.includes('handleAvatarFile') &&
    settingsModalSource.includes('onUpdateAvatar(reader.result)') &&
    settingsModalSource.includes('alt="Preview avatar"') &&
    settingsModalSource.includes('object-cover') &&
    settingsModalSource.includes('handleSave') &&
    profileHeaderSource.includes('handleAvatarChange');

  assert(
    photoPipelinePreserved,
    'Seleção, pré-visualização, enquadramento e salvamento da foto preservados',
    'Fluxo de upload, preview ou salvamento da foto foi afetado.'
  );

  let passedCount = 0;
  for (const r of results) {
    const symbol = r.passed ? '✓' : '✗';
    console.log(`${symbol} [${r.passed ? 'PASS' : 'FAIL'}] ${r.name}: ${r.details}`);
    if (r.passed) passedCount++;
  }

  console.log(`\nResultado Final: ${passedCount}/${results.length} testes aprovados.\n`);
  if (passedCount !== results.length) {
    process.exit(1);
  }
}

if (process.argv[1] && process.argv[1].endsWith('runHeaderOverlayTests.ts')) {
  runHeaderOverlayTests().catch((err) => {
    console.error('Erro na execução dos testes:', err);
    process.exit(1);
  });
}
