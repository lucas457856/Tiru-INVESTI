/**
 * MIGRACAO DE CONTRATOS — MODO DRY RUN (PREVIEW) — Versao Browser
 *
 * Execute este script no console do navegador (F12 -> Console) enquanto
 * estiver autenticado na app. O usuario ja esta logado, entao o Firestore
 * client SDK funciona normalmente.
 *
 * USO:
 *   // No console do navegador, copie e cole todo este conteudo, depois:
 *   await window.previewMigrationDryRun(uid);               // todos os contratos do usuario
 *   await window.previewMigrationDryRun(uid, contractId);    // contrato especifico
 *
 * Este script NAO modifica nada no Firestore. Apenas le e exibe o preview.
 *
 * PARA APLICAR A MIGRACAO (apos aprovacao):
 *   await window.previewMigrationDryRun(uid, null, true);    // apply todos os contratos
 *   await window.previewMigrationDryRun(uid, contractId, true); // apply contrato especifico
 */

import { collection, getDocs, doc, getDoc, updateDoc, serverTimestamp } from "firebase/firestore";
import { db } from "./src/services/firebase.js";

/**
 * Soma total de abatimentos em um array
 */
function totalAbatimentos(abatimentos) {
  if (!abatimentos || !Array.isArray(abatimentos)) return 0;
  return abatimentos.reduce((s, a) => s + (Number(a?.valor) || 0), 0);
}

/**
 * Analisa um contrato e detecta casos especiais, inconsistencias e o estado correto.
 */
function analisarContrato(contrato) {
  const abatimentos = Array.isArray(contrato.abatimentos) ? contrato.abatimentos : [];
  const abatimentoTotal = totalAbatimentos(abatimentos);
  const valorEmprestado = Number(contrato.valorEmprestado) || 0;
  const totalParcelas = Number(contrato.numeroParcelas) || 1;

  const parcelasPagasExistentes = Number(contrato.parcelasPagas) || 0;
  const valorRecebidoExistente = Number(contrato.valorRecebido) || 0;

  // Abatimentos com parcelaNumero definido (pagamento parcial que quitou parcela)
  const abatimentosComParcela = abatimentos.filter(
    (a) => a.parcelaNumero !== undefined && a.parcelaNumero !== null
  );
  const numerosComAbatimento = [...new Set(abatimentosComParcela.map((a) => Number(a.parcelaNumero)))];
  const abatimentoComParcelaTotal = abatimentosComParcela.reduce(
    (s, a) => s + (Number(a?.valor) || 0),
    0
  );

  // Abatimentos sem parcelaNumero (abatimento geral)
  const abatimentosSemParcela = abatimentos.filter(
    (a) => a.parcelaNumero === undefined || a.parcelaNumero === null
  );

  // Detecta casos especiais
  const casosEspeciais = [];

  // 1. Multiplos abatimentos na mesma parcela
  const contagemPorParcela = {};
  abatimentosComParcela.forEach((a) => {
    const num = Number(a.parcelaNumero);
    contagemPorParcela[num] = (contagemPorParcela[num] || 0) + 1;
  });
  const parcelasMultiplosAbatimentos = Object.entries(contagemPorParcela)
    .filter(([num, count]) => count > 1)
    .map(([num]) => Number(num));

  if (parcelasMultiplosAbatimentos.length > 0) {
    casosEspeciais.push(
      `Multiplos abatimentos na mesma parcela: ${parcelasMultiplosAbatimentos.join(", ")}`
    );
  }

  // 2. Abatimentos em parcelas diferentes
  if (numerosComAbatimento.length > 1) {
    casosEspeciais.push(
      `Abatimentos em ${numerosComAbatimento.length} parcelas diferentes: ${numerosComAbatimento.join(", ")}`
    );
  }

  // 3. Abatimentos sem parcelaNumero
  if (abatimentosSemParcela.length > 0) {
    casosEspeciais.push(
      `${abatimentosSemParcela.length} abatimento(s) sem parcelaNumero (abatimento geral)`
    );
  }

  // 4. Verifica se parcelasPagas ja esta contabilizado parcialmente
  if (parcelasPagasExistentes > 0 && numerosComAbatimento.length > 0) {
    if (parcelasPagasExistentes < numerosComAbatimento.length) {
      casosEspeciais.push(
        `parcelasPagas (${parcelasPagasExistentes}) < abatimentos com parcela (${numerosComAbatimento.length})`
      );
    } else if (parcelasPagasExistentes > numerosComAbatimento.length) {
      casosEspeciais.push(
        `parcelasPagas (${parcelasPagasExistentes}) > abatimentos com parcela (${numerosComAbatimento.length}) — pode incluir pagamentos normais`
      );
    }
  }

  // 5. valorRecebido ja parcialmente contabilizado
  if (valorRecebidoExistente > 0 && abatimentoComParcelaTotal > 0) {
    if (valorRecebidoExistente < abatimentoComParcelaTotal) {
      casosEspeciais.push(
        `valorRecebido (${valorRecebidoExistente}) < abatimentoTotal (${abatimentoComParcelaTotal}) — valorRecebido parcialmente contabilizado`
      );
    } else if (valorRecebidoExistente > abatimentoComParcelaTotal) {
      casosEspeciais.push(
        `valorRecebido (${valorRecebidoExistente}) > abatamentoComParcela (${abatimentoComParcelaTotal}) — inclui pagamentos alem de abatimentos`
      );
    }
  }

  // Estado correto
  const parcelasPagasCorreto =
    numerosComAbatimento.length > 0
      ? Math.max(parcelasPagasExistentes, numerosComAbatimento.length)
      : parcelasPagasExistentes;

  const abatimentoQueNaoFoiContado = Math.max(
    0,
    abatimentoComParcelaTotal - valorRecebidoExistente
  );
  const valorRecebidoCorreto = valorRecebidoExistente + abatimentoQueNaoFoiContado;

  // Inconsistencias
  const inconsistencias = [];
  const temAbatimentoComParcela = numerosComAbatimento.length > 0;

  if (temAbatimentoComParcela) {
    if (parcelasPagasCorreto !== parcelasPagasExistentes) {
      inconsistencias.push(
        `parcelasPagas: ${parcelasPagasExistentes} -> ${parcelasPagasCorreto}`
      );
    }
    if (
      Math.round(valorRecebidoCorreto * 100) / 100 !==
      Math.round(valorRecebidoExistente * 100) / 100
    ) {
      inconsistencias.push(
        `valorRecebido: ${valorRecebidoExistente} -> ${
          Math.round(valorRecebidoCorreto * 100) / 100
        }`
      );
    }
  }

  if (abatimentoTotal > valorEmprestado) {
    inconsistencias.push(
      `ATENCAO: abatimentoTotal (${abatimentoTotal}) > valorEmprestado (${valorEmprestado})`
    );
  }

  const camposASerAtualizados = [];
  if (temAbatimentoComParcela && parcelasPagasCorreto !== parcelasPagasExistentes) {
    camposASerAtualizados.push("parcelasPagas");
  }
  if (
    temAbatimentoComParcela &&
    Math.round(valorRecebidoCorreto * 100) / 100 !==
      Math.round(valorRecebidoExistente * 100) / 100
  ) {
    camposASerAtualizados.push("valorRecebido");
  }

  return {
    parcelasPagasCorreto,
    valorRecebidoCorreto: Math.round(valorRecebidoCorreto * 100) / 100,
    abatimentoTotal: Math.round(abatimentoTotal * 100) / 100,
    abatimentoComParcelaTotal: Math.round(abatimentoComParcelaTotal * 100) / 100,
    numerosComAbatimento,
    inconsistencias,
    camposASerAtualizados,
    casosEspeciais,
    revisaoNecessaria: casosEspeciais.length > 0,
  };
}

function formatarMoeda(v) {
  return (Number(v) || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

/**
 * Funcao principal — executa o DRY RUN no Firestore
 *
 * @param {string} targetUid - UID do usuario no Firestore
 * @param {string|null} targetContractId - ID do contrato especifico (ou null para todos)
 * @param {boolean} doApply - Se true, aplica a migracao (usar com cuidado!)
 */
window.previewMigrationDryRun = async function (
  targetUid,
  targetContractId = null,
  doApply = false
) {
  if (!targetUid) {
    console.error("ERRO: Informe o UID do usuario.");
    return;
  }

  const modo = doApply ? "APPLY (escrita)" : "DRY RUN (preview)";
  console.log("=".repeat(80));
  console.log(`MIGRACAO DE CONTRATOS - MODO ${modo.toUpperCase()}`);
  console.log("=".repeat(80));

  if (doApply) {
    console.warn("ATENCAO: Este script IRA modificar documentos no Firestore.");
  } else {
    console.log("Este script NAO modifica nada. Apenas exibe o preview.");
  }
  console.log("");

  let contratos = [];

  if (targetContractId) {
    console.log(`Procurando contrato: uid=${targetUid}, contractId=${targetContractId}`);
    const contratoDoc = await getDoc(
      doc(db, "usuarios", targetUid, "contratos", targetContractId)
    );
    if (!contratoDoc.exists()) {
      console.log(`Contrato ${targetContractId} nao encontrado.`);
      return;
    }
    const c = { id: contratoDoc.id, uid: targetUid, ...contratoDoc.data() };
    if (Array.isArray(c.abatimentos) && c.abatimentos.length > 0) {
      contratos = [c];
    } else {
      console.log("Este contrato nao tem abatimentos. Nada a migrar.");
      return;
    }
  } else {
    console.log(`Listando contratos do usuario: ${targetUid}`);
    const snapshot = await getDocs(
      collection(db, "usuarios", targetUid, "contratos")
    );
    snapshot.forEach((doc) => {
      const c = { id: doc.id, uid: targetUid, ...doc.data() };
      if (Array.isArray(c.abatimentos) && c.abatimentos.length > 0) {
        contratos.push(c);
      }
    });
  }

  console.log(`\nEncontrados ${contratos.length} contrato(s) com abatimentos registrados.`);

  if (contratos.length === 0) {
    console.log("Nenhum contrato com abatimentos encontrado. Nada a migrar.");
    return;
  }

  // Analisa todos os contratos
  const analises = [];
  for (const contrato of contratos) {
    const analise = analisarContrato(contrato);
    analises.push({ contrato, analise });
  }

  // Separa por categoria
  const simples = [];
  const revisao = [];
  const consistentes = [];

  for (const { contrato, analise } of analises) {
    if (analise.inconsistencias.length === 0) {
      consistentes.push({ contrato, analise });
    } else if (analise.revisaoNecessaria) {
      revisao.push({ contrato, analise });
    } else {
      simples.push({ contrato, analise });
    }
  }

  // Exibe preview
  console.log("\n" + "=".repeat(80));
  console.log("FASE 1: ANALISE DE CONTRATOS");
  console.log("=".repeat(80));

  if (simples.length > 0) {
    console.log(`\n[CONTRATOS COM INCONSISTENCIAS SIMPLES — migracao proposta]`);
    for (const { contrato, analise } of simples) {
      console.log("\n" + "-".repeat(80));
      console.log(`CONTRATO: ${contrato.id}`);
      console.log("-".repeat(80));

      console.log("\n[ANTES]");
      console.log(`  parcelasPagas:       ${contrato.parcelasPagas ?? 0}`);
      console.log(`  valorRecebido:       ${formatarMoeda(contrato.valorRecebido)}`);
      console.log(`  saldoPrincipal:      ${formatarMoeda(contrato.saldoPrincipal)}`);
      console.log(`  abatimentos:         ${JSON.stringify(contrato.abatimentos)}`);

      console.log("\n[DEPOIS - PROPOSTO]");
      console.log(`  parcelasPagas:       ${analise.parcelasPagasCorreto}`);
      console.log(`  valorRecebido:       ${formatarMoeda(analise.valorRecebidoCorreto)}`);
      console.log(`  saldoPrincipal:      ${formatarMoeda(contrato.saldoPrincipal)} (nao alterado)`);
      console.log(`  abatimentos:         ${JSON.stringify(contrato.abatimentos)} (nao alterado)`);

      console.log("\n[INCONSISTENCIAS]");
      analise.inconsistencias.forEach((inc) => console.log(`  - ${inc}`));

      console.log("\n[CAMPOS QUE SERIAM ALTERADOS]");
      analise.camposASerAtualizados.forEach((c) => console.log(`  - ${c}`));

      const parcelasComAbatimento = analise.numerosComAbatimento;
      console.log(`\n[PARCELAS afetadas pelos abatimentos]: ${parcelasComAbatimento.join(", ")}`);
    }
  }

  if (revisao.length > 0) {
    console.log(`\n[CONTRATOS REQUEREM REVISAO MANUAL — migracao NAO aplicada automaticamente]`);
    for (const { contrato, analise } of revisao) {
      console.log("\n" + "-".repeat(80));
      console.log(`CONTRATO: ${contrato.id} (REVISAO NECESSARIA)`);
      console.log("-".repeat(80));

      console.log("\n[ANTES]");
      console.log(`  parcelasPagas:       ${contrato.parcelasPagas ?? 0}`);
      console.log(`  valorRecebido:       ${formatarMoeda(contrato.valorRecebido)}`);
      console.log(`  saldoPrincipal:      ${formatarMoeda(contrato.saldoPrincipal)}`);
      console.log(`  abatimentos:         ${JSON.stringify(contrato.abatimentos)}`);

      console.log("\n[REVISAO NECESSARIA]");
      analise.casosEspeciais.forEach((c) => console.log(`  - ${c}`));

      console.log("\n[DEPOIS - PROPOSTO (so para referencia)]");
      console.log(`  parcelasPagas:       ${analise.parcelasPagasCorreto}`);
      console.log(`  valorRecebido:       ${formatarMoeda(analise.valorRecebidoCorreto)}`);

      console.log("\n[INCONSISTENCIAS]");
      analise.inconsistencias.forEach((inc) => console.log(`  - ${inc}`));
    }
  }

  if (consistentes.length > 0) {
    console.log(`\n[CONTRATOS CONSISTENTES — nada a migrar]`);
    consistentes.forEach(({ contrato }) => {
      console.log(`  - ${contrato.id}`);
    });
  }

  // Apply
  if (doApply && simples.length > 0) {
    console.log("\n" + "=".repeat(80));
    console.log("FASE 2: APLICANDO MIGRACAO");
    console.log("=".repeat(80));

    for (const { contrato, analise } of simples) {
      if (analise.camposASerAtualizados.length === 0) continue;

      const updateData = {};
      if (analise.camposASerAtualizados.includes("parcelasPagas")) {
        updateData.parcelasPagas = analise.parcelasPagasCorreto;
      }
      if (analise.camposASerAtualizados.includes("valorRecebido")) {
        updateData.valorRecebido = analise.valorRecebidoCorreto;
      }

      console.log(`\nAplicando em ${contrato.id}...`);
      console.log(`  Update: ${JSON.stringify(updateData)}`);

      const contratoRef = doc(db, "usuarios", contrato.uid, "contratos", contrato.id);
      await updateDoc(contratoRef, updateData);
      console.log(`  OK: atualizado.`);
    }

    // Verificacao
    console.log("\n" + "=".repeat(80));
    console.log("FASE 3: VERIFICACAO POS-MIGRACAO");
    console.log("=".repeat(80));

    for (const { contrato, analise } of simples) {
      if (analise.camposASerAtualizados.length === 0) continue;

      const contratoDoc = await getDoc(
        doc(db, "usuarios", contrato.uid, "contratos", contrato.id)
      );
      const contratoPos = { id: contratoDoc.id, uid: contrato.uid, ...contratoDoc.data() };
      const estadoPos = analisarContrato(contratoPos);

      console.log(`\n[${contrato.id}]`);
      console.log(`  parcelasPagas:       ${contratoPos.parcelasPagas} (era ${contrato.parcelasPagas})`);
      console.log(`  valorRecebido:       ${formatarMoeda(contratoPos.valorRecebido)} (era ${formatarMoeda(contrato.valorRecebido)})`);
      console.log(`  saldoPrincipal:      ${formatarMoeda(contratoPos.saldoPrincipal)}`);
      console.log(`  abatimentos:         ${JSON.stringify(contratoPos.abatimentos)}`);
      console.log(`  abatimentos preservados: ${JSON.stringify(contrato.abatimentos) === JSON.stringify(contratoPos.abatimentos) ? "SIM" : "NAO"}`);
      console.log(`  inconsistencias:     ${estadoPos.inconsistencias.length === 0 ? "0 (OK)" : estadoPos.inconsistencias.join(", ")}`);
      console.log(`  idempotente:         ${estadoPos.camposASerAtualizados.length === 0 ? "SIM" : "NAO"}`);
    }
  }

  // Resumo
  console.log("\n" + "=".repeat(80));
  console.log("RESUMO");
  console.log("=".repeat(80));
  console.log(`  Total de contratos com abatimentos:     ${contratos.length}`);
  console.log(`  Contratos com inconsistencias simples:  ${simples.length}`);
  console.log(`  Contratos com revisao necessaria:       ${revisao.length}`);
  console.log(`  Contratos ja consistentes:              ${consistentes.length}`);
  if (doApply) {
    console.log("  Migracao aplicada e verificada.");
  } else {
    console.log("  Para aplicar, execute novamente com doApply=true.");
  }
  console.log("=".repeat(80));

  return {
    total: contratos.length,
    simples,
    revisao,
    consistentes,
  };
};

console.log("[preview-migration-browser.mjs] Carregado. Use:");
console.log("  await previewMigrationDryRun(uid)");
console.log("  await previewMigrationDryRun(uid, contractId)");
console.log("  await previewMigrationDryRun(uid, null, true)  // apply");
