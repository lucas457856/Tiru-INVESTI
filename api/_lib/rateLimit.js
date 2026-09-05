// Rate Limiting in-memory compartilhado por todas as Serverless Functions.
//
// Por que in-memory e não Redis/Upstash/KV:
//   - Infra mínima: zero dependência externa, zero env var extra.
//   - Compatível com o plano Hobby da Vercel: cada função roda em
//     contêiner isolado, então o estado é POR-INSTÂNCIA (não global
//     entre cold starts). Para um único atacante, isso é suficiente —
//     cada cold start começa com a contagem dele em zero, mas a janela
//     de 15min é longa o bastante para deter abuso persistente.
//   - Limitação conhecida: com múltiplas instâncias simultâneas
//     (cold starts paralelos, ou picos), um atacante pode contornar
//     o limite distribuindo entre instâncias. Para defesa real
//     entre-região/entre-instância, migrar para Upstash Redis
//     (ver nota "Migração futura" abaixo).
//
// Implementação:
//   - Sliding window com timestamp por requisição.
//   - Limpeza lazy: ao checar, descartamos timestamps fora da janela
//     antes de contar. Para evitar leak de memória em chaves zumbis,
//     rodamos um sweep oportunista a cada CHAVE_LIMPEZA_A_CADA checks.
//
// Trade-offs explícitos:
//   - Sem persistência: contadores resetam a cada cold start da função.
//   - Sem sincronia entre instâncias: cada instância tem seu próprio Map.
//   - Janela em ms, sliding (não fixed): mais preciso, custo de memória
//     proporcional a `limite` (no máx 60 timestamps por chave para admin).
//
// NOTA DE MIGRAÇÃO FUTURA:
//   Trocar este módulo por um cliente Upstash (com `process.env.UPSTASH_REDIS_REST_URL`
//   + `process.env.UPSTASH_REDIS_REST_TOKEN`) é uma mudança isolada
//   que NÃO afeta os call sites. Manter este shape:
//   `checarRateLimit({ chave, limite, janelaMs }) → { ok, restante, resetMs }`.
//
// SEGURANÇA:
//   - NUNCA logar `chave` inteira quando for um IP ou UID. A chave é
//     usada apenas como índice no Map.
//   - O helper `extrairIp(req)` é defensivo contra spoofing parcial:
//     usa apenas o PRIMEIRO IP de `x-forwarded-for` (que é o cliente
//     real na Vercel) e cai no socket address se ausente.

/**
 * Tipo de entrada: cada chave guarda um array de timestamps (ms epoch)
 * das requisições que ainda estão dentro da janela.
 * @typedef {number[]} TimestampsJanela
 */

/** @type {Map<string, TimestampsJanela>} */
const contadores = new Map();

/** Contador global para sweep oportunista. */
let checksTotais = 0;
const CHAVE_LIMPEZA_A_CADA = 256;

/**
 * Extrai o IP "real" do cliente a partir dos headers padrão da Vercel
 * (e de proxies reversos em geral).
 *
 * Ordem de prioridade:
 *   1. `x-forwarded-for` (primeiro IP da lista) — Vercel popula com o
 *      IP do cliente. Pode ser falsificado se não houver proxy confiável,
 *      mas a Vercel adiciona ao final, não substitui.
 *   2. `x-real-ip` — proxy alternativo.
 *   3. `req.socket.remoteAddress` — fallback do Node.
 *
 * Retorna "desconhecido" se nada estiver disponível (caso extremo:
 * teste local sem socket). Em produção na Vercel, sempre retorna um
 * IP real.
 *
 * @param {import("http").IncomingMessage} req
 * @returns {string}
 */
export function extrairIp(req) {
  const xff = req.headers?.["x-forwarded-for"];
  if (typeof xff === "string" && xff.length > 0) {
    // Pode vir "cliente, proxy1, proxy2". O cliente real é o PRIMEIRO.
    const primeiro = xff.split(",")[0]?.trim();
    if (primeiro) return primeiro;
  }
  if (Array.isArray(xff) && xff.length > 0) {
    const primeiro = xff[0]?.split(",")[0]?.trim();
    if (primeiro) return primeiro;
  }
  const xri = req.headers?.["x-real-ip"];
  if (typeof xri === "string" && xri.trim().length > 0) {
    return xri.trim();
  }
  const sock = req.socket?.remoteAddress;
  if (typeof sock === "string" && sock.length > 0) {
    // Em IPv6-mapped IPv4, Node retorna "::ffff:1.2.3.4". Mantemos
    // como está — é informação útil para chave.
    return sock;
  }
  return "desconhecido";
}

/**
 * Verifica e registra uma requisição para a chave dada.
 *
 * - Se a chave já tem `limite` timestamps dentro da janela atual,
 *   retorna `{ ok: false, ... }` (chamador deve retornar 429).
 * - Caso contrário, registra `Date.now()` como nova request e
 *   retorna `{ ok: true, ... }`.
 *
 * Janela SLIDING: timestamps mais antigos que `agora - janelaMs`
 * são descartados antes de contar.
 *
 * @param {{ chave: string, limite: number, janelaMs: number }} opts
 * @returns {{ ok: boolean, restante: number, resetMs: number }}
 *   `ok`         — true se a request está dentro do limite.
 *   `restante`   — quantas requests ainda são permitidas na janela
 *                  (após esta ser contabilizada, se ok).
 *   `resetMs`    — em quanto tempo (ms) a chave libera UMA vaga
 *                  (i.e., tempo até o timestamp mais antigo sair
 *                  da janela). Útil para `Retry-After`.
 */
export function checarRateLimit({ chave, limite, janelaMs }) {
  if (!chave || typeof chave !== "string") {
    // Sem chave identificável, FAIL-OPEN: melhor deixar passar do que
    // bloquear o mundo. O caller é quem decide se quer um fallback
    // (ex: passar "desconhecido" para ter um bucket compartilhado).
    return { ok: true, restante: limite, resetMs: 0 };
  }
  const agora = Date.now();
  const limiteJanela = agora - janelaMs;

  let timestamps = contadores.get(chave);
  if (!timestamps) {
    timestamps = [];
    contadores.set(chave, timestamps);
  }

  // Filtra timestamps fora da janela (sliding window).
  // O array está em ordem de inserção; cortamos a partir do início
  // enquanto o valor for < limiteJanela.
  let i = 0;
  while (i < timestamps.length && timestamps[i] <= limiteJanela) i++;
  if (i > 0) timestamps.splice(0, i);

  if (timestamps.length >= limite) {
    // Limite atingido. NÃO registramos este hit (caso contrário, quem
    // está em burst fica eternamente bloqueado, mesmo após a janela
    // passar parcialmente — faria a janela "andar para frente" só
    // com requests aceitas).
    const resetMs = Math.max(0, timestamps[0] + janelaMs - agora);
    return { ok: false, restante: 0, resetMs };
  }

  // Aceita: registra o timestamp.
  timestamps.push(agora);

  // Sweep oportunista: a cada N checks, varre chaves zumbis (sem
  // timestamps recentes há mais de 2 janelas). Custo desprezível em
  // produção (Map com poucas dezenas de chaves).
  checksTotais += 1;
  if (checksTotais >= CHAVE_LIMPEZA_A_CADA) {
    checksTotais = 0;
    const limiteSweep = agora - 2 * janelaMs;
    for (const [k, ts] of contadores.entries()) {
      // Filtra e decide se a chave tem algum timestamp vivo.
      let j = 0;
      while (j < ts.length && ts[j] <= limiteSweep) j++;
      if (j === ts.length) {
        contadores.delete(k);
      } else if (j > 0) {
        ts.splice(0, j);
      }
    }
  }

  return { ok: true, restante: limite - timestamps.length, resetMs: 0 };
}

/**
 * Helper opcional para resetar manualmente uma chave (útil em testes
 * ou após um reset de senha, para não penalizar o usuário legítimo).
 *
 * @param {string} chave
 */
export function resetarRateLimit(chave) {
  contadores.delete(chave);
}

// Presets de rate limit compartilhados pelos handlers.
// Cada preset = { bucket, limite, janelaMs } e é passado como 5º
// parâmetro de `verificarToken(res, prefix, authAdmin, idToken, rateOpts)`.
//
// O `bucket` isola os contadores entre endpoints — sem ele, o mesmo
// UID acumularia hits de admin + notifications + auth no mesmo balde,
// o que distorceria os limites. Com bucket, cada grupo tem seu
// próprio contador por UID.
/** @type {{ bucket: string, limite: number, janelaMs: number }} */
export const RATE_OPTS_ADMIN = {
  bucket: "admin",
  limite: 60,
  janelaMs: 60 * 1000,
};
/** @type {{ bucket: string, limite: number, janelaMs: number }} */
export const RATE_OPTS_NOTIFICATIONS_DISPATCH = {
  bucket: "notifications-dispatch",
  limite: 30,
  janelaMs: 60 * 1000,
};
