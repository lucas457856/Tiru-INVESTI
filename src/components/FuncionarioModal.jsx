// Modal de criar/editar funcionário.
//
// - Modo "criar": pede nome, e-mail, senha temporária, limite de
//   contratos. A senha é lida via `ref` e NUNCA é persistida em
//   estado React — ela vai diretamente no POST e a ref é limpa.
// - Modo "editar": permite mudar nome, limite de contratos e
//   status (ativo/inativo). E-mail é exibido apenas leitura.
//
// Toda a chamada passa por /api/auth/create-employee e
// /api/auth/update-employee (employeesService). A sessão do dono
// nunca é afetada — Admin SDK roda no servidor.

import { useEffect, useRef, useState } from "react";
import { LoaderCircle, X, Eye, EyeOff } from "lucide-react";
import {
  criarFuncionario,
  atualizarFuncionario,
} from "../services/employeesService";

const LIMITE_MIN = 0;
const LIMITE_MAX = 100000;

export default function FuncionarioModal({ aberto, modo, funcionario, aoFechar, aoSucesso }) {
  const isEdicao = modo === "editar";

  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [limite, setLimite] = useState(50);
  const [statusAtivo, setStatusAtivo] = useState(true);
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);

  const senhaRef = useRef(null);

  useEffect(() => {
    if (!aberto) return;
    setErro("");
    setSalvando(false);
    if (isEdicao && funcionario) {
      setNome(funcionario.nome || "");
      setEmail(funcionario.email || "");
      setLimite(
        typeof funcionario.limiteContratos === "number" ? funcionario.limiteContratos : 0,
      );
      setStatusAtivo((funcionario.status || "ativo") === "ativo");
      if (senhaRef.current) senhaRef.current.value = "";
    } else {
      setNome("");
      setEmail("");
      setLimite(50);
      setStatusAtivo(true);
      if (senhaRef.current) senhaRef.current.value = "";
    }
  }, [aberto, isEdicao, funcionario]);

  // Fecha com ESC
  useEffect(() => {
    if (!aberto) return;
    function onKey(e) {
      if (e.key === "Escape" && !salvando) aoFechar();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [aberto, salvando, aoFechar]);

  if (!aberto) return null;

  async function handleSalvar(e) {
    e.preventDefault();
    setErro("");

    const nomeTrim = (nome || "").trim();
    if (nomeTrim.length < 2 || nomeTrim.length > 80) {
      setErro("Informe um nome entre 2 e 80 caracteres.");
      return;
    }
    const limiteNumero = Number(limite);
    if (
      !Number.isFinite(limiteNumero) ||
      !Number.isInteger(limiteNumero) ||
      limiteNumero < LIMITE_MIN ||
      limiteNumero > LIMITE_MAX
    ) {
      setErro(`Limite inválido (${LIMITE_MIN} a ${LIMITE_MAX}).`);
      return;
    }

    setSalvando(true);
    try {
      if (isEdicao) {
        const novoStatus = statusAtivo ? "ativo" : "inativo";
        const resp = await atualizarFuncionario({
          funcionarioId: funcionario.id,
          nome: nomeTrim,
          limiteContratos: limiteNumero,
          status: novoStatus,
        });
        if (!resp.ok) {
          setErro(resp.erro || "Não foi possível salvar.");
          setSalvando(false);
          return;
        }
      } else {
        const senha = senhaRef.current?.value || "";
        if (senha.length < 6 || senha.length > 128) {
          setErro("A senha deve ter entre 6 e 128 caracteres.");
          setSalvando(false);
          return;
        }
        const emailTrim = (email || "").trim().toLowerCase();
        if (!emailTrim || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTrim)) {
          setErro("Informe um e-mail válido.");
          setSalvando(false);
          return;
        }
        const resp = await criarFuncionario({
          nome: nomeTrim,
          email: emailTrim,
          senha,
          limiteContratos: limiteNumero,
        });
        // Limpa a senha da ref imediatamente, mesmo em erro
        if (senhaRef.current) senhaRef.current.value = "";
        if (!resp.ok) {
          setErro(resp.erro || "Não foi possível cadastrar.");
          setSalvando(false);
          return;
        }
      }
      if (senhaRef.current) senhaRef.current.value = "";
      setSalvando(false);
      aoSucesso?.();
    } catch (err) {
      setErro(err?.message || "Erro inesperado.");
      if (senhaRef.current) senhaRef.current.value = "";
      setSalvando(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={() => !salvando && aoFechar()}
      className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center p-0 sm:p-4"
    >
      <form
        onSubmit={handleSalvar}
        onClick={(e) => e.stopPropagation()}
        className="relative w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl bg-white dark:bg-slate-900 shadow-2xl p-5 max-h-[92vh] overflow-y-auto"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-white">
              {isEdicao ? "Editar funcionário" : "Adicionar funcionário"}
            </h2>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {isEdicao
                ? "Atualize os dados de acesso e o limite de contratos."
                : "O funcionário terá login próprio e acesso aos clientes e contratos do proprietário."}
            </p>
          </div>
          <button
            type="button"
            onClick={() => !salvando && aoFechar()}
            aria-label="Fechar"
            className="shrink-0 rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
          >
            <X className="w-4.5 h-4.5" />
          </button>
        </div>

        <div className="mt-5 space-y-4">
          {/* Nome */}
          <div>
            <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
              Nome completo
            </label>
            <input
              type="text"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              maxLength={80}
              autoFocus
              className="mt-1.5 w-full h-11 px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-slate-800 dark:text-slate-100 outline-none focus:border-jurex focus:ring-2 focus:ring-jurex/20"
            />
          </div>

          {/* E-mail */}
          <div>
            <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
              E-mail
            </label>
            <input
              type="email"
              value={isEdicao ? funcionario?.email || "" : email}
              onChange={(e) => !isEdicao && setEmail(e.target.value)}
              readOnly={isEdicao}
              maxLength={120}
              className={`mt-1.5 w-full h-11 px-3 rounded-xl border border-slate-200 dark:border-slate-700 text-sm outline-none ${
                isEdicao
                  ? "bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 cursor-not-allowed"
                  : "bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-100 focus:border-jurex focus:ring-2 focus:ring-jurex/20"
              }`}
            />
            {!isEdicao && (
              <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                O e-mail será o login do funcionário.
              </p>
            )}
          </div>

          {/* Senha (só criar) */}
          {!isEdicao && <CampoSenha inputRef={senhaRef} />}

          {/* Limite */}
          <div>
            <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
              Limite de contratos
            </label>
            <input
              type="number"
              min={LIMITE_MIN}
              max={LIMITE_MAX}
              step={1}
              value={limite}
              onChange={(e) => setLimite(e.target.value)}
              className="mt-1.5 w-full h-11 px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-slate-800 dark:text-slate-100 outline-none focus:border-jurex focus:ring-2 focus:ring-jurex/20"
            />
            <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
              0 = sem limite. Quando atingido, novos contratos são bloqueados.
            </p>
          </div>

          {/* Status (só editar) */}
          {isEdicao && (
            <div className="flex items-center justify-between rounded-xl border border-slate-200 dark:border-slate-700 px-3 py-2.5">
              <div>
                <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                  Funcionário ativo
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Inativos não conseguem acessar o sistema.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setStatusAtivo((v) => !v)}
                role="switch"
                aria-checked={statusAtivo}
                className={`relative w-11 h-6 rounded-full transition ${
                  statusAtivo ? "bg-jurex" : "bg-slate-300 dark:bg-slate-700"
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition ${
                    statusAtivo ? "translate-x-5" : ""
                  }`}
                />
              </button>
            </div>
          )}

          {erro && (
            <div className="rounded-xl border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10 px-3 py-2.5 text-xs text-red-600 dark:text-red-300">
              {erro}
            </div>
          )}
        </div>

        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={() => !salvando && aoFechar()}
            disabled={salvando}
            className="flex-1 h-11 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={salvando}
            className="flex-1 h-11 rounded-xl bg-gradient-to-r from-jurex to-emerald-500 text-white text-sm font-bold flex items-center justify-center gap-2 shadow-md shadow-jurex/25 hover:brightness-105 active:scale-[0.99] transition disabled:opacity-60"
          >
            {salvando && <LoaderCircle className="w-4 h-4 animate-spin" />}
            {isEdicao ? "Salvar alterações" : "Adicionar"}
          </button>
        </div>
      </form>
    </div>
  );
}

function CampoSenha({ inputRef }) {
  const [mostrar, setMostrar] = useState(false);
  return (
    <div>
      <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
        Senha temporária
      </label>
      <div className="mt-1.5 relative">
        <input
          ref={inputRef}
          type={mostrar ? "text" : "password"}
          minLength={6}
          maxLength={128}
          autoComplete="new-password"
          className="w-full h-11 pl-3 pr-11 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-slate-800 dark:text-slate-100 outline-none focus:border-jurex focus:ring-2 focus:ring-jurex/20"
        />
        <button
          type="button"
          onClick={() => setMostrar((v) => !v)}
          aria-label={mostrar ? "Ocultar senha" : "Mostrar senha"}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
        >
          {mostrar ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </div>
      <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
        Mínimo 6 caracteres. O funcionário pode trocar depois em
        &quot;Esqueci minha senha&quot;.
      </p>
    </div>
  );
}
