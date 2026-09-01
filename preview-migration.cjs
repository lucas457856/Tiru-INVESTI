/**
 * MIGRACAO DE CONTRATOS - MODO DRY RUN (PREVIEW)
 *
 * Script para identificar contratos com abatimentos registrados mas
 * campos derivados inconsistentes (parcelasPagas, valorRecebido).
 *
 * USO:
 *   node preview-migration.cjs --mock                                         # preview mock
 *   node preview-migration.cjs --mock --apply --contractId contract-001       # apply mock
 *   node preview-migration.cjs --uid <uid>                                    # preview Firestore (auth via env)
 *   node preview-migration.cjs --uid <uid> --contractId <id>                  # preview contrato
 *   node preview-migration.cjs --uid <uid> --contractId <id> --apply          # apply Firestore
 *
 * Para acessar Firestore real, configure:
 *   FIREBASE_EMAIL=seu@email.com
 *   FIREBASE_SENHA=senha123
 *
 * REGRA DE MIGRACAO (idempotente):
 *   1. NAO altera o array abatimentos.
 *   2. NAO cria novos abatimentos.
 *   3. NAO duplica valores.
 *   4. Atualiza SOMENTE: parcelasPagas, valorRecebido.
 *   5. saldoPrincipal, dataProximo, quitado NAO sao alterados.
 *
 * DETECCAO DE CASOS ESPECIAIS (marcados como "REVISAO NECESSARIA"):
 *   - Multiplos abatimentos na mesma parcela
 *   - Parcelas ja pagas por pagamento normal (sem abatimento)
 *   - Abatimentos em parcelas diferentes
 *   - valorRecebido ja parcialmente contabilizado
 *   - parcelasPagas ja parcialmente contabilizadas
 */

const args = process.argv.slice(2);
const uid = args.includes("--uid") ? args[args.indexOf("--uid") + 1] : null;
const contractId =
  args.includes("--contractId") || args.includes("--contractid")
    ? args[args.indexOf("--contractId") + 1] ||
      args[args.indexOf("--contractid") + 1]
    : null;
const mockMode = args.includes("--mock");
const applyMode = args.includes("--apply");

// --- Funcoes puras de calculo ---

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
  const valorBaseParcela =
    valorEmprestado > 0 && totalParcelas > 0
      ? valorEmprestado / totalParcelas
      : Number(contrato.valorParcela) || 0;

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

  // Abatimentos sem parcelaNumero (abatimento geral, não quitou parcela especifica)
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
      `Múltiplos abatimentos na mesma parcela: ${parcelasMultiplosAbatimentos.join(", ")}`
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

  // 4. Verifica se parcelasPagas já está contabilizado parcialmente
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

  // 5. Verifica se valorRecebido já está parcialmente contabilizado
  if (valorRecebidoExistente > 0 && abatimentoComParcelaTotal > 0) {
    if (valorRecebidoExistente < abatimentoComParcelaTotal) {
      casosEspeciais.push(
        `valorRecebido (${valorRecebidoExistente}) < abatimentoTotal (${abatimentoComParcelaTotal}) — valorRecebido parcialmente contabilizado`
      );
    } else if (valorRecebidoExistente > abatimentoComParcelaTotal) {
      const pagamentoExcedente = valorRecebidoExistente - abatimentoComParcelaTotal;
      const valorBaseParcelaTmp =
        valorEmprestado > 0 && totalParcelas > 0
          ? valorEmprestado / totalParcelas
          : Number(contrato.valorParcela) || 0;
      const jurosPorParcelaTmp = valorEmprestado * (Number(contrato.juros) || 0) / 100;
      const valorParcelaCompleta = valorBaseParcelaTmp + jurosPorParcelaTmp;
      if (valorParcelaCompleta > 0 && pagamentoExcedente >= valorParcelaCompleta * 0.5) {
        casosEspeciais.push(
          `valorRecebido (${valorRecebidoExistente}) > abatimentoComParcela (${abatimentoComParcelaTotal}) — inclui pagamentos reais de parcelas`
        );
      } else {
        casosEspeciais.push(
          `valorRecebido (${valorRecebidoExistente}) > abatimentoComParcela (${abatimentoComParcelaTotal}) — excesso não corresponde a parcela completa`
        );
      }
    }
  }

  // Estado correto (apenas abatimentos com parcelaNumero que não foram contabilizados)
  let parcelasPagasCorreto =
    numerosComAbatimento.length > 0
      ? Math.max(parcelasPagasExistentes, numerosComAbatimento.length)
      : parcelasPagasExistentes;

  // Se valorRecebido > abatimentoComParcelaTotal, havia pagamento(s) real(es)
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
      parcelasPagasCorreto = Math.max(parcelasPagasCorreto, 1);
    }
  }

  // valorRecebido correto: abatimentos com parcelaNumero não contabilizados ainda
  const abatimentoQueNaoFoiContado = Math.max(
    0,
    abatimentoComParcelaTotal - valorRecebidoExistente
  );
  const valorRecebidoCorreto = valorRecebidoExistente + abatimentoQueNaoFoiContado;

  // Detecta inconsistencias
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

  // Campos a serem atualizados — SOMENTE parcelasPagas e valorRecebido
  const camposASerAtualizados = [];
  if (temAbatimentoComParcela && parcelasPagasCorreto !== parcelasPagasExistentes) {
    camposASerAtualizados.push("parcelasPagas");
  }
  if (temAbatimentoComParcela &&
    Math.round(valorRecebidoCorreto * 100) / 100 !==
      Math.round(valorRecebidoExistente * 100) / 100) {
    camposASerAtualizados.push("valorRecebido");
  }

  // Se houver casos especiais, marca como revisao necessaria
  const revisaoNecessaria = casosEspeciais.length > 0;

  return {
    parcelasPagasCorreto,
    valorRecebidoCorreto: Math.round(valorRecebidoCorreto * 100) / 100,
    abatimentoTotal: Math.round(abatimentoTotal * 100) / 100,
    abatimentoComParcelaTotal: Math.round(abatimentoComParcelaTotal * 100) / 100,
    numerosComAbatimento,
    inconsistencias,
    camposASerAtualizados,
    casosEspeciais,
    revisaoNecessaria,
  };
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
    // Mock que replica o contrato real WzsHoX6qBRiR3kdCm1Js:
    // parcelasPagas=0, valorRecebido=225, abatimentos=[{parcelaNumero:1,valor:50}]
    // valorEmprestado ~ 450, 2 parcelas, 35% juros
    // Excesso de 175 representa pagamentos reais de uma parcela completa
    id: "contract-005-wzs",
    uid: "mock-user",
    valorEmprestado: 450,
    numeroParcelas: 2,
    juros: 35,
    jurosRecebidos: 0,
    parcelasPagas: 0,
    quitado: false,
    saldoPrincipal: 400,
    valorRecebido: 225,
    abatimentos: [
      { valor: 50, parcelaNumero: 1, data: "2026-08-28", observacao: "Pagamento parcial P1" },
    ],
    dataPrimeiraParcela: "2026-08-01",
    frequencia: "Mensal",
    cobrarJurosAtraso: false,
    clienteId: "cliente-mock",
    clienteNome: "Contrato Real Wzs",
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

// --- Firebase ---
let db = null;

if (!mockMode && uid) {
  const { initializeApp } = require("firebase/app");
  const { getFirestore } = require("firebase/firestore");

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
  db = getFirestore(app);
}

/**
 * Autentica no Firebase usando email/senha das env vars
 */
async function autenticarFirebase() {
  const { signInWithEmailAndPassword } = require("firebase/auth");
  const { auth } = require("./src/services/firebase.js");

  const email = process.env.FIREBASE_EMAIL;
  const senha = process.env.FIREBASE_SENHA;

  if (!email || !senha) {
    throw new Error(
      "FIREBASE_EMAIL e FIREBASE_SENHA devem estar definidos nas env vars.\n" +
        "Exemplo: set FIREBASE_EMAIL=seu@email.com && set FIREBASE_SENHA=senha123"
    );
  }

  const cred = await signInWithEmailAndPassword(auth, email, senha);
  return cred.user.uid;
}

async function carregarContratosFirestore() {
  if (!db) {
    throw new Error("db nao inicializado.");
  }

  const {
    collection: collectionFn,
    getDocs: getDocsFn,
    doc: docFn,
    getDoc: getDocFn,
  } = require("firebase/firestore");

  let contratosParaPreview = [];

  if (uid && contractId) {
    console.log(`Procurando contrato: uid=${uid}, contractId=${contractId}`);
    const contratoDoc = await getDocFn(
      docFn(db, "usuarios", uid, "contratos", contractId)
    );
    if (!contratoDoc.exists()) {
      console.log(`Contrato ${contractId} nao encontrado.`);
      return [];
    }
    const c = { id: contratoDoc.id, uid, ...contratoDoc.data() };
    if (Array.isArray(c.abatimentos) && c.abatimentos.length > 0) {
      return [c];
    } else {
      console.log("Este contrato nao tem abatimentos. Nada a migrar.");
      return [];
    }
  } else if (uid) {
    console.log(`Filtrando por usuario: ${uid}`);
    const snapshot = await getDocsFn(
      collectionFn(db, "usuarios", uid, "contratos")
    );
    snapshot.forEach((doc) => {
      const c = { id: doc.id, uid, ...doc.data() };
      if (Array.isArray(c.abatimentos) && c.abatimentos.length > 0) {
        contratosParaPreview.push(c);
      }
    });
    return contratosParaPreview;
  } else {
    throw new Error("UID necessario para Firestore. Use --uid <uid>");
  }
}

/**
 * Aplica a migracao (modo mock ou Firestore)
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
    const { doc: docFn, updateDoc: updateDocFn, serverTimestamp } = require("firebase/firestore");
    const contratoRef = docFn(db, "usuarios", contrato.uid, "contratos", contrato.id);
    await updateDocFn(contratoRef, {
      ...updateData,
      updatedAt: serverTimestamp(),
    });
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
    const { doc: docFn, getDoc: getDocFn } = require("firebase/firestore");
    const docSnap = await getDocFn(docFn(db, "usuarios", uid, "contratos", contratoId));
    if (!docSnap.exists()) return null;
    return { id: docSnap.id, uid, ...docSnap.data() };
  }
}

/**
 * Exibe preview/resumo de um contrato
 */
function exibirResumo(contrato, analise, titulo = "CONTRATO") {
  console.log("\n" + "=".repeat(80));
  console.log(`${titulo}: ${contrato.id}`);
  console.log("=".repeat(80));

  console.log("\n[DADOS DO CONTRATO]");
  console.log(`  valorEmprestado:     ${formatarMoeda(contrato.valorEmprestado)}`);
  console.log(`  numeroParcelas:      ${contrato.numeroParcelas}`);
  console.log(`  juros:               ${contrato.juros}%`);

  console.log("\n[ANTES]");
  console.log(`  parcelasPagas:       ${contrato.parcelasPagas ?? 0}`);
  console.log(`  valorRecebido:       ${formatarMoeda(contrato.valorRecebido)}`);
  console.log(`  saldoPrincipal:      ${formatarMoeda(contrato.saldoPrincipal)}`);
  console.log(`  quitado:             ${contrato.quitado}`);
  console.log(`  dataProximo:         ${contrato.dataProximo || "N/A"}`);

  console.log("\n[ABATIMENTOS]");
  const abatimentos = Array.isArray(contrato.abatimentos) ? contrato.abatimentos : [];
  if (abatimentos.length === 0) {
    console.log("  (nenhum)");
  } else {
    abatimentos.forEach((a, i) => {
      console.log(
        `  [${i + 1}] parcelaNumero: ${a.parcelaNumero ?? "-"}, ` +
        `valor: ${formatarMoeda(a.valor)}, data: ${a.data || "N/A"}` +
        `${a.observacao ? `, obs: ${a.observacao}` : ""}`
      );
    });
  }
  console.log(`  TOTAL abatimentos:   ${formatarMoeda(analise.abatimentoTotal)}`);

  if (analise.casosEspeciais.length > 0) {
    console.log("\n[REVISAO NECESSARIA]");
    analise.casosEspeciais.forEach((c) => {
      console.log(`  - ${c}`);
    });
    console.log("  (Nao sera corrigido automaticamente — requer analise manual)");
  }

  if (analise.inconsistencias.length > 0) {
    console.log("\n[DEPOIS — PROPOSTO]");
    console.log(`  parcelasPagas:       ${analise.parcelasPagasCorreto}`);
    console.log(`  valorRecebido:       ${formatarMoeda(analise.valorRecebidoCorreto)}`);
    console.log(`  saldoPrincipal:      ${formatarMoeda(contrato.saldoPrincipal)} (nao alterado)`);

    console.log("\n[INCONSISTENCIAS]");
    analise.inconsistencias.forEach((inc) => {
      console.log(`  - ${inc}`);
    });

    console.log("\n[CAMPOS QUE SERIAM ALTERADOS]");
    analise.camposASerAtualizados.forEach((c) => {
      console.log(`  - ${c}`);
    });
  } else {
    console.log("\n[STATUS: CONSISTENTE — nada a migrar]");
  }
}

/**
 * Funcao principal
 */
async function main() {
  const modo = applyMode ? "APPLY (escrita)" : "DRY RUN (preview)";

  console.log("=".repeat(80));
  console.log(`MIGRACAO DE CONTRATOS - MODO ${modo.toUpperCase()}`);
  console.log("=".repeat(80));

  if (applyMode) {
    console.log("ATENCAO: Este script IRA modificar documentos no Firestore/mock.");
  } else {
    console.log("Este script NAO modifica nada. Apenas exibe o preview.");
  }
  console.log("");

  let contratosParaPreview = [];

  if (mockMode) {
    console.log("MODO MOCK: usando dados de teste predefinidos.");
    contratosParaPreview = MOCK_CONTRATOS.filter(
      (c) => Array.isArray(c.abatimentos) && c.abatimentos.length > 0
    );
  } else {
    // Firestore real — autentica primeiro
    console.log("Autenticando no Firebase...");
    const authenticatedUid = await autenticarFirebase();
    console.log(`Autenticado como uid=${authenticatedUid}`);

    // Usa o uid da autenticacao ou o uid informado
    const targetUid = uid || authenticatedUid;
    if (uid && uid !== authenticatedUid) {
      console.log(`AVISO: --uid (${uid}) difere do uid autenticado (${authenticatedUid}).`);
      console.log("Usando --uid informado.");
    }

    contratosParaPreview = await carregarContratosFirestore(targetUid === uid ? targetUid : uid);
  }

  console.log(`\nEncontrados ${contratosParaPreview.length} contrato(s) com abatimentos registrados.`);

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
  const contratosComInconsistenciaSimples = [];
  const contratosRevisaoNecessaria = [];
  const contratosConsistentes = [];

  for (const { contrato, analise } of analises) {
    if (analise.inconsistencias.length === 0) {
      contratosConsistentes.push({ contrato, analise });
    } else if (analise.revisaoNecessaria) {
      contratosRevisaoNecessaria.push({ contrato, analise });
    } else {
      contratosComInconsistenciaSimples.push({ contrato, analise });
    }
  }

  // --- Exibe preview ---
  console.log("\n" + "=".repeat(80));
  console.log("FASE 1: ANALISE DE CONTRATOS");
  console.log("=".repeat(80));

  if (contratosComInconsistenciaSimples.length > 0) {
    console.log(`\n[CONTRATOS COM INCONSISTENCIAS SIMPLES — migracao proposta]`);
    for (const { contrato, analise } of contratosComInconsistenciaSimples) {
      exibirResumo(contrato, analise, "CONTRATO (inconsistencia simples)");
    }
  }

  if (contratosRevisaoNecessaria.length > 0) {
    console.log(`\n[CONTRATOS REQUEREM REVISAO MANUAL — migracao NAO aplicada automaticamente]`);
    for (const { contrato, analise } of contratosRevisaoNecessaria) {
      exibirResumo(contrato, analise, "CONTRATO (revisao necessaria)");
    }
  }

  if (contratosConsistentes.length > 0) {
    console.log(`\n[CONTRATOS CONSISTENTES — nada a migrar]`);
    for (const { contrato, analise } of contratosConsistentes) {
      console.log(`  - ${contrato.id} (uid: ${contrato.uid})`);
    }
  }

  // --- Apply (se modo --apply) ---
  if (applyMode && contratosComInconsistenciaSimples.length > 0) {
    console.log("\n" + "=".repeat(80));
    console.log("FASE 2: APLICANDO MIGRACAO (contratos sem revisao necessaria)");
    console.log("=".repeat(80));

    const mockStorage = mockMode ? clone(MOCK_CONTRATOS) : null;

    for (const { contrato, analise } of contratosComInconsistenciaSimples) {
      if (analise.camposASerAtualizados.length === 0) {
        continue;
      }
      console.log(`\nProcessando contrato ${contrato.id}...`);
      await aplicarMigracao(contrato, analise, mockStorage);
    }

    // --- Verificacao: releitura ---
    console.log("\n" + "=".repeat(80));
    console.log("FASE 3: VERIFICACAO POS-MIGRACAO (releitura)");
    console.log("=".repeat(80));

    for (const { contrato, analise } of contratosComInconsistenciaSimples) {
      if (analise.camposASerAtualizados.length === 0) {
        continue;
      }

      console.log(`\nContrato: ${contrato.id}`);
      console.log("-".repeat(60));

      const contratoPos = await lerContrato(contrato.id, mockStorage || MOCK_CONTRATOS);

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
      console.log(`\n  Abatimentos preservados: ${abatigosIguais ? "SIM" : "NAO"}`);
      console.log(`  Numero de abatimentos: ${contrato.abatimentos.length} -> ${contratoPos.abatimentos.length}`);

      const estadoPos = analisarContrato(contratoPos);
      console.log(
        `  Inconsistencias pos-migracao: ${estadoPos.inconsistencias.length === 0 ? "0 (OK)" : estadoPos.inconsistencias.join(", ")}`
      );

      // Recalculo de parcelas
      console.log("\n[RECALCULO DE PARCELAS]");
      const hoje = new Date("2026-08-01T12:00:00");
      const valorEmprestado = Number(contratoPos.valorEmprestado) || 0;
      const total = Number(contratoPos.numeroParcelas) || 0;
      const jurosTaxa = Number(contratoPos.juros) || 0;
      const valorBaseParcela =
        valorEmprestado > 0 && total > 0
          ? valorEmprestado / total
          : Number(contratoPos.valorParcela) || 0;
      const jurosPorParcela = valorEmprestado * (jurosTaxa / 100);
      const pagas = contratoPos.quitado ? total : Number(contratoPos.parcelasPagas) || 0;

      for (let i = 1; i <= total; i++) {
        if (i <= pagas) {
          const valorRecebido = Number(contratoPos.valorRecebido) || 0;
          const valorPagoMedio =
            pagas > 0 && valorRecebido > 0
              ? valorRecebido / pagas
              : Math.round((valorBaseParcela + jurosPorParcela) * 100) / 100;
          const recebido = Math.round(valorPagoMedio * 100) / 100;
          console.log(
            `  Parcela ${i}: valor=${formatarMoeda(recebido)}, recebido=${formatarMoeda(recebido)}, status=Paga, juros=${formatarMoeda(jurosPorParcela)}`
          );
        } else {
          const valor = Math.round((valorBaseParcela + jurosPorParcela) * 100) / 100;
          console.log(
            `  Parcela ${i}: valor=${formatarMoeda(valor)}, recebido=${formatarMoeda(0)}, status=Pendente, juros=${formatarMoeda(jurosPorParcela)}`
          );
        }
      }

      const pagasCount = pagas;
      const progresso = total > 0 ? (pagasCount / total) * 100 : 0;
      console.log(
        `\n  Progresso: ${pagasCount} de ${total} pagas = ${progresso}%`
      );
      console.log(
        `  Total recebido: ${formatarMoeda(
          Number(contratoPos.valorRecebido) || 0
        )}`
      );
    }

    // Idempotencia
    console.log("\n" + "=".repeat(80));
    console.log("FASE 4: VERIFICACAO DE IDEMPOTENCIA (segunda execucao)");
    console.log("=".repeat(80));

    for (const { contrato, analise } of contratosComInconsistenciaSimples) {
      const contratoPos = await lerContrato(
        contrato.id,
        mockStorage || MOCK_CONTRATOS
      );
      const estadoPos = analisarContrato(contratoPos);

      if (estadoPos.camposASerAtualizados.length === 0) {
        console.log(`  [${contrato.id}] Idempotent: OK (nada a atualizar na segunda execucao)`);
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
  console.log(`  Contratos com inconsistencias simples:  ${contratosComInconsistenciaSimples.length}`);
  console.log(`  Contratos com revisao necessaria:       ${contratosRevisaoNecessaria.length}`);
  console.log(`  Contratos ja consistentes:              ${contratosConsistentes.length}`);

  if (contractId) {
    console.log(`  (Filtrado por contractId=${contractId})`);
  }

  if (contratosRevisaoNecessaria.length > 0 && !applyMode) {
    console.log(
      `\n  ATENCAO: ${contratosRevisaoNecessaria.length} contrato(s) requer(em) revisao manual.\n` +
        "  Eles NAO serao migrados automaticamente. Revise antes de aplicar."
    );
  }

  if (applyMode) {
    console.log("  Migracao aplicada e verificada.");
  } else {
    console.log("  Para aplicar a migracao, adicione --apply.");
  }
  console.log("=".repeat(80));
}

main()
  .catch((err) => {
    console.error("ERRO:", err.message);
    console.error(err.stack);
    process.exit(1);
  })
  .finally(() => {
    if (process.exitCode === 0) {
      process.exit(0);
    }
  });
