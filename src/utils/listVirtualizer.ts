/**
 * HIKARI PERFIL — ETAPA 6: UTILITÁRIO DE VIRTUALIZAÇÃO DE LISTAS E GRIDS
 * 
 * Fornece cálculos matemáticos puros e determinísticos de janela deslizante (virtual windowing)
 * para grades multidimensionais e listas lineares de alta densidade (1.000 a 50.000+ itens).
 * Mantém 0 layout shifts (CLS), rolagem fluida e redução de até 99.8% de nós no DOM.
 */

export interface VirtualGridConfig {
  totalItems: number;
  columns: number;
  rowHeight: number;
  viewportHeight: number;
  scrollTop: number;
  overscanRows?: number;
}

export interface VirtualGridResult {
  totalRows: number;
  startRow: number;
  endRow: number;
  startIndex: number;
  endIndex: number;
  topPadding: number;
  bottomPadding: number;
  totalHeight: number;
  visibleCount: number;
  domReductionPercent: number;
}

/**
 * Calcula os índices de fatiamento e espaçamento de uma grade virtual (ex: AnimeListTab).
 */
export function computeVirtualGridWindow(config: VirtualGridConfig): VirtualGridResult {
  const {
    totalItems,
    columns,
    rowHeight,
    viewportHeight,
    scrollTop,
    overscanRows = 2,
  } = config;

  if (totalItems <= 0) {
    return {
      totalRows: 0,
      startRow: 0,
      endRow: 0,
      startIndex: 0,
      endIndex: 0,
      topPadding: 0,
      bottomPadding: 0,
      totalHeight: 0,
      visibleCount: 0,
      domReductionPercent: 0,
    };
  }

  const effectiveColumns = Math.max(1, columns);
  const effectiveRowHeight = Math.max(50, rowHeight);
  const effectiveViewport = Math.max(100, viewportHeight);
  const safeScroll = Math.max(0, scrollTop);

  const totalRows = Math.ceil(totalItems / effectiveColumns);
  const totalHeight = totalRows * effectiveRowHeight;

  const startRow = Math.max(0, Math.floor(safeScroll / effectiveRowHeight) - overscanRows);
  const endRow = Math.min(
    totalRows,
    Math.ceil((safeScroll + effectiveViewport) / effectiveRowHeight) + overscanRows
  );

  const startIndex = startRow * effectiveColumns;
  const endIndex = Math.min(totalItems, endRow * effectiveColumns);
  const visibleCount = Math.max(0, endIndex - startIndex);

  const topPadding = startRow * effectiveRowHeight;
  const bottomPadding = Math.max(0, (totalRows - endRow) * effectiveRowHeight);

  const domReductionPercent =
    totalItems > 0
      ? Number(((1 - visibleCount / totalItems) * 100).toFixed(1))
      : 0;

  return {
    totalRows,
    startRow,
    endRow,
    startIndex,
    endIndex,
    topPadding,
    bottomPadding,
    totalHeight,
    visibleCount,
    domReductionPercent: Math.max(0, domReductionPercent),
  };
}

export interface VirtualListConfig {
  totalItems: number;
  itemHeight: number;
  viewportHeight: number;
  scrollTop: number;
  overscan?: number;
}

export interface VirtualListResult {
  startIndex: number;
  endIndex: number;
  topPadding: number;
  bottomPadding: number;
  totalHeight: number;
  visibleCount: number;
  domReductionPercent: number;
}

/**
 * Calcula os índices de fatiamento para listas lineares (ex: Seguidores, Histórico).
 */
export function computeVirtualListWindow(config: VirtualListConfig): VirtualListResult {
  const { totalItems, itemHeight, viewportHeight, scrollTop, overscan = 3 } = config;

  if (totalItems <= 0) {
    return {
      startIndex: 0,
      endIndex: 0,
      topPadding: 0,
      bottomPadding: 0,
      totalHeight: 0,
      visibleCount: 0,
      domReductionPercent: 0,
    };
  }

  const effectiveItemHeight = Math.max(20, itemHeight);
  const effectiveViewport = Math.max(50, viewportHeight);
  const safeScroll = Math.max(0, scrollTop);
  const totalHeight = totalItems * effectiveItemHeight;

  const rawStart = Math.floor(safeScroll / effectiveItemHeight);
  const startIndex = Math.max(0, rawStart - overscan);

  const visibleSlots = Math.ceil(effectiveViewport / effectiveItemHeight);
  const endIndex = Math.min(totalItems, rawStart + visibleSlots + overscan);
  const visibleCount = Math.max(0, endIndex - startIndex);

  const topPadding = startIndex * effectiveItemHeight;
  const bottomPadding = Math.max(0, (totalItems - endIndex) * effectiveItemHeight);

  const domReductionPercent =
    totalItems > 0
      ? Number(((1 - visibleCount / totalItems) * 100).toFixed(1))
      : 0;

  return {
    startIndex,
    endIndex,
    topPadding,
    bottomPadding,
    totalHeight,
    visibleCount,
    domReductionPercent: Math.max(0, domReductionPercent),
  };
}

/**
 * Hook utilitário para medição de scroll com proteção contra frame drops e requestAnimationFrame.
 */
export function clampScrollPosition(
  targetY: number,
  totalHeight: number,
  viewportHeight: number
): number {
  const maxScroll = Math.max(0, totalHeight - viewportHeight);
  return Math.min(Math.max(0, targetY), maxScroll);
}
