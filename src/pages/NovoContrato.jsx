import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  House,
  Save,
  LoaderCircle,
  Trash2,
  TriangleAlert,
  UserPlus,
  Plus,
  X,
  Check,
  Search,
  ChevronDown,
  Lock,
} from "lucide-react";
import AppLayout from "../components/AppLayout";
import BackButton from "../components/BackButton";
import { useAuth } from "../context/useAuth";
import { useEffectiveUid } from "../hooks/useEffectiveUid";
import { useDonoAdmin } from "../hooks/useDonoAdmin";
import { db } from "../services/firebase";
import { collection, doc, getDocs, query, serverTimestamp, updateDoc, where } from "firebase/firestore";
import { useContratos } from "../hooks/useContratos";
import { formatarMoeda, formatarData } from "../utils/formatadores";
import { buscarContrato, statusContrato, parcelasDoContrato, excluirContrato } from "../services/contractService";
import { mostrarNotificacaoNativa } from "../utils/notifications";
import { criarContrato as criarContratoApi } from "../services/adminService";
import { notifyWrite as syncNotifyWrite } from "../services/sync/SyncManager";
import {
  dispatchNotificationEvent,
  obterDeviceIdLocal,
} from "../services/notificationEvents";
import logoJurex from "../assets/jurex-logo.png";

// Badge de status da parcela (cores alinhadas ao design do sistema)
const STATUS_PARCELA = {
  Paga: { classe: "bg-emerald-50 dark:bg-emerald-500/10 text-jurex", label: "Paga" },
  Pendente: { classe: "bg-amber-50 dark:bg-amber-500/10 text-amber-500", label: "Em dia" },
  Vencida: { classe: "bg-red-50 dark:bg-red-500/10 text-red-500", label: "Vencida" },
  Parcial: { classe: "bg-blue-50 dark:bg-blue-500/10 text-blue-600", label: "Parcial" },
};

// Badge de status do contrato
const STATUS_CONTRATO = {
  Quitado: { classe: "bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400", label: "Quitado" },
  Atrasado: { classe: "bg-red-50 dark:bg-red-500/10 text-red-500", label: "Atrasado" },
  "Em dia": { classe: "bg-emerald-50 dark:bg-emerald-500/10 text-jurex", label: "Em dia" },
};

export default function NovoContrato() {
  const navigate = useNavigate();
  const { usuario } = useAuth();
  const effectiveUid = useEffectiveUid();
  // Quando a rota carrega com /emprestimos/:id/editar, o `id` é o ID real
  // do contrato no Firestore. Ausência de `id` => modo criação.
  const { id: idEdicao } = useParams();
  const modoEdicao = Boolean(idEdicao);
  // Limites, permissões e status do DONO (defaults permissivos
  // aplicados automaticamente — ver useDonoAdmin). Usado para
  // bloquear o submit quando o limite de contratos foi atingido
  // ou quando a permissão `criarContratos` foi revogada.
  // A defesa real continua no endpoint server-side
  // /api/admin/criar-contrato, que valida o limite no Admin SDK
  // e o Firestore Rules nega create direto do client SDK.
  const { permissoes, limites, status: statusDono, plan, loading: loadingDono } = useDonoAdmin();
  // Contagem atual de contratos do escopo efetivo. Vem da fonte única
  // (useContratos / SyncManager) — 1 listener de `usuarios/{uid}/contratos`
  // por sessão, compartilhado com o resto do app. No modo edição, a
  // checagem do limite não se aplica (editar não cria novo documento).
  const { data: listaContratos } = useContratos();
  const qtdContratos = listaContratos.length;

  // Formulário
  const [valor, setValor] = useState("");
  const [parcelas, setParcelas] = useState("1");
  const [juros, setJuros] = useState("");
  const [tipoEmprestimo, setTipoEmprestimo] = useState("Com Juros");
  // tipoJuros define COMO os juros são aplicados:
  //   "parcela" → juros cobrado em CADA parcela (sem dividir por N)
  //               Ex: 500/35%/2 → 250+175 = R$ 425,00; total R$ 850; lucro R$ 350.
  //   "total"   → juros aplicado UMA ÚNICA VEZ sobre o valor emprestado,
  //               dividido entre as parcelas.
  //               Ex: 500/35%/2 → 250+87,50 = R$ 337,50; total R$ 675; lucro R$ 175.
  // Default: "parcela" (preserva UX dos contratos novos). Contratos antigos
  // sem `tipoJuros` no Firestore caem no fallback do helper de cálculo.
  const [tipoJuros, setTipoJuros] = useState("parcela");
  const [frequencia, setFrequencia] = useState("Mensal");
  // Data da primeira parcela: preenche com a data de HOJE (local) ao abrir a tela.
  // Formato YYYY-MM-DD, compatível com <input type="date">.
  const [dataPrimeira, setDataPrimeira] = useState(() => {
    const hoje = new Date();
    const ano = hoje.getFullYear();
    const mes = String(hoje.getMonth() + 1).padStart(2, "0");
    const dia = String(hoje.getDate()).padStart(2, "0");
    return `${ano}-${mes}-${dia}`;
  });
  const [observacao, setObservacao] = useState("");
  const [temObservacao, setTemObservacao] = useState(false);
  const [jurosAtraso, setJurosAtraso] = useState("");
  const [modoJurosAtraso, setModoJurosAtraso] = useState("% ao valor da parcela");
  const [jurosAtrasoValor, setJurosAtrasoValor] = useState("");

  // Cliente
  const [clienteSel, setClienteSel] = useState(null);
  const [clientes, setClientes] = useState([]);
  const [carregandoClientes, setCarregandoClientes] = useState(true);
  const [buscaCliente, setBuscaCliente] = useState("");
  const [mostraDropdown, setMostraDropdown] = useState(false);

  // Estados
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  const valorNumero = parseFloat(valor.replace(/\D/g, "")) / 100 || 0;

  // Carrega clientes do Firestore do usuário autenticado.
  // Usa o "effective uid" para funcionar tanto para o dono
  // (effectiveUid === usuario.uid) quanto para o funcionário
  // (effectiveUid === ownerUid do funcionário).
  useEffect(() => {
    if (!effectiveUid) return;
    setCarregandoClientes(true);
    const q = query(
      collection(db, "clientes"),
      where("ownerId", "==", effectiveUid)
    );
    getDocs(q).then((snap) => {
      const lista = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setClientes(lista);
      setCarregandoClientes(false);
    }).catch(() => setCarregandoClientes(false));
  }, [effectiveUid]);

  // Regra de bloqueio (espelha Emprestimos.jsx). limite.contratos
  // = 0 significa "sem limite" — não bloqueia. permissoes.
  // criarContratos = false → bloqueia sempre. status =
  // "bloqueado" → bloqueia sempre. No modo edição, a checagem
  // não se aplica (não cria novo documento). plan === "pro" →
  // ilimitado (nunca bloqueia por limite).
  const ehPro = plan === "pro";
  const limiteContratos = limites.contratos;
  const contaBloqueada = statusDono === "bloqueado";
  const permissaoNegada =
    !contaBloqueada && permissoes.criarContratos === false;
  const limiteAtingido =
    !modoEdicao &&
    !loadingDono &&
    !ehPro &&
    !contaBloqueada &&
    !permissaoNegada &&
    limiteContratos > 0 &&
    qtdContratos >= limiteContratos;
  const cadastroBloqueado = contaBloqueada || permissaoNegada || limiteAtingido;

  // Filtra clientes pela busca
  const clientesFiltrados = useMemo(() => {
    if (!buscaCliente.trim()) return clientes;
    return clientes.filter(
      (c) =>
        (c.nomeCompleto?.toLowerCase() ?? "").includes(buscaCliente.toLowerCase()) ||
        (c.cpf?.toLowerCase() ?? "").includes(buscaCliente.toLowerCase())
    );
  }, [clientes, buscaCliente]);

  // Ref do wrapper do campo de cliente (para click-outside)
  const wrapperClienteRef = useRef(null);

  // Fecha o dropdown ao clicar fora do componente
  useEffect(() => {
    if (!mostraDropdown) return;
    function onClickOutside(e) {
      if (wrapperClienteRef.current && !wrapperClienteRef.current.contains(e.target)) {
        setMostraDropdown(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [mostraDropdown]);

  // Fecha o dropdown ao pressionar ESC
  useEffect(() => {
    if (!mostraDropdown) return;
    function onKey(e) {
      if (e.key === "Escape") setMostraDropdown(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [mostraDropdown]);

  // Estado de carregamento do contrato no modo edição.
  //   carregando  : busca inicial no Firestore
  //   pronto      : dados carregados, formulário liberado
  //   nao-encontrado : id inexistente / sem permissão
  //   erro        : falha de rede / permissão
  const [estadoEdicao, setEstadoEdicao] = useState(modoEdicao ? "carregando" : "pronto");
  // Snapshot do contrato carregado (validação / debug). useRef porque não
  // precisa re-renderizar — só consulta durante o submit.
  const contratoOriginalRef = useRef(null);

  // Pré-preenche o formulário com os dados reais do contrato em modo edição.
  // IMPORTANTE: o array `abatimentos` é PRESERVADO no Firestore — apenas os
  // campos editáveis são recarregados para o estado do formulário. Pagamentos
  // e histórico NÃO são tocados aqui.
  useEffect(() => {
    if (!modoEdicao) return;
    if (!effectiveUid || !idEdicao) return;
    let ativo = true;
    setEstadoEdicao("carregando");
    buscarContrato({ uid: effectiveUid }, idEdicao)
      .then((dados) => {
        if (!ativo) return;
        if (!dados) {
          setEstadoEdicao("nao-encontrado");
          return;
        }
        const c = dados.contrato;
        contratoOriginalRef.current = c;

        // Campos financeiros
        if (c.valorEmprestado !== undefined && c.valorEmprestado !== null) {
          setValor(formatarMoedaExibicao(Number(c.valorEmprestado)));
        }
        if (c.numeroParcelas !== undefined && c.numeroParcelas !== null) {
          setParcelas(String(c.numeroParcelas));
        }
        if (c.juros !== undefined && c.juros !== null) {
          setJuros(String(c.juros));
        }
        // "Com Juros" se houver juros > 0, senão "Sem Juros"
        setTipoEmprestimo(Number(c.juros) > 0 ? "Com Juros" : "Sem Juros");
        // tipoJuros só faz sentido quando há juros. Default = "parcela" para
        // contratos novos. Contratos antigos sem o campo preservam o estado
        // inicial ("parcela") na UI, mas o cálculo no Firestore respeita o
        // fallback do helper.
        if (c.tipoJuros === "total" || c.tipoJuros === "parcela") {
          setTipoJuros(c.tipoJuros);
        }
        if (c.frequencia) {
          setFrequencia(c.frequencia);
        }

        // Data da primeira parcela — Firestore pode ter Timestamp, string ISO
        // ou Date. Normaliza para YYYY-MM-DD (input[type=date]) sem drift de TZ.
        let dataStr = "";
        if (c.dataPrimeiraParcela) {
          if (typeof c.dataPrimeiraParcela === "string") {
            dataStr = c.dataPrimeiraParcela.slice(0, 10);
          } else if (typeof c.dataPrimeiraParcela.toDate === "function") {
            const d = c.dataPrimeiraParcela.toDate();
            const yyyy = d.getFullYear();
            const mm = String(d.getMonth() + 1).padStart(2, "0");
            const dd = String(d.getDate()).padStart(2, "0");
            dataStr = `${yyyy}-${mm}-${dd}`;
          }
        }
        if (dataStr) setDataPrimeira(dataStr);

        // Juros em atraso
        if (c.cobrarJurosAtraso) {
          setJurosAtraso("sim");
          if (c.modoJurosAtraso) setModoJurosAtraso(c.modoJurosAtraso);
          if (c.jurosAtrasoValor !== undefined && c.jurosAtrasoValor !== null) {
            // Exibe como string simples ("10", "2.5") — o input filtra a vírgula
            setJurosAtrasoValor(String(c.jurosAtrasoValor));
          }
        } else {
          setJurosAtraso("");
        }

        // Observação
        if (c.observacao && String(c.observacao).trim() !== "") {
          setTemObservacao(true);
          setObservacao(c.observacao);
        } else {
          setTemObservacao(false);
          setObservacao("");
        }

        // Cliente: usa o cliente que veio em `dados.cliente` (validado por
        // ownerId) ou, se não vier, busca o clienteId diretamente.
        if (dados.cliente) {
          setClienteSel(dados.cliente);
          setBuscaCliente("");
        } else if (c.clienteId) {
          getDoc(doc(db, "clientes", c.clienteId))
            .then((snap) => {
              if (!ativo) return;
              if (snap.exists() && snap.data().ownerId === effectiveUid) {
                setClienteSel({ id: snap.id, ...snap.data() });
              }
            })
            .catch(() => {});
        }

        setEstadoEdicao("pronto");
      })
      .catch(() => {
        if (ativo) setEstadoEdicao("erro");
      });
    return () => {
      ativo = false;
    };
  }, [modoEdicao, usuario, idEdicao]);

  // Formata o valor enquanto digita (R$ 0,00)
  function formatarValor(e) {
    const digits = e.target.value.replace(/\D/g, "");
    if (!digits) {
      setValor("");
      return;
    }
    const num = Number(digits) / 100;
    setValor(num.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));
  }

  // Juros como número (ex: "35" → 35)
  const jurosNumero = parseFloat(juros.replace(",", ".")) || 0;
  const parcelasNumero = parseInt(parcelas, 10) || 0;

  // Resumo calculado dinamicamente.
  // REGRAS DO SISTEMA (com juros):
  //   - tipoJuros === "total" ("Sobre o total"):
  //       juros       = valorEmprestado × (taxa / 100)        [UMA ÚNICA VEZ]
  //       totalReceber = valorEmprestado + juros
  //       valorParcela = totalReceber / numeroParcelas
  //       lucro       = totalReceber - valorEmprestado
  //       Ex: 500/35%/2 → 337,50 / 675,00 / 175,00.
  //   - tipoJuros === "parcela" (default — "Por parcela"):
  //       principalPorParcela = valorEmprestado / numeroParcelas
  //       jurosPorParcela     = valorEmprestado × (taxa / 100)   [EM CADA PARCELA]
  //       valorParcela        = principalPorParcela + jurosPorParcela
  //       totalReceber        = valorParcela × numeroParcelas
  //       lucro               = totalReceber - valorEmprestado
  //       Ex: 500/35%/2 → 425,00 / 850,00 / 350,00.
  // A frequência (Semanal, Mensal, etc.) controla apenas DATAS, não o total.
  // Para "Sem Juros": valorParcela = valorEmprestado / numeroParcelas.
  const resumo = useMemo(() => {
    const totalParcelas = Math.max(parcelasNumero, 1);

    // "Sem Juros": parcela = principal ÷ N, sem juros.
    if (tipoEmprestimo !== "Com Juros") {
      const valorParcela = totalParcelas > 0
        ? Math.round((valorNumero / totalParcelas) * 100) / 100
        : 0;
      return {
        valorParcela,
        totalReceber: valorNumero,
        jurosTotal: 0,
        lucro: 0,
        valorOriginal: valorNumero,
      };
    }

    // "Sobre o total": juros aplicado uma vez sobre o valor original,
    // dividido entre as parcelas.
    if (tipoJuros === "total") {
      const jurosTotal = Math.round(valorNumero * (jurosNumero / 100) * 100) / 100;
      const totalReceber = Math.round((valorNumero + jurosTotal) * 100) / 100;
      const valorParcela = totalParcelas > 0
        ? Math.round((totalReceber / totalParcelas) * 100) / 100
        : 0;
      return {
        valorParcela,
        totalReceber,
        jurosTotal,
        lucro: jurosTotal,
        valorOriginal: valorNumero,
      };
    }

    // "Por parcela" (default): juros cobrado em CADA parcela.
    const principalPorParcela = valorNumero / totalParcelas;
    const jurosPorParcelaValor = valorNumero * (jurosNumero / 100);
    const valorParcela = Math.round((principalPorParcela + jurosPorParcelaValor) * 100) / 100;
    const totalReceber = Math.round(valorParcela * totalParcelas * 100) / 100;
    const lucro = Math.round((totalReceber - valorNumero) * 100) / 100;
    return {
      valorParcela,
      totalReceber,
      jurosTotal: lucro,
      lucro,
      valorOriginal: valorNumero,
    };
  }, [valorNumero, jurosNumero, parcelasNumero, tipoEmprestimo, tipoJuros]);

  function formatarMoedaExibicao(v) {
    return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }

  function formatarMoedaDisplay(v) {
    return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }

  async function criarContrato(e) {
    e.preventDefault();
    setErro("");
    if (!clienteSel) return setErro(modoEdicao ? "Selecione um cliente antes de salvar as alterações." : "Selecione um cliente antes de criar o contrato.");
    if (valorNumero <= 0) return setErro("Informe um valor emprestado válido.");
    if (parcelasNumero <= 0) return setErro("Informe um número de parcelas válido.");
    if (tipoEmprestimo === "Com Juros" && jurosNumero <= 0) {
      return setErro("Informe os juros ao mês.");
    }
    if (!usuario) return setErro("Usuário não autenticado.");
    if (!effectiveUid) return setErro("Sessão sem escopo de proprietário.");

    // Bloqueio de UX antes de chamar o endpoint. Aplica-se
    // SOMENTE ao modo de criação — em modo edição, o
    // updateDoc apenas altera o documento existente e não
    // cria novo, portanto o limite de quantidade não se aplica.
    // A defesa real está no servidor (Admin SDK) e nas
    // Firestore Rules, mas este early-return evita round-trip
    // e dá feedback imediato ao usuário.
    if (!modoEdicao && cadastroBloqueado) {
      if (contaBloqueada) {
        return setErro("Conta bloqueada. Entre em contato com o administrador.");
      }
      if (permissaoNegada) {
        return setErro(
          "A criação de contratos foi bloqueada pelo administrador. Entre em contato para liberar."
        );
      }
      return setErro(
        `Limite de contratos atingido. Seu limite atual é de ${limiteContratos} ${
          limiteContratos === 1 ? "contrato" : "contratos"
        }. Entre em contato com o administrador para aumentar seu limite.`
      );
    }

    try {
      setSalvando(true);

      // Subcoleção por usuário: usuarios/{effectiveUid}/contratos
      // (effectiveUid = dono para o proprietário; = ownerUid para o
      // funcionário). Lida por Emprestimos.jsx via useEffectiveUid().

      if (modoEdicao) {
        // ====== MODO EDIÇÃO ======
        // Atualiza APENAS o documento existente (NÃO cria novo). Preserva:
        //   - ID original (Firestore docRef.id)
        //   - pagamentos já realizados (parcelasPagas, valorRecebido, jurosRecebidos)
        //   - histórico de abatimentos (`abatimentos` array, `abatimentoTotal`)
        //   - dataProximo (recalculada via getNextOpenInstallment se alterado)
        //   - vencimentosCustom / parcelasCustom (renegociações anteriores)
        //   - criadoEm (timestamp original)
        //   - createdBy (NÃO é alterado em edição)
        // Apenas os CAMPOS EDITÁVEIS no formulário são sobrescritos.
        //
        // ATENÇÃO: o array `parcelas` é RECALCULADO a partir de calcularParcelas
        // com base nos novos parâmetros. As parcelas já PAGADAS permanecem
        // preservadas na lógica de `parcelasDoContrato` (linhas que tratam
        // status === "Paga"). Parcelas pagas NÃO são recriadas.
        const ref = doc(db, "usuarios", effectiveUid, "contratos", idEdicao);
        await updateDoc(ref, {
          // Vínculo com o cliente
          clienteId: clienteSel.id,
          clienteNome: clienteSel.nomeCompleto,
          // Dados financeiros
          nome: clienteSel.nomeCompleto,
          valorEmprestado: valorNumero,
          valorParcela: resumo.valorParcela,
          totalReceber: resumo.totalReceber,
          // juros: zera em modo "Sem Juros" para refletir a escolha do usuário
          juros: tipoEmprestimo === "Com Juros" ? jurosNumero : 0,
          // tipoJuros só é persistido quando há juros. "parcela" ou "total".
          // Quando "Sem Juros", grava null para deixar explícito que não se aplica.
          tipoJuros: tipoEmprestimo === "Com Juros" ? tipoJuros : null,
          numeroParcelas: parcelasNumero,
          // Juros em atraso
          cobrarJurosAtraso: jurosAtraso ? true : false,
          modoJurosAtraso: jurosAtraso ? modoJurosAtraso : null,
          jurosAtrasoValor: jurosAtraso ? (parseFloat(jurosAtrasoValor.replace(",", ".")) || 0) : 0,
          // Condições
          frequencia,
          dataPrimeiraParcela: dataPrimeira,
          observacao: temObservacao ? observacao.trim() : "",
          updatedAt: serverTimestamp(),
        });
        // Notifica o SyncManager (Fase 1): o contrato foi editado.
        // O listener singleton recebe o push oficial e atualiza os
        // subscribers. Best-effort — não bloqueia o fluxo.
        // (Aqui está inline porque a edição de contrato não usa um
        // service dedicado; criação passa por API server-side.)
        syncNotifyWrite(effectiveUid, "contratos");
        // Após salvar: volta para a tela de detalhes do MESMO contrato.
        // `replace: true` evita empilhar histórico de navegação
        // (Detalhes → Editar → Detalhes, em vez de 2x Detalhes no back).
        // A rota `/emprestimos/:id` é diferente da rota de edição
        // `/emprestimos/:id/editar`, então o componente Detalhes é
        // REMONTADO pelo React, e o `useEffect` interno rebusca o
        // contrato no Firestore — o `contrato.observacao` atualizado
        // aparece imediatamente, sem gambiarra de query param.
        navigate(`/emprestimos/${idEdicao}`, { replace: true });
        return;
      }

      // ====== MODO CRIAÇÃO ======

      // A criação do contrato é feita via endpoint server-side
      // (/api/admin/criar-contrato), que usa Admin SDK e valida
      // token, status, permissoes, LIMITE DE CONTRATOS do dono
      // (com getCountFromServer no Firestore) e LIMITE INDIVIDUAL
      // do funcionário (quando aplicável) antes de gravar. Isso
      // garante que mesmo um addDoc direto do client SDK seja
      // bloqueado (as Firestore Rules negam create em
      // /usuarios/{uid}/contratos para o client SDK — apenas
      // Admin SDK cria).
      // Texto curto usado na notificação nativa do originador
      // (mostrarNotificacaoNativa) e em nada mais. Mantém o padrão
      // "Nx" exigido pelo visual da notificação (sem nome de
      // cliente nem valor — apenas a quantidade de parcelas).
      const descricaoContrato = `${parcelasNumero}x`;
      const resp = await criarContratoApi({
        clienteId: clienteSel.id,
        valorEmprestado: valorNumero,
        numeroParcelas: parcelasNumero,
        juros: tipoEmprestimo === "Com Juros" ? jurosNumero : 0,
        tipoJuros: tipoEmprestimo === "Com Juros" ? tipoJuros : null,
        tipoEmprestimo,
        frequencia,
        dataPrimeiraParcela: dataPrimeira,
        valorParcela: resumo.valorParcela,
        totalReceber: resumo.totalReceber,
        jurosAtraso: {
          cobrar: !!jurosAtraso,
          modo: jurosAtraso ? modoJurosAtraso : null,
          valor: jurosAtraso ? (parseFloat(jurosAtrasoValor.replace(",", ".")) || 0) : 0,
        },
        observacao: temObservacao ? observacao.trim() : "",
      });
      if (!resp || !resp.ok) {
        setSalvando(false);
        setErro(resp?.erro || "Não foi possível criar o contrato. Tente novamente.");
        return;
      }

      // Notificação nativa (a do app já foi gravada pelo endpoint).
      // Best-effort: se falhar, não bloqueia o fluxo.
      try {
        mostrarNotificacaoNativa("Novo contrato criado", descricaoContrato, {
          tipo: "contrato_criado",
          contratoId: resp.id,
        });
      } catch (err) {
        console.error("mostrarNotificacaoNativa:", err);
      }

      // === FCM: dispatch do evento central já gravado pelo backend ===
      //
      // O backend (api/admin/criar-contrato.js:515-573) JÁ gravou o
      // evento em `usuarios/{ownerId}/notificationEvents/{eventId}`
      // (type=CONTRACT_CREATED) e devolveu o `eventId` na resposta.
      // O servidor propositalmente NÃO chama o dispatch (separação
      // entre gravação e envio FCM — ver comentário do servidor
      // linhas 518-522). O call site do cliente é o responsável por
      // disparar o push.
      //
      // Sem esta chamada, o evento fica salvo no Firestore mas
      // NENHUM device (nem o originador nem os outros) recebe FCM.
      // Segue o mesmo padrão de contractService.processarPagamento
      // (linhas 716-752) e useNotificadorVencimentos (linhas
      // 192-213).
      //
      // Best-effort: falha do dispatch é logada mas NÃO bloqueia
      // o fluxo (o contrato já foi criado e a in-app notif já
      // apareceu). Idempotente: re-chamar dispatch com o mesmo
      // eventId é seguro (o dispatch apenas lê o evento e envia
      // FCM novamente).
      const contractEventId = resp && resp.eventId;
      const sourceDeviceId = obterDeviceIdLocal();
      if (contractEventId) {
        try {
          await dispatchNotificationEvent({
            eventId: contractEventId,
            sourceDeviceId: sourceDeviceId || "",
          });
        } catch (err) {
          console.warn(
            "[novo-contrato] dispatchNotificationEvent falhou (ignorado):",
            err && err.message,
          );
        }
      } else {
        console.warn(
          "[novo-contrato] resposta sem eventId; FCM nao sera disparado.",
        );
      }

      navigate(`/contratos/${resp.id}/sucesso`);
    } catch (err) {
      console.error("Erro ao salvar contrato:", err);
      setErro(
        err?.code === "permission-denied"
          ? "Sem permissão para salvar o contrato. Verifique o login."
          : "Não foi possível salvar o contrato. Tente novamente."
      );
    } finally {
      setSalvando(false);
    }
  }

  // ---------- Estados de loading / erro / não encontrado ----------
  // (mantido para compatibilidade com navegação)

  // Labels visuais para o tipo de empréstimo.
  // A string interna do estado continua sendo "Com Juros" / "Sem Juros"
  // (não muda a lógica de negócio) — só o texto exibido.
  const TIPO_LABELS = {
    "Com Juros": "Com Juros",
    "Sem Juros": "Valor Fixo",
  };

  // Opções de frequência para o seletor segmentado.
  const FREQ_OPCOES = ["Diária", "Semanal", "Quinzenal", "Mensal"];

  // Switch horizontal customizado (mantém o estado fornecido).
  // O input checkbox fica visualmente escondido; o "trilho" e a "bolinha"
  // são puramente decorativos. O estado é controlado por `checked`/`onChange`.
  function ToggleRow({ checked, onChange, label }) {
    return (
      <label className="flex items-center justify-between h-12 px-5 rounded-[10px] border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 cursor-pointer select-none transition hover:border-jurex/40">
        <span className="text-sm text-slate-700 dark:text-slate-200">{label}</span>
        <span className="relative inline-flex items-center">
          <input
            type="checkbox"
            checked={checked}
            onChange={onChange}
            className="peer sr-only"
          />
          <span
            className={`w-9 h-5 rounded-full transition-colors ${
              checked ? "bg-jurex" : "bg-slate-300 dark:bg-slate-600"
            }`}
          />
          <span
            className={`absolute left-0.5 top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
              checked ? "translate-x-4" : "translate-x-0"
            }`}
          />
        </span>
      </label>
    );
  }

  // Estilos base (reutilizados em todos os inputs/selects)
  const classeLabel =
    "block text-[11px] font-bold tracking-widest text-slate-500 dark:text-slate-400 uppercase";
  const classeInput =
    "mt-2 w-full h-12 px-5 rounded-[10px] border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-semibold text-slate-800 dark:text-slate-100 placeholder-slate-400 outline-none transition focus:border-jurex focus:ring-2 focus:ring-jurex/20";
  const classeBotaoSegmentoInativo =
    "h-12 rounded-[10px] text-sm font-semibold bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 transition hover:border-jurex/40 hover:text-slate-900 dark:hover:text-white";
  const classeBotaoSegmentoAtivo =
    "h-12 rounded-[10px] text-sm font-semibold bg-jurex border border-jurex text-white shadow-sm shadow-jurex/30 transition";

  return (
    <AppLayout>
      {/* Fundo da área principal: branco com leve halo esverdeado
          no canto inferior direito (igual ao print). */}
      <div className="min-h-svh bg-white dark:bg-slate-950 relative overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 hidden sm:block"
          style={{
            background:
              "radial-gradient(900px 500px at 85% 100%, rgba(23,178,106,0.10), rgba(23,178,106,0) 60%)",
          }}
        />

        <div className="relative w-full max-w-[1180px] 2xl:max-w-[1280px] mx-auto px-6 sm:px-8 lg:px-10 py-6 lg:py-8">
          {/* Cabeçalho */}
          <div className="rounded-2xl border border-emerald-100/70 dark:border-slate-800 bg-gradient-to-r from-emerald-50/80 via-emerald-50/40 to-white dark:from-slate-900 dark:via-slate-900 dark:to-emerald-950/20 px-5 sm:px-7 py-4 sm:py-5 shadow-sm">
            <div className="flex items-center gap-3">
              {/* Em modo edição, voltar retorna aos DETALHES do mesmo contrato.
                  Em modo criação, volta para a lista de contratos. */}
              <BackButton
                to={modoEdicao ? `/emprestimos/${idEdicao}` : "/emprestimos"}
                className="p-2.5"
                iconSize="w-[18px] h-[18px]"
              />
              <button
                type="button"
                onClick={() => navigate("/dashboard")}
                aria-label="Início"
                className="rounded-full p-2.5 bg-white dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700 shadow-[0_2px_4px_rgba(15,23,42,0.04)] hover:bg-slate-50 dark:hover:bg-slate-700 transition"
              >
                <House className="w-[18px] h-[18px] text-slate-600 dark:text-slate-300" />
              </button>
              <h1 className="text-[20px] font-bold text-slate-900 dark:text-white tracking-tight">
                {modoEdicao ? "Editar contrato" : "Novo contrato"}
              </h1>
            </div>
          </div>

          {/* Alerta */}
          {!clienteSel && !carregandoClientes && (
            <div className="mt-6 flex items-center gap-3 rounded-xl border border-amber-300/70 dark:border-amber-500/30 bg-amber-50/60 dark:bg-amber-500/10 px-5 py-3.5">
              <TriangleAlert className="w-4.5 h-4.5 shrink-0 text-amber-500" />
              <p className="text-sm text-amber-700 dark:text-amber-300">
                Selecione um cliente para continuar.
              </p>
            </div>
          )}

          {/* Formulário */}
          {/* No modo edição, bloqueia interação até o contrato ser carregado.
              Mostra spinner centralizado em vez do form para evitar edição
              com dados ausentes. Em erro/nao-encontrado, mostra mensagem. */}
          {modoEdicao && estadoEdicao === "carregando" && (
            <div className="mt-6 lg:mt-7 flex flex-col items-center justify-center gap-3 py-16 text-slate-500 dark:text-slate-400">
              <LoaderCircle className="w-7 h-7 text-jurex animate-spin" />
              <p className="text-sm font-semibold">Carregando contrato...</p>
            </div>
          )}
          {modoEdicao && estadoEdicao === "nao-encontrado" && (
            <div className="mt-6 lg:mt-7 flex flex-col items-center justify-center gap-3 py-16 text-center">
              <p className="text-base font-semibold text-slate-700 dark:text-slate-200">
                Contrato não encontrado
              </p>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Este contrato pode ter sido excluído ou você não tem permissão para editá-lo.
              </p>
              <button
                type="button"
                onClick={() => navigate("/emprestimos")}
                className="mt-2 h-10 px-5 rounded-[10px] border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-semibold text-slate-700 dark:text-slate-200 hover:border-jurex/40 transition"
              >
                Voltar para contratos
              </button>
            </div>
          )}
          {modoEdicao && estadoEdicao === "erro" && (
            <div className="mt-6 lg:mt-7 flex flex-col items-center justify-center gap-3 py-16 text-center">
              <p className="text-base font-semibold text-red-500">
                Erro ao carregar o contrato
              </p>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Verifique sua conexão e tente novamente.
              </p>
            </div>
          )}

          {/* Só renderiza o form em modo criação OU quando o contrato já
              terminou de carregar em modo edição. Bloqueia edição com dados
              ausentes (evita gravar lixo). */}
          {(!modoEdicao || estadoEdicao === "pronto") && (
          <form onSubmit={criarContrato} className="mt-6 lg:mt-7 space-y-6 pb-24">
            {/* Banner de bloqueio (limite/permissão/status).
                Só é exibido no modo criação — no modo edição não
                se aplica (updateDoc não cria novo documento). */}
            {!modoEdicao && cadastroBloqueado && !loadingDono && (
              <div
                role="alert"
                className="rounded-2xl border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 px-4 py-3 flex items-start gap-3"
              >
                <span className="shrink-0 mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded-lg bg-amber-100 dark:bg-amber-500/20">
                  <Lock className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                </span>
                <p className="text-sm font-semibold text-amber-700 dark:text-amber-300 leading-relaxed">
                  {contaBloqueada
                    ? "Conta bloqueada. Entre em contato com o administrador."
                    : permissaoNegada
                    ? "A criação de contratos foi bloqueada pelo administrador. Entre em contato para liberar."
                    : `Limite de contratos atingido. Seu limite atual é de ${limiteContratos} ${
                        limiteContratos === 1 ? "contrato" : "contratos"
                      }. Entre em contato com o administrador para aumentar seu limite.`}
                </p>
              </div>
            )}

            {/* Cliente (dropdown customizado) */}
            <div ref={wrapperClienteRef} className="relative">
              <label className={classeLabel}>Cliente</label>

              {/* Campo principal — sempre visível, idêntico a um input comum.
                  Quando FECHADO: mostra o cliente selecionado + ChevronDown.
                  Quando ABERTO: continua como input e o dropdown abre logo
                  abaixo (com o seu próprio campo de busca). */}
              <div className="relative mt-2">
                <input
                  type="text"
                  placeholder={
                    carregandoClientes
                      ? "Carregando clientes..."
                      : "Selecione um cliente..."
                  }
                  value={clienteSel ? clienteSel.nomeCompleto : buscaCliente}
                  onChange={(e) => {
                    setBuscaCliente(e.target.value);
                    if (clienteSel) setClienteSel(null);
                  }}
                  onFocus={() => {
                    if (!carregandoClientes) {
                      setMostraDropdown(true);
                    }
                  }}
                  readOnly={!!clienteSel}
                  className={`${classeInput} ${clienteSel ? "cursor-pointer" : ""}`}
                />
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => {
                    if (carregandoClientes) return;
                    if (clienteSel) {
                      // Limpar cliente (sem abrir dropdown)
                      setClienteSel(null);
                      setBuscaCliente("");
                    } else {
                      // Foco no input (que abre o dropdown)
                      setMostraDropdown(true);
                    }
                  }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 mt-1 rounded p-1 hover:bg-slate-200 dark:hover:bg-slate-700 transition"
                  aria-label={clienteSel ? "Limpar cliente" : "Abrir lista"}
                >
                  {clienteSel ? (
                    <X className="w-4 h-4 text-slate-500 dark:text-slate-400" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-slate-500 dark:text-slate-400" />
                  )}
                </button>
              </div>

              {/* Dropdown: aparece logo abaixo do campo, alinhado */}
              {mostraDropdown && !carregandoClientes && (
                <div
                  className="absolute z-30 left-0 right-0 mt-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl overflow-hidden"
                  role="listbox"
                >
                  {/* Campo de busca dentro do dropdown */}
                  <div className="relative border-b border-slate-200 dark:border-slate-700">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                    <input
                      autoFocus
                      type="text"
                      placeholder="Buscar por nome ou CPF..."
                      value={buscaCliente}
                      onChange={(e) => setBuscaCliente(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") setMostraDropdown(false);
                      }}
                      className="w-full h-10 pl-11 pr-4 text-sm bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 placeholder-slate-400 outline-none"
                    />
                  </div>

                  {/* Lista de clientes */}
                  <div className="max-h-60 overflow-y-auto p-1.5">
                    {clientesFiltrados.length === 0 ? (
                      <p className="px-3 py-4 text-sm text-center text-slate-500 dark:text-slate-400">
                        Nenhum cliente encontrado.
                      </p>
                    ) : (
                      clientesFiltrados.map((c) => {
                        const selecionado = clienteSel?.id === c.id;
                        return (
                          <button
                            key={c.id}
                            type="button"
                            role="option"
                            aria-selected={selecionado}
                            onClick={() => {
                              setClienteSel(c);
                              setBuscaCliente("");
                              setMostraDropdown(false);
                            }}
                            className={`w-full flex items-start gap-3 px-3 py-2.5 rounded-[10px] text-left transition ${
                              selecionado
                                ? "bg-emerald-50 dark:bg-emerald-500/10"
                                : "hover:bg-slate-50 dark:hover:bg-slate-800/70"
                            }`}
                          >
                            <Check
                              className={`w-4 h-4 mt-0.5 shrink-0 ${
                                selecionado
                                  ? "text-jurex"
                                  : "text-transparent"
                              }`}
                            />
                            <div className="min-w-0 flex-1">
                              <p
                                className={`text-sm font-semibold truncate ${
                                  selecionado
                                    ? "text-jurex dark:text-emerald-400"
                                    : "text-slate-900 dark:text-white"
                                }`}
                              >
                                {c.nomeCompleto ?? "—"}
                              </p>
                              <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                                {c.cpf ?? ""}
                              </p>
                            </div>
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Valor emprestado */}
            <div>
              <label className={classeLabel}>Valor emprestado (R$)</label>
              <input
                type="text"
                placeholder="0,00"
                value={valor}
                onChange={(e) => formatarValor(e)}
                className={classeInput}
              />
            </div>

            {/* Tipo de empréstimo */}
            <div>
              <label className={classeLabel}>Tipo de empréstimo</label>
              <div className="mt-2 grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setTipoEmprestimo("Sem Juros")}
                  className={
                    tipoEmprestimo === "Sem Juros"
                      ? classeBotaoSegmentoAtivo
                      : classeBotaoSegmentoInativo
                  }
                >
                  {TIPO_LABELS["Sem Juros"]}
                </button>
                <button
                  type="button"
                  onClick={() => setTipoEmprestimo("Com Juros")}
                  className={
                    tipoEmprestimo === "Com Juros"
                      ? classeBotaoSegmentoAtivo
                      : classeBotaoSegmentoInativo
                  }
                >
                  {TIPO_LABELS["Com Juros"]}
                </button>
              </div>
            </div>

            {/* Aplicação dos juros (só visível quando "Com Juros") */}
            {tipoEmprestimo === "Com Juros" && (
              <div>
                <label className={classeLabel}>Aplicação dos juros</label>
                <div className="mt-2 grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setTipoJuros("parcela")}
                    className={
                      tipoJuros === "parcela"
                        ? classeBotaoSegmentoAtivo
                        : classeBotaoSegmentoInativo
                    }
                  >
                    Por parcela
                  </button>
                  <button
                    type="button"
                    onClick={() => setTipoJuros("total")}
                    className={
                      tipoJuros === "total"
                        ? classeBotaoSegmentoAtivo
                        : classeBotaoSegmentoInativo
                    }
                  >
                    Sobre o total
                  </button>
                </div>
              </div>
            )}

            {/* Juros % a.m. + Nº Parcelas (2 colunas) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={classeLabel}>
                  {tipoJuros === "total" ? "Juros % (total do contrato)" : "Juros % a.m. (ao mês)"}
                </label>
                <input
                  type="text"
                  placeholder="0"
                  value={juros}
                  onChange={(e) => setJuros(e.target.value.replace(/[^0-9.]/g, ""))}
                  disabled={tipoEmprestimo !== "Com Juros"}
                  className={`${classeInput} ${
                    tipoEmprestimo !== "Com Juros"
                      ? "opacity-60 cursor-not-allowed"
                      : ""
                  }`}
                />
              </div>
              <div>
                <label className={classeLabel}>Nº parcelas</label>
                <input
                  type="number"
                  min="1"
                  value={parcelas}
                  onChange={(e) => setParcelas(e.target.value)}
                  className={classeInput}
                />
              </div>
            </div>

            {/* Cobrar juros em atraso */}
            <div>
              <ToggleRow
                checked={!!jurosAtraso}
                onChange={(e) => setJurosAtraso(e.target.checked ? "sim" : "")}
                label="Cobrar juros em atraso"
              />
              {jurosAtraso && (
                <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className={classeLabel}>Modo</label>
                    <select
                      value={modoJurosAtraso}
                      onChange={(e) => setModoJurosAtraso(e.target.value)}
                      className={classeInput}
                    >
                      <option value="% ao valor da parcela">
                        % ao valor da parcela
                      </option>
                      <option value="Valor fixo">Valor fixo</option>
                    </select>
                  </div>
                  <div>
                    <label className={classeLabel}>Taxa/Valor (R$)</label>
                    <input
                      type="text"
                      placeholder="Ex: 2"
                      value={jurosAtrasoValor}
                      onChange={(e) =>
                        setJurosAtrasoValor(
                          e.target.value.replace(/[^0-9,]/g, "").replace(",", ".")
                        )
                      }
                      className={classeInput}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Frequência */}
            <div>
              <label className={classeLabel}>Frequência de pagamento</label>
              <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-3">
                {FREQ_OPCOES.map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setFrequencia(f)}
                    className={
                      frequencia === f
                        ? classeBotaoSegmentoAtivo
                        : classeBotaoSegmentoInativo
                    }
                  >
                    {f}
                  </button>
                ))}
              </div>
            </div>

            {/* Data da primeira parcela */}
            <div>
              <label className={classeLabel}>Data da primeira parcela</label>
              <input
                type="date"
                value={dataPrimeira}
                onChange={(e) => setDataPrimeira(e.target.value)}
                className={classeInput}
              />
            </div>

            {/* Adicionar observação (toggle) */}
            <div>
              <ToggleRow
                checked={temObservacao}
                onChange={(e) => setTemObservacao(e.target.checked)}
                label="Adicionar observação"
              />
              {temObservacao && (
                <textarea
                  value={observacao}
                  onChange={(e) => setObservacao(e.target.value)}
                  rows={2}
                  placeholder="Observação sobre o contrato..."
                  className="mt-2 w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-950/40 p-3 text-sm leading-relaxed text-slate-800 dark:text-slate-100 outline-none resize-y transition focus:border-jurex focus:ring-2 focus:ring-jurex/20"
                />
              )}
            </div>

            {/* Resumo financeiro (3 linhas) */}
            {valorNumero > 0 && parcelasNumero > 0 && (
              <div className="mt-2 rounded-[14px] border border-emerald-100/80 dark:border-emerald-500/20 bg-emerald-50/50 dark:bg-emerald-500/5 p-5 sm:p-6 space-y-3 shadow-sm">
                <div className="flex justify-between items-center text-sm">
                  <span className="text-slate-500 dark:text-slate-400">Valor da parcela</span>
                  <span className="font-bold text-jurex dark:text-emerald-400 tabular-nums">
                    {formatarMoedaExibicao(resumo.valorParcela)}
                  </span>
                </div>
                <div className="flex justify-between items-center text-sm">
                  <span className="text-slate-500 dark:text-slate-400">Total a receber</span>
                  <span className="font-bold text-jurex dark:text-emerald-400 tabular-nums">
                    {formatarMoedaExibicao(resumo.totalReceber)}
                  </span>
                </div>
                <div className="flex justify-between items-center text-sm">
                  <span className="text-slate-500 dark:text-slate-400">Lucro estimado</span>
                  <span className="font-bold text-jurex dark:text-emerald-400 tabular-nums">
                    {formatarMoedaExibicao(resumo.lucro)}
                  </span>
                </div>
              </div>
            )}

            {/* Erro */}
            {erro && (
              <p className="rounded-xl bg-red-50 dark:bg-red-950/30 px-4 py-3 text-sm font-semibold text-red-500">
                {erro}
              </p>
            )}

            {/* Botão submit */}
            <div className="pt-2">
              <button
                type="submit"
                disabled={
                  salvando ||
                  !clienteSel ||
                  valorNumero <= 0 ||
                  parcelasNumero <= 0 ||
                  (tipoEmprestimo === "Com Juros" && jurosNumero <= 0) ||
                  (!modoEdicao && cadastroBloqueado)
                }
                className={`w-full h-12 rounded-[10px] text-white text-[15px] font-semibold flex items-center justify-center gap-2 shadow-sm shadow-jurex/30 transition ${
                  salvando ||
                  !clienteSel ||
                  valorNumero <= 0 ||
                  parcelasNumero <= 0 ||
                  (tipoEmprestimo === "Com Juros" && jurosNumero <= 0) ||
                  (!modoEdicao && cadastroBloqueado)
                    ? "bg-slate-300 dark:bg-slate-700 cursor-not-allowed"
                    : "bg-jurex hover:bg-jurex-dark"
                }`}
              >
                {salvando ? (
                  <>
                    <LoaderCircle className="w-5 h-5 animate-spin" />
                    Salvando...
                  </>
                ) : !modoEdicao && cadastroBloqueado ? (
                  <>
                    <Lock className="w-4 h-4" />
                    {contaBloqueada
                      ? "Conta bloqueada"
                      : permissaoNegada
                      ? "Criação bloqueada"
                      : "Limite de contratos atingido"}
                  </>
                ) : modoEdicao ? (
                  "Salvar alterações"
                ) : (
                  "Criar contrato"
                )}
              </button>
            </div>
          </form>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
