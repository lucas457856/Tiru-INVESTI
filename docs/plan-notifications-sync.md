# Notificações sincronizadas PC ↔ Mobile (Firestore → FCM → Notification API)

## 1. Diagnóstico da arquitetura anterior

O projeto **não tem push notification (FCM)**. O que existe hoje:

| Camada | Onde | O que faz |
|---|---|---|
| Firestore in-app | `src/services/notificationsService.js` | `criarNotificacao(uid, dados)` grava em `usuarios/{uid}/notificacoes`; `observarNotificacoes` retorna `onSnapshot`. |
| Notificação nativa desktop | `src/utils/notifications.js` → `mostrarNotificacaoNativa(...)` | `new Notification(...)` (legado) OU `registration.showNotification()` (Android). |
| Service Worker | `public/sw.js` (`SW_VERSION = "jurex-sw-v1"`) | **Não** escuta `push`. Só faz `notificationclick` para focar `/dashboard`. |
| Dedup | `src/utils/notificationDedup.js` | 3 camadas: `Set` em memória + `localStorage` (chave `jurex:notif:<tipo>:<contratoId>:<parcelaNumero>:<vencimentoISO>`) + `tag` do Chrome. |
| Triggers atuais | `useNotificadorVencimentos.js` (parcela vencendo/atrasada); `contractService.processarPagamento` (pagamento_recebido); `criar-contrato.js` (contrato_criado) | Cada um chama `criarNotificacao` + `mostrarNotificacaoNativa` **independentemente**, sem evento central. |

**Problemas:**
- Sem `eventId` central: cada trigger toma sua própria decisão de notificar. Impossível deduplicar "1 evento → 1 notificação por device" entre frontends.
- Sem FCM: celular Android com aba em background **não** recebe push real — depende do `registration.showNotification` na aba ativa, e iOS/Safari fica sem fallback.
- Sem identificação de dispositivo: a `tag` do Chrome dedup só no escopo de uma aba, e a `localStorage` cobre só o navegador atual.
- Sem registro de tokens: nada no Firestore sabe "este celular do João recebe push".

## 2. Decisões de design (alinhadas com o usuário)

- **Política de distribuição**: dispositivos do DONO recebem todos os eventos do `ownerId`. Dispositivos de FUNCIONÁRIO recebem apenas eventos cujo documento-alvo tenha `createdBy == funcionarioUid` (espelha a regra de leitura do Firestore).
- **FCM**: ativar agora via Vercel API (mesma máquina onde rodam `criar-contrato.js`, `criar-cliente.js`, etc.). Reutiliza a instância Admin SDK já cacheada em `api/_lib/firebaseAdmin.js`.
- **Dedup**: 3 camadas — `Set` em memória + `localStorage` (chave `jurex:notif:event:<eventId>`) + `tag` do Chrome. Adiciona também `eventId` no Firestore `notificacoes/{id}` para que dois devices não criem 2 docs com o mesmo `eventId`.

## 3. Modelo de dados

### Evento central (Firestore)
```
usuarios/{ownerId}/notificationEvents/{eventId}
{
  eventId: string (id do doc, gerado client-side com crypto.randomUUID()),
  type: enum (CONTRACT_CREATED, PAYMENT_REGISTERED, INSTALLMENT_OVERDUE, INSTALLMENT_DUE_TODAY, ...),
  ownerId: uid do DONO (sempre o owner raiz, não o funcionário),
  createdBy: { uid, role: "owner" | "funcionario" },
  sourceDeviceId: deviceId que originou (sempre o chamador),
  title: string,
  body: string,
  data: { contratoId?, clienteId?, parcelaNumero?, ... }  // payload p/ navegação
  createdAt: serverTimestamp(),
  status: "created" | "dispatched" | "partial_failure" | "delivered",
  dispatchedAt?: Timestamp,
  // NÃO guardamos tokens FCM aqui (vão em /devices).
}
```

### Dispositivo
```
usuarios/{uid}/devices/{deviceId}
{
  deviceId: string (UUID v4 salvo no localStorage, persistente por browser/device),
  type: "desktop" | "mobile" | "tablet" | "other",
  platform: navigator.userAgent parseado (ex: "Chrome 124", "iPhone Safari"),
  fcmToken: string | null,
  fcmTokenUpdatedAt: Timestamp,
  notificationsEnabled: boolean (espelha Notification.permission),
  lastSeenAt: serverTimestamp(),
  createdAt: serverTimestamp(),
  ownerId: uid (para funcionários, ownerId do dono raiz),
  // Para funcionário:
  userRole: "owner" | "funcionario",
  ownerUid: uid (raiz do dono — sempre presente, mesmo p/ dono)
}
```

### Notificação in-app (estrutura existente, ampliada)
```
usuarios/{uid}/notificacoes/{notifId}
{
  tipo, titulo, descricao, contratoId, parcelaNumero, valor, lida, criadaEm
  // ADICIONAR:
  eventId: string  // ← chave para dedup entre devices e dedup in-app
}
```

## 4. Fluxo implementado

```
[1] Ação no front (ex: registrar pagamento)
     │
     ↓
[2] Hook useNotificationEvent() — gera eventId, monta payload
     │
     ↓
[3] Front chama criarContrato API (já existe) — backend grava
     │
     ↓
[4] Backend (api/admin/criar-contrato.js, contractService.processarPagamento, etc.)
     escreve:
       - doc do contrato/pagamento (já existe)
       - doc em usuarios/{ownerId}/notificationEvents/{eventId}  ← NOVO
       - doc em usuarios/{ownerUid}/notificacoes/{auto}  ← já existe, agora com eventId
     │
     ↓
[5] Endpoint /api/notifications/dispatch?eventId=X (NOVO)
       - lê o evento
       - lê devices do ownerId (regras de filtragem abaixo)
       - para cada device com fcmToken: admin.messaging().send(...)
       - atualiza status/dispatchedAt no evento
     │
     ↓
[6] Distribuição paralela:
       - DISPOSITIVO QUE ORIGINOU: nada de FCM (já viu via in-app);
         mas o hook dispara mostrarNotificacaoNativa() local.
       - OUTROS DISPOSITIVOS DO DONO: recebem FCM push → SW showNotification.
       - FUNCIONÁRIOS: recebem FCM só se o doc-alvo (contrato/pagamento)
         tiver createdBy == funcionarioUid.
     │
     ↓
[7] Frontend (cada device):
       - FCM message → onMessage (foreground) OU onBackgroundMessage (SW)
       - Recebido: checa eventId em Set + localStorage → se novo, exibe.
       - Cria entrada em /notificacoes in-app se ainda não existir (idempotente via eventId).
```

## 5. PC → Mobile (caminho concreto)

1. Usuário no PC clica "Registrar pagamento" em `ReceberPagamento.jsx`.
2. `processarPagamento()` (em `contractService.js`) é chamado. Atualmente ele já chama `criarNotificacao(...)` e `mostrarNotificacaoNativa(...)`. **Adicionar:** `criarNotificationEvent({ type: "PAYMENT_REGISTERED", ... })` antes do `criarNotificacao`. O `eventId` é gerado pelo hook e passado no payload.
3. Endpoint `criar-contrato.js` (e equivalentes) grava o evento em `notificationEvents/{eventId}`. (Para `processarPagamento` que escreve direto via client SDK, vamos criar um novo endpoint `api/notifications/register-event.js` que recebe `eventId + type + data` e grava no Admin SDK — preserva a regra de "create via Admin SDK para garantir a existência do eventId no servidor".)
4. Após gravação, o endpoint chama `dispatchNotificationEvent(eventId)`.
5. Backend busca `devices` do `ownerId`. Para o celular do dono, encontra o `fcmToken` e dispara `admin.messaging().send({ token, notification, data, android: { priority: "high" }, webpush: { headers } })`.
6. O celular (Firebase Messaging SW `firebase-messaging-sw.js`) recebe a mensagem, mostra via `registration.showNotification`. Frontend em foreground também recebe via `onMessage` se a aba estiver aberta.
7. Click na notificação: SW faz `clients.openWindow('/emprestimos/' + data.contratoId)`.

## 6. Mobile → PC (caminho concreto)

Idêntico ao PC → Mobile, com a única diferença na origem: o `sourceDeviceId` é do celular. O PC recebe via FCM se o app estiver aberto em uma aba do Chrome (o `onMessage` mostra a nativa) ou via Service Worker (mostra direto do SO). Como o PC já tem SW registrado (`/sw.js`), a integração é só mudar o SW para também escutar `push` (Firesase messaging onBackgroundMessage).

## 7. Prevenção de duplicidade

3 camadas:

1. **eventId no Firestore (fonte da verdade)**: cada evento tem `eventId` único. Backend **não cria 2 eventos** com mesmo `eventId`. O client gera o `eventId` uma vez por ação e propaga para todos os subdocumentos gerados (event + in-app notif + push). Backend rejeita 409 se já existir.
2. **Dedup em memória no front** (`utils/notificationDedup.js`): estender `eventoJaNotificado()` para também checar por `eventId` (chave `jurex:notif:event:<eventId>`). Set singleton em memória + `localStorage`.
3. **tag do Chrome**: toda notificação nativa carrega `tag: jurex:<type>:<eventId>`. Chrome substitui em vez de empilhar.

Se dois devices do mesmo dono estiverem abertos simultaneamente: ambos recebem FCM, ambos chamam `onMessage`, ambos checam dedup por `eventId`. O device ORIGINADOR é excluído da lista de FCM (ver § 8), então recebe só via in-app + nativa local. Os outros 2 devices recebem 1 push cada.

## 8. Segurança

- **Backend-only Admin SDK**: `api/_lib/firebaseAdmin.js` (já existe, já cacheado). Adicionar `getMessaging(admin)` (de `firebase-admin/messaging`).
- **Token FCM**: front pega via `getToken({ vapidKey })` (requer `VAPID_KEY` em env do front, gerada no Console do Firebase → Project Settings → Cloud Messaging → Web Push certificates). Front grava em `usuarios/{uid}/devices/{deviceId}` via **endpoint** `api/notifications/register-device.js` (Admin SDK). Front **nunca** lê tokens de outros devices — a regra em `firestore.rules` (abaixo) nega `read` em devices de outros uids.
- **Função do funcionário**: o campo `userRole` + `ownerUid` no doc do device permite ao backend filtrar. Regra: o `authUid` do request é o `request.auth.uid`. O endpoint de dispatch usa **apenas** o `ownerId` do evento + `createdBy` do doc-alvo para decidir destinatários. Não há como um funcionário injetar outro `ownerId` no payload.
- **Firestore Rules** (adicionar):
  ```
  match /devices/{deviceId} {
    // Só o próprio uid pode criar/ler/atualizar/excluir seu device.
    allow read, write: if request.auth != null && request.auth.uid == uid;
  }
  match /notificationEvents/{eventId} {
    // Só Admin SDK cria. Leitura: dono ou funcionário do owner.
    allow read: if ehDonoOuFuncionario(uid);
    // Sem create/update/delete para client SDK.
  }
  ```
  Comentário: hoje o `firestore.rules` já tem `match /notificacoes/{notifId}` aberto para `ehDonoOuFuncionario` — manter. Adicionar `match /devices/{deviceId}` (escopo do próprio uid) e `match /notificationEvents/{eventId}` (read-only para dono/funcionário).

## 8b. Logout / troca de usuário

- No logout, `auth.signOut()` → `useDeviceRegistration` chama `updateDoc(device, { fcmToken: null, notificationsEnabled: false })` e **deleta o FCM token local** via `getMessaging().deleteToken()`. Assim, no próximo login:
  - Se for o mesmo usuário, hook re-registra o mesmo deviceId (mesmo UUID) e o `setDoc({ merge: true })` reaproveita o doc.
  - Se for outro usuário, o novo deviceId (do novo localStorage? não — UUID é por-browser, persiste) **NÃO** pode ser gravado em outro uid sem que o front prove que o `request.auth.uid` é o novo dono. Como a regra de devices exige `request.auth.uid == uid`, o deviceId do navegador anterior do usuário A fica em `usuarios/A/...` e o usuário B cria seu próprio `usuarios/B/devices/<novo-uuid>`. **Decisão: o deviceId é por browser (UUID v4 no localStorage), não por user. Cada login num browser diferente gera um deviceId novo; mesmo browser pode estar logado em momentos diferentes como A e B, e a regra de `uid` impede cross-contamination.** Sem essa disciplina, o deviceId do usuário A vazaria para o usuário B no mesmo browser.

## 9. Arquivos alterados / criados

### Novos
| Arquivo | Função |
|---|---|
| `src/hooks/useDeviceRegistration.js` | Registra/atualiza o device do usuário (UUID, FCM token, permissões). Roda no `App.jsx` quando `auth.currentUser` muda. |
| `src/hooks/useNotificationDispatcher.js` | Listener FCM no front. `onMessage` (foreground) + `onBackgroundMessage` (SW). Recebido → dedup por `eventId` → `mostrarNotificacaoNativa` + cria doc in-app se faltar. |
| `src/services/notificationEvents.js` | Front service: `criarNotificationEvent(payload)`, `listarMeusDispositivos()`. Chama endpoints server-side. |
| `public/firebase-messaging-sw.js` | Service Worker dedicado ao FCM. Substitui o `sw.js` atual (que vira legado OU é extendido). Decide: **estender** `sw.js` com importScripts do Firebase Messaging SW e adicionar handler `push` + `onBackgroundMessage`. Mais simples: 1 SW. |
| `api/notifications/dispatch.js` | Server endpoint: recebe `eventId`, lê evento, busca devices do ownerId, filtra (origem não recebe; funcionário só se `createdBy` bate), dispara FCM, atualiza status. |
| `api/notifications/register-device.js` | Server endpoint: valida token (verifyIdToken), upsert `usuarios/{uid}/devices/{deviceId}`. |
| `api/notifications/register-event.js` | Server endpoint: grava `notificationEvents/{eventId}` (Idempotente: se já existe, retorna 200 sem ação). |
| `scripts/test-events-dedup.mjs` | (Opcional) Smoke test: cria 2 eventos com mesmo `eventId`, garante idempotência. |
| `src/utils/notificationEventTypes.js` | Constantes: `CONTRACT_CREATED`, `PAYMENT_REGISTERED`, `INSTALLMENT_OVERDUE`, `INSTALLMENT_DUE_TODAY`, `CLIENT_CREATED`, `EMPLOYEE_CREATED`, `CONTRACT_DELETED`, `CLIENT_DELETED`, `EMPLOYEE_DELETED`. |

### Alterados
| Arquivo | Mudança |
|---|---|
| `firestore.rules` | Adicionar `match /devices/{deviceId}` e `match /notificationEvents/{eventId}`. |
| `public/sw.js` | Estender com `importScripts('https://www.gstatic.com/firebasejs/12.18.0/firebase-app-compat.js')` + `firebase-messaging-compat.js` + `onBackgroundMessage`. Bumpar `SW_VERSION` para `jurex-sw-v2`. |
| `src/main.jsx` | Bumpar `?v=jurex-sw-v2`. |
| `src/services/contractService.js` | Em `processarPagamento`, antes de `criarNotificacao`, gerar `eventId` e chamar `criarNotificationEvent({ type: "PAYMENT_REGISTERED", data: { contratoId, parcelaNumero, ... } })`. Idem em `excluirContrato` (type `CONTRACT_DELETED`). |
| `api/admin/criar-contrato.js` | Após `contratosRef.add(novoContrato)`, gravar `notificationEvents/{eventId}` e chamar `/api/notifications/dispatch`. Idem em `criar-cliente.js`, `api/auth/create-employee.js`. |
| `src/hooks/useNotificadorVencimentos.js` | Trocar `criarNotificacao` direto por `criarNotificationEvent({ type: "INSTALLMENT_OVERDUE" \| "INSTALLMENT_DUE_TODAY", data: { contratoId, parcelaNumero, vencimentoISO } })`. |
| `src/pages/NovoContrato.jsx` | No `navigate('/contratos/:id/sucesso')`, gerar `eventId` ANTES e enviar no payload de `criarContratoApi`. (Não, melhor: o endpoint gera. Ver § 10.) |
| `src/services/notificationsService.js` | `criarNotificacao` aceita `eventId` opcional; se já existe `notificacoes/{eventId=<x>}` com mesmo `eventId`, não duplica. (Firestore `where('eventId','==',X).limit(1)` antes do `addDoc`.) |
| `src/utils/notificationDedup.js` | Adicionar `eventoJaNotificadoPorEventId(eventId)` e `marcarNotificadoPorEventId(eventId)`. Chave `jurex:notif:event:<eventId>`. |
| `src/App.jsx` | Adicionar `<NotificationProvider>` que monta `useDeviceRegistration` (após auth) e expõe `useNotificationDispatcher` para os filhos. |
| `package.json` | Nenhuma mudança: `firebase` (12.x) já cobre messaging. `firebase-admin` (12.x) já cobre messaging no server. |

## 10. Quem gera o `eventId`?

Decisão: **cliente que origina** gera o `eventId` (UUID v4 via `crypto.randomUUID()`) e propaga via payload. Razão: se o servidor gerasse, a idempotência "se já existe, retorna" precisaria de um segundo request. Cliente gerando + servidor validando = atômico. Tradeoff: o cliente pode mandar `eventId` arbitrário — mitigado pelo Firestore Rules que **bloqueia** create em `notificationEvents` via client SDK (só Admin SDK cria). O cliente manda o `eventId` no payload do endpoint principal (ex: `criar-contrato.js` aceita `eventId` no body e usa como id do doc, OU gera internamente). **Decisão final: o endpoint principal gera o `eventId`** e o retorna na resposta, para manter client-side simples. O cliente então passa esse `eventId` em chamadas subsequentes (ex: in-app notification, dispatch) para deduplicar.

## 11. Pendências / ações manuais necessárias

Antes de funcionar end-to-end, o operador precisa:
1. **Console do Firebase → Project Settings → Cloud Messaging**: gerar **Web Push certificate (VAPID key)**. Adicionar em `.env` do front: `VITE_FIREBASE_VAPID_KEY=...`.
2. **Console do Firebase → Cloud Messaging API (V1)**: habilitar. Sem isso, `admin.messaging().send()` retorna 403.
3. **Variáveis Admin SDK** (`FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`): já necessárias para os outros endpoints; apenas confirmar que estão na Vercel.
4. **Service Worker**: testar em HTTPS (FCM exige context seguro). O deploy atual já é HTTPS (Vercel).
5. **iOS Safari 16.4+**: PWA-only para FCM. Se o operador quiser iOS, precisa adicionar à home screen antes. Documentar no README.
6. **Primeiro push pode demorar**: o Firebase pode demorar alguns minutos para registrar o token pela primeira vez após adicionar o SW. Smoke test: abrir DevTools → Application → Service Workers → ver `fcmToken` em `localStorage` e em `usuarios/{uid}/devices/{deviceId}.fcmToken`.

## 12. Verificação local

```bash
npm run lint
npm run build
# Dev local:
npm run dev
# em 2 abas (Chrome + Firefox, ou 2 perfis), mesmo usuário:
#   aba 1: registrar pagamento → aba 2 deve receber push (se tiver SW + VAPID).
```

## 13. Fora de escopo (explícito)

- iOS < 16.4 (sem suporte FCM web).
- Push para web sem SW (Fogg).
- Migração de notificações antigas in-app (já existentes em `usuarios/{uid}/notificacoes`) — elas ficam como legado, sem `eventId`. Apenas novas notificações ganham o campo.
- Realtime listener do Firestore para `notificationEvents` (não é necessário: o FCM já entrega o push; o `onSnapshot` em `notificacoes` continua igual, agora filtrando por `eventId` para não duplicar).
