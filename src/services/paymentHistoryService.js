// Service para histórico de pagamentos no Firestore.
// Subcoleção: usuarios/{uid}/contratos/{contratoId}/pagamentos/{pagamentoId}
import { collection, addDoc, serverTimestamp, query, orderBy, getDocs } from "firebase/firestore";
import { db } from "./firebase";

// Registra um pagamento no histórico
export async function registrarPagamento(usuario, contrato, pagamento) {
  if (!usuario || !contrato) throw new Error("Contexto inválido");

  const {
    valorRecebido = 0,
    tipoRecebimento = "parcela", // "parcela" | "juros" | "parcial" | "quitacao"
    jurosRecebidos = 0,
    principalAbatido = 0,
    dataRecebimento = new Date().toISOString().split("T")[0],
    parcelaNumero,
    observacao = "",
    saldoAntes = 0,
    saldoDepois = 0,
    saldoPrincipalAntes = 0,
    saldoPrincipalDepois = 0,
    abatimentoTotalAntes = 0,
    abatimentoTotalDepois = 0,
  } = pagamento;

  const ref = collection(
    db,
    "usuarios", usuario.uid, "contratos", contrato.id, "pagamentos"
  );

  const docRef = await addDoc(ref, {
    contratoId: contrato.id,
    clienteId: contrato.clienteId,
    clienteNome: contrato.clienteNome,
    parcelaNumero: parcelaNumero !== undefined ? parcelaNumero : null,
    valorRecebido: Number(valorRecebido) || 0,
    tipoRecebimento,
    jurosRecebidos: Number(jurosRecebidos) || 0,
    principalAbatido: Number(principalAbatido) || 0,
    dataRecebimento,
    observacao,
    saldoAntes: Number(saldoAntes) || 0,
    saldoDepois: Number(saldoDepois) || 0,
    saldoPrincipalAntes: Number(saldoPrincipalAntes) || 0,
    saldoPrincipalDepois: Number(saldoPrincipalDepois) || 0,
    abatimentoTotalAntes: Number(abatimentoTotalAntes) || 0,
    abatimentoTotalDepois: Number(abatimentoTotalDepois) || 0,
    criadoEm: serverTimestamp(),
  });

  return docRef.id;
}

// Busca todos os pagamentos de um contrato
export async function buscarHistoricoPagamentos(usuario, contratoId) {
  if (!usuario || !contratoId) return [];
  const q = query(
    collection(db, "usuarios", usuario.uid, "contratos", contratoId, "pagamentos"),
    orderBy("criadoEm", "desc")
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
