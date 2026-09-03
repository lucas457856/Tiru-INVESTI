// Página "Histórico financeiro" — timeline com TODOS os eventos financeiros
// reais já registrados no sistema.
//
// Fontes de dados (todas reais, nenhuma coleção nova criada):
//   1. usuarios/{uid}/contratos/{id}
//        → "Contrato criado" (criadoEm, valorEmprestado, clienteNome)
//
//   2. usuarios/{uid}/contratos/{id}/pagamentos
//        Registrados por `paymentHistoryService.registrarPagamento`,
//        chamado por `processarPagamento` para as modalidades:
//          - parcela_inteira → tipoRecebimento "parcela"  → "Pagamento recebido"
//          - juros_parte_divida → tipoRecebimento "parcial"
//              • se principalAbatido > 0 → "Juros + amortização"
//              • caso contrário         → "Pagamento parcial"
//          - quitar_tudo       → tipoRecebimento "quitacao" → "Contrato quitado"
//
//   3. usuarios/{uid}/contratos/{id}/jurosRecebidos
//        Registrados por `jurosRecebidosService.registrarJurosRecebido`,
//        chamado por `processarPagamento` APENAS para a modalidade
//        "juros_apenas" (NÃO é pagamento de parcela, é apenas histórico
//        de recebimento de juros) → "Só juros".
//
// IMPORTANTE SOBRE RENEGOCIAÇÃO:
//   `parcelasCustom` é gravado SOMENTE em `contractService.renegociarParcela`
//   (verificado por grep no código de produção). Porém, NÃO existe
//   `criadoEm` próprio para a renegociação — apenas o `updatedAt` do
//   contrato é alterado. Como o usuário instruiu que NÃO devemos inferir
//   eventos financeiros apenas por updatedAt (que pode mudar por vários
//   motivos e geraria histórico falso), esta página NÃO renderiza
//   "Parcela renegociada". Quando o sistema passar a registrar uma
//   coleção/timestamp dedicado para renegociação, basta adicioná-lo aqui.
//
// Sem dados mock, sem slice/limit, sem ordenação por id — ordenamos por
// timestamp real do evento.
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Home,
  FileText,
  ArrowDown,
  CheckCircle2,
  RefreshCw,
  CircleDollarSign,
  LoaderCircle,
  Inbox,
  AlertTriangle,
} from "lucide-react";
import { collection, getDocs, query, orderBy } from "firebase/firestore";
import AppLayout from "../components/AppLayout";
import BackButton from "../components/BackButton";
import { db } from "../services/firebase";
import { useAuth } from "../context/useAuth";
import { formatarMoeda, formatarData } from "../utils/formatadores";

// Converte qualquer fonte de data (Firestore Timestamp, ISO string,
// YYYY-MM-DD ou Date) em ms (epoch). Robusto contra drift de timezone.
function paraMs(data) {
  if (!data) return 0;
  if (typeof data.toDate === "function") return data.toDate().getTime();
  if (data instanceof Date) return data.getTime();
  if (typeof data === "string") {
    if (/^\d{4}-\d{2}-\d{2}$/.test(data)) {
      const [y, m, d] = data.split("-").map(Number);
      return new Date(y, m - 1, d).getTime();
    }
    const t = Date.parse(data);
    return Number.isNaN(t) ? 0 : t;
  }
  return 0;
}

// Data que será exibida no card: prioriza criadoEm (Firestore) e cai
// para dataRecebimento (string YYYY-MM-DD).
function dataExibicao(evento) {
  if (evento._tsMs) return new Date(evento._tsMs);
  if (evento.dataRecebimento) {
    return new Date(evento.dataRecebimento.split("T")[0]);
  }
  return new Date();
}

// Ícone por tipo de evento
const ICONES = {
  "contrato-criado": FileText,
  "pagamento": ArrowDown,
  "pagamento-parcial": ArrowDown,
  "quitacao": CheckCircle2,
  "juros-amortizacao": CircleDollarSign,
  "juros-apenas": CircleDollarSign,
};

// Cor da bolinha da timeline: + verde, - vermelho
function corBola(evento) {
  if (evento.sinal === "+") return "bg-Cred Facil";
  if (evento.sinal === "-") return "bg-rose-500";
  return "bg-slate-300";
}

// Cor do valor à direita do card
function corValor(sinal) {
  if (sinal === "+") return "text-Cred Facil";
  if (sinal === "-") return "text-rose-500";
  return "text-slate-700";
}

// Formata "+ R$ 500,00" ou "- R$ 500,00" para o card
function formatarValorAssinado(valor, sinal) {
  const m = formatarMoeda(Math.abs(Number(valor) || 0));
  return `${sinal} ${m}`;
}

// Classifica um pagamento (paymentHistoryService) em um tipo de evento
// da timeline. Mantém o que paymentHistoryService.js REALMENTE grava.
function classificarPagamento(p) {
  const tipoRec = p.tipoRecebimento || "parcela";
  const valor = Number(p.valorRecebido) || 0;
  const principalAbatido = Number(p.principalAbatido) || 0;

  if (tipoRec === "quitacao") {
    return {
      tipo: "quitacao",
      titulo: "Contrato quitado",
      sinal: "+",
      valor,
    };
  }
  if (tipoRec === "parcial") {
    // Modalidade `juros_parte_divida` no processarPagamento.
    // Só classificamos como "Juros + amortização" quando há principal
    // abatido de fato — caso contrário é um pagamento parcial genérico.
    if (principalAbatido > 0) {
      return {
        tipo: "juros-amortizacao",
        titulo: "Juros + amortização",
        sinal: "+",
        valor,
        principalAbatido,
      };
    }
    return {
      tipo: "pagamento-parcial",
      titulo: "Pagamento parcial",
      sinal: "+",
      valor,
    };
  }
  // "parcela" (modalidade parcela_inteira)
  return {
    tipo: "pagamento",
    titulo: "Pagamento recebido",
    sinal: "+",
    valor,
  };
}

export default function HistoricoFinanceiro() {
  const navigate = useNavigate();
  const { usuario } = useAuth();

  const [eventos, setEventos] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(null);

  useEffect(() => {
    if (!usuario) return undefined;
    let cancelado = false;

    async function carregar() {
      setCarregando(true);
      setErro(null);
      try {
        // 1) Todos os contratos do usuário (sem slice/limit).
        const contratosSnap = await getDocs(
          query(collection(db, "usuarios", usuario.uid, "contratos"))
        );
        const contratos = contratosSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

        // 2) Para cada contrato, busca pagamentos e jurosRecebidos em paralelo.
        //    Erros em subcoleções individuais NÃO derrubam o histórico inteiro:
        //    se um contrato não tiver pagamentos/jurosRecebidos, simplesmente
        //    pulamos (não tratamos "coleção vazia" como erro).
        const resultados = await Promise.all(
          contratos.map(async (c) => {
            const [pagResult, jurResult] = await Promise.allSettled([
              getDocs(
                query(
                  collection(db, "usuarios", usuario.uid, "contratos", c.id, "pagamentos"),
                  orderBy("criadoEm", "asc")
                )
              ),
              getDocs(
                query(
                  collection(db, "usuarios", usuario.uid, "contratos", c.id, "jurosRecebidos"),
                  orderBy("criadoEm", "asc")
                )
              ),
            ]);
            return {
              contrato: c,
              pagamentos:
                pagResult.status === "fulfilled"
                  ? pagResult.value.docs.map((d) => ({ id: d.id, ...d.data() }))
                  : [],
              jurosRecebidos:
                jurResult.status === "fulfilled"
                  ? jurResult.value.docs.map((d) => ({ id: d.id, ...d.data() }))
                  : [],
            };
          })
        );

        // 3) Monta a lista de eventos.
        const lista = [];
        for (const { contrato, pagamentos, jurosRecebidos } of resultados) {
          const clienteNome =
            contrato.clienteNome || contrato.nome || "Cliente";
          const criadoMs = paraMs(contrato.criadoEm);

          // (a) Contrato criado
          if (criadoMs > 0) {
            lista.push({
              _id: `criado-${contrato.id}`,
              _tsMs: criadoMs,
              tipo: "contrato-criado",
              titulo: "Contrato criado",
              descricao: formatarMoeda(contrato.valorEmprestado || 0),
              valor: Number(contrato.valorEmprestado) || 0,
              sinal: "-",
              contratoId: contrato.id,
              clienteNome,
            });
          }

          // (b) Pagamentos (registrados por paymentHistoryService)
          for (const p of pagamentos) {
            const tsMs = paraMs(p.criadoEm) || paraMs(p.dataRecebimento);
            const cls = classificarPagamento(p);
            let descricao;
            if (cls.tipo === "quitacao") {
              descricao = `${clienteNome} - quitação total`;
            } else if (cls.tipo === "juros-amortizacao") {
              descricao = `${clienteNome} - amortizou ${formatarMoeda(cls.principalAbatido)}`;
            } else if (cls.tipo === "pagamento-parcial") {
              descricao = `${clienteNome} - pagamento parcial`;
            } else {
              const num = p.parcelaNumero != null ? `Parcela ${p.parcelaNumero}` : "Parcela";
              descricao = `${num} - ${clienteNome}`;
            }
            lista.push({
              _id: `pag-${p.id}`,
              _tsMs: tsMs,
              dataRecebimento: p.dataRecebimento,
              tipo: cls.tipo,
              titulo: cls.titulo,
              descricao,
              valor: cls.valor,
              sinal: cls.sinal,
              contratoId: contrato.id,
              clienteNome,
            });
          }

          // (c) jurosRecebidos (modalidade "juros_apenas")
          for (const j of jurosRecebidos) {
            const tsMs = paraMs(j.criadoEm) || paraMs(j.dataRecebimento);
            const valor = Number(j.valorRecebido) || 0;
            const num = j.parcelaNumero != null ? `Parcela ${j.parcelaNumero}` : "Parcela";
            lista.push({
              _id: `jur-${j.id}`,
              _tsMs: tsMs,
              dataRecebimento: j.dataRecebimento,
              tipo: "juros-apenas",
              titulo: "Só juros",
              descricao: `${clienteNome} - juros da ${num.toLowerCase()}`,
              valor,
              sinal: "+",
              contratoId: contrato.id,
              clienteNome,
            });
          }
          // (d) Renegociação intencionalmente OMITIDA: parcelasCustom é
          //     gravado apenas por renegociarParcela, mas não possui
          //     timestamp próprio da operação. Conforme instrução do
          //     usuário, não inferimos eventos a partir do updatedAt.
        }

        if (!cancelado) {
          // Ordena do MAIS RECENTE para o MAIS ANTIGO.
          lista.sort((a, b) => b._tsMs - a._tsMs);
          setEventos(lista);
          setCarregando(false);
        }
      } catch (err) {
        console.error("Erro ao carregar histórico financeiro:", err);
        if (!cancelado) {
          setErro(err?.message || "Não foi possível carregar o histórico.");
          setCarregando(false);
        }
      }
    }

    carregar();
    return () => {
      cancelado = true;
    };
  }, [usuario]);

  const totalEventos = useMemo(() => eventos.length, [eventos]);

  return (
    <AppLayout>
      <div className="min-h-svh bg-slate-50 dark:bg-slate-950">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 pb-16">
          {/* Cabeçalho verde claro com botões circulares */}
          <div className="rounded-2xl bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-100 dark:border-emerald-500/20 px-5 py-4 sm:px-6 sm:py-5 mb-8">
            <div className="flex items-center gap-3">
              <BackButton className="w-9 h-9 sm:w-10 sm:h-10" iconSize="w-4 h-4" />
              <button
                type="button"
                onClick={() => navigate("/dashboard")}
                aria-label="Ir para o Início"
                className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-700 shadow-[0_2px_4px_rgba(15,23,42,0.04)] flex items-center justify-center text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition"
              >
                <Home className="w-4 h-4" />
              </button>
              <h1 className="ml-2 sm:ml-3 text-lg sm:text-xl font-extrabold text-slate-900 dark:text-white">
                Histórico financeiro
              </h1>
            </div>
          </div>

          {/* Loading */}
          {carregando && (
            <div className="flex flex-col items-center justify-center py-20 text-slate-500 dark:text-slate-400">
              <LoaderCircle className="w-7 h-7 animate-spin text-Cred Facil" />
              <p className="mt-3 text-sm font-medium">Carregando histórico…</p>
            </div>
          )}

          {/* Erro */}
          {!carregando && erro && (
            <div className="rounded-2xl border border-rose-200 dark:border-rose-500/30 bg-rose-50 dark:bg-rose-500/10 p-5 flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-bold text-rose-700 dark:text-rose-300">
                  Não foi possível carregar o histórico
                </p>
                <p className="mt-1 text-xs text-rose-600/80 dark:text-rose-300/80">
                  {erro}
                </p>
              </div>
            </div>
          )}

          {/* Vazio */}
          {!carregando && !erro && totalEventos === 0 && (
            <div className="flex flex-col items-center justify-center py-20 text-slate-400 dark:text-slate-500">
              <Inbox className="w-10 h-10" />
              <p className="mt-3 text-sm font-semibold">
                Nenhum histórico financeiro encontrado.
              </p>
            </div>
          )}

          {/* Timeline */}
          {!carregando && !erro && totalEventos > 0 && (
            <div className="relative pl-12 sm:pl-14">
              <div className="absolute left-5 sm:left-6 top-3 bottom-3 w-px bg-slate-200 dark:bg-slate-800" />

              <ol className="space-y-4 sm:space-y-5">
                {eventos.map((ev) => {
                  const Icone = ICONES[ev.tipo] || FileText;
                  return (
                    <li key={ev._id} className="relative">
                      <span
                        className={`absolute -left-7 sm:-left-8 top-5 sm:top-6 w-4 h-4 rounded-full ${corBola(
                          ev
                        )} ring-4 ring-white dark:ring-slate-950 flex items-center justify-center`}
                        aria-hidden="true"
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-white/90" />
                      </span>

                      <article className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5 shadow-sm hover:shadow-md transition">
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2.5">
                              <span className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 flex items-center justify-center shrink-0">
                                <Icone className="w-4 h-4" />
                              </span>
                              <p className="text-sm sm:text-[15px] font-extrabold text-slate-900 dark:text-white truncate">
                                {ev.titulo}
                              </p>
                            </div>
                            <p className="mt-1.5 text-xs sm:text-sm text-slate-500 dark:text-slate-400 break-words">
                              {ev.descricao}
                            </p>
                            <p className="mt-1 text-[11px] sm:text-xs text-slate-400 dark:text-slate-500">
                              {formatarData(dataExibicao(ev))}
                            </p>
                          </div>
                          <p
                            className={`shrink-0 text-sm sm:text-[15px] font-extrabold tabular-nums whitespace-nowrap ${corValor(
                              ev.sinal
                            )}`}
                          >
                            {formatarValorAssinado(ev.valor, ev.sinal)}
                          </p>
                        </div>
                      </article>
                    </li>
                  );
                })}
              </ol>
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
