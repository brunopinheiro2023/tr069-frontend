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
    const escapeRegex = (str: string): string => {
      if (typeof str !== 'string') return '';
      return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    };

    // Compila a RegExp uma única vez fora dos laços (loops)
    let searchRegex: RegExp | null = null;
    const searchString = String(filters.search || '').trim();
    if (searchString) {
      searchRegex = new RegExp(escapeRegex(searchString), 'i');
    }

    // Chunking: processa em partes de 1000 para não travar o worker
    const CHUNK_SIZE = 1000;
    const filteredCpes = [];

    for (let i = 0; i < cpes.length; i += CHUNK_SIZE) {
      const chunk = cpes.slice(i, i + CHUNK_SIZE);
      const chunkFiltered = chunk.filter((cpe: any) => {
        // 1. Filtros mais baratos primeiro (comparações primitivas O(1))
        if (filters.isOnline !== undefined && cpe.isOnline !== filters.isOnline) {
          return false;
        }
        if (filters.manufacturer && cpe.manufacturer !== filters.manufacturer) {
          return false;
        }
        if (filters.productClass && cpe.productClass !== filters.productClass) {
          return false;
        }
        if (filters.softwareVersion && cpe.softwareVersion !== filters.softwareVersion) {
          return false;
        }
        if (filters.isCriticalGpon && (cpe._rx === undefined || cpe._rx >= -27)) {
          return false;
        }

        // 2. Validação de Busca Textual (Regex) com proteção contra valores null/undefined
        if (searchRegex) {
          const matches =
            (cpe.serialNumber && searchRegex.test(String(cpe.serialNumber))) ||
            (cpe.wanIp && searchRegex.test(String(cpe.wanIp))) ||
            (cpe.productClass && searchRegex.test(String(cpe.productClass))) ||
            (cpe._pppoe && searchRegex.test(String(cpe._pppoe))) ||
            (cpe.manufacturer && searchRegex.test(String(cpe.manufacturer)));
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
    postMessage({ error: 'PROCESSING_ERROR', message: (error as ErrorEvent)?.message || 'Erro desconhecido no worker' });
  }
});

// Error handler global para capturar erros não tratados
addEventListener('error', (error) => {
  postMessage({ error: 'WORKER_ERROR', message: (error as ErrorEvent)?.message || 'Erro fatal no worker' });
});
