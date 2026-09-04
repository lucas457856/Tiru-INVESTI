// Serviço de preview de migração de contratos — modo DRY RUN (somente leitura)
// Usa a instância Firebase já autenticada pela aplicação.
// Exponha globalmente: window.previewMigrationDryRun, window.applyMigration e window.getMigrationPreviewUser

import { collection, getDocs, doc, getDoc, updateDoc } from "firebase/firestore";
import { auth, db } from "./firebase";
import { parcelasDoContrato } from "./contractService.js";

function totalAbatimentos(abatimentos) {
  if (!abatimentos || !Array.isArray(abatimentos)) return 0;
  return abatimentos.reduce((s, a) => s + (Number(a?.valor) || 0), 0);
}

function analisarContrato(contrato) {
  const abatimentos = Array.isArray(contrato.abatimentos) ? contrato.abatimentos : [];
  const abatimentoTotal = totalAbatimentos(abatimentos);
  const valorEmprestado = Number(contrato.valorEmprestado) || 0;
  const totalParcelas = Number(contrato.numeroParcelas) || 1;

  const parcelasPagasExistentes = Number(contrato.parcelasPagas) || 0;
  const valorRecebidoExistente = Number(contrato.valorRecebido) || 0;

  const abatimentosComParcela = abatimentos.filter(
    (a) => a.parcelaNumero !== undefined && a.parcelaNumero !== null
  );
  const numerosComAbatimento = [
    ...new Set(abatimentosComParcela.map((a) => Number(a.parcelaNumero))),
  ];
  const abatimentoComParcelaTotal = abatimentosComParcela.reduce(
    (s, a) => s + (Number(a?.valor) || 0),
    0
  );

  const abatimentosSemParcela = abatimentos.filter(
    (a) => a.parcelaNumero === undefined || a.parcelaNumero === null
  );

  const casosEspeciais = [];

  // 1. Multiplos abatimentos na mesma parcela
  const contagemPorParcela = {};
  abatimentosComParcela.forEach((a) => {
    const num = Number(a.parcelaNumero);
    contagemPorParcela[num] = (contagemPorParcela[num] || 0) + 1;
  });
  const parcelasMultiplos = Object.entries(contagemPorParcela)
    .filter(([num, count]) => count > 1)
    .map(([num]) => Number(num));

  if (parcelasMultiplos.length > 0) {
    casosEspeciais.push(
      `Multiplos abatimentos na mesma parcela: ${parcelasMultiplos.join(", ")}`
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
        `valorRecebido (${valorRecebidoExistente}) < abatamentoTotal (${abatimentoComParcelaTotal}) — parcialmente contabilizado`
      );
    } else if (valorRecebidoExistente > abatimentoComParcelaTotal) {
      // valorRecebido > abatamento → houve pagamentos reais (não apenas abatimentos)
      // Não marca como revisao obrigatória: tenta corrigir numericamente abaixo
      const pagamentoExcedente = valorRecebidoExistente - abatimentoComParcelaTotal;
      const valorBaseParcelaTmp =
        valorEmprestado > 0 && totalParcelas > 0
          ? valorEmprestado / totalParcelas
          : Number(contrato.valorParcela) || 0;
      const jurosPorParcelaTmp = valorEmprestado * (Number(contrato.juros) || 0) / 100;
      const valorParcelaCompleta = valorBaseParcelaTmp + jurosPorParcelaTmp;
      if (valorParcelaCompleta > 0 && pagamentoExcedente >= valorParcelaCompleta * 0.5) {
        // Excedente próximo a uma parcela completa → era um pagamento real
        casosEspeciais.push(
          `valorRecebido (${valorRecebidoExistente}) > abatamentoComParcela (${abatimentoComParcelaTotal}) — inclui pagamentos reais de parcelas`
        );
      } else {
        casosEspeciais.push(
          `valorRecebido (${valorRecebidoExistente}) > abatamentoComParcela (${abatimentoComParcelaTotal}) — excesso não corresponde a parcela completa, revisão manual necessária`
        );
      }
    }
  }

  // Estado correto
  let parcelasPagasCorreto =
    numerosComAbatimento.length > 0
      ? Math.max(parcelasPagasExistentes, numerosComAbatimento.length)
      : parcelasPagasExistentes;

  // Se valorRecebido > abatamentoComParcelaTotal, havia pagamento(es) real(es)
  // que deveriam ter incrementado parcelasPagas
  if (valorRecebidoExistente > 0 && abatimentoComParcelaTotal > 0 && valorRecebidoExistente > abatimentoComParcelaTotal) {
    const pagamentoExcedente = valorRecebidoExistente - abatimentoComParcelaTotal;
    const valorBaseParcela =
      valorEmprestado > 0 && totalParcelas > 0
        ? valorEmprestado / totalParcelas
        : Number(contrato.valorParcela) || 0;
    const jurosPorParcela = valorEmprestado * (Number(contrato.juros) || 0) / 100;
    const valorParcelaCompleta = valorBaseParcela + jurosPorParcela;
    if (valorParcelaCompleta > 0 && pagamentoExcedente >= valorParcelaCompleta * 0.5) {
      // Excedente próximo a uma parcela completa → parcelasPagas deve refletir isso
      parcelasPagasCorreto = Math.max(parcelasPagasCorreto, 1);
    }
  }

  // valorRecebido correto: abatimentos com parcelaNumero não contabilizados ainda
  const abatimentoQueNaoFoiContado = Math.max(
    0,
    abatimentoComParcelaTotal - valorRecebidoExistente
  );
  const valorRecebidoCorreto =
    valorRecebidoExistente + abatimentoQueNaoFoiContado;

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

  // Campos a serem atualizados — SOMENTE parcelasPagas e valorRecebido
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

function exibirResumo(contrato, analise, titulo = "CONTRATO") {
  console.groupCollapsed(
    `%c${titulo}: ${contrato.id}`,
    "font-weight: bold; font-size: 1.1em;"
  );

  console.log("[ANTES]");
  console.log(`  parcelasPagas:    ${contrato.parcelasPagas ?? 0}`);
  console.log(`  valorRecebido:    ${formatarMoeda(contrato.valorRecebido)}`);
  console.log(`  saldoPrincipal:   ${formatarMoeda(contrato.saldoPrincipal)}`);
  console.log(`  quitado:          ${contrato.quitado}`);
  console.log(`  dataProximo:      ${contrato.dataProximo || "N/A"}`);
  console.log(
    `  abatimentos (${contrato.abatimentos?.length || 0}):\n` +
      `${JSON.stringify(contrato.abatimentos, null, 4)}`
  );

  console.log("\n[ABATIMENTOS REGISTRADOS]");
  const abatimentos = Array.isArray(contrato.abatimentos) ? contrato.abatimentos : [];
  abatimentos.forEach((a, i) => {
    console.log(
      `  [${i + 1}] parcelaNumero: ${a.parcelaNumero ?? "-"}, ` +
        `valor: ${formatarMoeda(a.valor)}, data: ${a.data || "N/A"}` +
        `${a.observacao ? `, obs: ${a.observacao}` : ""}`
    );
  });
  console.log(`  TOTAL abatimentos: ${formatarMoeda(analise.abatimentoTotal)}`);

  if (analise.casosEspeciais.length > 0) {
    console.log("\n[⚠ REVISAO NECESSARIA]");
    analise.casosEspeciais.forEach((c) => console.log(`  - ${c}`));
    console.log("  (Nao sera corrigido automaticamente — requer analise manual)");
  }

  if (analise.inconsistencias.length > 0) {
    console.log("\n[DEPOIS — PROPOSTO]");
    console.log(`  parcelasPagas:    ${analise.parcelasPagasCorreto}`);
    console.log(`  valorRecebido:    ${formatarMoeda(analise.valorRecebidoCorreto)}`);
    console.log(`  saldoPrincipal:   ${formatarMoeda(contrato.saldoPrincipal)} (nao alterado)`);
    console.log(
      `  abatimentos:      ${JSON.stringify(contrato.abatimentos)} (nao alterado)`
    );

    console.log("\n[INCONSISTENCIAS]");
    analise.inconsistencias.forEach((inc) => console.log(`  - ${inc}`));

    console.log("\n[CAMPOS QUE SERIAM ALTERADOS]");
    analise.camposASerAtualizados.forEach((c) => console.log(`  - ${c}`));

    console.log(
      `\n[PARCELAS afetadas pelos abatimentos]: ${analise.numerosComAbatimento.join(", ")}`
    );
  } else {
    console.log("\n[STATUS: CONSISTENTE — nada a migrar]");
  }

  console.groupEnd();
}

// Exponha temporariamente para verificar usuario autenticado no console
window.getMigrationPreviewUser = () => auth.currentUser;

/**
 * Função principal — executa o DRY RUN no Firestore
 *
 * @param {string} targetUid - UID do usuario no Firestore (do auth.currentUser.uid)
 * @param {string|null} targetContractId - ID do contrato especifico (ou null para todos)
 */
window.previewMigrationDryRun = async function (
  targetUid,
  targetContractId = null
) {
  // Se UID nao informado, tenta detectar automaticamente
  if (!targetUid) {
    const user = auth.currentUser;
    if (!user) return;
    targetUid = user.uid;
  }

  // Valida autenticacao
  const user = auth.currentUser;
  if (!user) {
    console.error("ERRO: Nenhum usuario autenticado no Firebase.");
    console.error("Faca login na aplicacao antes de executar o DRY RUN.");
    console.error("Verifique: window.getMigrationPreviewUser()");
    return;
  }

  if (user.uid !== targetUid) {
    console.error("ERRO: UID informado nao corresponde ao usuario logado.");
    console.error(`UID informado: ${targetUid}`);
    console.error(`UID logado:    ${user.uid}`);
    console.error("Use: await window.previewMigrationDryRun(window.getMigrationPreviewUser().uid)");
    return;
  }

  console.log("=".repeat(80));
  console.log("MIGRACAO DE CONTRATOS — MODO DRY RUN (preview)");
  console.log("=".repeat(80));
  console.log("Este script NAO modifica nada no Firestore. Apenas le e exibe o preview.");
  console.log(`Usuario autenticado: ${user.email} (${user.uid})`);
  console.log("");

  let contratos = [];

  if (targetContractId) {
    console.log(`Procurando contrato: uid=${targetUid}, contractId=${targetContractId}`);
    try {
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
    } catch (err) {
      console.error("ERRO ao ler contrato:", err.message);
      console.error("Possivelmente as regras de seguranca do Firestore negaram acesso.");
      console.error(`Verifique se request.auth.uid corresponde a '${targetUid}'`);
      return;
    }
  } else {
    console.log(`Listando contratos do usuario: ${targetUid}`);
    try {
      const snapshot = await getDocs(
        collection(db, "usuarios", targetUid, "contratos")
      );
      snapshot.forEach((doc) => {
        const c = { id: doc.id, uid: targetUid, ...doc.data() };
        if (Array.isArray(c.abatimentos) && c.abatimentos.length > 0) {
          contratos.push(c);
        }
      });
    } catch (err) {
      console.error("ERRO ao listar contratos:", err.message);
      console.error("Possivelmente as regras de seguranca do Firestore negaram acesso.");
      console.error(`Verifique se request.auth.uid corresponde a '${targetUid}'`);
      return;
    }
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
      exibirResumo(contrato, analise);
    }
  }

  if (revisao.length > 0) {
    console.log(`\n[CONTRATOS REQUEREM REVISAO MANUAL — migracao NAO aplicada automaticamente]`);
    for (const { contrato, analise } of revisao) {
      exibirResumo(contrato, analise, "CONTRATO (REVISAO NECESSARIA)");
    }
  }

  if (consistentes.length > 0) {
    console.log(`\n[CONTRATOS CONSISTENTES — nada a migrar]`);
    consistentes.forEach(({ contrato }) => {
      console.log(`  - ${contrato.id}`);
    });
  }

  // Resumo final
  console.log("\n" + "=".repeat(80));
  console.log("RESUMO");
  console.log("=".repeat(80));
  console.log(`  Total de contratos com abatimentos:     ${contratos.length}`);
  console.log(`  Contratos com inconsistencias simples:  ${simples.length}`);
  console.log(`  Contratos com revisao necessaria:       ${revisao.length}`);
  console.log(`  Contratos ja consistentes:              ${consistentes.length}`);

  if (revisao.length > 0) {
    console.log(`\n  ATENCAO: ${revisao.length} contrato(s) requer(em) revisao manual.`);
    console.log("  Eles NAO serao migrados automaticamente. Revise antes de aplicar.");
  }

  console.log("  Este foi um DRY RUN — NENHUMA alteracao foi feita no Firestore.");
  console.log("=".repeat(80));

  return {
    total: contratos.length,
    simples,
    revisao,
    consistentes,
  };
};

/**
 * Aplica a migracao em contratos com inconsistencias simples.
 * Pula contratos que requerem revisao manual.
 *
 * @param {string} targetUid - UID do usuario no Firestore
 * @param {string|null} targetContractId - ID do contrato especifico (ou null para todos)
 */
window.applyMigration = async function (
  targetUid,
  targetContractId = null
) {
  if (!targetUid) {
    const user = auth.currentUser;
    if (user) {
      targetUid = user.uid;
    } else {
      return;
    }
  }

  const user = auth.currentUser;
  if (!user) {
    console.error("ERRO: Nenhum usuario autenticado no Firebase.");
    return;
  }
  if (user.uid !== targetUid) {
    console.error("ERRO: UID informado nao corresponde ao usuario logado.");
    return;
  }

  console.log("=".repeat(80));
  console.log("MIGRACAO DE CONTRATOS — MODO APPLY (escrita)");
  console.log("=".repeat(80));
  console.warn("ATENCAO: Este script IRA modificar documentos no Firestore.");
  console.warn("Altera SOMENTE parcelasPagas e valorRecebido. Preserva abatimentos e saldoPrincipal.");
  console.log("");

  // Primeiro: DRY RUN para obter a lista de contratos
  const result = await previewMigrationDryRunInternal(targetUid, targetContractId);
  if (!result || result.simples.length === 0) {
    console.log("Nenhum contrato com inconsistencias simples para migrar.");
    return;
  }

  const updateCount = await window.__applyMigrationToContracts(result.simples, targetUid);
  console.log(`\nMigracao concluida: ${updateCount} contrato(s) atualizado(s).`);
  console.log("=".repeat(80));

  return { atualizados: updateCount, contratos: result.simples };
};

// Funcao interna: faz a leitura dos contratos e retorna as analises (sem logs de preview)
async function previewMigrationDryRunInternal(targetUid, targetContractId) {
  let contratos = [];

  if (targetContractId) {
    const contratoDoc = await getDoc(
      doc(db, "usuarios", targetUid, "contratos", targetContractId)
    );
    if (!contratoDoc.exists()) {
      console.log(`Contrato ${targetContractId} nao encontrado.`);
      return null;
    }
    const c = { id: contratoDoc.id, uid: targetUid, ...contratoDoc.data() };
    if (Array.isArray(c.abatimentos) && c.abatimentos.length > 0) {
      contratos = [c];
    } else {
      console.log("Este contrato nao tem abatimentos. Nada a migrar.");
      return null;
    }
  } else {
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

  const simples = [];
  const revisao = [];
  const consistentes = [];

  for (const contrato of contratos) {
    const analise = analisarContrato(contrato);
    if (analise.inconsistencias.length === 0) {
      consistentes.push({ contrato, analise });
    } else if (analise.revisaoNecessaria) {
      revisao.push({ contrato, analise });
    } else {
      simples.push({ contrato, analise });
    }
  }

  return { total: contratos.length, simples, revisao, consistentes };
}

// Aplica a migracao nos contratos simples (chamado internamente)
/**
 * Inspeciona um contrato específico — leitura apenas, NÃO modifica nada.
 * Mostra todos os campos relevantes e calcula a distribuição esperada de parcelas.
 *
 * @param {string} targetUid - UID do usuario no Firestore
 * @param {string} targetContractId - ID do contrato especifico
 */
window.inspectContract = async function (targetUid, targetContractId) {
  const user = auth.currentUser;
  if (!user) {
    console.error("ERRO: Nenhum usuario autenticado no Firebase.");
    return;
  }
  if (user.uid !== targetUid) {
    console.error("ERRO: UID informado nao corresponde ao usuario logado.");
    return;
  }
  if (!targetContractId) {
    console.error("ERRO: Informe o ID do contrato. Uso: await window.inspectContract(uid, 'contract-id')");
    return;
  }

  console.log("=".repeat(80));
  console.log(`INSPECAO DE CONTRATO: ${targetContractId}`);
  console.log("=".repeat(80));

  // Lê o contrato do Firestore
  const contratoDoc = await getDoc(
    doc(db, "usuarios", targetUid, "contratos", targetContractId)
  );

  if (!contratoDoc.exists()) {
    console.log(`Contrato ${targetContractId} nao encontrado.`);
    return null;
  }

  const contrato = { id: contratoDoc.id, uid: targetUid, ...contratoDoc.data() };

  // Dump de todos os campos relevantes
  console.log("\n[DADOS DO CONTRATO — estado atual no Firestore]");
  console.log(`  id:                  ${contrato.id}`);
  console.log(`  uid:                 ${contrato.uid}`);
  console.log(`  valorEmprestado:     ${formatarMoeda(contrato.valorEmprestado)}`);
  console.log(`  numeroParcelas:      ${contrato.numeroParcelas}`);
  console.log(`  juros:               ${contrato.juros}%`);
  console.log(`  valorParcela:        ${contrato.valorParcela ?? "(nao definido)"}`);
  console.log(`  parcelasPagas:       ${contrato.parcelasPagas ?? 0}`);
  console.log(`  valorRecebido:       ${formatarMoeda(contrato.valorRecebido)}`);
  console.log(`  saldoPrincipal:      ${formatarMoeda(contrato.saldoPrincipal)}`);
  console.log(`  abatimentoTotal:     ${formatarMoeda(contrato.abatimentoTotal ?? 0)}`);
  console.log(`  jurosRecebidos:      ${formatarMoeda(contrato.jurosRecebidos)}`);
  console.log(`  quitado:             ${contrato.quitado}`);
  console.log(`  dataProximo:         ${contrato.dataProximo || "N/A"}`);
  console.log(`  dataPrimeiraParcela: ${contrato.dataPrimeiraParcela || "N/A"}`);
  console.log(`  frequencia:          ${contrato.frequencia || "N/A"}`);
  console.log(`  clienteId:           ${contrato.clienteId || "N/A"}`);
  console.log(`  cobrarJurosAtraso:   ${contrato.cobrarJurosAtraso}`);
  console.log(`  jurosAtrasoValor:    ${contrato.jurosAtrasoValor ?? "N/A"}`);

  console.log("\n[ABATIMENTOS (array completo)]");
  const abatimentos = Array.isArray(contrato.abatimentos) ? contrato.abatimentos : [];
  if (abatimentos.length === 0) {
    console.log("  (nenhum)");
  } else {
    abatimentos.forEach((a, i) => {
      console.log(
        `  [${i + 1}] parcelaNumero: ${a.parcelaNumero ?? "(sem referencia)"}, ` +
        `valor: ${formatarMoeda(a.valor)}, data: ${a.data || "N/A"}` +
        `${a.observacao ? `, obs: ${a.observacao}` : ""}`
      );
    });
    console.log(`  TOTAL abatimentos: ${formatarMoeda(totalAbatimentos(abatimentos))}`);
  }

  // Analise financeira
  const analise = analisarContrato(contrato);

  // Detalhamento do calculo de parcelas
  const parcelasCalc = parcelasDoContratoGlobal(contrato);
  console.log("\n[CALCULO DE PARCELAS — baseado no estado ATUAL do Firestore]");
  console.log(`  valorBaseParcela = ${contrato.valorEmprestado} / ${contrato.numeroParcelas} = ${formatarMoeda(contrato.valorEmprestado / contrato.numeroParcelas)}`);
  console.log(`  jurosPorParcela = ${contrato.valorEmprestado} x (${contrato.juros}/100) = ${formatarMoeda(contrato.valorEmprestado * (Number(contrato.juros) || 0) / 100)}`);
  console.log(`  valorParcelaCompleta = ${formatarMoeda((contrato.valorEmprestado / contrato.numeroParcelas) + (contrato.valorEmprestado * (Number(contrato.juros) || 0) / 100))}`);

  console.log("\n[DISTRIBUICAO DE VALOR RECEBIDO]");
  const pagas = Number(contrato.parcelasPagas) || 0;
  const valorRecebido = Number(contrato.valorRecebido) || 0;
  console.log(`  parcelasPagas: ${pagas}`);
  console.log(`  valorRecebido: ${formatarMoeda(valorRecebido)}`);
  if (pagas > 0 && valorRecebido > 0) {
    console.log(`  valorRecebido / parcelasPagas = ${formatarMoeda(valorRecebido / pagas)} (valor por parcela paga)`);
  }

  console.log("\n[ANALISE DE INCONSISTENCIAS]");
  if (analise.inconsistencias.length === 0) {
    console.log("  CONSISTENTE — nada a migrar");
  } else {
    analise.inconsistencias.forEach((inc) => console.log(`  - ${inc}`));
  }
  if (analise.casosEspeciais.length > 0) {
    console.log("\n[REVISAO NECESSARIA]");
    analise.casosEspeciais.forEach((c) => console.log(`  - ${c}`));
  }

  console.log("\n[PROPOSTA DE MIGRACAO]");
  console.log(`  parcelasPagas:   ${contrato.parcelasPagas ?? 0} -> ${analise.parcelasPagasCorreto}`);
  console.log(`  valorRecebido:   ${formatarMoeda(contrato.valorRecebido)} -> ${formatarMoeda(analise.valorRecebidoCorreto)}`);
  console.log(`  saldoPrincipal:  ${formatarMoeda(contrato.saldoPrincipal)} (preservado)`);
  console.log(`  campos a atualizar: ${analise.camposASerAtualizados.join(", ") || "(nenhum)"}`);

  // Parcelas calculadas COM o estado corrigido (para preview da UI)
  const contratoCorrigido = {
    ...contrato,
    parcelasPagas: analise.parcelasPagasCorreto,
    valorRecebido: analise.valorRecebidoCorreto,
  };
  const parcelasCorrigidas = parcelasDoContratoGlobal(contratoCorrigido);

  console.log("\n[PARCELAS APOS MIGRACAO PROPOSTA]");
  parcelasCorrigidas.forEach((p) => {
    console.log(
      `  Parcela ${p.numero}: ${p.status}, valor=${formatarMoeda(p.valor)}, recebido=${formatarMoeda(p.recebido || 0)}`
    );
  });

  console.log("\n" + "=".repeat(80));
  console.log("ESTA FOI UMA LEITURA — NENHUMA ALTERACAO FOI FEITA NO FIRESTORE.");
  console.log("=".repeat(80));

  return { contrato, analise, parcelasCorrigidas };
};

function parcelasDoContratoGlobal(contrato, hoje = new Date()) {
  // Delega para `parcelasDoContrato` de contractService.js, que aplica a
  // sobrescrita CIRÚRGICA sobre `calcularParcelas`: preserva o valor original
  // das parcelas futuras quando não há abatimento explícito, e recalcula
  // com `valorEmprestado - abatimentoTotal` como base quando há (juros_parte_divida).
  return parcelasDoContrato(contrato, hoje);
}

window.__applyMigrationToContracts = async function (simples, targetUid) {
  let updateCount = 0;

  for (const { contrato, analise } of simples) {
    if (analise.camposASerAtualizados.length === 0) continue;

    const updateData = {};
    if (analise.camposASerAtualizados.includes("parcelasPagas")) {
      updateData.parcelasPagas = analise.parcelasPagasCorreto;
    }
    if (analise.camposASerAtualizados.includes("valorRecebido")) {
      updateData.valorRecebido = analise.valorRecebidoCorreto;
    }

    console.log(`\nAplicando contrato ${contrato.id}...`);
    console.log(`  Update: ${JSON.stringify(updateData)}`);

    try {
      const contratoRef = doc(db, "usuarios", targetUid, "contratos", contrato.id);
      await updateDoc(contratoRef, updateData);

      // Verifica idempotencia: rele as e analisa novamente
      const contratoPosDoc = await getDoc(contratoRef);
      const contratoPos = { id: contratoPosDoc.id, uid: targetUid, ...contratoPosDoc.data() };
      const estadoPos = analisarContrato(contratoPos);

      const abatimentosPreservados =
        JSON.stringify(contrato.abatimentos) ===
        JSON.stringify(contratoPos.abatimentos || contrato.abatimentos);

      console.log(`  OK: atualizado.`);
      console.log(`    Abatimentos preservados: ${abatimentosPreservados ? "SIM" : "NAO"}`);
      console.log(
        `    Idempotente: ${estadoPos.camposASerAtualizados.length === 0 ? "SIM" : "NAO"}`
      );
      if (!abatimentosPreservados) {
        console.error("  ERRO: Abatimentos foram alterados! Revise manualmente.");
      }
      updateCount += 1;
    } catch (err) {
      console.error(`  ERRO ao atualizar ${contrato.id}:`, err.message);
    }
  }

  return updateCount;
};
