/// <reference lib="webworker" />

/**
 * Web Worker dedicado para filtrar a lista de CPEs em segundo plano,
 * evitando que a thread principal da UI congele com listas grandes.
 * Timeout: 20s para evitar travamento.
 * Chunking: processa listas grandes em partes.
 */
const WORKER_TIMEOUT_MS = 20000; // 20 segundos

addEventListener('message', ({ data }) => {
  const { cpes, filters } = data;

  if (!cpes || !filters) {
    postMessage([]);
    return;
  }

  // Timeout de segurança
  const timeoutId = setTimeout(() => {
    postMessage({ error: 'TIMEOUT', message: 'Worker timeout após 20s - filtro muito complexo ou lista muito grande' });
  }, WORKER_TIMEOUT_MS);

  try {
    // Função auxiliar para escapar caracteres especiais de Regex (Previne ReDoS)
    const escapeRegex = (string) => string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // Chunking: processa em partes de 1000 para não travar o worker
    const CHUNK_SIZE = 1000;
    const filteredCpes = [];

    for (let i = 0; i < cpes.length; i += CHUNK_SIZE) {
      const chunk = cpes.slice(i, i + CHUNK_SIZE);
      const chunkFiltered = chunk.filter(cpe => {
        // Aplica filtro de status
        if (filters.isOnline !== undefined && cpe.isOnline !== filters.isOnline) {
          return false;
        }
        // Aplica filtro de fabricante
        if (filters.manufacturer && cpe.manufacturer !== filters.manufacturer) {
          return false;
        }
        // Aplica filtro de modelo
        if (filters.productClass && cpe.productClass !== filters.productClass) {
          return false;
        }
        // Aplica filtro de firmware
        if (filters.softwareVersion && cpe.softwareVersion !== filters.softwareVersion) {
          return false;
        }
        // Aplica filtro de GPON Crítico
        if (filters.isCriticalGpon && (cpe._rx === undefined || cpe._rx >= -27)) {
          return false;
        }
        // Aplica filtro de busca por texto
        if (filters.search) {
          const searchRegex = new RegExp(escapeRegex(filters.search), 'i');
          const matches =
            searchRegex.test(cpe.serialNumber) ||
            (cpe.wanIp && searchRegex.test(cpe.wanIp)) ||
            (cpe.productClass && searchRegex.test(cpe.productClass)) ||
            (cpe._pppoe && searchRegex.test(cpe._pppoe)) ||
            (cpe.manufacturer && searchRegex.test(cpe.manufacturer));
          if (!matches) return false;
        }
        return true;
      });
      filteredCpes.push(...chunkFiltered);
    }

    clearTimeout(timeoutId);
    postMessage(filteredCpes);
  } catch (error) {
    clearTimeout(timeoutId);
    postMessage({ error: 'PROCESSING_ERROR', message: error?.message || 'Erro desconhecido no worker' });
  }
});

// Error handler global para capturar erros não tratados
addEventListener('error', (error) => {
  postMessage({ error: 'WORKER_ERROR', message: error?.message || 'Erro fatal no worker' });
});