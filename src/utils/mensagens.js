// Helper compartilhado para montar mensagens de WhatsApp a partir de modelos
// editáveis em /configuracoes/modelos-contrato. Não conhece Firestore — recebe
// modelos já carregados e devolve a string interpolada.
//
// Variáveis suportadas (todas opcionais; ausentes viram "—"):
//   nome, nomeProduto, valorContrato, valorVenda, taxaJurosLabel,
//   frequencia, numeroParcelas, valorParcela, dataInicio, entrada,
//   totalReceber, cronograma

import { formatarMoeda, formatarData } from "./formatadores";

// Substitui {chave} por exemplo[chave] (ou "—" se ausente). Não toca em
// nada que não esteja entre chaves — preserva emojis, acentos, quebras
// de linha, *negrito* e o que mais estiver no texto.
export function substituir(texto, exemplo) {
  if (!texto) return "";
  return texto.replace(/\{(\w+)\}/g, (_, chave) => {
    const v = exemplo ? exemplo[chave] : undefined;
    return v == null || v === "" ? "—" : String(v);
  });
}

// Cronograma gerado a partir das parcelas reais do contrato. Cada linha:
//   • Parcela X/Y — R$ Z — venc. D
// Cobre qualquer quantidade (2, 3, 10, etc.). Não recalcula nada — usa
// exatamente o que `parcelasDoContrato` devolve.
export function gerarCronograma(parcelas) {
  if (!parcelas || parcelas.length === 0) return "—";
  const total = parcelas.length;
  return parcelas
    .map(
      (p) =>
        `• Parcela ${p.numero}/${total} — ${formatarMoeda(p.valor)} — venc. ${formatarData(p.vencimento)}`
    )
    .join("\n");
}

// Monta o objeto `exemplo` a partir dos dados reais do contrato aberto.
// `valorContrato` usa SEMPRE o valorEmprestado original (nunca saldo).
// `valorVenda`/`entrada`/`nomeProduto` viram "—" se o contrato não os
// tiver (esses campos não são cadastrados hoje em lugar algum do app).
export function montarExemplo(contrato, cliente, parcelas) {
  const nomeCompleto = (cliente && cliente.nomeCompleto) || "";
  const primeiroNome = nomeCompleto.split(" ")[0] || nomeCompleto || "—";

  const taxaJurosLabel =
    contrato && contrato.tipoEmprestimo === "Sem Juros"
      ? "Sem juros"
      : `${(contrato && contrato.juros) || 0}% a.m.`;

  return {
    nome: primeiroNome,
    nomeProduto: (contrato && contrato.nomeProduto) || "—",
    valorContrato: formatarMoeda(contrato && contrato.valorEmprestado),
    valorVenda:
      contrato && contrato.valorVenda != null
        ? formatarMoeda(contrato.valorVenda)
        : "—",
    entrada:
      contrato && contrato.entrada != null
        ? formatarMoeda(contrato.entrada)
        : "—",
    taxaJurosLabel,
    frequencia: (contrato && contrato.frequencia) || "—",
    numeroParcelas: String((contrato && contrato.numeroParcelas) || 0),
    valorParcela: formatarMoeda(contrato && contrato.valorParcela),
    dataInicio: (contrato && formatarData(contrato.dataPrimeiraParcela)) || "—",
    totalReceber: formatarMoeda(contrato && contrato.totalReceber),
    cronograma: gerarCronograma(parcelas || []),
  };
}

// Modelos padrão (fallback usado quando o usuário ainda não tem modelos
// no Firestore, e como complementação caso só tenha um dos dois).
// Textos definidos pelo usuário — não duplicar linhas, não trocar emojis.
export const MODELOS_PADRAO = [
  {
    id: "resumo-emprestimo",
    titulo: "Resumo do contrato",
    texto: `Olá, {nome}! 👋

Segue o resumo do nosso *contrato de empréstimo*:

💰 *Valor emprestado:* {valorContrato}
📈 *Juros:* {taxaJurosLabel}
📆 *Frequência:* {frequencia}
🔢 *Parcelas:* {numeroParcelas}x de {valorParcela}
🗓️ *Início:* {dataInicio}
💵 *Total a pagar:* {totalReceber}

*Cronograma de vencimentos:*
{cronograma}

Qualquer dúvida estou à disposição. Obrigado pela confiança! 🙏`,
  },
  {
    id: "resumo-venda",
    titulo: "Resumo da venda",
    texto: `Opa, {nome}!👋

Segue o resumo do nosso *contrato de Venda*:

{nomeProduto}

💵 Valor da venda: {valorVenda}
✅ Entrada: {entrada}
📆 Frequência: {frequencia}
🔢 Parcelas: {numeroParcelas}x de {valorParcela}
🗓️ Início: {dataInicio}

*Cronograma de vencimentos:*
{cronograma}`,
  },
];

// Atalho: dado um modelo (com {id, texto}) e os dados reais, devolve a
// string final pronta para enviar.
export function gerarMensagem(modelo, contrato, cliente, parcelas) {
  if (!modelo) return "";
  const exemplo = montarExemplo(contrato, cliente, parcelas);
  return substituir(modelo.texto, exemplo);
}
