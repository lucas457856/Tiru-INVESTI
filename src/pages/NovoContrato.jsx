import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  House,
  Save,
  LoaderCircle,
  Trash2,
  TriangleAlert,
  UserPlus,
  Plus,
  X,
  Check,
} from "lucide-react";
import AppLayout from "../components/AppLayout";
import { useAuth } from "../context/useAuth";
import { db } from "../services/firebase";
import { collection, addDoc, getDocs, query, serverTimestamp, where } from "firebase/firestore";
import { formatarMoeda, formatarData } from "../utils/formatadores";
import { buscarContrato, statusContrato, parcelasDoContrato, excluirContrato } from "../services/contractService";
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

  // Formulário
  const [valor, setValor] = useState("");
  const [parcelas, setParcelas] = useState("1");
  const [juros, setJuros] = useState("");
  const [tipoEmprestimo, setTipoEmprestimo] = useState("Com Juros");
  const [frequencia, setFrequencia] = useState("Mensal");
  const [dataPrimeira, setDataPrimeira] = useState("");
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

  // Carrega clientes do Firestore do usuário autenticado
  useEffect(() => {
    if (!usuario) return;
    setCarregandoClientes(true);
    const q = query(
      collection(db, "clientes"),
      where("ownerId", "==", usuario.uid)
    );
    getDocs(q).then((snap) => {
      const lista = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setClientes(lista);
      setCarregandoClientes(false);
    }).catch(() => setCarregandoClientes(false));
  }, [usuario]);

  // Filtra clientes pela busca
  const clientesFiltrados = useMemo(() => {
    if (!buscaCliente.trim()) return clientes;
    return clientes.filter(
      (c) =>
        (c.nomeCompleto?.toLowerCase() ?? "").includes(buscaCliente.toLowerCase()) ||
        (c.cpf?.toLowerCase() ?? "").includes(buscaCliente.toLowerCase())
    );
  }, [clientes, buscaCliente]);

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

  // Resumo calculado dinamicamente
  // REGRA DO SISTEMA (com juros):
  //   juros       = valorEmprestado × (taxa / 100)        [APLICADO UMA ÚNICA VEZ]
  //   totalReceber = valorEmprestado + juros
  //   valorParcela = totalReceber / numeroParcelas
  //   lucro       = totalReceber - valorEmprestado
  // A frequência (Semanal, Mensal, etc.) controla apenas DATAS, não o total.
  // Para "Sem Juros": valorParcela = valorEmprestado / numeroParcelas.
  const resumo = useMemo(() => {
    const totalParcelas = Math.max(parcelasNumero, 1);
    const jurosTotal = tipoEmprestimo === "Com Juros"
      ? Math.round(valorNumero * (jurosNumero / 100) * 100) / 100
      : 0;
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
  }, [valorNumero, jurosNumero, parcelasNumero, tipoEmprestimo]);

  function formatarMoedaExibicao(v) {
    return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }

  function formatarMoedaDisplay(v) {
    return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }

  async function criarContrato(e) {
    e.preventDefault();
    setErro("");
    if (!clienteSel) return setErro("Selecione um cliente antes de criar o contrato.");
    if (valorNumero <= 0) return setErro("Informe um valor emprestado válido.");
    if (parcelasNumero <= 0) return setErro("Informe um número de parcelas válido.");
    if (tipoEmprestimo === "Com Juros" && jurosNumero <= 0) {
      return setErro("Informe os juros ao mês.");
    }
    if (!usuario) return setErro("Usuário não autenticado.");
    try {
      setSalvando(true);
      // Subcoleção por usuário: usuarios/{uid}/contratos (lida por Emprestimos.jsx)
      const docRef = await addDoc(collection(db, "usuarios", usuario.uid, "contratos"), {
        // Vínculo com o cliente selecionado
        clienteId: clienteSel.id,
        clienteNome: clienteSel.nomeCompleto,
        // Dados financeiros
        nome: clienteSel.nomeCompleto,
        valorEmprestado: valorNumero,
        valorParcela: resumo.valorParcela,
        totalReceber: resumo.totalReceber,
        valorRecebido: 0,
        jurosRecebidos: 0,              // juros acumulados recebidos
        saldoPrincipal: valorNumero,    // R$ original menos abatimentos
        tipoEmprestimo,
        juros: tipoEmprestimo === "Com Juros" ? jurosNumero : 0,
        numeroParcelas: parcelasNumero,
        // Juros em atraso
        cobrarJurosAtraso: jurosAtraso ? true : false,
        modoJurosAtraso: jurosAtraso ? modoJurosAtraso : null,
        jurosAtrasoValor: jurosAtraso ? (parseFloat(jurosAtrasoValor.replace(",", ".")) || 0) : 0,
        // Condições
        frequencia,
        dataPrimeiraParcela: dataPrimeira,
        observacao: temObservacao ? observacao.trim() : "",
        // Status
        quitado: false,
        parcelasPagas: 0,
        dataProximo: dataPrimeira,
        abatimentos: [],        // array de { parcelaNumero, valor, data, observacao }
        abatimentoTotal: 0,     // soma de todos os abatimentos (índice)
        criadoEm: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      navigate(`/contratos/${docRef.id}/sucesso`);
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
  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto px-6 py-6">
        {/* Cabeçalho */}
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-gradient-to-r from-emerald-50 to-white dark:from-slate-900 dark:to-emerald-950/20 px-6 py-5">
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => navigate("/emprestimos")}
              aria-label="Voltar"
              className="rounded-full p-2 ring-1 ring-slate-200 dark:ring-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 transition"
            >
              <ArrowLeft className="w-4.5 h-4.5 text-slate-700 dark:text-slate-200" />
            </button>
            <button
              type="button"
              onClick={() => navigate("/dashboard")}
              aria-label="Início"
              className="rounded-full p-2 ring-1 ring-slate-200 dark:ring-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 transition"
            >
              <House className="w-4.5 h-4.5 text-slate-600 dark:text-slate-300" />
            </button>
            <h1 className="text-xl font-bold text-slate-900 dark:text-white">
              Novo contrato
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
        <form onSubmit={criarContrato} className="mt-6 space-y-6">
          {/* Cliente */}
          <div>
            <label className="block text-[10px] font-bold tracking-widest text-slate-500 dark:text-slate-400 uppercase">
              Cliente
            </label>
            <div className="relative mt-2">
              <input
                type="text"
                placeholder={carregandoClientes ? "Carregando clientes..." : "Buscar cliente por nome ou CPF..."}
                value={buscaCliente}
                onChange={(e) => setBuscaCliente(e.target.value)}
                onFocus={() => setMostraDropdown(true)}
                disabled={carregandoClientes}
                className="w-full h-12 px-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-semibold text-slate-800 dark:text-slate-100 outline-none transition focus:border-jurex focus:ring-2 focus:ring-jurex/20"
              />
              {clienteSel && (
                <button
                  type="button"
                  onClick={() => setClienteSel(null)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 hover:bg-slate-200 dark:hover:bg-slate-700 transition"
                >
                  <X className="w-4 h-4 text-slate-500 dark:text-slate-400" />
                </button>
              )}
            </div>

            {mostraDropdown && clientesFiltrados.length > 0 && (
              <div className="absolute z-10 mt-2 w-full max-w-5xl max-h-60 overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg">
                {clientesFiltrados.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      setClienteSel(c);
                      setBuscaCliente("");
                      setMostraDropdown(false);
                    }}
                    className="w-full px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800 transition"
                  >
                    <p className="font-semibold text-slate-900 dark:text-white">
                      {c.nomeCompleto ?? "—"}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {c.cpf ?? ""} · {c.telefone ?? ""}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Valor emprestado */}
          <div>
            <label className="block text-[10px] font-bold tracking-widest text-slate-500 dark:text-slate-400 uppercase">
              Valor emprestado
            </label>
            <input
              type="text"
              placeholder="R$ 0,00"
              value={valor}
              onChange={(e) => formatarValor(e)}
              className="mt-2 w-full h-12 px-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-semibold text-slate-800 dark:text-slate-100 outline-none transition focus:border-jurex focus:ring-2 focus:ring-jurex/20"
            />
          </div>

          {/* Tipo de empréstimo */}
          <div>
            <label className="block text-[10px] font-bold tracking-widest text-slate-500 dark:text-slate-400 uppercase">
              Tipo de empréstimo
            </label>
            <div className="mt-2 grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setTipoEmprestimo("Com Juros")}
                className={`h-12 rounded-xl text-sm font-bold transition ${
                  tipoEmprestimo === "Com Juros"
                    ? "bg-gradient-to-r from-jurex to-emerald-500 text-white shadow-lg shadow-jurex/25"
                    : "bg-white dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-700 text-slate-700 dark:text-slate-300 hover:border-jurex/40"
                }`}
              >
                Com juros
              </button>
              <button
                type="button"
                onClick={() => setTipoEmprestimo("Sem Juros")}
                className={`h-12 rounded-xl text-sm font-bold transition ${
                  tipoEmprestimo === "Sem Juros"
                    ? "bg-gradient-to-r from-jurex to-emerald-500 text-white shadow-lg shadow-jurex/25"
                    : "bg-white dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-700 text-slate-700 dark:text-slate-300 hover:border-jurex/40"
                }`}
              >
                Sem juros
              </button>
            </div>
          </div>

          {/* Juros ao mês */}
          {tipoEmprestimo === "Com Juros" && (
            <div>
              <label className="block text-[10px] font-bold tracking-widest text-slate-500 dark:text-slate-400 uppercase">
                Juros ao mês (%)
              </label>
              <input
                type="text"
                placeholder="Ex: 35"
                value={juros}
                onChange={(e) => setJuros(e.target.value.replace(/[^0-9.]/g, ""))}
                className="mt-2 w-full h-12 px-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-semibold text-slate-800 dark:text-slate-100 outline-none transition focus:border-jurex focus:ring-2 focus:ring-jurex/20"
              />
            </div>
          )}

          {/* Parcelas */}
          <div>
            <label className="block text-[10px] font-bold tracking-widest text-slate-500 dark:text-slate-400 uppercase">
              Número de parcelas
            </label>
            <input
              type="number"
              min="1"
              value={parcelas}
              onChange={(e) => setParcelas(e.target.value)}
              className="mt-2 w-full h-12 px-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-semibold text-slate-800 dark:text-slate-100 outline-none transition focus:border-jurex focus:ring-2 focus:ring-jurex/20"
            />
          </div>

          {/* Frequência */}
          <div>
            <label className="block text-[10px] font-bold tracking-widest text-slate-500 dark:text-slate-400 uppercase">
              Frequência
            </label>
            <select
              value={frequencia}
              onChange={(e) => setFrequencia(e.target.value)}
              className="mt-2 w-full h-12 px-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-semibold text-slate-800 dark:text-slate-100 outline-none transition focus:border-jurex focus:ring-2 focus:ring-jurex/20"
            >
              <option value="Diária">Diária</option>
              <option value="Semanal">Semanal</option>
              <option value="Quinzenal">Quinzenal</option>
              <option value="Mensal">Mensal</option>
            </select>
          </div>

          {/* Data da primeira parcela */}
          <div>
            <label className="block text-[10px] font-bold tracking-widest text-slate-500 dark:text-slate-400 uppercase">
              Data da primeira parcela
            </label>
            <input
              type="date"
              value={dataPrimeira}
              onChange={(e) => setDataPrimeira(e.target.value)}
              className="mt-2 w-full h-12 px-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-semibold text-slate-800 dark:text-slate-100 outline-none transition focus:border-jurex focus:ring-2 focus:ring-jurex/20"
            />
          </div>

          {/* Observação */}
          <div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="temObservacao"
                checked={temObservacao}
                onChange={(e) => setTemObservacao(e.target.checked)}
                className="rounded border-slate-300 dark:border-slate-600 text-jurex focus:ring-jurex"
              />
              <label htmlFor="temObservacao" className="text-sm text-slate-700 dark:text-slate-300">
                Adicionar observação
              </label>
            </div>
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

          {/* Juros em atraso */}
          <div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="cobrarJurosAtraso"
                checked={!!jurosAtraso}
                onChange={(e) => setJurosAtraso(e.target.checked ? "sim" : "")}
                className="rounded border-slate-300 dark:border-slate-600 text-jurex focus:ring-jurex"
              />
              <label htmlFor="cobrarJurosAtraso" className="text-sm text-slate-700 dark:text-slate-300">
                Cobrar juros/multa em atraso
              </label>
            </div>
            {jurosAtraso && (
              <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold tracking-widest text-slate-500 dark:text-slate-400 uppercase">
                    Modo
                  </label>
                  <select
                    value={modoJurosAtraso}
                    onChange={(e) => setModoJurosAtraso(e.target.value)}
                    className="mt-2 w-full h-12 px-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-semibold text-slate-800 dark:text-slate-100 outline-none transition focus:border-jurex focus:ring-2 focus:ring-jurex/20"
                  >
                    <option value="% ao valor da parcela">% ao valor da parcela</option>
                    <option value="Valor fixo">Valor fixo</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold tracking-widest text-slate-500 dark:text-slate-400 uppercase">
                    Taxa/Valor (R$)
                  </label>
                  <input
                    type="text"
                    placeholder="Ex: 2"
                    value={jurosAtrasoValor}
                    onChange={(e) =>
                      setJurosAtrasoValor(
                        e.target.value.replace(/[^0-9,]/g, "").replace(",", ".")
                      )
                    }
                    className="mt-2 w-full h-12 px-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-semibold text-slate-800 dark:text-slate-100 outline-none transition focus:border-jurex focus:ring-2 focus:ring-jurex/20"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Resumo */}
          {valorNumero > 0 && parcelasNumero > 0 && (
            <div className="mt-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/60 p-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-slate-500 dark:text-slate-400">Valor original:</span>
                <span className="font-semibold text-slate-900 dark:text-white tabular-nums">
                  {formatarMoedaExibicao(valorNumero)}
                </span>
              </div>
              {tipoEmprestimo === "Com Juros" && jurosNumero > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500 dark:text-slate-400">Juros total (35% × {parcelasNumero}x):</span>
                  <span className="font-semibold text-slate-900 dark:text-white tabular-nums">
                    {formatarMoedaExibicao(resumo.jurosTotal)}
                  </span>
                </div>
              )}
              <div className="flex justify-between text-sm">
                <span className="text-slate-500 dark:text-slate-400">Total a receber:</span>
                <span className="font-semibold text-slate-900 dark:text-white tabular-nums">
                  {formatarMoedaExibicao(resumo.totalReceber)}
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
          <div className="mt-4">
            <button
              type="submit"
              disabled={salvando || !clienteSel || valorNumero <= 0 || parcelasNumero <= 0 || (tipoEmprestimo === "Com Juros" && jurosNumero <= 0)}
              className={`w-full h-13 rounded-2xl bg-gradient-to-r from-jurex to-emerald-500 text-white text-base font-bold flex items-center justify-center gap-2 shadow-lg shadow-jurex/30 hover:brightness-105 active:scale-[0.99] transition ${
                salvando || !clienteSel || valorNumero <= 0 || parcelasNumero <= 0 || (tipoEmprestimo === "Com Juros" && jurosNumero <= 0)
                  ? "opacity-60 pointer-events-none"
                  : ""
              }`}
            >
              {salvando ? (
                <>
                  <LoaderCircle className="w-5 h-5 animate-spin" />
                  Salvando...
                </>
              ) : (
                <>
                  <Save className="w-5 h-5" />
                  Criar contrato
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </AppLayout>
  );
}
