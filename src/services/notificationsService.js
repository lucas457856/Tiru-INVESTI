// Serviço de notificações do app.
//
// Persistência em Firestore na subcoleção
// `usuarios/{uid}/notificacoes` (mesma estrutura de subcoleção por
// usuário já usada em `contratos`, `pagamentos`, `jurosRecebidos`).
//
// Cada documento representa uma notificação do sistema:
//   {
//     tipo: "contrato_criado" | "parcela_vencendo" | "parcela_atrasada"
//         | "pagamento_recebido" | "resumo_contratos",
//     titulo: string,
//     descricao: string,
//     contratoId?: string,
//     parcelaNumero?: number,
//     valor?: number,
//     lida: boolean,
//     criadaEm: Timestamp,
//   }
//
// O sino do Dashboard e a página /notificacoes consomem o MESMO
// `observarNotificacoes`, garantindo que o contador e a lista
// permaneçam sincronizados em tempo real via onSnapshot.

import {
  addDoc,
  collection,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { db } from "./firebase";

const LIMITE_LISTA = 100;

/**
 * Observa as notificações do usuário em tempo real.
 * Retorna a função de unsubscribe do onSnapshot.
 *
 * @param {string} uid
 * @param {(lista: Array) => void} cb
 * @param {(err: Error) => void} [onError]
 * @returns {() => void}
 */
export function observarNotificacoes(uid, cb, onError) {
  if (!uid) {
    cb([]);
    return () => {};
  }
  const q = query(
    collection(db, "usuarios", uid, "notificacoes"),
    orderBy("criadaEm", "desc"),
    limit(LIMITE_LISTA),
  );
  return onSnapshot(
    q,
    (snap) => {
      const lista = snap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          ...data,
          // Converte Timestamp do Firestore em Date JS para uso em UI
          // (ex.: "há 2 horas"). Fallback para `new Date()` caso o doc
          // tenha sido criado com clock do cliente (clocks dessinc.).
          criadaEm:
            data?.criadaEm && typeof data.criadaEm.toDate === "function"
              ? data.criadaEm.toDate()
              : data?.criadaEm instanceof Date
                ? data.criadaEm
                : new Date(),
        };
      });
      cb(lista);
    },
    (err) => {
      console.error("observarNotificacoes:", err);
      if (typeof onError === "function") onError(err);
    },
  );
}

/**
 * Cria uma nova notificação para o usuário.
 *
 * @param {string} uid
 * @param {{
 *   tipo: string,
 *   titulo: string,
 *   descricao: string,
 *   contratoId?: string,
 *   parcelaNumero?: number,
 *   valor?: number,
 * }} dados
 * @returns {Promise<string>} id da notificação criada
 */
export async function criarNotificacao(uid, dados) {
  if (!uid) throw new Error("criarNotificacao: uid obrigatório");
  if (!dados || !dados.tipo || !dados.titulo) {
    throw new Error("criarNotificacao: tipo e titulo são obrigatórios");
  }
  const ref = await addDoc(collection(db, "usuarios", uid, "notificacoes"), {
    tipo: dados.tipo,
    titulo: dados.titulo,
    descricao: dados.descricao || "",
    contratoId: dados.contratoId || null,
    parcelaNumero: dados.parcelaNumero ?? null,
    valor: typeof dados.valor === "number" ? dados.valor : null,
    lida: false,
    criadaEm: serverTimestamp(),
  });
  return ref.id;
}

/**
 * Marca uma notificação específica como lida.
 * No-op silencioso se já estiver lida.
 *
 * @param {string} uid
 * @param {string} notifId
 */
export async function marcarComoLida(uid, notifId) {
  if (!uid || !notifId) return;
  await updateDoc(doc(db, "usuarios", uid, "notificacoes", notifId), {
    lida: true,
  });
}

/**
 * Marca TODAS as notificações não lidas do usuário como lidas.
 * Usa writeBatch para reduzir round-trips ao Firestore.
 *
 * @param {string} uid
 */
export async function marcarTodasComoLidas(uid) {
  if (!uid) return;
  const q = query(
    collection(db, "usuarios", uid, "notificacoes"),
    where("lida", "==", false),
  );
  const snap = await getDocs(q);
  if (snap.empty) return;
  const batch = writeBatch(db);
  snap.forEach((d) => {
    batch.update(doc(db, "usuarios", uid, "notificacoes", d.id), {
      lida: true,
    });
  });
  await batch.commit();
}
