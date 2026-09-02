import { useEffect, useMemo, useState, useCallback } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Send,
  FileText,
  Pencil,
  Trash2,
  LoaderCircle,
  FileImage,
  UsersRound,
  Settings,
  Home,
  ChartLine,
  ChevronDown,
  X,
  Copy,
  Check,
  MessageCircle,
  FileSignature,
} from "lucide-react";
import AppLayout from "../components/AppLayout";
import { useAuth } from "../context/useAuth";
import { formatarMoeda, formatarTelefone, formatarData, numeroCurto } from "../utils/formatadores";
import { gerarPdfContrato } from "../utils/pdfContrato";
import { buscarContrato, statusContrato, parcelasDoContrato, excluirContrato, listarModelosContrato } from "../services/contractService";
import { calculateDebtRemaining, totalAbatimentos, calculatePrincipalQuitado, getNextOpenInstallment, calculatePenalty } from "../services/paymentCalculations";
import { buscarJurosRecebidos } from "../services/jurosRecebidosService";
import { gerarMensagem, MODELOS_PADRAO } from "../utils/mensagens";
import logoJurex from "../assets/jurex-logo.png";

// Badge de status da parcela (cores alinhadas ao design do sistema)
const STATUS_PARCELA = {
  Paga: { classe: "bg-emerald-50 dark:bg-emerald-500/10 text-jurex", label: "Paga" },
  Pendente: { classe: "bg-amber-50 dark:bg-amber-500/10 text-amber-500", label: "Em dia" },
  Vencida: { classe: "bg-red-50 dark:bg-red-500/10 text-red-500", label: "Vencida" },
  Parcial: { classe: "bg-blue-50 dark:bg-blue-500/10 text-blue-600", label: "Parcial" },
};

const STATUS_CONTRATO = {
  Quitado: { classe: "bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400", label: "Quitado" },
  Atrasado: { classe: "bg-red-50 dark:bg-red-500/10 text-red-500", label: "Atrasado" },
  "Em dia": { classe: "bg-emerald-50 dark:bg-emerald-500/10 text-jurex", label: "Em dia" },
};

const HOJE = new Date();

// Itens do menu da sidebar (visual fixa à esquerda, 240px)
const MENU_ITEMS = [
  { id: "inicio", label: "Início", icon: Home, href: "/dashboard" },
  { id: "contratos", label: "Contratos", icon: FileText, href: "/emprestimos", selected: true },
  { id: "clientes", label: "Clientes", href: "/clientes", icon: UsersRound },
  { id: "relatorios", label: "Relatórios", icon: ChartLine, href: "/relatorios" },
  { id: "configuracoes", label: "Configurações", icon: Settings, href: "#", hasSubmenu: true },
];

// Sub-itens fixos do menu (para o dropdown de Configurações)
const SUB_CONFIG = [
  { to: "/calendario", label: "Calendário" },
  { to: "/perfil", label: "Perfil" },
  { to: "/configuracoes/meus-planos", label: "Meus Planos" },
  { to: "/configuracoes/funcionarios", label: "Funcionários" },
  { to: "/configuracoes/modelos-cobranca", label: "Modelos de cobrança" },
  { to: "/configuracoes/modelos-contrato", label: "Modelos de contrato" },
  { to: "/configuracoes/backup", label: "Backup de dados" },
  { to: "/configuracoes/ajuda", label: "Central de ajuda" },
  { to: "/configuracoes/privacidade", label: "Privacidade" },
  { to: "/configuracoes/sobre", label: "Sobre o Jurex" },
];

export default function EmprestimoDetalhes() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { usuario } = useAuth();

  // carregando | pronto | nao-encontrado | erro
  const [estado, setEstado] = useState("carregando");
  const [contrato, setContrato] = useState(null);
  const [cliente, setCliente] = useState(null);
  const [configAberto, setConfigAberto] = useState(false);

  // Estado do popup "Enviar contrato via WhatsApp"
  const [modalEnvioAberto, setModalEnvioAberto] = useState(false);
  const [abaAtiva, setAbaAtiva] = useState("resumo-emprestimo");
  const [modelos, setModelos] = useState(MODELOS_PADRAO);
  const [textoMensagem, setTextoMensagem] = useState("");
  const [copiado, setCopiado] = useState(false);

  // Recebimentos de juros do contrato (subcoleção Firestore dedicada).
  // Usado para exibir o badge "Juros da semana recebido" nas parcelas
  // cujo recebimento foi feito via modalidade "juros_apenas".
  // Esta coleção é INDEPENDENTE de `pagamentos` (que registra parcelas
  // inteiras, parciais e quitações). Ler de `jurosRecebidos` apenas.
  const [jurosRecebidosContrato, setJurosRecebidosContrato] = useState([]);

  const hoje = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  // Busca contrato + cliente pelo ID real do Firestore
  useEffect(() => {
    if (!usuario || !id) return;
    let ativo = true;
    setEstado("carregando");

    buscarContrato(usuario, id)
      .then((dados) => {
        if (!ativo) return;
        if (!dados) {
          setEstado("nao-encontrado");
          return;
        }
        setContrato(dados.contrato);
        setCliente(dados.cliente);
        setEstado("pronto");
      })
      .catch((err) => {
        if (!ativo) return;
        console.error("Erro ao carregar contrato:", err);
        if (err?.code === "permission-denied") {
          setEstado("nao-encontrado");
        } else {
          setEstado("erro");
        }
      });

    return () => { ativo = false; };
  }, [usuario, id]);

  // Carrega os recebimentos de juros do contrato (subcoleção Firestore dedicada).
  // Necessário para exibir o badge "Juros da semana recebido" nas parcelas
  // que receberam juros via modalidade "juros_apenas".
  useEffect(() => {
    if (!usuario || !id) return;
    let ativo = true;
    console.log("[DIAG] juros encontrados: buscando para contratoId=", id, "uid=", usuario?.uid);
    buscarJurosRecebidos(usuario, id)
      .then((docs) => {
        if (!ativo) return;
        console.log("[DIAG] juros encontrados:", Array.isArray(docs) ? docs.length : 0);
        setJurosRecebidosContrato(Array.isArray(docs) ? docs : []);
      })
      .catch((err) => {
        if (!ativo) return;
        console.error("Erro ao carregar recebimentos de juros:", err);
        setJurosRecebidosContrato([]);
      });
    return () => { ativo = false; };
  }, [usuario, id, contrato?.updatedAt]);

  // Força reload dos dados do Firestore (necessário após pagamento/exclusão)
  const recarregar = useCallback(() => {
    if (!usuario || !id) return;
    let ativo = true;
    setEstado("carregando");
    buscarContrato(usuario, id)
      .then((dados) => {
        if (!ativo) return;
        if (!dados) {
          setEstado("nao-encontrado");
          setContrato(null);
          setCliente(null);
          return;
        }
        setContrato(dados.contrato);
        setCliente(dados.cliente);
        setEstado("pronto");
        // Recarrega também os recebimentos de juros para que badges recém-pagos
        // apareçam imediatamente após o pagamento.
        buscarJurosRecebidos(usuario, id)
          .then((docs) => {
            if (!ativo) return;
            setJurosRecebidosContrato(Array.isArray(docs) ? docs : []);
          })
          .catch(() => { /* silencioso */ });
      })
      .catch((err) => {
        if (!ativo) return;
        if (err?.code === "permission-denied") {
          setEstado("nao-encontrado");
        } else {
          setEstado("erro");
        }
      });
    return () => { ativo = false; };
  }, [usuario, id]);

  // Status do contrato calculado a partir dos dados reais
  const status = useMemo(() => {
    if (!contrato) return "";
    return statusContrato(contrato, hoje);
  }, [contrato, hoje]);

  // Parcelas calculadas a partir dos campos reais do contrato
  const parcelas = useMemo(() => {
    if (!contrato) return [];
    return parcelasDoContrato(contrato, hoje);
  }, [contrato, hoje]);

  // Parcelas COM multa aplicada para EXIBIÇÃO nesta tela.
  // A multa é derivada de `calcularParcelas` (parcelasDoContrato) e somada ao
  // valor congelado apenas para mostrar o valor atualizado na lista e no card
  // "Próximo vencimento". Não é gravada no Firestore, não é exposta em
  // `parcela.valorOriginalParcela` (permanece intocado) e não afeta o cálculo
  // de pagamento em `ReceberPagamento` (que já soma a multa em `valorParcelaOriginal + multa`).
  // - `calcularMultaJuros` (linha 241) e `calculatePenalty` (paymentCalculations)
  //   retornam 0 para parcelas pagas, futuras (v >= hoje) e contratos sem
  //   `cobrarJurosAtraso`. Portanto, apenas parcelas ATRASADAS com multa configurada
  //   ganham acréscimo aqui.
  // - Quando o dia virar, `hoje` muda, `parcelas` é recomputado, e este useMemo
  //   recomputa → o valor exibido cresce automaticamente.
  const parcelasComMulta = useMemo(() => {
    if (!contrato) return parcelas;
    return parcelas.map((p) => {
      const multa = calculatePenalty(contrato, p, hoje);
      if (multa > 0) {
        return { ...p, valor: Math.round((Number(p.valor) + multa) * 100) / 100 };
      }
      return p;
    });
  }, [parcelas, contrato, hoje]);

  // Progresso e resumo financeiro (dados reais — sem alteração de cálculo)
  const progresso = useMemo(() => {
    if (!contrato || !parcelas.length) return { porcentagem: 0, pagas: 0, total: 0, recebido: 0 };
    const total = parcelas.length;
    const pagas = parcelas.filter((p) => p.status === "Paga").length;
    const recebido = parcelas.reduce((s, p) => s + (p.recebido || 0), 0);
    const porcentagem = total > 0 ? (pagas / total) * 100 : 0;
    return { porcentagem, pagas, total, recebido };
  }, [contrato, parcelas]);

  // Saldo atual e principal (dados reais — sem alteração de cálculo)
  const saldos = useMemo(() => {
    if (!contrato) return { saldoPrincipal: 0, valorOriginal: 0, abatimentoTotal: 0, principalQuitado: 0, principalRestante: 0 };
    const valorOriginal = Number(contrato.valorEmprestado) || 0;
    const saldoPrincipal = calculateDebtRemaining(contrato);
    const abatimentoTotal = totalAbatimentos(contrato.abatimentos);
    const principalQuitado = calculatePrincipalQuitado(contrato);
    const principalRestante = Math.max(0, saldoPrincipal);
    return { saldoPrincipal, valorOriginal, abatimentoTotal, principalQuitado, principalRestante };
  }, [contrato]);

  // Próxima parcela em aberto (primeira não paga com saldo > 0).
  // Usa `parcelasComMulta` para que o card "Próximo vencimento" exiba o valor
  // atualizado (original + multa) quando a próxima parcela estiver atrasada
  // e o contrato tiver `cobrarJurosAtraso` configurado.
  const proximaParcela = useMemo(
    () => parcelasComMulta.find((p) => p.status !== "Paga" && Number(p.valor) > 0) || null,
    [parcelasComMulta]
  );

  // Juros recebidos (calculado a partir do contrato — SEM alteração de fórmula)
  const jurosRecebidos = useMemo(() => {
    if (!contrato) return 0;
    const valorEmprestado = Number(contrato.valorEmprestado) || 0;
    const jurosTaxa = Number(contrato.juros) || 0;
    return Math.round((valorEmprestado * (jurosTaxa / 100)) * 100) / 100;
  }, [contrato]);

  // Valor de multa/juros da parcela (cobrarJurosAtraso configurado)
  // Usa a função canônica `calculatePenalty` de `paymentCalculations.js` para
  // garantir coerência com o valor somado em `parcelasComMulta` e o cálculo
  // de pagamento em `ReceberPagamento.jsx`. Parse LOCAL, arredondamento e
  // `valorOriginalParcela` (não `contrato.valorParcela`) preservados.
  function calcularMultaJuros(parcela) {
    return calculatePenalty(contrato, parcela, HOJE);
  }

  // WhatsApp com telefone real do cliente (botão de cada parcela)
  function enviarWhatsappParcela(parcela) {
    if (!cliente) {
      window.alert("Este cliente não tem telefone cadastrado.");
      return;
    }
    const telefone = formatarTelefone(cliente?.telefone ?? "").replace(/\D/g, "");
    if (!telefone) {
      window.alert("Este cliente não tem telefone cadastrado.");
      return;
    }
    const mensagem = [
      `*Cobrança de parcela*`,
      `*Cliente:* ${cliente.nomeCompleto ?? "—"}`,
      `*Contrato:* ${numeroCurto(contrato?.id)}`,
      `*Parcela:* ${parcela.numero}/${parcelas.length}`,
      `*Valor:* ${formatarMoeda(parcela.valor)}`,
      `*Vencimento:* ${formatarData(parcela.vencimento)}`,
    ].join("\n");
    window.open(
      `https://wa.me/55${telefone}?text=${encodeURIComponent(mensagem)}`,
      "_blank",
      "noopener"
    );
  }

  // WhatsApp do contrato (botão principal) — abre o popup de preview
  function abrirModalEnvio() {
    if (!cliente) {
      window.alert("Este cliente não tem telefone cadastrado.");
      return;
    }
    setAbaAtiva("resumo-emprestimo");
    setModalEnvioAberto(true);
  }

  // Carrega os modelos do Firestore na primeira vez que o modal abre.
  // Lazy: não roda no mount da página. Se o usuário não tiver modelos
  // salvos, mantém os MODELOS_PADRAO (que já são o estado inicial).
  useEffect(() => {
    if (!modalEnvioAberto || !usuario) return;
    let ativo = true;
    listarModelosContrato(usuario.uid)
      .then((docs) => {
        if (!ativo || !docs || docs.length === 0) return;
        // Mescla: usa o que veio do Firestore, mas garante que os dois
        // IDs padrão existam (caso o usuário tenha só um salvo).
        const ids = new Set(docs.map((d) => d.id));
        const completos = [...docs];
        MODELOS_PADRAO.forEach((p) => {
          if (!ids.has(p.id)) completos.push(p);
        });
        setModelos(completos);
      })
      .catch(() => {
        // Silencioso: mantém o fallback
      });
    return () => {
      ativo = false;
    };
  }, [modalEnvioAberto, usuario]);

  // Regenera o texto da pré-visualização sempre que o modal abre, a aba
  // muda, os modelos chegam, ou os dados do contrato/parcelas mudam.
  useEffect(() => {
    if (!modalEnvioAberto) return;
    const m =
      modelos.find((x) => x.id === abaAtiva) ||
      MODELOS_PADRAO.find((x) => x.id === abaAtiva);
    if (!m) return;
    setTextoMensagem(gerarMensagem(m, contrato, cliente, parcelas));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modalEnvioAberto, abaAtiva, modelos, contrato, cliente, parcelas]);

  // Copia o conteúdo atual do textarea (não regenera).
  async function copiarMensagem() {
    try {
      await navigator.clipboard.writeText(textoMensagem);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      window.alert("Não foi possível copiar a mensagem.");
    }
  }

  // Abre o WhatsApp com o texto EXATO do textarea (sem regenerar).
  function enviarWhatsapp() {
    if (!cliente) {
      window.alert("Este cliente não tem telefone cadastrado.");
      return;
    }
    const telefone = formatarTelefone(cliente.telefone ?? "").replace(/\D/g, "");
    if (!telefone) {
      window.alert("Este cliente não tem telefone cadastrado.");
      return;
    }
    const url = `https://wa.me/55${telefone}?text=${encodeURIComponent(textoMensagem)}`;
    window.open(url, "_blank", "noopener");
  }

  function fecharModalEnvio() {
    setModalEnvioAberto(false);
    setCopiado(false);
  }

  // Compartilhar PDF atualizado
  function compartilharPdf() {
    if (!contrato) return;
    gerarPdfContrato({ contrato, cliente, logoDataUrl: logoJurex });
  }

  // Navega para a tela de recebimento para a parcela clicada
  function pagar(parcela) {
    if (!contrato || !parcela) return;
    navigate(`/receber-pagamento/${contrato.id}?parcela=${parcela.numero}`);
  }

  // Estorno de parcela paga
  async function estornar(parcela) {
    if (!contrato || !usuario) return;
    const ok = window.confirm(
      `Estornar o pagamento da parcela ${parcela.numero} do contrato ${numeroCurto(contrato.id)}?\nEsta ação não pode ser desfeita.`
    );
    if (!ok) return;
    try {
      await recarregar();
    } catch (err) {
      console.error("Erro ao estornar:", err);
      window.alert("Não foi possível estornar. Verifique e tente novamente.");
    }
  }

  // Editar contrato
  function editar() {
    if (!contrato) return;
    navigate(`/contratos/${contrato.id}/sucesso`);
  }

  // Excluir contrato com confirmação
  async function excluir() {
    if (!contrato || !usuario) return;
    const ok = window.confirm(
      `Excluir o contrato ${numeroCurto(contrato.id)}?\nEsta ação não pode ser desfeita.`
    );
    if (!ok) return;
    try {
      await excluirContrato(usuario, contrato.id);
      navigate("/emprestimos");
    } catch (err) {
      console.error("Erro ao excluir contrato:", err);
      window.alert("Não foi possível excluir o contrato. Verifique as regras do Firestore e tente novamente.");
    }
  }

  // Renegociação (navega para a página de renegociação da parcela)
  function renegociar(parcela) {
    if (!contrato || !parcela) return;
    navigate(`/contratos/${contrato.id}/parcelas/${parcela.numero}/renegociar`);
  }

  // Detecta se esta parcela é a próxima em aberto (destaque visual)
  const isProximaParcela = (p) => proximaParcela?.numero === p.numero;

  // ---------- Layouts de loading / erro / não encontrado ----------

  if (estado === "carregando") {
    return (
      <AppLayout>
        <div className="min-h-svh flex flex-col items-center justify-center gap-3 text-slate-500 dark:text-slate-400">
          <LoaderCircle className="w-7 h-7 text-jurex animate-spin" />
          <p className="text-sm font-semibold">Carregando contrato...</p>
        </div>
      </AppLayout>
    );
  }

  if (estado === "nao-encontrado" || estado === "erro" || !contrato) {
    return (
      <AppLayout>
        <div className="max-w-5xl mx-auto px-6 py-6">
          <section className="mt-16 mb-16 flex flex-col items-center text-center">
            <span className="rounded-2xl bg-amber-50/60 dark:bg-amber-500/10 p-4">
              <svg className="w-7 h-7 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9 3.75h18" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 7.5h.008v.008H12z" />
              </svg>
            </span>
            <h2 className="mt-4 text-base font-bold text-slate-900 dark:text-white">
              {estado === "erro"
                ? "Não foi possível carregar o contrato."
                : "Contrato não encontrado."}
            </h2>
            {estado === "erro" && (
              <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">
                Verifique sua conexão e regras do Firestore.
              </p>
            )}
            <button
              type="button"
              onClick={() => navigate("/emprestimos")}
              className="mt-5 h-11 px-5 rounded-xl bg-gradient-to-r from-jurex to-emerald-500 text-white text-sm font-bold shadow-md shadow-jurex/25 hover:brightness-105 active:scale-[0.98] transition"
            >
              Voltar para contratos
            </button>
          </section>
        </div>
      </AppLayout>
    );
  }

  // ---------- Página completa ----------

  const sb = STATUS_CONTRATO[status] || STATUS_CONTRATO["Em dia"];
  const jurosTexto = contrato.juros ? `${contrato.juros}% a.m.` : "—";

  // "VALOR DO CONTRATO" na tela = valor original - abatimentos explícitos.
  // - Pagamentos de parcela não alteram este valor (só atualizam recebido/progresso).
  // - Abatimentos reduzem este valor.
  // - Estornos de parcela não alteram este valor.
  // valorEmprestado (no Firestore) e valorOriginal no memo continuam imutáveis;
  // o abatimentoTotal vem do array `abatimentos` já persistido pelo backend.
  const valorExibido = Math.max(
    0,
    (saldos.valorOriginal || Number(contrato.valorEmprestado) || 0) -
      (saldos.abatimentoTotal || 0)
  );
  const temAbatimento = (saldos.abatimentoTotal || 0) > 0;
  const saldoDifereDoContrato = Math.round(saldos.saldoPrincipal * 100) !== Math.round(valorExibido * 100);
  const mostrarSaldoAReceber =
    status !== "Quitado" && valorExibido > 0 && saldoDifereDoContrato;

  return (
    <div className="flex min-h-screen">
      {/* Sidebar esquerda — 240px fixo */}
      <aside className="hidden xl:flex xl:flex-col xl:w-[240px] xl:fixed xl:inset-y-0 xl:border-r xl:border-slate-200">
        <div className="flex flex-col flex-1 overflow-y-auto">
          {/* Marca */}
          <div className="flex items-center gap-3 px-6 py-6 border-b border-slate-200">
            <div className="w-[38px] h-[38px] rounded-xl bg-slate-900 flex items-center justify-center flex-shrink-0">
              <span className="text-emerald-500 font-bold text-base">J</span>
            </div>
            <div className="min-w-0">
              <p className="font-bold text-slate-800 text-[15px] truncate max-w-[170px]">
                Jurex
              </p>
              <p className="text-[10px] font-medium tracking-wider text-blue-600 uppercase truncate max-w-[170px]">
                FREDERICO KILLER
              </p>
            </div>
          </div>

          {/* Navegação */}
          <nav className="mt-5 flex flex-col gap-1.5 px-3">
            {MENU_ITEMS.map((item) => {
              const Icon = item.icon;
              const isSelected = !!item.selected;
              const baseClasses = "flex items-center gap-3 h-[42px] mx-[15px] rounded-[11px] px-[14px] text-sm font-medium transition-all";
              const selectedClasses = isSelected
                ? "bg-[#F0FBF6] border border-[#BBF7D0] text-[#059669]"
                : "text-slate-600 hover:bg-slate-50";
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    if (item.hasSubmenu) {
                      setConfigAberto((v) => !v);
                    } else {
                      navigate(item.href);
                    }
                  }}
                  className={`${baseClasses} ${selectedClasses}`}
                >
                  {Icon && <Icon className={`w-[18px] h-[18px] ${isSelected ? "text-[#059669]" : "text-slate-500"}`} />}
                  <span className={isSelected ? "text-[#059669]" : ""}>{item.label}</span>
                  {item.hasSubmenu && (
                    <ChevronDown
                      className={`w-[18px] h-[18px] text-slate-400 transition-transform ml-auto ${configAberto ? "rotate-180" : ""}`}
                    />
                  )}
                </button>
              );
            })}
          </nav>

          {/* Submenu Configurações */}
          {configAberto && (
            <div className="mt-1 mx-[15px] mb-4 border-l border-slate-200 pl-4 space-y-0.5">
              {SUB_CONFIG.map((sub) => (
                <button
                  key={sub.to}
                  type="button"
                  onClick={() => navigate(sub.to)}
                  className="flex items-center gap-2 h-[32px] w-full rounded-[8px] px-2.5 text-xs font-medium text-slate-600 hover:bg-slate-50 transition"
                >
                  {sub.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </aside>

      {/* Área principal */}
      <main className="flex-1 xl:ml-[240px]">
        <div className="max-w-[1240px] mx-auto px-6 py-6 mb-10">

          {/* Header superior */}
          <header className="rounded-[22px] border border-[#E8FAF2] bg-[#F1FCF7] px-6 py-5 shadow-[0_8px_25px_rgba(20,100,70,0.05)]">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3 min-w-0">
                <button
                  type="button"
                  onClick={() => navigate("/emprestimos")}
                  aria-label="Voltar"
                  className="w-[42px] h-[42px] rounded-full bg-white border border-[#E1E7E5] shadow-[0_4px_6px_rgba(15,23,42,0.03)] flex items-center justify-center hover:bg-slate-50 transition"
                >
                  <ArrowLeft className="w-[18px] h-[18px] text-slate-700" />
                </button>
                <button
                  type="button"
                  onClick={() => navigate("/dashboard")}
                  aria-label="Início"
                  className="w-[42px] h-[42px] rounded-full bg-white border border-[#E1E7E5] shadow-[0_4px_6px_rgba(15,23,42,0.03)] flex items-center justify-center hover:bg-slate-50 transition"
                >
                  <Home className="w-[18px] h-[18px] text-slate-600" />
                </button>

                {/* Identificação do contrato */}
                <div className="min-w-0">
                  <h1 className="text-[22px] font-bold text-slate-900">
                    #{contrato.id?.slice(0, 6).toUpperCase() ?? "—"}
                  </h1>
                  <p className="text-[12px] font-medium text-blue-600 uppercase tracking-wider">
                    {cliente?.nomeCompleto ?? contrato?.clienteNome ?? "FREDERICO KILLER"}
                  </p>
                </div>
              </div>

              {/* Status badge */}
              <span
                className={`shrink-0 rounded-full px-[11px] py-1 text-[11px] font-bold flex items-center gap-1 ${sb.classe}`}
              >
                {sb.label}
              </span>
            </div>
          </header>

          {/* Card principal do contrato */}
          <section className="mt-6 rounded-[24px] border border-[#E8FAF2] bg-gradient-to-br from-white to-[#EFFCF6] px-[23px] py-6 shadow-[0_12px_35px_rgba(0,180,100,0.08)]">
            {/* VALOR DO CONTRATO + Status */}
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-[11px] font-bold tracking-[1px] text-slate-600 uppercase">
                  Valor do contrato
                </p>
                <p className="mt-1 text-[30px] font-extrabold text-[#00B86B] tabular-nums">
                  {formatarMoeda(valorExibido)}
                </p>
                {mostrarSaldoAReceber && (
                  <p className="mt-1 text-[11px] text-slate-500 tabular-nums">
                    Saldo a receber:{" "}
                    <span className="font-bold text-slate-700">
                      {formatarMoeda(saldos.saldoPrincipal)}
                    </span>
                  </p>
                )}
              </div>
              <span
                className={`shrink-0 rounded-full px-[11px] py-1 text-[11px] font-bold flex items-center gap-1 ${sb.classe}`}
              >
                <span className="w-2 h-2 rounded-full bg-[#00B86B]" />
                {sb.label}
              </span>
            </div>

            {/* Três caixas na horizontal: Juros / Parcelas / Início */}
            <div className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="rounded-[11px] border border-[#DDE5E2] bg-white/0 px-4 py-3.5 text-center">
                <p className="text-[8px] font-bold tracking-widest text-slate-500 uppercase">
                  Juros
                </p>
                <p className="mt-1 text-[12px] font-bold text-slate-900 tabular-nums">
                  {jurosTexto}
                </p>
              </div>
              <div className="rounded-[11px] border border-[#DDE5E2] bg-white/0 px-4 py-3.5 text-center">
                <p className="text-[8px] font-bold tracking-widest text-slate-500 uppercase">
                  Parcelas
                </p>
                <p className="mt-1 text-[12px] font-bold text-slate-900">
                  {contrato.numeroParcelas ?? 0}x
                </p>
              </div>
              <div className="rounded-[11px] border border-[#DDE5E2] bg-white/0 px-4 py-3.5 text-center">
                <p className="text-[8px] font-bold tracking-widest text-slate-500 uppercase">
                  Início
                </p>
                <p className="mt-1 text-[12px] font-bold text-slate-900">
                  {formatarData(contrato.dataPrimeiraParcela) || "—"}
                </p>
              </div>
            </div>

            {/* Progresso: barra + texto */}
            <div className="mt-6">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-medium text-slate-500">
                  Progresso
                </span>
                <span className="text-sm font-bold text-[#00B86B] tabular-nums">
                  {progresso.porcentagem.toFixed(0)}%
                </span>
              </div>
              <div className="mt-2 h-[7px] rounded-full bg-slate-200 overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-jurex to-emerald-500 transition-all"
                  style={{ width: `${progresso.porcentagem}%` }}
                />
              </div>
              <div className="mt-2 flex items-center justify-between">
                <span className="text-[10px] text-slate-500">
                  <span className="font-bold text-slate-900">{progresso.pagas}</span> de {progresso.total} pagas
                </span>
                <span className="text-[10px]">
                  <span className="text-slate-500">Recebido: </span>
                  <span className="font-bold text-[#00B86B] tabular-nums">{formatarMoeda(progresso.recebido)}</span>
                </span>
              </div>
            </div>

            {/* Próximo vencimento */}
            <div className="mt-6 rounded-[16px] border border-[#CCF7E5] bg-white/60 px-4 py-3.5">
              <p className="text-[9px] font-bold tracking-widest text-slate-500 uppercase">
                Próximo vencimento
              </p>
              {status === "Quitado" ? (
                <p className="mt-1 text-[12px] font-semibold text-slate-500">
                  Contrato quitado
                </p>
              ) : proximaParcela ? (
                <div
                  onClick={() => pagar(proximaParcela)}
                  className="mt-2 cursor-pointer flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-[15px] font-bold text-slate-900">
                      Parcela {proximaParcela.numero} · {formatarMoeda(proximaParcela.valor)}
                    </p>
                    <p className="truncate text-[11px] text-slate-500">
                      Vence {formatarData(proximaParcela.vencimento)}
                    </p>
                  </div>
                </div>
              ) : (
                <p className="mt-1 text-[12px] font-semibold text-slate-500">
                  Sem vencimento pendente
                </p>
              )}
            </div>
          </section>

          {/* Botões de ação — 4 em uma linha */}
          <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <button
              type="button"
              onClick={abrirModalEnvio}
              className="h-[46px] rounded-[14px] bg-[#00B968] text-white text-sm font-bold flex items-center justify-center gap-2 hover:brightness-105 transition"
            >
              <Send className="w-[18px] h-[18px]" />
              Enviar contrato via WhatsApp
            </button>
            <button
              type="button"
              onClick={compartilharPdf}
              className="h-[46px] rounded-[14px] border border-[#B5DEC9] bg-white text-slate-800 text-sm font-bold flex items-center justify-center gap-2 hover:bg-emerald-50 transition"
            >
              <FileImage className="w-[18px] h-[18px] text-slate-700" />
              Compartilhar PDF atualizado
            </button>
            <button
              type="button"
              onClick={editar}
              className="h-[46px] rounded-[14px] border border-[#B5DEC9] bg-white text-slate-800 text-sm font-bold flex items-center justify-center gap-2 hover:bg-emerald-50 transition"
            >
              <Pencil className="w-[18px] h-[18px] text-slate-700" />
              Editar
            </button>
            <button
              type="button"
              onClick={excluir}
              className="h-[46px] rounded-[14px] border border-[#F89C9C] bg-white text-[#FF3B30] text-sm font-bold flex items-center justify-center gap-2 hover:bg-red-50 transition"
            >
              <Trash2 className="w-[18px] h-[18px] text-[#FF3B30]" />
              Excluir
            </button>
          </div>

          {/* Parcelas */}
          <section className="mt-10 mb-12">
            <h2 className="text-[13px] font-bold tracking-[1px] text-slate-800 uppercase">
              Parcelas
            </h2>

            {parcelasComMulta.length === 0 ? (
              <div className="mt-3 rounded-2xl border border-slate-200 bg-white px-5 py-6 text-center">
                <p className="text-sm text-slate-500">
                  Nenhuma parcela.
                </p>
              </div>
            ) : (
              <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                {parcelasComMulta.map((p) => {
                  const sp = STATUS_PARCELA[p.status] || STATUS_PARCELA.Pendente;
                  const multaJuros = calcularMultaJuros(p);
                  const destacada = isProximaParcela(p);

                  // Procura no histórico um recebimento de "Só os juros" para esta parcela.
                  // Pode haver mais de um (vários juros_apenas cumulativos); mostra o mais recente.
                  const jurosRecebidosParcela = jurosRecebidosContrato
                    .filter((h) => Number(h.parcelaNumero) === Number(p.numero) && h.tipo === "juros")
                    .sort((a, b) => {
                      const da = a?.dataRecebimento || "";
                      const db = b?.dataRecebimento || "";
                      return db.localeCompare(da);
                    })[0];

                  return (
                    <article
                      key={p.numero}
                      className={`rounded-[16px] border p-3 shadow-[0_4px_6px_rgba(15,23,42,0.02)] transition-all duration-200 ${
                        destacada
                          ? "border-[#00B86B] bg-white"
                          : "border-[#DDE5E2] bg-white"
                      }`}
                      onClick={() => pagar(p)}
                    >
                      {/* Cabeçalho da parcela */}
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-3 min-w-0">
                          {/* Número da parcela em quadrado */}
                          <div
                            className={`shrink-0 w-[42px] h-[42px] rounded-[11px] flex items-center justify-center transition-colors ${
                              p.status === "Paga"
                                ? "bg-[#E8FAF2] text-[#00B86B]"
                                : destacada
                                ? "bg-[#00B86B] text-white"
                                : "bg-[#FFFBEB] text-[#F59E0B]"
                            }`}
                          >
                            <span className="text-[17px] font-bold">
                              {p.numero}
                            </span>
                          </div>
                          <div className="min-w-0">
                            <p
                              className={`text-[14px] font-bold ${
                                destacada ? "text-slate-900" : "text-slate-900"
                              }`}
                            >
                              {formatarMoeda(p.valor)}
                            </p>
                            <p className="mt-0.5 text-[10px] text-slate-500">
                              Vence {formatarData(p.vencimento)}
                            </p>
                            {multaJuros > 0 && (
                              <p className="mt-0.5 text-[10px] text-red-500">
                                + {formatarMoeda(multaJuros)} multa/juros
                              </p>
                            )}
                          </div>
                        </div>
                        <span
                          className={`shrink-0 rounded-full px-[11px] py-1 text-[10px] font-bold flex items-center gap-1 ${sp.classe}`}
                        >
                          {p.status === "Paga" && (
                            <span className="w-1.5 h-1.5 rounded-full bg-jurex" />
                          )}
                          {sp.label}
                        </span>
                      </div>

                      {/* Badge: juros daquela semana já foram recebidos.
                          Linha própria, entre o cabeçalho e os botões, ocupando
                          a largura total do card. Dados vêm do histórico real
                          (subcoleção Firestore de pagamentos). */}
                      {jurosRecebidosParcela && (
                        <p
                          data-testid={`juros-recebidos-parcela-${p.numero}`}
                          className="mt-2 text-[11px] font-medium text-emerald-600"
                        >
                          ✓ Juros da semana recebido · {formatarMoeda(jurosRecebidosParcela.valorRecebido)} em {formatarData(jurosRecebidosParcela.dataRecebimento)}
                        </p>
                      )}

                      {/* Botões de ação da parcela */}
                      {p.status !== "Paga" ? (
                        <div
                          className="mt-3 flex gap-[10px]"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            onClick={() => enviarWhatsappParcela(p)}
                            className="h-[30px] px-[11px] rounded-full text-[10px] font-bold flex items-center justify-center gap-1 bg-[#E8FAF2] border border-[#B5DEC9] text-[#00B86B] hover:bg-emerald-50 transition"
                          >
                            Cobrar
                          </button>
                          <button
                            type="button"
                            onClick={() => renegociar(p)}
                            className="h-[30px] px-[11px] rounded-full text-[10px] font-bold flex items-center justify-center gap-1 bg-[#FFFBEB] border border-[#FDE68A] text-[#F59E0B] hover:bg-amber-100 transition"
                          >
                            Renegociar
                          </button>
                          <button
                            type="button"
                            onClick={() => pagar(p)}
                            className="h-[30px] px-[11px] rounded-full text-[10px] font-bold flex items-center justify-center gap-1 bg-[#00B86B] text-white hover:brightness-105 transition"
                          >
                            Pagar
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            estornar(p);
                          }}
                          className="mt-3 w-full h-[24px] rounded-full bg-red-50 border border-red-300 text-red-500 text-[11px] font-medium hover:bg-red-100 transition"
                        >
                          ↶ Estornar
                        </button>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </main>

      {/* Modal: Enviar contrato via WhatsApp */}
      {modalEnvioAberto && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={fecharModalEnvio}
          className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-2xl rounded-2xl bg-white shadow-2xl p-5"
          >
            {/* Cabeçalho */}
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-base font-bold text-slate-900">
                  Enviar contrato
                </h2>
                <p className="text-xs text-slate-500">
                  Para {cliente?.nomeCompleto ?? "—"}
                </p>
              </div>
              <button
                type="button"
                onClick={fecharModalEnvio}
                aria-label="Fechar"
                className="shrink-0 rounded-full p-1.5 ring-1 ring-slate-200 text-slate-500 hover:bg-slate-100 transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Seletor de modelo (abas) */}
            <div className="mt-5">
              <p className="text-[10px] font-bold tracking-widest text-slate-500 uppercase">
                Modelo
              </p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {MODELOS_PADRAO.map((m) => {
                  const ativo = abaAtiva === m.id;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setAbaAtiva(m.id)}
                      className={`h-[38px] rounded-full text-xs font-bold flex items-center justify-center gap-2 transition ${
                        ativo
                          ? "bg-[#00B968] text-white shadow"
                          : "bg-white border border-slate-200 text-slate-700 hover:bg-slate-50"
                      }`}
                    >
                      <FileSignature className="w-4 h-4" />
                      {m.titulo}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Pré-visualização + link "Editar modelos" */}
            <div className="mt-5">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-bold tracking-widest text-slate-500 uppercase">
                  Pré-visualização
                </p>
                <button
                  type="button"
                  onClick={() => navigate("/configuracoes/modelos-contrato")}
                  className="text-[11px] font-bold text-[#00B968] flex items-center gap-1 hover:underline"
                >
                  <Pencil className="w-3 h-3" />
                  Editar modelos
                </button>
              </div>
              <textarea
                value={textoMensagem}
                onChange={(e) => setTextoMensagem(e.target.value)}
                rows={10}
                className="mt-2 w-full min-h-[200px] rounded-xl border border-slate-200 bg-slate-50 p-3 text-[13px] text-slate-800 font-mono whitespace-pre-wrap outline-none focus:ring-2 focus:ring-[#00B968]/30 focus:border-[#00B968]"
                placeholder="A mensagem será gerada a partir do modelo selecionado."
              />
              <p className="mt-1 text-[11px] text-slate-500">
                Você pode editar o texto antes de enviar.
              </p>
            </div>

            {/* Rodapé: Copiar + WhatsApp */}
            <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                type="button"
                onClick={copiarMensagem}
                className="h-[44px] rounded-xl bg-white border border-slate-200 text-slate-800 text-sm font-bold flex items-center justify-center gap-2 hover:bg-slate-50 transition"
              >
                {copiado ? (
                  <Check className="w-4 h-4 text-[#00B968]" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
                {copiado ? "Copiado" : "Copiar"}
              </button>
              <button
                type="button"
                onClick={enviarWhatsapp}
                className="h-[44px] rounded-xl bg-[#00B968] text-white text-sm font-bold flex items-center justify-center gap-2 hover:brightness-105 transition"
              >
                <MessageCircle className="w-4 h-4" />
                WhatsApp
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}