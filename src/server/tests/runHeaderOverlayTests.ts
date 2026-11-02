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
