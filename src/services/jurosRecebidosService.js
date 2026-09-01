// Service dedicado ao histórico de RECEBIMENTOS DE JUROS (modalidade "Só os juros").
//
// IMPORTANTE: "Só os juros" NÃO é pagamento de parcela. É apenas um registro
// histórico de que os juros daquela semana foram recebidos. Esta coleção é
// independente da coleção `pagamentos` (que registra parcelas inteiras,
// parciais, quitações etc.) e existe somente para alimentar o badge
// "Juros da semana recebido" exibido dentro do card de cada parcela.
//
// Path: usuarios/{uid}/contratos/{contratoId}/jurosRecebidos/{jurosId}
import { collection, addDoc, serverTimestamp, query, orderBy, getDocs } from "firebase/firestore";
import { db } from "./firebase";

/**
 * Registra um recebimento de juros no histórico dedicado.
 *
 * NÃO altera:
 * - valorEmprestado
 * - valorParcela
 * - totalReceber
 * - saldoPrincipal
 * - principalQuitado
 * - parcelasPagas
 * - status da parcela
 *
 * Só persiste um documento com os campos abaixo, que será lido por
 * `buscarJurosRecebidos` para exibir o badge na parcela correta.
 */
export async function registrarJurosRecebido(usuario, contrato, dados) {
  if (!usuario || !contrato) throw new Error("Contexto inválido");

  const {
    parcelaNumero,
    valorRecebido = 0,
    dataRecebimento = new Date().toISOString().split("T")[0],
    observacao = "",
  } = dados || {};

  const ref = collection(
    db,
    "usuarios", usuario.uid, "contratos", contrato.id, "jurosRecebidos"
  );

  const docRef = await addDoc(ref, {
    contratoId: contrato.id,
    clienteId: contrato.clienteId,
    clienteNome: contrato.clienteNome,
    parcelaNumero: parcelaNumero !== undefined && parcelaNumero !== null
      ? Number(parcelaNumero)
      : null,
    valorRecebido: Number(valorRecebido) || 0,
    dataRecebimento,
    observacao,
    tipo: "juros",
    criadoEm: serverTimestamp(),
  });

  return docRef.id;
}

/**
 * Busca todos os recebimentos de juros de um contrato.
 * Retorna array vazio se não houver.
 */
export async function buscarJurosRecebidos(usuario, contratoId) {
  if (!usuario || !contratoId) return [];
  const q = query(
    collection(db, "usuarios", usuario.uid, "contratos", contratoId, "jurosRecebidos"),
    orderBy("criadoEm", "desc")
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
