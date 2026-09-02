// Gerador do comprovante financeiro do contrato em PDF (jsPDF).
// Puro: recebe os dados prontos (contrato, cliente, logo em dataURL) — sem acessos ao Firestore.
import jsPDF from "jspdf";
import { formatarMoeda, formatarData, formatarTelefone, numeroCurto } from "./formatadores.js";
import { parcelasDoContrato } from "../services/contractService.js";
import { calculateDebtRemaining, totalAbatimentos, calculatePrincipalQuitado } from "../services/paymentCalculations.js";

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

// Monta o documento e devolve { pdf, numeroDoc } (usado pelo download e pelos testes)
export function construirPdfContrato({ contrato, cliente, logoDataUrl, agora = new Date() }) {
  const pdf = new jsPDF({ unit: "mm", format: "a4" });
  const M = 14; // margem lateral
  const LARG = pdf.internal.pageSize.getWidth() - M * 2; // largura útil
  const D = M + LARG; // borda direita
  const ALT = pdf.internal.pageSize.getHeight();

  const pad = (n) => String(n).padStart(2, "0");
  // Padrão do número do documento: JUREX-CTR-EEA382-20260823-1718
  const numeroDoc = `JUREX-CTR-${(contrato.id ?? "").slice(0, 6).toUpperCase()}-${agora.getFullYear()}${pad(agora.getMonth() + 1)}${pad(agora.getDate())}-${pad(agora.getHours())}:${pad(agora.getMinutes())}`;

  // ---- Cabeçalho
  if (logoDataUrl) {
    try {
      pdf.addImage(logoDataUrl, "PNG", M, 10, 22, 22);
    } catch {
      // logo inválida não deve impedir a emissão do comprovante
    }
  }
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(11);
  pdf.setTextColor(...TEXTO);
  pdf.text("COMPROVANTE FINANCEIRO", 40, 19);

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
  pdf.text(`${formatarData(agora)}, ${pad(agora.getHours())}:${pad(agora.getMinutes())}`, D, 27.5, {
    align: "right",
  });

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

  // ---- Seção: Dados do contrato
  tituloSecao("DADOS DO CONTRATO");
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9);
  pdf.setTextColor(...TEXTO);

  const linhaCampo = (label, valor) => {
    pdf.setFont("helvetica", "bold");
    pdf.text(label, M, y);
    pdf.setFont("helvetica", "normal");
    pdf.text(String(valor), M + 60, y);
    y += 5;
  };

  linhaCampo("Contrato:", numeroDoc);
  linhaCampo("Cliente:", cliente?.nomeCompleto ?? contrato.clienteNome ?? "-");
  linhaCampo("Telefone:", cliente?.telefone ? formatarTelefone(cliente.telefone) : "-");
  linhaCampo("Valor original:", formatarMoeda(contrato.valorEmprestado));
  linhaCampo("Saldo atual:", formatarMoeda(contrato.saldoPrincipal ?? contrato.valorEmprestado));
  linhaCampo("Juros:", `${contrato.juros ?? 0}% a.m.`);
  linhaCampo("Frequência:", contrato.frequencia ?? "-");
  linhaCampo("Parcelas:", `${contrato.numeroParcelas ?? 0}x`);
  y += 3;

  // ---- Seção: Cronograma de parcelas (usando parcelasDoContrato — inclui
  // a sobrescrita que preserva o valor original das parcelas futuras quando
  // há apenas pagamento normal, e recalcula com `valorEmprestado - abatimentoTotal`
  // como base quando há abatimento explícito via juros_parte_divida).
  const parcelas = parcelasDoContrato(contrato, agora);

  tituloSecao("CRONOGRAMA DE PARCELAS");
  // Cabeçalho da tabela
  const startX = M;
  const colNum = startX;
  const colVenc = startX + 20;
  const colValor = startX + 55;
  const colRecebido = startX + 90;
  const colStatus = startX + 120;

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(8);
  pdf.setTextColor(...TEXTO_SUAVE);
  pdf.text("#", colNum, y);
  pdf.text("Vencimento", colVenc, y);
  pdf.text("Valor", colValor, y);
  pdf.text("Recebido", colRecebido, y);
  pdf.text("Status", colStatus, y);
  y += 4;
  pdf.setDrawColor(...LINHA);
  pdf.setLineWidth(0.3);
  pdf.line(M, y, D, y);
  y += 4;

  for (const p of parcelas) {
    const cor = CORES_STATUS[p.status] || CORES_STATUS.Pendente;
    pdf.setFillColor(...cor.fundo);
    pdf.setDrawColor(...cor.fundo);
    pdf.rect(colStatus + 15, y - 3, 4, 4, "F");

    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8.5);
    pdf.setTextColor(...TEXTO);
    pdf.text(String(p.numero), colNum, y);
    pdf.text(formatarData(p.vencimento), colVenc, y);
    pdf.text(formatarMoeda(p.valor), colValor, y);
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
  y += 8;

  // ---- Seção: Resumo financeiro
  tituloSecao("RESUMO FINANCEIRO");
  const saldoAtual = calculateDebtRemaining(contrato);
  const abatimentoTotal = totalAbatimentos(contrato.abatimentos);
  const principalQuitado = calculatePrincipalQuitado(contrato);

  linhaCampo("Valor original:", formatarMoeda(contrato.valorEmprestado));
  linhaCampo("Abatimentos:", `-${formatarMoeda(abatimentoTotal)}`);
  linhaCampo("Saldo atual:", formatarMoeda(saldoAtual));
  linhaCampo("Juros recebidos:", formatarMoeda(contrato.jurosRecebidos ?? 0));
  linhaCampo("Total recebido:", formatarMoeda(contrato.valorRecebido ?? 0));
  y += 3;

  // ---- Rodapé
  pdf.setDrawColor(...LINHA);
  pdf.setLineWidth(0.3);
  pdf.line(M, ALT - 15, D, ALT - 15);
  pdf.setFont("helvetica", "italic");
  pdf.setFontSize(7);
  pdf.setTextColor(...TEXTO_SUAVE);
  pdf.text("Jurex — Gestão de Cobranças", M, ALT - 8);
  pdf.text(`Página ${pdf.internal.getNumberOfPages()}`, D, ALT - 8, { align: "right" });

  return { pdf, numeroDoc };
}

// Download ou exibição do PDF (wrapper simples)
export function gerarPdfContrato({ contrato, cliente, logoDataUrl }) {
  const { pdf, numeroDoc } = construirPdfContrato({ contrato, cliente, logoDataUrl });
  // Em browser: abre em nova aba; em Node/teste: retorna numeroDoc
  if (typeof window !== "undefined") {
    const blob = pdf.output("bloburl");
    window.open(blob, "_blank");
  }
  return numeroDoc;
}
