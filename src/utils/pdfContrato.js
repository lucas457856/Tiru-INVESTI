// Gerador do comprovante financeiro do contrato em PDF (jsPDF).
// Puro: recebe os dados prontos (contrato, cliente, logo em dataURL) — sem acessos ao Firestore.
//
// IDENTIDADE DO PDF: "Cred-Facil — Gestão Financeira".
// Os dados são 100% dinâmicos, provenientes do `contrato` e do `cliente`
// passados como parâmetro. Nenhum valor é hardcoded.
//
// FONTE DE DADOS:
//   - Dados do cliente  : objeto `cliente` (ou campos equivalentes do contrato)
//   - Dados do contrato : objeto `contrato` (Firestore real)
//   - Cronograma        : `parcelasDoContrato(contrato, agora)` — fonte canônica
//                         que já aplica overrides de renegociação, deslocamentos
//                         por juros_apenas, preserva valor original de parcela
//                         pendente, e recalcula via base de cálculo quando há
//                         abatimento explícito (juros_parte_divida).
//   - Multa por atraso  : `calculatePenalty(contrato, parcela, agora)` — mesma
//                         função usada em ReceberPagamento.
//   - Resumo financeiro : `calculateDebtRemaining`, `totalAbatimentos`,
//                         `calculatePrincipalQuitado` (paymentCalculations).
//   - Status do contrato: `calcularStatusContrato(contrato, agora)` — mesma
//                         função usada em EmprestimoDetalhes/Emprestimos.

import jsPDF from "jspdf";
import {
  formatarMoeda,
  formatarData,
  formatarTelefone,
  numeroCurto,
} from "./formatadores.js";
import { parcelasDoContrato } from "../services/contractService.js";
import {
  calculateDebtRemaining,
  totalAbatimentos,
  calculatePrincipalQuitado,
  calculatePenalty,
  calculateInterest,
  calcularStatusContrato,
} from "../services/paymentCalculations.js";

// Re-exporta para compatibilidade com importadores existentes
export { calcularParcelas, totalAbatimentos, avancarData } from "./parcelasUtil.js";

const VERDE = [23, 178, 106]; // #17b26a — mesmo verde do sistema
const VERDE_CLARO = [231, 248, 239];
const TEXTO = [15, 23, 42]; // slate-900
const TEXTO_SUAVE = [100, 116, 139]; // slate-500
const LINHA = [226, 232, 240]; // slate-200

// Cores das etiquetas de status das parcelas
const CORES_STATUS = {
  Paga: { fundo: VERDE_CLARO, texto: VERDE },
  Pendente: { fundo: [254, 243, 199], texto: [180, 83, 9] },
  Vencida: { fundo: [254, 226, 226], texto: [220, 38, 38] },
  Parcial: { fundo: [219, 234, 254], texto: [37, 99, 235] },
};

// Identidade textual do PDF
const MARCA_NOME = "CRED-FACIL";
const MARCA_SLOGAN = "GESTÃO FINANCEIRA";
const MARCA_RODAPE = "Cred-Facil — Gestão Financeira";

// Cache da logo oficial: o chamador pode passar `logoDataUrl` (recomendado,
// para não bloquear a geração com um fetch) OU a função busca em runtime
// em `/logo.png` (asset oficial do app, servido pela Vercel/Vite).
let _logoDataUrlCache = null;
async function obterLogoOficial(logoDataUrl) {
  if (logoDataUrl) return logoDataUrl;
  if (_logoDataUrlCache) return _logoDataUrlCache;
  if (typeof window === "undefined" || typeof fetch === "undefined") return null;
  try {
    const resp = await fetch("/logo.png", { cache: "force-cache" });
    if (!resp.ok) return null;
    const blob = await resp.blob();
    _logoDataUrlCache = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
    return _logoDataUrlCache;
  } catch {
    return null;
  }
}

// Monta o documento e devolve { pdf, numeroDoc } (usado pelo download e pelos testes)
export async function construirPdfContrato({
  contrato,
  cliente,
  logoDataUrl,
  agora = new Date(),
}) {
  const pdf = new jsPDF({ unit: "mm", format: "a4" });
  const M = 14; // margem lateral
  const LARG = pdf.internal.pageSize.getWidth() - M * 2; // largura útil
  const D = M + LARG; // borda direita
  const ALT = pdf.internal.pageSize.getHeight();

  const pad = (n) => String(n).padStart(2, "0");
  // Número do documento baseado no ID real do contrato + timestamp real.
  // Formato: CRED-FACIL-CTR-<idCurto>-<YYYYMMDD>-<HH:MM>
  const idCurto = (contrato?.id ?? "").slice(0, 6).toUpperCase() || "S-ID";
  const numeroDoc = `CRED-FACIL-CTR-${idCurto}-${agora.getFullYear()}${pad(
    agora.getMonth() + 1,
  )}${pad(agora.getDate())}-${pad(agora.getHours())}:${pad(agora.getMinutes())}`;

  // Cronograma canônico (respeita overrides de renegociação, deslocamentos
  // por juros_apenas, valor original preservado de parcelas pendentes, e
  // recálculo com base em valorEmprestado - abatimentoTotal quando há
  // juros_parte_divida).
  const parcelas = parcelasDoContrato(contrato, agora);

  // ---- Cabeçalho
  const logo = await obterLogoOficial(logoDataUrl);
  if (logo) {
    try {
      pdf.addImage(logo, "PNG", M, 10, 22, 22);
    } catch {
      // logo inválida não deve impedir a emissão do comprovante
    }
  }
  // Marca textual ao lado da logo
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(13);
  pdf.setTextColor(...TEXTO);
  pdf.text(MARCA_NOME, 40, 16);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(7);
  pdf.setTextColor(...VERDE);
  pdf.text(MARCA_SLOGAN, 40, 20);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(11);
  pdf.setTextColor(...TEXTO);
  pdf.text("COMPROVANTE FINANCEIRO", 40, 25);

  // Coluna direita: documento + data de geração
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(7);
  pdf.setTextColor(...TEXTO_SUAVE);
  pdf.text("DOCUMENTO", D, 13, { align: "right" });
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(9);
  pdf.setTextColor(...TEXTO);
  pdf.text(numeroDoc, D, 18, { align: "right" });
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(7);
  pdf.setTextColor(...TEXTO_SUAVE);
  pdf.text("GERADO EM", D, 23, { align: "right" });
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(8.5);
  pdf.setTextColor(...TEXTO);
  pdf.text(
    `${formatarData(agora)}, ${pad(agora.getHours())}:${pad(agora.getMinutes())}`,
    D,
    27.5,
    { align: "right" },
  );

  pdf.setDrawColor(...LINHA);
  pdf.setLineWidth(0.3);
  pdf.line(M, 38, D, 38);

  let y = 50;

  // Título de seção com a barra vertical verde
  const tituloSecao = (texto) => {
    pdf.setFillColor(...VERDE);
    pdf.rect(M, y - 4, 1.4, 5, "F");
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(11);
    pdf.setTextColor(...TEXTO);
    pdf.text(texto, M + 5, y);
    y += 9.5;
  };

  const linhaCampo = (label, valor) => {
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(8.5);
    pdf.setTextColor(...TEXTO_SUAVE);
    pdf.text(label, M, y);
    pdf.setFont("helvetica", "normal");
    pdf.setTextColor(...TEXTO);
    pdf.text(String(valor ?? "-"), M + 60, y);
    y += 5;
  };

  // ---- Seção 1: Dados do cliente
  tituloSecao("DADOS DO CLIENTE");
  const nomeCliente =
    cliente?.nomeCompleto ??
    cliente?.nome ??
    contrato?.clienteNome ??
    "-";
  const telefoneCliente = cliente?.telefone ?? contrato?.clienteTelefone ?? "";
  linhaCampo("Nome:", nomeCliente);
  linhaCampo("Telefone:", telefoneCliente ? formatarTelefone(telefoneCliente) : "-");
  y += 3;

  // ---- Seção 2: Contrato
  tituloSecao("DADOS DO CONTRATO");
  linhaCampo("Número:", numeroCurto(contrato?.id));
  linhaCampo("Data do contrato:", formatarData(contrato?.dataInicio ?? contrato?.criadoEm));
  linhaCampo(
    "Forma de pagamento:",
    contrato?.formaPagamento ?? contrato?.modalidade ?? "-",
  );
  linhaCampo("Frequência:", contrato?.frequencia ?? "-");
  linhaCampo(
    "Quantidade de parcelas:",
    `${contrato?.numeroParcelas ?? 0}x`,
  );
  linhaCampo("Juros:", `${contrato?.juros ?? 0}% a.m.`);
  y += 3;

  // ---- Seção 3: Resumo financeiro
  tituloSecao("RESUMO FINANCEIRO");
  const valorOriginal = Number(contrato?.valorEmprestado) || 0;
  const abatimentoTotal = totalAbatimentos(contrato?.abatimentos);
  const saldoAtual = calculateDebtRemaining(contrato);
  const principalQuitado = calculatePrincipalQuitado(contrato);
  const totalRecebido = Number(contrato?.valorRecebido) || 0;
  const jurosRecebidos = Number(contrato?.jurosRecebidos) || 0;
  const statusContrato = calcularStatusContrato(contrato, agora);

  // Total a pagar exibido no PDF: regra SOMENTE principal + juros − pagos − abatimentos.
  // NÃO considera multas (mesmo que existam parcelas vencidas com multa calculada
  // no sistema). A multa continua visível em outras seções do PDF (coluna "Multa"
  // da tabela de parcelas) e nas regras do sistema — só não entra neste total.
  // Usa a função `calculateInterest` (reutilizada, sem hardcode de 20%) para
  // aplicar a taxa de juros REAL do contrato (`contrato.juros` em % a.m.).
  //
  // - `valorRecebido` é o total já pago pelo cliente (inclui principal, juros
  //   e multas cobradas), portanto deduzir esse valor cobre todos os pagamentos.
  // - `abatimentoTotal` é a soma de todos os `abatimentos` explícitos do
  //   contrato (array `contrato.abatimentos`).
  //
  // Exemplos:
  //   R$ 1.500 + 20% − 0 − 0 = R$ 1.800,00
  //   R$ 2.000 + 10% − 0 − 0 = R$ 2.200,00
  const jurosDoContrato = Number(contrato?.juros) || 0;
  const jurosTotais = calculateInterest(valorOriginal, jurosDoContrato);
  const totalAPagar = Math.max(
    0,
    Math.round((valorOriginal + jurosTotais - totalRecebido - abatimentoTotal) * 100) / 100,
  );

  // Contadores reais de parcelas (calculados a partir do cronograma canônico)
  const contadores = parcelas.reduce(
    (acc, p) => {
      acc.total += 1;
      if (p.status === "Paga") acc.pagas += 1;
      else if (p.status === "Vencida") acc.vencidas += 1;
      else if (p.status === "Pendente") acc.pendentes += 1;
      else if (p.status === "Parcial") acc.parciais += 1;
      return acc;
    },
    { total: 0, pagas: 0, pendentes: 0, vencidas: 0, parciais: 0 },
  );

  linhaCampo("Status:", statusContrato);
  linhaCampo("Valor original:", formatarMoeda(valorOriginal));
  linhaCampo("Principal quitado:", formatarMoeda(principalQuitado));
  linhaCampo("Abatimentos:", `-${formatarMoeda(abatimentoTotal)}`);
  linhaCampo("Total a pagar:", formatarMoeda(totalAPagar));
  linhaCampo("Juros recebidos:", formatarMoeda(jurosRecebidos));
  linhaCampo("Total recebido:", formatarMoeda(totalRecebido));
  linhaCampo(
    "Parcelas:",
    `${contadores.pagas} pagas · ${contadores.pendentes} pendentes · ${contadores.vencidas} vencidas${contadores.parciais ? ` · ${contadores.parciais} parciais` : ""} (de ${contadores.total})`,
  );
  y += 3;

  // ---- Seção 4: Cronograma de parcelas
  tituloSecao("PARCELAS");
  // Larguras e posições da tabela
  const startX = M;
  const colNum = startX;
  const colVenc = startX + 12;
  const colValor = startX + 36;
  const colJuros = startX + 58;
  const colMulta = startX + 78;
  const colRecebido = startX + 96;
  const colStatus = startX + 124;

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(7.5);
  pdf.setTextColor(...TEXTO_SUAVE);
  pdf.text("#", colNum, y);
  pdf.text("Vencimento", colVenc, y);
  pdf.text("Valor original", colValor, y);
  pdf.text("Juros", colJuros, y);
  pdf.text("Multa", colMulta, y);
  pdf.text("Recebido", colRecebido, y);
  pdf.text("Status", colStatus, y);
  y += 4;
  pdf.setDrawColor(...LINHA);
  pdf.setLineWidth(0.3);
  pdf.line(M, y, D, y);
  y += 4;

  // Loop dinâmico sobre TODAS as parcelas (sem limite) — quebra de página
  // automática quando o conteúdo ultrapassa o rodapé.
  for (const p of parcelas) {
    const cor = CORES_STATUS[p.status] || CORES_STATUS.Pendente;
    pdf.setFillColor(...cor.fundo);
    pdf.setDrawColor(...cor.fundo);
    pdf.rect(colStatus + 15, y - 3, 4, 4, "F");

    const jurosParc = Number(p.jurosOriginais) || 0;
    const multaParc = calculatePenalty(contrato, p, agora);
    const valorOriginalParc =
      Number(p.valorOriginalParcela) || Number(p.valor) || 0;

    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
    pdf.setTextColor(...TEXTO);
    pdf.text(String(p.numero ?? "-"), colNum, y);
    pdf.text(formatarData(p.vencimento), colVenc, y);
    pdf.text(formatarMoeda(valorOriginalParc), colValor, y);
    pdf.text(formatarMoeda(jurosParc), colJuros, y);
    pdf.text(formatarMoeda(multaParc), colMulta, y);
    pdf.text(formatarMoeda(p.recebido || 0), colRecebido, y);
    pdf.setTextColor(...cor.texto);
    pdf.text(p.status, colStatus + 20, y);
    y += 6;

    if (y > ALT - 25) {
      pdf.addPage();
      y = M + 10;
    }
  }

  pdf.setDrawColor(...LINHA);
  pdf.setLineWidth(0.3);
  pdf.line(M, y, D, y);
  y += 6;

  // ---- Rodapé
  pdf.setDrawColor(...LINHA);
  pdf.setLineWidth(0.3);
  pdf.line(M, ALT - 15, D, ALT - 15);
  pdf.setFont("helvetica", "italic");
  pdf.setFontSize(7);
  pdf.setTextColor(...TEXTO_SUAVE);
  pdf.text(
    `Documento gerado pelo ${MARCA_RODAPE} a partir dos registros do contrato. Confira os valores com os comprovantes e documentos originais quando necessário.`,
    M,
    ALT - 8,
  );
  pdf.text(`Página ${pdf.internal.getNumberOfPages()}`, D, ALT - 8, {
    align: "right",
  });

  return { pdf, numeroDoc };
}

// Download ou exibição do PDF (wrapper simples).
// Antes de abrir, garante que os dados do contrato sejam os mais recentes
// em memória (caller é responsável por recarregar do Firestore antes,
// se necessário).
export async function gerarPdfContrato({ contrato, cliente, logoDataUrl }) {
  const { pdf, numeroDoc } = await construirPdfContrato({
    contrato,
    cliente,
    logoDataUrl,
  });
  // Em browser: abre em nova aba; em Node/teste: retorna numeroDoc
  if (typeof window !== "undefined") {
    const blob = pdf.output("bloburl");
    window.open(blob, "_blank");
  }
  return numeroDoc;
}
