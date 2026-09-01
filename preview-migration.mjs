/**
 * MIGRACAO DE CONTRATOS — MODO DRY RUN (PREVIEW) — Versão ESM
 *
 * Script para identificar contratos com abatimentos registrados mas
 * campos derivados inconsistentes (parcelasPagas, valorRecebido).
 *
 * USO:
 *   node preview-migration.mjs --mock                                         # preview mock
 *   node preview-migration.mjs --mock --apply --contractId contract-001       # apply mock
 *   node preview-migration.mjs --uid <uid>                                  # preview Firestore
 *   node preview-migration.mjs --uid <uid> --contractId <id>                # preview contrato
 *   node preview-migration.mjs --uid <uid> --contractId <id> --apply        # apply Firestore
 *
 * Para Firestore real, configure previamente:
 *   set FIREBASE_EMAIL=seu@email.com
 *   set FIREBASE_SENHA=senha123
 *
 * REGRA DE MIGRACAO (idempotente):
 *   1. NAO altera o array abatimentos.
 *   2. NAO cria novos abatimentos.
 *   3. NAO duplica valores.
 *   4. Atualiza SOMENTE: parcelasPagas, valorRecebido.
 *   5. saldoPrincipal, dataProximo, quitado NAO sao alterados.
 */

import { initializeApp } from "firebase/app";
import {
  getFirestore,
  collection,
  getDocs,
  doc,
  getDoc,
  updateDoc,
  serverTimestamp,
} from "firebase/firestore";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";

// --- Argumentos ---
const args = process.argv.slice(2);
const uid = args.includes("--uid") ? args[args.indexOf("--uid") + 1] : null;
const contractId =
  args.includes("--contractId") || args.includes("--contractid")
    ? args[args.indexOf("--contractId") + 1] ||
      args[args.indexOf("--contractid") + 1]
    : null;
const mockMode = args.includes("--mock");
const applyMode = args.includes("--apply");

// --- Configuracao Firebase ---
const firebaseConfig = {
  apiKey: "AIzaSyC6StDHxZn5VakxH1MDqiYDKAGx6f1QLJg",
  authDomain: "agt-controller3.firebaseapp.com",
  projectId: "agt-controller3",
  storageBucket: "agt-controller3.firebasestorage.app",
  messagingSenderId: "1015891452736",
  appId: "1:1015891452736:web:42c93a93415ecda4cf90a5",
  measurementId: "G-5NSDLRRKZ9",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// --- Funcoes puras ---

function totalAbatimentos(abatimentos) {
  if (!abatimentos || !Array.isArray(abatimentos)) return 0;
  return abatimentos.reduce((s, a) => s + (Number(a?.valor) || 0), 0);
}

function formatarMoeda(v) {
  return (Number(v) || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
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

  // Abatimentos com parcelaNumero definido
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

  // Abatimentos sem parcelaNumero
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

  // 4. parcelasPagas contabilizado parcialmente
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

  // 5. valorRecebido parcialmente contabilizado
  if (valorRecebidoExistente > 0 && abatimentoComParcelaTotal > 0) {
    if (valorRecebidoExistente < abatimentoComParcelaTotal) {
      casosEspeciais.push(
        `valorRecebido (${valorRecebidoExistente}) < abatamentoComParcela (${abatimentoComParcelaTotal}) — parcialmente contabilizado`
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

/**
 * Exibe o resumo de um contrato
 */
function exibirResumo(contrato, analise, titulo = "CONTRATO") {
  console.log("\n" + "=".repeat(80));
  console.log(`${titulo}: ${contrato.id}`);
  console.log("=".repeat(80));

  console.log("\n[ANTES]");
  console.log(`  parcelasPagas:       ${contrato.parcelasPagas ?? 0}`);
  console.log(`  valorRecebido:       ${formatarMoeda(contrato.valorRecebido)}`);
  console.log(`  saldoPrincipal:      ${formatarMoeda(contrato.saldoPrincipal)}`);
  console.log(`  abatimentos:         ${JSON.stringify(contrato.abatimentos)}`);
  console.log(`  quitado:             ${contrato.quitado}`);
  console.log(`  dataProximo:         ${contrato.dataProximo || "N/A"}`);

  console.log("\n[ABATIMENTOS REGISTRADOS]");
  const abatimentos = Array.isArray(contrato.abatimentos) ? contrato.abatimentos : [];
  abatimentos.forEach((a, i) => {
    console.log(
      `  [${i + 1}] parcelaNumero: ${a.parcelaNumero ?? "-"}, ` +
      `valor: ${formatarMoeda(a.valor)}, data: ${a.data || "N/A"}` +
      `${a.observacao ? `, obs: ${a.observacao}` : ""}`
    );
  });
  console.log(`  TOTAL abatimentos:   ${formatarMoeda(analise.abatimentoTotal)}`);

  if (analise.casosEspeciais.length > 0) {
    console.log("\n[REVISAO NECESSARIA]");
    analise.casosEspeciais.forEach((c) => console.log(`  - ${c}`));
    console.log("  (Nao sera corrigido automaticamente — requer analise manual)");
  }

  if (analise.inconsistencias.length > 0) {
    console.log("\n[DEPOIS — PROPOSTO]");
    console.log(`  parcelasPagas:       ${analise.parcelasPagasCorreto}`);
    console.log(`  valorRecebido:       ${formatarMoeda(analise.valorRecebidoCorreto)}`);
    console.log(`  saldoPrincipal:      ${formatarMoeda(contrato.saldoPrincipal)} (nao alterado)`);
    console.log(`  abatimentos:         ${JSON.stringify(contrato.abatimentos)} (nao alterado)`);

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
}

/**
 * Recalcula parcelas (usando logica equivalente a calcularParcelas)
 */
function recalcularParcelas(contrato, hoje = new Date()) {
  const valorEmprestado = Number(contrato.valorEmprestado) || 0;
  const total = Number(contrato.numeroParcelas) || 0;
  const jurosTaxa = Number(contrato.juros) || 0;

  const valorBaseParcela =
    valorEmprestado > 0 && total > 0
      ? valorEmprestado / total
      : Number(contrato.valorParcela) || 0;

  const jurosPorParcela = valorEmprestado * (jurosTaxa / 100);
  const pagas = contrato.quitado ? total : Number(contrato.parcelasPagas) || 0;

  const lista = [];
  const primeira = contrato.dataPrimeiraParcela
    ? new Date(`${contrato.dataPrimeiraParcela}T12:00:00`)
    : null;

  let vencimento = primeira && !isNaN(primeira) ? new Date(primeira) : null;

  const PASSO_DIAS = {};
  const avancarData = (data, frequencia) => {
    const nova = new Date(data);
    const dias = PASSO_DIAS[frequencia];
    if (dias) {
      nova.setDate(nova.getDate() + dias);
    } else {
      nova.setMonth(nova.getMonth() + 1);
    }
    return nova;
  };

  for (let i = 1; i <= total; i += 1) {
    let status = "Pendente";
    let valor = valorBaseParcela;
    let recebido = 0;

    if (i <= pagas) {
      status = "Paga";
      const valorRecebido = Number(contrato.valorRecebido) || 0;
      const valorPagoMedio =
        pagas > 0 && valorRecebido > 0
          ? valorRecebido / pagas
          : Math.round((valorBaseParcela + jurosPorParcela) * 100) / 100;
      recebido = Math.round(valorPagoMedio * 100) / 100;
      valor = recebido;
    } else {
      const jurosParcela = jurosPorParcela;
      valor = Math.round((valorBaseParcela + jurosParcela) * 100) / 100;
      status = vencimento && vencimento < hoje ? "Vencida" : "Pendente";
    }

    lista.push({
      numero: i,
      valor,
      recebido,
      jurosOriginais: jurosPorParcela,
      status,
    });

    vencimento = vencimento
      ? avancarData(vencimento, contrato.frequencia)
      : null;
  }
  return lista;
}

// --- Dados mock ---
const MOCK_CONTRATOS = [
  {
    id: "contract-001",
    uid: "user-001",
    valorEmprestado: 450,
    numeroParcelas: 2,
    juros: 35,
    jurosRecebidos: 0,
    parcelasPagas: 0,
    quitado: false,
    saldoPrincipal: 400,
    valorRecebido: 0,
    abatimentos: [
      { valor: 50, parcelaNumero: 1, data: "2026-08-28", observacao: "Pagamento parcial P1" },
    ],
    dataPrimeiraParcela: "2026-08-01",
    frequencia: "Mensal",
    cobrarJurosAtraso: false,
    clienteId: "cliente-001",
    clienteNome: "Joao Silva",
  },
  {
    id: "contract-002",
    uid: "user-002",
    valorEmprestado: 500,
    numeroParcelas: 2,
    juros: 35,
    jurosRecebidos: 175,
    parcelasPagas: 1,
    quitado: false,
    saldoPrincipal: 250,
    valorRecebido: 425,
    abatimentos: [],
    dataPrimeiraParcela: "2026-08-01",
    frequencia: "Mensal",
    cobrarJurosAtraso: false,
    clienteId: "cliente-002",
    clienteNome: "Maria Santos",
  },
  {
    id: "contract-003",
    uid: "user-001",
    valorEmprestado: 1000,
    numeroParcelas: 4,
    juros: 10,
    jurosRecebidos: 0,
    parcelasPagas: 0,
    quitado: false,
    saldoPrincipal: 800,
    valorRecebido: 0,
    abatimentos: [
      { valor: 100, parcelaNumero: 1, data: "2026-07-15", observacao: "Pagamento parcial P1" },
      { valor: 100, parcelaNumero: 2, data: "2026-07-15", observacao: "Pagamento parcial P2" },
    ],
    dataPrimeiraParcela: "2026-07-01",
    frequencia: "Mensal",
    cobrarJurosAtraso: false,
    clienteId: "cliente-001",
    clienteNome: "Joao Silva",
  },
  {
    id: "contract-004",
    uid: "user-003",
    valorEmprestado: 500,
    numeroParcelas: 2,
    juros: 35,
    jurosRecebidos: 50,
    parcelasPagas: 0,
    quitado: false,
    saldoPrincipal: 450,
    valorRecebido: 50,
    abatimentos: [
      { valor: 50, parcelaNumero: null, data: "2026-08-15", observacao: "Abatimento geral" },
    ],
    dataPrimeiraParcela: "2026-08-01",
    frequencia: "Mensal",
    cobrarJurosAtraso: false,
    clienteId: "cliente-004",
    clienteNome: "Pedro Costa",
  },
  {
    id: "contract-005",
    uid: "user-003",
    valorEmprestado: 500,
    numeroParcelas: 2,
    juros: 35,
    jurosRecebidos: 0,
    parcelasPagas: 0,
    quitado: false,
    saldoPrincipal: 500,
    valorRecebido: 0,
    abatimentos: [],
    dataPrimeiraParcela: "2026-08-01",
    frequencia: "Mensal",
    cobrarJurosAtraso: false,
    clienteId: "cliente-004",
    clienteNome: "Pedro Costa",
  },
];

/**
 * Carrega contratos do Firestore real
 */
async function carregarContratosFirestore(targetUid) {
  let contratos = [];

  if (contractId) {
    console.log(`Procurando contrato: uid=${targetUid}, contractId=${contractId}`);
    const contratoDoc = await getDoc(
      doc(db, "usuarios", targetUid, "contratos", contractId)
    );
    if (!contratoDoc.exists()) {
      console.log(`Contrato ${contractId} nao encontrado.`);
      return [];
    }
    const c = { id: contratoDoc.id, uid: targetUid, ...contratoDoc.data() };
    if (Array.isArray(c.abatimentos) && c.abatimentos.length > 0) {
      return [c];
    } else {
      console.log("Este contrato nao tem abatimentos. Nada a migrar.");
      return [];
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
    return contratos;
  }
}

/**
 * Autentica no Firebase usando email/senha das env vars
 */
async function autenticarFirebase() {
  const email = process.env.FIREBASE_EMAIL;
  const senha = process.env.FIREBASE_SENHA;

  if (!email || !senha) {
    throw new Error(
      "FIREBASE_EMAIL e FIREBASE_SENHA devem estar definidas nas env vars.\n" +
        "Exemplo: set FIREBASE_EMAIL=seu@email.com && set FIREBASE_SENHA=senha123"
    );
  }

  const cred = await signInWithEmailAndPassword(auth, email, senha);
  return cred.user.uid;
}

/**
 * Aplica migracao em um contrato
 */
async function aplicarMigracao(contrato, analise, mockStorage) {
  const updateData = {};

  if (analise.camposASerAtualizados.includes("parcelasPagas")) {
    updateData.parcelasPagas = analise.parcelasPagasCorreto;
  }
  if (analise.camposASerAtualizados.includes("valorRecebido")) {
    updateData.valorRecebido = analise.valorRecebidoCorreto;
  }

  if (Object.keys(updateData).length === 0) {
    console.log(`  [${contrato.id}] Nada a atualizar (ja consistente).`);
    return contrato;
  }

  if (mockMode) {
    const idx = mockStorage.findIndex((c) => c.id === contrato.id);
    if (idx >= 0) {
      mockStorage[idx] = { ...clone(mockStorage[idx]), ...updateData };
      // Garante que abatimentos nao foram alterados
      mockStorage[idx].abatimentos = clone(contrato.abatimentos);
    }
    console.log(`  [${contrato.id}] ATUALIZADO (mock): ${JSON.stringify(updateData)}`);
    return { ...contrato, ...updateData };
  } else {
    const contratoRef = doc(db, "usuarios", contrato.uid, "contratos", contrato.id);
    await updateDoc(contratoRef, updateData);
    console.log(`  [${contrato.id}] ATUALIZADO (Firestore): ${JSON.stringify(updateData)}`);
    return { ...contrato, ...updateData };
  }
}

/**
 * Releitura de contrato
 */
async function lerContrato(contratoId, mockStorage) {
  if (mockMode) {
    return mockStorage.find((c) => c.id === contratoId) || null;
  } else {
    const docSnap = await getDoc(
      doc(db, "usuarios", uid, "contratos", contratoId)
    );
    if (!docSnap.exists()) return null;
    return { id: docSnap.id, uid, ...docSnap.data() };
  }
}

/**
 * Funcao principal
 */
async function main() {
  const modo = applyMode ? "APPLY (escrita)" : "DRY RUN (preview)";

  console.log("=".repeat(80));
  console.log(`MIGRACAO DE CONTRATOS - MODO ${modo}`);
  console.log("=".repeat(80));

  if (applyMode) {
    console.warn("ATENCAO: Este script IRA modificar documentos no Firestore/mock.");
  } else {
    console.log("Este script NAO modifica nada. Apenas exibe o preview.");
  }
  console.log("");

  let contratosParaPreview = [];
  let authenticatedUid = null;

  if (mockMode) {
    console.log("MODO MOCK: usando dados de teste predefinidos.");
    contratosParaPreview = MOCK_CONTRATOS.filter(
      (c) => Array.isArray(c.abatimentos) && c.abatimentos.length > 0
    );
  } else if (uid) {
    // Firestore real — autentica
    console.log("Autenticando no Firebase...");
    try {
      authenticatedUid = await autenticarFirebase();
      console.log(`Autenticado como uid=${authenticatedUid}`);
    } catch (err) {
      console.error("ERRO de autenticacao:", err.message);
      console.log("\nUsando --mock para teste:");
      console.log("  set FIREBASE_EMAIL=seu@email.com");
      console.log("  set FIREBASE_SENHA=senha123");
      console.log("  node preview-migration.mjs --uid <uid>");
      process.exit(1);
    }

    if (uid !== authenticatedUid) {
      console.log(
        `AVISO: --uid (${uid}) difere do uid autenticado (${authenticatedUid}).`
      );
    }
    contratosParaPreview = await carregarContratosFirestore(uid);
  } else {
    console.log("Sem --uid e sem --mock. Use --mock para teste ou --uid <uid> para Firestore.");
    process.exit(1);
  }

  console.log(
    `\nEncontrados ${contratosParaPreview.length} contrato(s) com abatimentos registrados.`
  );

  if (contratosParaPreview.length === 0) {
    console.log("Nenhum contrato com abatimentos encontrado. Nada a migrar.");
    return;
  }

  // Filtra por contractId se especificado
  let contratosFiltrados = contratosParaPreview;
  if (contractId) {
    contratosFiltrados = contratosParaPreview.filter((c) => c.id === contractId);
    if (contratosFiltrados.length === 0) {
      console.log(`Contrato ${contractId} nao encontrado entre os contratos com abatimentos.`);
      return;
    }
  }

  // --- Analisa todos os contratos ---
  const analises = [];
  for (const contrato of contratosFiltrados) {
    const analise = analisarContrato(contrato);
    analises.push({ contrato, analise });
  }

  // --- Separa por categoria ---
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

  // --- Exibe preview ---
  console.log("\n" + "=".repeat(80));
  console.log("FASE 1: ANALISE DE CONTRATOS");
  console.log("=".repeat(80));

  if (simples.length > 0) {
    console.log("\n[CONTRATOS COM INCONSISTENCIAS SIMPLES — migracao proposta]");
    for (const { contrato, analise } of simples) {
      exibirResumo(contrato, analise);
    }
  }

  if (revisao.length > 0) {
    console.log("\n[CONTRATOS REQUEREM REVISAO MANUAL — migracao NAO aplicada automaticamente]");
    for (const { contrato, analise } of revisao) {
      exibirResumo(contrato, analise, "CONTRATO (REVISAO NECESSARIA)");
    }
  }

  if (consistentes.length > 0) {
    console.log("\n[CONTRATOS CONSISTENTES — nada a migrar]");
    consistentes.forEach(({ contrato }) => {
      console.log(`  - ${contrato.id} (uid: ${contrato.uid})`);
    });
  }

  // --- Apply ---
  if (applyMode && simples.length > 0) {
    console.log("\n" + "=".repeat(80));
    console.log("FASE 2: APLICANDO MIGRACAO");
    console.log("=".repeat(80));

    const mockStorage = mockMode ? clone(MOCK_CONTRATOS) : null;

    for (const { contrato, analise } of simples) {
      if (analise.camposASerAtualizados.length === 0) continue;

      console.log(`\nProcessando contrato ${contrato.id}...`);
      await aplicarMigracao(contrato, analise, mockStorage);
    }

    // --- Verificacao: releitura ---
    console.log("\n" + "=".repeat(80));
    console.log("FASE 3: VERIFICACAO POS-MIGRACAO (releitura)");
    console.log("=".repeat(80));

    for (const { contrato, analise } of simples) {
      if (analise.camposASerAtualizados.length === 0) continue;

      console.log(`\nContrato: ${contrato.id}`);
      console.log("-".repeat(60));

      const contratoPos = await lerContrato(contrato.id, mockStorage || []);

      console.log("\n[ANTES]");
      console.log(`  parcelasPagas:       ${contrato.parcelasPagas ?? 0}`);
      console.log(`  valorRecebido:       ${formatarMoeda(contrato.valorRecebido)}`);
      console.log(`  saldoPrincipal:      ${formatarMoeda(contrato.saldoPrincipal)}`);
      console.log(`  abatimentos:         ${JSON.stringify(contrato.abatimentos)}`);

      console.log("\n[DEPOIS]");
      console.log(`  parcelasPagas:       ${contratoPos.parcelasPagas ?? 0}`);
      console.log(`  valorRecebido:       ${formatarMoeda(contratoPos.valorRecebido)}`);
      console.log(`  saldoPrincipal:      ${formatarMoeda(contratoPos.saldoPrincipal)}`);
      console.log(`  abatimentos:         ${JSON.stringify(contratoPos.abatimentos)}`);

      const abatigosIguais =
        JSON.stringify(contrato.abatimentos) ===
        JSON.stringify(contratoPos.abatimentos);
      console.log(
        `\n  Abatimentos preservados: ${abatigosIguais ? "SIM" : "NAO"}`
      );
      console.log(
        `  Numero de abatimentos: ${contrato.abatimentos.length} -> ${contratoPos.abatimentos.length}`
      );

      const estadoPos = analisarContrato(contratoPos);
      console.log(
        `  Inconsistencias pos-migracao: ${
          estadoPos.inconsistencias.length === 0
            ? "0 (OK)"
            : estadoPos.inconsistencias.join(", ")
        }`
      );

      // Recalculo de parcelas
      console.log("\n[RECALCULO DE PARCELAS]");
      const hoje = new Date("2026-08-01T12:00:00");
      const parcelas = recalcularParcelas(contratoPos, hoje);

      parcelas.forEach((p) => {
        console.log(
          `  Parcela ${p.numero}: valor=${formatarMoeda(p.valor)}, ` +
          `recebido=${formatarMoeda(p.recebido)}, status=${p.status}, ` +
          `juros=${formatarMoeda(p.jurosOriginais)}`
        );
      });

      const pagasCount = parcelas.filter((p) => p.status === "Paga").length;
      const progresso =
        parcelas.length > 0 ? (pagasCount / parcelas.length) * 100 : 0;
      const totalRecebidoParcelas = parcelas.reduce(
        (s, p) => s + (p.recebido || 0),
        0
      );

      console.log(
        `\n  Progresso: ${pagasCount} de ${parcelas.length} pagas = ${progresso}%`
      );
      console.log(`  Total recebido: ${formatarMoeda(totalRecebidoParcelas)}`);
    }

    // Idempotencia
    console.log("\n" + "=".repeat(80));
    console.log("FASE 4: VERIFICACAO DE IDEMPOTENCIA (segunda execucao)");
    console.log("=".repeat(80));

    for (const { contrato, analise } of simples) {
      if (analise.camposASerAtualizados.length === 0) continue;

      const contratoPos = await lerContrato(
        contrato.id,
        mockStorage || []
      );
      const estadoPos = analisarContrato(contratoPos);

      if (estadoPos.camposASerAtualizados.length === 0) {
        console.log(
          `  [${contrato.id}] Idempotent: OK (nada a atualizar na segunda execucao)`
        );
      } else {
        console.log(
          `  [${contrato.id}] Idempotent: FALHOU — ainda inconsistente: ${estadoPos.camposASerAtualizados.join(", ")}`
        );
      }
    }
  }

  // --- Resumo final ---
  console.log("\n" + "=".repeat(80));
  console.log("RESUMO");
  console.log("=".repeat(80));
  console.log(`  Total de contratos com abatimentos:     ${contratosParaPreview.length}`);
  console.log(`  Contratos com inconsistencias simples:  ${simples.length}`);
  console.log(`  Contratos com revisao necessaria:       ${revisao.length}`);
  console.log(`  Contratos ja consistentes:              ${consistentes.length}`);

  if (contractId) {
    console.log(`  (Filtrado por contractId=${contractId})`);
  }

  if (revisao.length > 0 && !applyMode) {
    console.log(
      `\n  ATENCAO: ${revisao.length} contrato(s) requer(em) revisao manual.`
    );
    console.log("  Eles NAO serao migrados automaticamente. Revise antes de aplicar.");
  }

  if (applyMode) {
    console.log("  Migracao aplicada e verificada.");
  } else {
    console.log("  Para aplicar a migracao, adicione --apply.");
  }
  console.log("=".repeat(80));

  // Fecha o app Firebase
  try {
    const { getAuth: getAuthFn } = await import("firebase/auth");
    const authInstance = getAuthFn(app);
    if (authInstance.currentUser) {
      await authInstance.currentUser.getIdTokenResult();
    }
  } catch (e) {
    // Ignora erros de logout no modo mock
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("ERRO:", err.message);
  console.error(err.stack);
  process.exit(1);
});
