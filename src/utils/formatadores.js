// Formatações compartilhadas entre páginas

export function formatarMoeda(valor) {
  return (Number(valor) || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

// Aceita Timestamp do Firestore, ISO string, Date ou string YYYY-MM-DD.
// ATENÇÃO: string "YYYY-MM-DD" é interpretada pelo Date constructor como UTC
// (meia-noite), o que causa drift de 1 dia no fuso horário brasileiro (UTC-3)
// — ex: "2027-01-30" vira 29/01. Fazemos parse LOCAL explícito para preservar
// o dia do calendário exatamente como gravado.
export function formatarData(data) {
  if (!data) return "";
  let d;
  if (typeof data.toDate === "function") {
    d = data.toDate();
  } else if (typeof data === "string" && /^\d{4}-\d{2}-\d{2}$/.test(data)) {
    // YYYY-MM-DD: parse LOCAL (não UTC) — preserva o dia do calendário
    const partes = data.split("-").map(Number);
    d = new Date(partes[0], partes[1] - 1, partes[2]);
  } else {
    d = new Date(data);
  }
  return isNaN(d) ? "" : d.toLocaleDateString("pt-BR");
}

// Máscara de exibição do CPF a partir dos dígitos
export function formatarCpf(cpf) {
  if (!cpf) return "-";
  const d = String(cpf).replace(/\D/g, "").padStart(11, "0");
  return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
}

// Número curto de exibição derivado do ID real do documento (#EA382)
export function numeroCurto(id) {
  return `#${String(id ?? "").slice(0, 6).toUpperCase()}`;
}

// Máscara de exibição do telefone a partir dos dígitos
export function formatarTelefone(telefone) {
  const d = String(telefone ?? "").replace(/\D/g, "");
  if (!d) return "";
  if (d.length <= 10) {
    return d.replace(/(\d{2})(\d)/, "($1) $2").replace(/(\d{4})(\d)/, "$1-$2");
  }
  return d
    .replace(/(\d{2})(\d)/, "($1) $2")
    .replace(/(\d{5})(\d)/, "$1-$2")
    .slice(0, 15);
}
