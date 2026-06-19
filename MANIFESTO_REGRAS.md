# 📋 Manifesto de Regras - TR-069 ACS

**Versão:** 1.0  
**Data:** 13/06/2026  
**Escopo:** Backend Node.js + Frontend Angular  
**Objetivo:** Padronizar nomenclatura, estrutura de diretórios e convenções de código

---

## 🎯 Princípios Fundamentais

1. **Consistência sobre convenção pessoal** - Siga os padrões existentes
2. **Legibilidade sobre brevidade** - Nomes descritivos são preferíveis
3. **Separação de responsabilidades** - Cada módulo tem um propósito único
4. **Escalabilidade em mente** - Estrutura suporta crescimento para 10.000+ CPEs
5. **Segurança por padrão** - Validação e sanitização são obrigatórias

---

## 📁 Estrutura de Diretórios - Backend

```
tr069-inova/
├── src/
│   ├── config/              # Configurações estáticas e constantes
│   ├── controllers/         # Manipuladores de requisições HTTP/CWMP
│   ├── cron/               # Jobs agendados (node-cron)
│   ├── middlewares/        # Middleware Express/Socket.IO
│   ├── models/             # Schemas Mongoose (MongoDB)
│   │   └── diagnostics/    # Modelos especializados de diagnóstico
│   ├── routes/             # Definição de rotas Express
│   ├── services/           # Lógica de negócio
│   │   └── cwmp/           # Serviços especializados TR-069
│   ├── tasks/              # Filas e processamento assíncrono
│   ├── utils/              # Funções utilitárias puras
│   ├── validators/         # Schemas Zod de validação
│   ├── websocket/          # Handlers Socket.IO
│   │   └── handlers/       # Handlers individuais por evento
│   └── workers/            # Background workers (RabbitMQ)
├── tests/                  # Testes unitários, integração, E2E
├── .env                    # Variáveis de ambiente (NÃO commitar)
├── .env.example            # Template de variáveis de ambiente
├── package.json            # Dependências Node.js
├── server.js               # Entry point do servidor
└── MANIFESTO_REGRAS.md     # Este arquivo
```

---

## 📁 Estrutura de Diretórios - Frontend

```
tr069/
├── src/
│   ├── app/
│   │   ├── core/           # Módulos compartilhados globais
│   │   │   ├── components/ # Componentes UI reutilizáveis
│   │   │   │   ├── button/
│   │   │   │   ├── header/
│   │   │   │   ├── sidebar/
│   │   │   │   ├── toast/
│   │   │   │   └── skeleton/
│   │   │   ├── guards/     # Route guards (autenticação, permissões)
│   │   │   ├── interceptors/# Interceptors HTTP (JWT, error handling)
│   │   │   ├── models/     # Interfaces TypeScript
│   │   │   ├── pipes/      # Pipes Angular (formatação, transformação)
│   │   │   └── services/   # Serviços globais (auth, http, toast)
│   │   └── features/       # Módulos por funcionalidade
│   │       ├── login/      # Feature de login
│   │       ├── dashboard/  # Dashboard principal
│   │       │   └── components/
│   │       └── cpe-list/   # Listagem de CPEs
│   ├── assets/             # Assets estáticos (imagens, fontes)
│   ├── environments/       # Configurações de ambiente
│   ├── styles/             # Estilos globais
│   ├── index.html          # HTML entry point
│   ├── main.ts             # Bootstrap Angular
│   └── styles.scss         # Estilos globais SCSS
├── angular.json            # Configuração Angular CLI
├── package.json            # Dependências Node.js
├── tsconfig.json           # Configuração TypeScript
└── MANIFESTO_REGRAS.md     # Este arquivo (simbólico)
```

**Nota:** A documentação técnica de parâmetros CWMP (dicionários de fabricantes) está localizada no backend em `src/Parametros_Mapeados_<FABRICANTE>.md`. Consulte o manifesto do backend para detalhes.

---

## 🏷️ Convenções de Nomenclatura - Backend

### Arquivos

| Tipo | Padrão | Exemplos |
|------|--------|----------|
| Controllers | `camelCase` + `.js` | `cwmpController.js`, `authController.js`, `telemetryController.js` |
| Services | `camelCase` + `.js` | `redisService.js`, `crService.js`, `cpeDiscoveryService.js` |
| Models | `PascalCase` + `.js` | `Cpe.js`, `FirmwareTemplate.js`, `CpeDiscoveryStatus.js` |
| Middlewares | `camelCase` + `.js` | `jwtMiddleware.js`, `rbacMiddleware.js`, `cpeOperationBlocker.js` |
| Routes | `camelCase` + `.js` | `authRoutes.js`, `cpeRoutes.js` |
| Utils | `camelCase` + `.js` | `logger.js`, `redisUtils.js`, `sessionCrypto.js` |
| Validators | `camelCase` + `.js` | `schemas.js` |
| Cron Jobs | `camelCase` + `.js` | `templateSyncCron.js` |
| Workers | `camelCase` + `.js` | `telemetryWorker.js` |
| WebSocket Handlers | `camelCase` + `.js` | `subscribeCpe.js`, `wifiDiagnostics.js` |

### Variáveis JavaScript

| Tipo | Padrão | Exemplos |
|------|--------|----------|
| Variáveis locais | `camelCase` | `serialNumber`, `discoveryStatus`, `isFullyMapped` |
| Constantes (module) | `UPPER_SNAKE_CASE` | `ACTION_LOCK_KEY_PREFIX`, `FAULT_TRACK_KEY` |
| Constantes (local) | `camelCase` | `redisUrl`, `templateId` |
| Funções | `camelCase` | `needsDiscovery()`, `startDiscovery()`, `processDiscoveryResponse()` |
| Classes | `PascalCase` | `DiagnosticsService`, `CircuitBreaker` |
| Mongoose Models | `PascalCase` | `Cpe`, `FirmwareTemplate`, `CpeDynamicTopology` |
| Collections/Maps | `camelCase` + `plural` | `diagnosticStreams`, `auditLogBuffer`, `cpePresences` |

### Chaves de Objeto

| Tipo | Padrão | Exemplos |
|------|--------|----------|
| Propriedades de objeto | `camelCase` | `serialNumber`, `discoveryStatus`, `totalPathsDiscovered` |
| Chaves Redis | `kebab-case` com prefixo | `cpe:driver:{serialNumber}`, `cpe:action:lock:{serialNumber}` |
| Eventos Socket.IO | `snake_case` | `subscribe_cpe`, `leave_cpe_room`, `apply_wifi_optimization` |
| Eventos de Log | `snake_case` | `discovery_started`, `get_parameter_names_response_received` |

### Nomes de Função

```javascript
// ✅ CORRETO - Verbos que descrevem ação
async function needsDiscovery(serialNumber) { }
async function startDiscovery(serialNumber, cpe) { }
async function processDiscoveryResponse(serialNumber, parameterNames, intent) { }
async function checkDiscoveryCompletion(serialNumber) { }
async function isFullyMapped(serialNumber) { }

// ❌ INCORRETO - Nomes ambíguos
async function check(sn) { }
async function process(data) { }
async function doSomething() { }
```

### Parâmetros de Função

```javascript
// ✅ CORRETO - Descritivos
function handleGetParameterNamesResponse(responseData, req, res, clientIp) { }
function validateCwmpOperation(serialNumber, operationType) { }

// ❌ INCORRETO - Genéricos
function handle(data, req, res, ip) { }
function validate(sn, type) { }
```

---

## 🏷️ Convenções de Nomenclatura - Frontend

### Arquivos

| Tipo | Padrão | Exemplos |
|------|--------|----------|
| Componentes | `kebab-case` + `.component.ts` | `button.component.ts`, `header.component.ts`, `sidebar.component.ts` |
| Componentes (template) | `kebab-case` + `.component.html` | `button.component.html` |
| Componentes (styles) | `kebab-case` + `.component.scss` | `button.component.scss` |
| Services | `camelCase` + `.service.ts` | `auth.service.ts`, `cpe.service.ts`, `toast.service.ts` |
| Guards | `camelCase` + `.guard.ts` | `auth.guard.ts`, `role.guard.ts` |
| Interceptors | `camelCase` + `.interceptor.ts` | `jwt.interceptor.ts`, `error.interceptor.ts` |
| Pipes | `camelCase` + `.pipe.ts` | `date.pipe.ts`, `status.pipe.ts` |
| Models/Interfaces | `PascalCase` + `.ts` | `Cpe.ts`, `User.ts`, `TelemetryData.ts` |
| Modules | `kebab-case` + `.module.ts` | `login.module.ts`, `dashboard.module.ts` |

### Variáveis TypeScript

| Tipo | Padrão | Exemplos |
|------|--------|----------|
| Variáveis locais | `camelCase` | `serialNumber`, `discoveryStatus`, `isLoading` |
| Constantes (module) | `UPPER_SNAKE_CASE` | `API_BASE_URL`, `MAX_RETRY_ATTEMPTS` |
| Propriedades de classe | `camelCase` | `serialNumber`, `discoveryStatus` |
| Propriedades privadas | `camelCase` com `_` prefixo | `_serialNumber`, `_discoveryStatus` |
| Observables | `camelCase` com `$` sufixo | `cpeList$`, `telemetryData$` |
| Interfaces | `PascalCase` | `Cpe`, `User`, `TelemetryData` |
| Types | `PascalCase` | `DiscoveryStatus`, `OperationType` |

### Nomes de Componente

```typescript
// ✅ CORRETO - Descritivos e com sufixo
@Component({
  selector: 'app-button',
  templateUrl: './button.component.html',
  styleUrls: ['./button.component.scss']
})
export class ButtonComponent { }

@Component({
  selector: 'app-sidebar',
  templateUrl: './sidebar.component.html',
  styleUrls: ['./sidebar.component.scss']
})
export class SidebarComponent { }

// ❌ INCORRETO - Genéricos ou sem sufixo
@Component({
  selector: 'app-comp',
  templateUrl: './comp.component.html'
})
export class Comp { }
```

### Selectores de Componente

```typescript
// ✅ CORRETO - Prefixo 'app-' + kebab-case
selector: 'app-button'
selector: 'app-sidebar'
selector: 'app-cpe-list'

// ❌ INCORRETO - Sem prefixo ou camelCase
selector: 'button'
selector: 'sidebar'
selector: 'appCpeList'
```

---

## 🗂️ Organização de Arquivos por Funcionalidade

### Backend - Feature-Based

```
src/services/cwmp/
├── diagnostics.service.js      # Serviço de diagnósticos TR-143
├── sessionCrypto.js            # Criptografia de sessão
└── opticalParser.js            # Parser de valores ópticos

src/models/diagnostics/
├── SpeedTestHistory.js
├── UDPEchoHistory.js
├── WiFiNeighborHistory.js
├── PingHistory.js
├── DNSLookupHistory.js
└── TraceRouteHistory.js

src/websocket/handlers/
├── index.js                    # Centralizador de handlers
├── subscribeCpe.js             # Handler de inscrição em CPE
├── leaveCpeRoom.js             # Handler de saída de sala
├── driverKeepalive.js          # Handler de heartbeat
├── unsubscribeCpe.js           # Handler de cancelamento
├── wifiDiagnostics.js          # Handler de diagnóstico Wi-Fi
└── wifiOptimization.js         # Handler de otimização Wi-Fi
```

### Frontend - Feature-Based

```
src/app/features/
├── login/
│   ├── login.component.ts
│   ├── login.component.html
│   ├── login.component.scss
│   └── login.module.ts
├── dashboard/
│   ├── components/
│   │   ├── telemetry-card/
│   │   └── status-indicator/
│   ├── dashboard.component.ts
│   ├── dashboard.component.html
│   ├── dashboard.component.scss
│   └── dashboard.module.ts
└── cpe-list/
    ├── components/
    │   ├── cpe-table/
    │   └── cpe-filter/
    ├── cpe-list.component.ts
    ├── cpe-list.component.html
    ├── cpe-list.component.scss
    └── cpe-list.module.ts
```

---

## 🔒 Regras de Segurança

### Backend

1. **Nunca exponha credenciais** - Use variáveis de ambiente
2. **Valide TODOS os inputs** - Use Zod schemas
3. **Sanitize parâmetros TR-069** - Use regex para prevenir NoSQL injection
4. **Use prepared statements** - Mongoose já protege contra SQL injection
5. **Rate limiting obrigatório** - Em todas as rotas públicas
6. **JWT com expiração curta** - 15 minutos access token
7. **Redação de dados sensíveis** - Logger centralizado com redação automática

### Frontend

1. **Nunca armazene tokens em localStorage** - Use httpOnly cookies
2. **Sanitize HTML** - Use DOMPurify antes de innerHTML
3. **Valide no cliente E servidor** - Validação client-side é UX, não segurança
4. **Use HTTPS obrigatório** - Em produção
5. **CORS restrito** - Apenas origens permitidas

---

## 📝 Regras de Documentação

### Comentários de Código

```javascript
// ✅ CORRETO - Descritivo e com propósito
/**
 * Verifica se a CPE precisa de descoberta de parâmetros
 * @param {string} serialNumber - Serial da CPE
 * @returns {Promise<boolean>} - true se precisa descobrir
 */
async function needsDiscovery(serialNumber) {
  // ...
}

// ❌ INCORRETO - Óbvio ou inútil
// Função que verifica se precisa descobrir
async function needsDiscovery(serialNumber) {
  // Retorna true se precisa
}
```

### JSDoc para Funções Públicas

```javascript
/**
 * Processa a resposta de GetParameterNames e classifica os paths
 * @param {string} serialNumber - Serial da CPE
 * @param {Array} parameterNames - Lista de nomes de parâmetros retornados
 * @param {string} intent - Intent da task (discovery-tr181 ou discovery-tr098)
 * @returns {Promise<void>}
 */
async function processDiscoveryResponse(serialNumber, parameterNames, intent) {
  // ...
}
```

### Comentários de Bloco

```javascript
// ── DESCRIÇÃO DO BLOCO ──────────────────────────────────────────
// Explicação do propósito deste bloco de código
// ─────────────────────────────────────────────────────────────────
```

---

## 🧪 Regras de Testes

### Nomenclatura de Arquivos de Teste

```
tests/
├── unit/
│   ├── services/
│   │   ├── redisService.test.js
│   │   └── cpeDiscoveryService.test.js
│   └── controllers/
│       └── authController.test.js
├── integration/
│   └── api/
│       └── cpeRoutes.test.js
└── e2e/
    └── websocket.e2e.test.js
```

### Nomenclatura de Testes

```javascript
// ✅ CORRETO - Descritivo
describe('CpeDiscoveryService', () => {
  test('deve retornar true quando CPE não está mapeada', async () => {
    // ...
  });

  test('deve iniciar descoberta quando isFullyMapped é false', async () => {
    // ...
  });
});

// ❌ INCORRETO - Genérico
describe('Service', () => {
  test('test 1', async () => {
    // ...
  });
});
```

---

## 🚀 Regras de Git Commit

### Formato de Mensagem de Commit

```
<tipo>(<escopo>): <descrição>

[opcional: corpo]

[opcional: footer]
```

### Tipos de Commit

| Tipo | Descrição | Exemplo |
|------|-----------|---------|
| `feat` | Nova funcionalidade | `feat(cpe-discovery): adicionar serviço de descoberta de parâmetros` |
| `fix` | Correção de bug | `fix(logger): migrar loggers customizados para utils/logger.js` |
| `refactor` | Refatoração sem mudança de comportamento | `refactor(websocket): extrair handlers para módulos separados` |
| `docs` | Documentação | `docs(readme): atualizar instruções de instalação` |
| `style` | Formatação/estilo (sem lógica) | `style(cwmpController): ajustar indentação` |
| `test` | Adicionar testes | `test(redisService): adicionar testes unitários` |
| `chore` | Tarefas de manutenção | `chore(deps): atualizar dependências` |

### Exemplos de Commit

```
feat(cpe-discovery): adicionar serviço de descoberta de parâmetros

- Criar modelo CpeDiscoveryStatus para rastrear status
- Implementar cpeDiscoveryService com classificação de paths
- Adicionar middleware cpeOperationBlocker para segurança
- Atualizar cwmpBuilder para suportar GetParameterNames

Closes #123

fix(logger): migrar loggers customizados para utils/logger.js

- Migrar 19 arquivos de loggers inline para logger centralizado
- Remover definições duplicadas de logger
- Manter compatibilidade com estrutura de logs existente

refactor(websocket): extrair handlers para módulos separados

- Criar src/websocket/handlers/ com 6 handlers individuais
- Centralizar lógica em index.js com broadcastViewers helper
- Reduzir server.js de 900+ linhas para estrutura modular
```

---

## 📊 Regras de Performance

### Backend

1. **Use índices compostos** - Para queries frequentes com múltiplos campos
2. **Evite N+1 queries** - Use `populate()` do Mongoose ou agregação
3. **Cache Redis** - Para dados frequentemente acessados (15s TTL)
4. **Connection pooling** - MongoDB pool de 50 conexões
5. **Micro-batching** - Para operações em massa (audit logs, telemetria)
6. **Lazy loading** - Carregue dados apenas quando necessário

### Frontend

1. **Lazy loading de módulos** - Use `loadChildren` em rotas
2. **OnPush change detection** - Para componentes com dados estáticos
3. **Virtual scrolling** - Para listas longas (100+ itens)
4. **TrackBy em ngFor** - Para otimizar renderização
5. **Debounce em inputs** - Para evitar chamadas excessivas à API
6. **Compressão de assets** - Gzip/Brotli no servidor

---

## 🎨 Regras de Estilo de Código

### Backend (JavaScript)

1. **Use const por padrão** - Use let apenas quando reatribuição é necessária
2. **Arrow functions para callbacks** - Melhor legibilidade
3. **Template literals** - Para concatenação de strings
4. **Destructuring** - Para extrair propriedades de objetos
5. **Async/await** - Para código assíncrono (evite callbacks hell)
6. **Early returns** - Para reduzir aninhamento
7. **Sem magic numbers** - Use constantes nomeadas

### Frontend (TypeScript)

1. **Strict mode** - Sempre habilitado no tsconfig.json
2. **Tipagem explícita** - Evite `any` quando possível
3. **Interfaces para modelos** - Use `interface` para shapes de dados
4. **Types para unions** - Use `type` para tipos union/intersection
5. **Readonly onde aplicável** - Para propriedades imutáveis
6. **Private/Public** - Use modificadores de acesso

---

## 🔧 Regras de Configuração

### Variáveis de Ambiente

```bash
# ✅ CORRETO - Descritivas e agrupadas
# Database
MONGODB_URI=mongodb://localhost:27017/tr069
REDIS_URL=redis://localhost:6379
RABBITMQ_URL=amqp://guest:guest@localhost:5672

# Security
JWT_SECRET=your-secret-key-here
REDIS_PASSWORD=your-redis-password

# Server
PORT=3000
NODE_ENV=development

# ❌ INCORRETO - Genéricas ou sem agrupamento
DB=mongodb://localhost:27017/tr069
SECRET=your-secret
PORT=3000
```

### Configuração Angular

```json
{
  "projects": {
    "tr069": {
      "architect": {
        "build": {
          "configurations": {
            "production": {
              "fileReplacements": [
                {
                  "replace": "src/environments/environment.ts",
                  "with": "src/environments/environment.prod.ts"
                }
              ],
              "optimization": true,
              "buildOptimizer": true
            }
          }
        }
      }
    }
  }
}
```

---

## 📋 Checklist de Code Review

### Backend

- [ ] Logger usa `utils/logger.js` (não inline)
- [ ] Variáveis seguem convenção de nomenclatura
- [ ] Funções têm JSDoc descrevendo parâmetros e retorno
- [ ] Inputs são validados com Zod schemas
- [ ] Queries MongoDB têm índices apropriados
- [ ] Erros são tratados com try/catch
- [ ] Segredos não estão hardcoded
- [ ] Commits seguem formato de mensagem

### Frontend

- [ ] Componentes usam `OnPush` change detection
- [ ] Observáveis têm `$` sufixo
- [ ] Interfaces TypeScript para modelos
- [ ] Selectores têm prefixo `app-`
- [ ] Lazy loading para módulos de feature
- [ ] Validação client-side implementada
- [ ] Error handling em serviços HTTP
- [ ] No `any` types (exceto casos justificados)

---

## 🔄 Processo de Atualização

1. **Discussão** - Proposta de mudança em issue/PR
2. **Aprovação** - Consenso do time
3. **Atualização** - Modificar este manifesto
4. **Comunicação** - Anunciar mudanças em channel apropriado
5. **Implementação** - Aplicar mudanças em código existente
6. **Verificação** - Code review para garantir conformidade

---

## 📚 Referências

- [Node.js Best Practices](https://github.com/goldbergyoni/nodebestpractices)
- [Angular Style Guide](https://angular.io/guide/styleguide)
- [Airbnb JavaScript Style Guide](https://github.com/airbnb/javascript)
- [Conventional Commits](https://www.conventionalcommits.org/)
- [TR-069 Specification](https://www.broadband-forum.org/technical/download/TR-069-Amendment-6.pdf)

---

**Última atualização:** 13/06/2026  
**Mantenedor:** Equipe de Desenvolvimento TR-069 ACS
