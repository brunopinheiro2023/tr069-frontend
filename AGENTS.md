# AGENTS.md — TR-069 Frontend (Angular)

Instruções para qualquer agente de codificação IA (Claude Code, Devin, Cursor, etc.) que operar neste repositório.

## Regra crítica: nunca opere com trabalho não commitado por muito tempo

- **Nunca rodar `git stash`, `git checkout .`, `git reset --hard`, `git clean -fd`** sem confirmar com o usuário
- Múltiplos agentes no mesmo repo → **commitar a cada marco validado**, não acumular
- Antes de operação destrutiva de Git → `git status` + `git stash list` + reportar ao usuário
- Se arquivos mudando sem você ter feito → **parar e alertar o usuário** (outro agente pode estar ativo)

## Ambiente

| Item         | Valor                                                           |
| ------------ | --------------------------------------------------------------- |
| Diretório    | `/home/inova/projects/tr069`                                    |
| Remote       | `github.com/brunopero2023/tr069-frontend.git` (branch `master`) |
| VPS Dev      | `10.91.0.21` (Ubuntu 24.04, RDP, Devin Desktop)                 |
| VPS Produção | `10.90.0.77` — frontend servido via docker-compose do backend   |
| Build        | `npx ng build --configuration=development` (~45s)               |
| Testes       | `npx ng test --include="**/<component>.spec.ts" --watch=false`  |
| Dev server   | `npx ng serve --host 0.0.0.0 --port 4200 --disable-host-check`  |
| Angular      | v17.3.x (standalone components, signals não usados)             |

## Padrões de código

- **Edição:** Grep → Read(offset,limit) → Edit. Nunca Write em arquivo existente sem ler primeiro.
- **Falha:** Após 2 edições consecutivas falhas no mesmo arquivo → parar e reportar.
- **Tools:** Independentes sempre em parallel (1 mensagem, múltiplos calls).
- **Resposta:** Tabela > prosa. Português BR. Não criar `.md` sem pedido explícito.
- **Commits:** Conventional Commits — `tipo(escopo): descrição` em português.
- **Co-author:** Sempre incluir `Co-Authored-By: Devin <158243242+devin-ai-integration[bot]@users.noreply.github.com>`.
- **Não fazer push** unless explicitly asked.

## Estrutura de diretórios (principal)

```
src/app/
├── core/models/index.ts                          # Interfaces TypeScript (ChannelEntry, WifiInsight, etc.)
├── features/dashboard/components/cpe-details/
│   └── components/cpe-diagnostics-tab-new/
│       └── components/neighbor-scan-card/        # Card de Análise Wi-Fi (vizinhos + saturação)
│           ├── neighbor-scan-card.component.ts
│           ├── neighbor-scan-card.component.html
│           ├── neighbor-scan-card.component.scss
│           └── neighbor-scan-card.component.spec.ts
```

## Componente: neighbor-scan-card

### Visão geral

Card de Análise Wi-Fi que exibe:

1. **Resumo da varredura** — data/hora, origem (scheduler/manual/api), total de redes vizinhas
2. **Gráficos de saturação 2.4GHz e 5GHz** — barras verticais com gradiente 3D por canal
3. **Qualidade dos rádios** — RSSI, SNR, taxa de erro, clientes conectados
4. **Lista de redes vizinhas** — tabela com SSID, BSSID, canal, RSSI, segurança
5. **Insights e recomendações** — sugestões de canal com botão "Aplicar"

### Gráficos de saturação — arquitetura visual

#### Estrutura HTML (2.4GHz e 5GHz idênticos)

```
.saturation-band (flex column, stretch)
  ├── .band-header (h5 + .band-summary: Redes/Pior/Melhor)
  ├── .band-note (dica sobre canais não-sobrepostos)
  ├── .band-legend (dots: Baixa/Média/Alta/Não-sobreposto/Atual/Sugerido★)
  └── .channel-chart (flex: 1, preenche card)
      ├── .chart-y-axis (escala 0-5, 4 labels)
      └── .chart-plot
          ├── .grid-lines (3 linhas: high/medium/low)
          └── .chart-bars (flex row, align-items: flex-end)
              └── .channel-col (1 por canal)
                  ├── .col-score (número colorido no topo)
                  ├── .col-bar-track (poço da barra, min-height 140px)
                  │   └── .col-bar-fill (gradiente 3D, cresce de baixo→cima)
                  │       ├── ::before (glass effect, reflexo 40% topo)
                  │       └── .col-bar-label (Baixa/Média/Alta/Livre)
                  ├── .col-channel (número do canal, bold)
                  └── .col-count-badge (N redes, pill ambar se >0)
```

#### Funções TypeScript principais

| Função                              | Descrição                                                                     |
| ----------------------------------- | ----------------------------------------------------------------------------- |
| `getCongestionLevel(score)`         | Classifica score: empty(0) / low(≤1) / medium(≤3) / high(>3)                  |
| `getCongestionLabel(score)`         | Rótulo textual: "Livre" / "Baixa" / "Média" / "Alta"                          |
| `getCongestionColor(level)`         | Cor sólida hex por nível (para score no topo)                                 |
| `getCongestionGradient(level)`      | Gradiente CSS 3 paradas 165deg (para fill da barra)                           |
| `getCongestionWidth(score, max=5)`  | Altura % com escala **raiz cúbica** + piso 12%                                |
| `shouldShowBarLabel(channel)`       | Sempre true se há dados — mostra "Livre" em canais sem interferência          |
| `isNonOverlappingChannel(ch, band)` | true para CH 1/6/11 (2.4g) e 36/40/44/48/149/153/157/161/165 (5g)             |
| `isSuggestedChannel(ch, band)`      | true se canal = suggestion.bestChannel                                        |
| `bandSummary2g` / `bandSummary5g`   | { totalNeighbors, worstChannel, bestChannel }                                 |
| `displayChannels5g`                 | Filtra canais 5g vazios (sem vizinhos, sem score, não-sobrepostos, não-atual) |

#### Escala não-linear (raiz cúbica)

`getCongestionWidth` usa `Math.cbrt(score/max) * 100` em vez de linear:

| Score | Linear (antigo) | cbrt (atual) |
| ----- | --------------- | ------------ |
| 0     | 0%              | 0%           |
| 0.5   | 10%             | **50%**      |
| 1     | 20%             | **58%**      |
| 2     | 40%             | **74%**      |
| 3     | 60%             | **84%**      |
| 5     | 100%            | **100%**     |

Piso mínimo de 12% quando `score > 0` — garante que canais com interferência mínima tenham gradiente visível.

#### Gradientes 3D por nível

| Nível | Gradiente (topo → meio → base)                  |
| ----- | ----------------------------------------------- |
| Livre | `#f8fafc → #e2e8f0 → #cbd5e1` (cinza neutro)    |
| Baixa | `#86efac → #22c55e → #15803d` (verde esmeralda) |
| Média | `#fcd34d → #f59e0b → #b45309` (âmbar dourado)   |
| Alta  | `#fca5a5 → #ef4444 → #b91c1c` (vermelho coral)  |

Ângulo 165deg (diagonal sutil) + `::before` glass effect (reflexo branco 40% topo) + box-shadow tripla (glow externo + highlight interno + sombra base).

#### Destaques visuais por tipo de canal

| Tipo             | Borde do track        | Background do track          | Marcador        |
| ---------------- | --------------------- | ---------------------------- | --------------- |
| Não-sobreposto   | Verde `#22c55e`       | —                            | —               |
| Atual            | Indigo `#6366f1`      | Gradient indigo + inset glow | `●` após número |
| Sugerido         | Verde `#16a34a` (4px) | Gradient verde + inset glow  | `★` após número |
| Atual + Sugerido | Indigo (prevalece)    | —                            | `●★`            |

#### Alturas e responsividade

| Elemento              | Desktop          | Mobile           |
| --------------------- | ---------------- | ---------------- |
| Chart (eixo + plot)   | min-height 300px | min-height 250px |
| Track (poço da barra) | min-height 140px | min-height 120px |
| Fill (gradiente)      | min-height 28px  | —                |
| Coluna (largura)      | 60-90px          | 44-60px          |
| Score (font)          | 0.8rem           | 0.68rem          |
| Canal (font)          | 0.9rem           | 0.75rem          |

#### Igualação de altura dos cards

- `.saturation-bands`: `align-items: stretch` (grid items mesma altura)
- `.saturation-band`: `display: flex; flex-direction: column`
- `.channel-chart`: `flex: 1` (preenche espaço restante)
- `.chart-bars`: `height: 100%` + `min-height: 300px`

### Testes

- 96 testes no `neighbor-scan-card.component.spec.ts`
- Cobertura: getters, funções helper, rendering condicional, EventEmitter
- Rodar: `npx ng test --include="**/neighbor-scan-card.component.spec.ts" --watch=false`

## Deploy frontend

```bash
# 1. Push do frontend
cd /home/inova/projects/tr069 && git push origin master

# 2. Na VPS produção — pull + rebuild
ssh vps "cd /opt/tr069/frontend && git pull origin master"
ssh vps "cd /opt/tr069/backend && DOCKER_CONFIG=/tmp/docker-config ~/bin/docker-compose up -d --build frontend"
```

O `docker-compose.yml` do backend define o serviço `frontend` com `context: ../frontend`.

## Histórico de alterações recentes

### Redesenho UIX dos gráficos de saturação (2026-07-16)

**Commits (9):**

| Commit    | Descrição                                                                    |
| --------- | ---------------------------------------------------------------------------- |
| `8fad8cd` | Redesenho inicial: horizontal → vertical (colunas)                           |
| `e345915` | Gráficos mais informativos: eixo Y, grid lines, resumo banda, badge contagem |
| `a802f6c` | Gradientes 3D: 2 paradas vertical com box-shadow                             |
| `c281f2d` | Altura das colunas: 240px → 300px (desktop), 200px → 250px (mobile)          |
| `6a045d7` | Gradientes modernos: 3 paradas 165deg + glass effect + border-radius 8px     |
| `c7e00d0` | Escala não-linear cbrt + piso 12% + min-height 18px                          |
| `4be9585` | Threshold label: 35% → 15% + min-height 28px                                 |
| `d5b4fc1` | Label "Livre" em canais 5GHz sem interferência (shouldShowBarLabel)          |
| `93d3045` | Igualar altura dos cards 2.4GHz e 5GHz (flex stretch)                        |

**Resultado final:**

- Barras verticais com gradiente 3D moderno (3 paradas, diagonal 165deg, glass effect)
- Eixo Y com escala 0-5 e linhas de referência horizontais
- Labels "Baixa/Média/Alta/Livre" dentro de cada barra
- Resumo da banda no header (total redes, pior canal, melhor canal)
- Badge de contagem de redes por canal
- Destaques visuais para canal atual (● indigo) e sugerido (★ verde)
- Cards 2.4GHz e 5GHz com mesma altura
- Responsividade mobile com colunas mais estreitas e fontes menores
- 96/96 testes passing

### Auditoria Wi-Fi Backend (2026-07-15)

Ver `AGENTS.md` do backend (`/home/inova/projects/tr069-inova/AGENTS.md`) para detalhes da auditoria e correções.

### Recálculo de insights ao abrir aba + loading state pós-otimização (2026-07-16)

**Commit:** `12e8a33`

**Problema:** A aba Análise Wi-Fi não recalcular os insights quando o canal ou largura de banda eram alterados via SPV. O MongoDB era atualizado e `cpe_updated` era emitido, mas o componente filho não escutava esse evento — continuava exibindo insights do cache Redis (90s) com valores antigos. Além disso, o botão "Aplicar" desligava o loading imediatamente após POST 200, sem aguardar a CPE confirmar.

**Alterações (5 arquivos):**

| Arquivo                                | Alteração                                                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cpe-wifi-analysis-tab.component.ts`   | `ngOnInit`: `loadAllData(true)` (bypassa cache Redis). Listener `cpe_updated` com guard `!== undefined` detecta mudança em `wifi2g/wifi5g.channel` ou `.bandwidth` → `loadAllData(true)`. `applyWaitingConfirmation`: estado amber intermediário. `handleWifiOptimizationResult`: desliga loading + recarrega. Failsafe 65s. `neighbor_scan_completed`/`auto_wifi_optimize_applied` agora usam `forceRefresh=true`. |
| `cpe.service.ts`                       | `getWifiHosts`: adicionado parâmetro `forceRefresh` (bypassa cache frontend Map + sessionStorage).                                                                                                                                                                                                                                                                                                                  |
| `websocket.service.ts`                 | `onWifiOptimizationResult()`: listener do evento `wifi_optimization_result` emitido pelo backend 30s pós-enqueue do SPV.                                                                                                                                                                                                                                                                                            |
| `cpe-wifi-analysis-tab.component.html` | Indicador visual amber durante `applyWaitingConfirmation` (spinner + mensagem "Aguardando confirmação da CPE...").                                                                                                                                                                                                                                                                                                  |
| `cpe-wifi-analysis-tab.component.scss` | Classe `.apply-waiting` (amber, mesmo padrão das `.apply-success`/`.apply-error`).                                                                                                                                                                                                                                                                                                                                  |

**Guard crítico `!== undefined`:** o evento `cpe_updated` é emitido por múltiplas origens com payloads parciais. O SPV handler envia `wifi2g` completo (com `channel`), mas o GPV handler envia só `wifi2g.bandwidth` (sem `channel`). Sem o guard, campos ausentes (`undefined`) no payload disparariam reloads falsos em cada Inform/GPV.

**Validação E2E (CPE 54504C47DDECCAA0):** Ver `AGENTS.md` do backend, TODO-17.

### UI de Quarentena — card sempre visível + bloqueio de acesso + liberação na linha (2026-07-18)

**Problema:** O card "Em Quarentena" só aparecia quando havia CPEs quarentenadas (`*ngIf="globalQuarantinedCount > 0"`), não dando visibilidade de frota saudável. CPEs quarentenadas podiam ser acessadas normalmente no CPE Detalhes (via clique na linha ou URL direta), expondo tabs de coleta/config/diagnóstico que o backend já bloqueia via `taskQueueService`. A linha da tabela mostrava os 6 botões normais mesmo para CPEs quarentenadas, sem botão de liberação nem explicação do motivo.

**Solução (defesa em profundidade — 3 camadas):**

1. **Card sempre visível** — mostra 0 quando a frota está saudável, com classe `.inactive-card` (opacidade 0.55, pointer-events none). Clique só ativa filtro quando count>0.
2. **Bloqueio na linha** — `goToDetails` intercepta CPE quarentenada e abre **Modal de Quarentena** em vez de navegar. Modal exibe motivo, `detectedBy`, `since`, `bootLoopCount` e `details` completo do backend (motivo, ações bloqueadas, liberação automática, ações recomendadas e pós-solução). Botão "Liberar Quarentena" visível só para admin/supervisor.
3. **Bloqueio no CPE Detalhes** — acesso direto via URL `/dashboard/cpe/:serial` mostra banner de quarentena (padrão copiado do `.offline-banner`, cor warning) e esconde `summary-grid` + `tabs-nav` + `tab-content` via `*ngIf="!cpe.quarantine?.active"`. Botão liberar reusa `releaseCpe()` já existente.

**Alterações (5 arquivos):**

| Arquivo                      | Alteração                                                                                                                                                                                                                                                                                                                             |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dashboard.component.html`   | Card sem `*ngIf`, com `[class.inactive-card]` e `[style.pointer-events]`. `actions-cell`: 5 botões normais em `<ng-container *ngIf="!cpe.quarantine?.active">`, bloco quarentena com ícone `info` (tooltip=`details`) + botão Liberar. Delete (admin) fora do `*ngIf`. Novo modal de quarentena (padrão modal-overlay/modal-content). |
| `dashboard.component.ts`     | `goToDetails` intercepta quarentenada → `openQuarantineModal`. Novos: `canManageQuarantine()`, `openQuarantineModal()`, `closeQuarantineModal()`, `confirmReleaseFromRow()`, `releaseQuarantine()` (público, reuso modal+linha). Estado: `isQuarantineModalOpen`, `selectedQuarantinedCpe`, `releasingCpe`.                           |
| `dashboard.component.scss`   | `.inactive-card`, `.quarantine-info-btn`, `.action-btn.release-btn`, `.quarantine-modal`, `.quarantine-reason-row/badge/meta`, `.quarantine-bootloop-count`, `.quarantine-details` (pre-wrap), `.filter-btn.release-btn`, `.permission-notice`.                                                                                       |
| `cpe-details.component.html` | Banner `.quarantine-banner` após `.offline-banner`. `summary-grid` + tabs envolvidos em `<ng-container *ngIf="!cpe.quarantine?.active">`.                                                                                                                                                                                             |
| `cpe-details.component.scss` | `.quarantine-banner` (copia `.offline-banner` com cor warning), `.quarantine-details` (pre-wrap), `.quarantine-actions`, `.permission-notice`.                                                                                                                                                                                        |

**Reuso:** `cpeService.releaseCpe()` já existia (DELETE `/api/cpe/:serial/quarantine`). WebSocket `cpe_quarantine_released` já tratado no dashboard. `canManageQuarantine()` copiado do cpe-details. Modal copia padrão do bulk-reboot. Banner copia padrão do offline-banner. `CpeQuarantine` já existia em `core/models/index.ts`.

**RBAC:** backend exige admin/supervisor no DELETE `/quarantine`. Frontend espelha com `canManageQuarantine()` (`role === 'admin' \|\| 'supervisor'`). Técnico vê modal/banner informativo mas não o botão liberar — vê `.permission-notice`.

**Delete admin mantido:** CPE quarentenada em boot loop persistente pode ser excluída por admin mesmo em quarentena — botão delete permanece visível para gestão administrativa de equipamento irrecuperável.

**Build:** `ng build --configuration=development` verde, 0 erros, 45.8s.
