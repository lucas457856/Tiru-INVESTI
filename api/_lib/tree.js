// Helper de exclusão recursiva de subcoleções Firestore.
//
// CONSOLIDAÇÃO: este código estava intencionalmente duplicado em
// `api/auth/delete-employee.js:66-92` e `api/admin/delete-owner.js:80-102`.
// Os dois blocos eram IDÊNTICOS. Esta versão única é importada por
// ambos os handlers. NÃO há mudança de comportamento.
//
// O Admin SDK exige listar as coleções via `listCollections()` e depois
// excluir os documentos em batch. Para garantir que NÃO fiquem
// documentos órfãos, listamos subcoleções em cada nível.

// Limite por operação. Acima disso, a operação precisa ser repetida.
// Admin SDK tem limite de 500 writes por batch — processamos em
// batches internamente. Este limite é apenas um teto de segurança
// contra loop eterno. O valor é 5000 (compatível com o que estava nos
// handlers originais).
const MAX_ITENS_POR_OPERACAO = 5000;

/**
 * Exclui recursivamente todas as subcoleções filhas de um documento.
 *
 * Recebe um DocumentReference do Firebase Admin SDK e chama
 * `listCollections()` sobre ele. NÃO aceita CollectionReference —
 * sub-coleções só existem como filhas de um documento, e a API
 * `listCollections()` é exclusiva de DocumentReference. Para limpar
 * os documentos de uma coleção (top-level ou sub-coleção), itere-a
 * via `.get()` e chame o helper em cada `doc.ref`.
 *
 * @param {import("firebase-admin/firestore").Firestore} dbAdmin
 * @param {import("firebase-admin/firestore").DocumentReference} docRef
 * @param {number} [profundidade=0] Nível de recursão atual (defesa contra ciclos)
 * @returns {Promise<number>} Total de subdocumentos excluídos
 */
export async function excluirSubcolecoesRecursivo(dbAdmin, docRef, profundidade = 0) {
  if (profundidade > 5) return 0; // defesa contra ciclos
  const collections = await docRef.listCollections();
  let total = 0;
  for (const coll of collections) {
    const snap = await coll.limit(MAX_ITENS_POR_OPERACAO).get();
    if (snap.empty) continue;

    // Exclui recursivamente sub-subcoleções PRIMEIRO (post-order)
    for (const subDoc of snap.docs) {
      total += await excluirSubcolecoesRecursivo(dbAdmin, subDoc.ref, profundidade + 1);
    }

    // Em batch de 500 (limite do Firestore)
    const docs = snap.docs;
    for (let i = 0; i < docs.length; i += 500) {
      const batch = dbAdmin.batch();
      const fatia = docs.slice(i, i + 500);
      for (const d of fatia) {
        batch.delete(d.ref);
      }
      await batch.commit();
      total += fatia.length;
    }
  }
  return total;
}
