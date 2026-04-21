# AppTip — Documentação arquitetural

> **Última atualização:** 21/04/2026 (sessão de refatoração Pessoas + módulo Mise completo)
> **Versão:** v5.48+ (ver `APP_VERSION` em `src/App.js`)

## Visão geral

AppTip é uma plataforma SaaS para restaurantes. Começou focada em gestão de gorjetas e evoluiu para incluir:

- **Módulo AppTip (core):** gorjetas, escala, trilhas, reuniões, VT, comunicados, FAQ, fale com DP, cargos, equipe, VT, inbox, incidentes, feedbacks
- **Módulo AppMise (dentro do AppTip):** contagens de estoque, compras com ciclo de abastecimento completo (cálculo automático de reposição + WhatsApp + recebimento com diff), checklists operacionais, fichas técnicas (portado do projeto `fichastecnicas-c3829`)
- **Gestão de pessoas unificada:** cadastro único de Pessoa; permissões granulares via matriz sanfona; migração automática de `employees`+`managers` → `pessoas`

## Stack

- **Front:** React 18 + Create React App (`react-scripts`)
- **Estado:** useState + useEffect no `App()` (arquivo único `src/App.js`, ~22k linhas)
- **Persistência:** Firestore (projeto `gorjeta-app`, região `southamerica-east1`). Cada "coleção" na UI é um documento em `/appdata/{K.x}` com campo `value: [...]`. Cache local em `localStorage` para offline-resilience.
- **Auth:** custom (não usa Firebase Auth). Login via CPF + PIN validado contra registros no Firestore.
- **Deploy:** Vercel em `apptip.app`
- **Repositório:** `gustavorodrigues111/gorjeta-app`
- **Libs CDN (public/index.html):** jsPDF + autoTable + XLSX (usados por Fichas Técnicas e Insumos)

## Arquitetura de dados

### Chave-valor (K)

Todas as chaves do Firestore ficam centralizadas em `const K = {...}` (linha ~582). Cada chave vira um documento `/appdata/{K.x}` com `value: <array ou objeto>`.

**Coleções core AppTip:**
`owners`, `managers`, `restaurants`, `employees`, `roles`, `tips`, `splits`, `schedules`, `communications`, `commAcks`, `faq`, `dpMessages`, `workSchedules`, `notifications`, `noTipDays`, `trash`, `schedTemplates`, `schedDrafts`, `scheduleVersions`, `tipVersions`, `vtConfig`, `vtMonthly`, `vtPayments`, `incidents`, `feedbacks`, `devChecklists`, `scheduleAdjustments`, `scheduleStatus`, `schedulePrevista`, `employeeGoals`, `delays`, `tipApprovals`, `meetingPlans`, `meetingIdeas`, `meetingAgendas`, `meetingActions`, `meetingOccurrences`, `meetingPendencias`, `inbox`, `inboxFolders`.

**Coleções AppMise — Contagens & Compras:**
- `miseCategories` — `[{id, restaurantId, name, type:"contagem"|"pedido"|"ambos"}]`
- `miseStocks` — `[{id, restaurantId, name, location?}]`
- `miseAssignments` — `[{id, restaurantId, categoryId, stockId|null, userId}]` (stockId=null = pedido-direto)
- `miseItems` — `[{id, restaurantId, categoryId, name, unit, minStock?}]`
- `miseCycles` — `[{id, restaurantId, name, startDate, status:"open"|"closed", endDate?, closedAt?, closedBy?}]` (1 ciclo aberto por restaurante)
- `miseCounts` — `[{id, restaurantId, cycleId, itemId, stockId|null, userId, qty, countedAt}]`
- `miseSuppliers` — `[{id, restaurantId, name, whatsapp?, notes?}]`
- `miseProductSuppliers` — `[{id, restaurantId, productId, supplierId, conversionFactor, price?, preferred}]` (N:N com atributos)
- `miseSupplierOrders` — `[{id, restaurantId, cycleId, supplierId, status, items[], createdAt, approvedAt?, sentAt?, receivedAt?, receivedBy?, history:[]}]`

Status do Pedido (`MISE_ORDER_STATUS`): `draft` | `approved` | `sent` | `received_ok` | `received_with_divergence` | `awaiting_correction` | `rejected`. Os 3 finais são terminais → disparam encerramento automático do ciclo quando todos os pedidos do ciclo atingem terminal.

**Coleções AppMise — Checklists:**
- `miseChecklistTemplates` — `[{id, restaurantId, name, description?, items:[{id,text,order}], active}]`
- `miseChecklistRuns` — `[{id, restaurantId, templateId, userId, userName, date, items:[{itemId,done,doneAt?}], completedAt?}]`

**Coleções AppMise — Fichas Técnicas (portado de `fichastecnicas-c3829`):**
- `miseFtInsumos` — `[{id, restaurantId, name, unit, price, reutilizavel?}]`
- `miseFtEquipamentos` — `{[restaurantId]: [string]}`
- `miseFtDishes` — `[{id, restaurantId, name, description, louca, equipamentos, markup, target_cmv?, sub_fichas:[{id,name,rendimento,rendimento_qty,rendimento_unit,modo_preparo,subproduto?,ingredientes:[...]}], photos}]`

Sub-fichas aninhadas com subref (ingrediente pode referenciar outra sub-ficha do mesmo prato) e subproduto (nome que aparece noutras fichas como produzido). Cálculo de custo recursivo via `ftDishCost` + `ftSubfichaCost` com cache + detecção automática de subref por similaridade de nome.

**Coleções novas (refatoração Pessoas):**
- `pessoas` — `[{id, restaurantIds[], name, cpf, pin, mustChangePin, email?, whatsapp?, isTeam:{[rid]:bool}, teamData:{[rid]:{...}}, linkedEmployeeId?, linkedManagerId?, permissions:{[rid]:{operational:{},admin:{},special:{}}}}]`
- `pessoasMigratedAt` — ISO da migração

`permissions[rid]` tem 3 grupos:
- `operational`: `escalas`, `gorjetas`, `trilhas`, `reunioes`, `contagens`, `compras`, `checklists`, `fichasTecnicas`
- `admin`: `tips`, `schedule`, `employees`, `roles`, `vt`, `comunicados`, `faq`, `config`, `pessoas`
- `special`: `isDP`, `isLider` + `areas: [...]`

## Fluxos principais

### Login (refatorado)

`UnifiedLogin` agora tenta primeiro buscar em `pessoas`:

1. CPF + PIN → pessoa?
2. Se `mustChangePin` → tela dedicada de troca (PIN final ≠ 4 primeiros do CPF)
3. Monta opções: para cada `restaurantId` em `pessoa.restaurantIds`, oferece Empregado / Gestor Operacional / Gestor Adm conforme permissions em `permissions[rid]`
4. 1 opção → login direto. Múltiplas → seletor pós-login
5. Cada opção chama o callback apropriado (`onLoginEmployee` / `onLoginOperational` / `onLoginManager`) com o **registro legado** (employee/manager) localizado via `linkedEmployeeId` ou `linkedManagerId`

**Fallback:** se pessoa não encontrada, cai no fluxo antigo de owners/managers/employees por CPF/PIN. Preserva retrocompat durante transição.

### Seletor pós-login

Pessoa com múltiplos perfis vê lista: "Empregado · [Rest]", "Gestor Operacional · [Rest]", "Gestor Adm. · [Rest]". Inclui nome do restaurante se pessoa está em múltiplos.

### Portais

3 portais principais:
- **Empregado** (`view === "employee"`, rota `/`): `EmployeePortal` — extrato de gorjeta, escala, trilhas, comunicados
- **Gestor Operacional** (`view === "operational"`): `OperationalPortal` — tabs dinâmicas baseadas em `operationalAreas`. Contagens/Compras/Checklists/Fichas Técnicas funcionais; áreas AppTip orientam pro Portal Adm
- **Gestor Administrativo** (`view === "manager"`, rota `/adm`): `ManagerPortal` → `RestaurantPanel` — todos os cadastros e operações

Alternância entre portais via botões no header (`onSwitchToManager`, `onSwitchToEmployee`, `onSwitchToOperational`) sem novo login.

### Migração pessoas (automática)

Roda 1 vez na carga se `pessoas` vazio E há `employees` ou `managers`. Implementada em `pessoasMigrate(employees, managers)`:

1. Cada employee → pessoa com `id = "pes_emp_" + emp.id`, `isTeam[rid] = true`, `teamData` preservado, `operationalAreas` → `permissions.operational`
2. Cada manager: merge com pessoa-empregado existente se `linkedEmpId` ou CPF coincidente; senão cria pessoa standalone com `linkedManagerId`. Adiciona `manager.perms` → `permissions.admin`, `manager.isDP`/`profile` → `permissions.special`
3. PIN = primeiros 4 dígitos do CPF, `mustChangePin: true`

**Idempotente:** IDs determinísticos, mesmo input produz mesmo output.

### Sincronização pessoa ↔ legado

Quando a matriz de Permissões é alterada (`togglePerm`), escreve em:
- `pessoa.permissions` (fonte nova)
- `employee.operationalAreas[name]` se `group === "operational"` e existe `linkedEmployeeId`
- `manager.perms[name]` se `group === "admin"` e existe `linkedManagerId`
- `manager.isDP` / `manager.profile` se `group === "special"` e existe `linkedManagerId`

Isso garante que as telas legadas continuam funcionando sem refactor downstream.

### Ciclo de Abastecimento (OperationalCompras)

```
Contador (área contagens) → lança contagens em miseCounts (cycleId + itemId + stockId + qty)
   ↓
Comprador (área compras) → OperationalCompras computa sugestões via miseComputeSuggestedOrders
   ↓
Cálculo: necessidade = max(0, minStock − sum(counts)) + pedido_direto_do_ciclo
         qty_sugerida = ceil(necessidade / fator) × fator   (fator do fornecedor preferencial ou override)
   ↓
Aprovação → cria miseSupplierOrders (status "approved")
   ↓
Envio WhatsApp → abre wa.me/<whatsapp>?text=<mensagem_formatada> + marca "sent"
   ↓
Recebimento → modal de diff produto a produto → status terminal (received_ok / received_with_divergence / awaiting_correction / rejected)
   ↓
Encerramento automático: se todos os pedidos do ciclo em status terminal → cicle.status = "closed"
```

## Arquivos-chave

- `src/App.js` — tudo (~22k linhas, arquivo único)
  - `K` (linha ~582): chaves Firestore
  - Utilitários: `load`, `save` (Firestore), `fmt`, `fmtDate`, `maskCpf`, etc.
  - `ftNrm`, `ftDishCost`, `ftSubfichaCost` — cálculos de Fichas Técnicas
  - `pessoasMigrate` — migração determinística
  - `miseComputeSuggestedOrders`, `miseBuildWhatsMessage`, `miseWhatsLink`
  - Componentes: `App`, `UnifiedLogin`, `ManagerPortal`, `EmployeePortal`, `OperationalPortal`, `OwnerPortal`, `RestaurantPanel`, `MiseContagensAdmin`, `OperationalContagens`, `OperationalCompras`, `MiseChecklistsAdmin`, `MiseChecklistTemplateEditor`, `OperationalChecklists`, `MiseFichasTecnicasAdmin`, `MiseFtInsumos`, `MiseFtEquipamentos`, `MiseFtDishesAdmin`, `MiseFtDishEditor`, `MiseFtSubFichaEditor`, `OperationalFichasTecnicas`, `PessoasAdmin`, `PermissoesMatrix`
- `src/firebase.js` — config Firebase (projeto `gorjeta-app`, App Check via reCAPTCHA)
- `src/index.js` — entry com `AppErrorBoundary`
- `public/index.html` — CSS variables (tema claro/escuro "Warm Minimal") + scripts CDN (jsPDF, XLSX)

## Backups

Todo deploy importante deveria gerar um `App.js.<TIMESTAMP>.bak` antes de começar. Último backup: `src/App.js.20260421_111429.bak`.

## Convenções e gotchas

- **17k+ linhas num arquivo só** — edit-tool primeiro, evite reescrita. Componentes grandes são inlined, não extraídos em arquivos.
- **eslint em CI = erro** — `no-unused-vars` bloqueia build. Utilitários grandes têm `/* eslint-disable no-unused-vars */ ... /* eslint-enable */`
- **Build:** `BUILD_PATH=/tmp/apptip-build CI=true ./node_modules/.bin/react-scripts build` se o sandbox não tem permissão em `build/`.
- **`onUpdate(field, value)`** salva em Firestore + atualiza state. Suporta `value` como função `(prev) => next` pra evitar stale-state race.
- **Dados existentes** — já estão num schema v4. Mudar estrutura de coleção existente exige migração idempotente.
- **Unificar `fichastecnicas-c3829`** com o projeto AppTip é **migração de produto**, não do código — depende de gcloud export + transformação.

## Known issues / débitos técnicos

- Telas downstream (Escala, Gorjeta, VT) ainda leem de `employees` / `managers` direto; só o sync mantém `pessoas` coerente. Refactor para ler de `pessoas.where(isTeam)` está pendente.
- Áreas AppTip no `OperationalPortal` (Escalas, Gorjetas, Trilhas, Reuniões) mostram CTA pra usar o Gestor Adm; não tem visão operacional dedicada ainda.
- Removida a aba "Gestores" da UI — o render block `tab === "dp_gestores"` permanece em RestaurantPanel para não quebrar rotas em andamento, mas não é alcançável pela navegação.
- Coleção `managers` permanece como fonte primária para login legado (fallback) e para as telas que ainda leem dela. Remover só após o login novo estar estável em produção.
- Pessoa marcada com permissões `admin.X` mas sem `linkedManagerId` → a permissão é gravada só em `pessoas`; telas admin legadas não enxergam. Auto-criação de manager record nesse caso é polish pendente (ver Fase C).

## Como deployar

```bash
cd ~/Downloads/gorjeta-app/gorjeta-app
git add -A && git commit -m "..."
git push
# Vercel faz deploy automático em apptip.app
```

Build local para validar antes:

```bash
CI=true ./node_modules/.bin/react-scripts build
```
