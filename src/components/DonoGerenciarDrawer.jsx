// Drawer lateral do Painel Administrativo — permite editar os campos
// administrativos de UM DONO (status, limites, permissoes).
//
// Recebe um objeto `dono` com o shape retornado por /api/admin/overview:
//   { uid, nome, email, telefone, contClientes, contContratos,
//     contFuncionarios, status, limites: {contratos, clientes,
//     funcionarios}, permissoes: {criarContratos, criarClientes,
//     criarFuncionarios} }
//
// Comportamento:
//   - Estado local: copia editável dos campos.
//   - Inputs numéricos para limites (0 = sem limite).
//   - Toggles para permissoes.
//   - Toggle grande para status (Ativo / Bloqueado).
//   - Barra de progresso "Usado X / Y" para cada limite (se Y > 0).
//   - Botão "Salvar" chama props.onSalvar(donoUid, payload).
//   - Dirty state: o botão Salvar fica desabilitado se nada mudou.
//
// Validação de tipos é feita no servidor (api/admin/update-owner.js);
// aqui só validamos a forma (inteiros ≥ 0, booleanos, etc).

import { useMemo, useState } from "react";
import {
  X,
  Save,
  LoaderCircle,
  ShieldOff,
  ShieldCheck,
  Users,
  Briefcase,
  FileText,
} from "lucide-react";

function fmtNum(n) {
  return Number.isFinite(Number(n)) ? Number(n) : 0;
}

function estadoInicialDeDono(dono) {
  if (!dono) {
    return {
      status: "ativo",
      limites: { contratos: 5, clientes: 5, funcionarios: 5 },
      permissoes: {
        criarContratos: true,
        criarClientes: true,
        criarFuncionarios: false,
      },
    };
  }
  return {
    status: dono.status === "bloqueado" ? "bloqueado" : "ativo",
    limites: {
      contratos: fmtNum(dono.limites?.contratos),
      clientes: fmtNum(dono.limites?.clientes),
      funcionarios: fmtNum(dono.limites?.funcionarios),
    },
    permissoes: {
      criarContratos: dono.permissoes?.criarContratos !== false,
      criarClientes: dono.permissoes?.criarClientes !== false,
      criarFuncionarios: dono.permissoes?.criarFuncionarios !== false,
    },
  };
}

function BarraUso({ usado, limite }) {
  const l = fmtNum(limite);
  const u = fmtNum(usado);
  if (l <= 0) {
    return (
      <p className="mt-1 text-[11px] text-slate-500">
        {u} usado(s) • sem limite configurado
      </p>
    );
  }
  const pct = Math.min(100, Math.round((u / l) * 100));
  const cor =
    pct >= 100
      ? "bg-red-500"
      : pct >= 80
      ? "bg-amber-500"
      : "bg-jurex";
  return (
    <div className="mt-1">
      <div className="flex items-center justify-between text-[11px] text-slate-500">
        <span>
          {u} / {l}
        </span>
        <span>{pct}%</span>
      </div>
      <div className="mt-1 h-1.5 w-full rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
        <div
          className={`h-full ${cor} transition-all`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function Toggle({ rotulo, valor, onChange, icone: Icone }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={!!valor}
      onClick={() => onChange(!valor)}
      className={`w-full flex items-center gap-3 p-3 rounded-xl border transition ${
        valor
          ? "border-jurex/30 bg-emerald-50 dark:bg-emerald-500/10"
          : "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
      }`}
    >
      {Icone && <Icone className="w-4 h-4 text-slate-500 shrink-0" />}
      <span className="flex-1 text-left text-sm font-semibold text-slate-700 dark:text-slate-200">
        {rotulo}
      </span>
      <span
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${
          valor ? "bg-jurex" : "bg-slate-300 dark:bg-slate-700"
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${
            valor ? "translate-x-6" : "translate-x-1"
          }`}
        />
      </span>
    </button>
  );
}

function InputLimite({ rotulo, valor, onChange, max = 1000000 }) {
  return (
    <div>
      <label className="block text-[10px] font-bold tracking-widest text-slate-500 uppercase">
        {rotulo}
      </label>
      <input
        type="number"
        min={0}
        max={max}
        step={1}
        value={Number.isFinite(Number(valor)) ? Number(valor) : 0}
        onChange={(e) => {
          const n = Number(e.target.value);
          onChange(Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0);
        }}
        className="mt-2 w-full h-11 px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-800 dark:text-slate-100 outline-none focus:border-jurex focus:ring-2 focus:ring-jurex/20 tabular-nums"
      />
      <p className="mt-1 text-[10px] text-slate-500">
        0 = sem limite
      </p>
    </div>
  );
}

export default function DonoGerenciarDrawer({ aberto, dono, onFechar, onSalvar }) {
  // Estado local hidratado a partir do `dono` recebido. Usamos
  // inicialização lazy para que o estado inicial já venha pronto,
  // sem precisar de um `useEffect` sincronizando prop → state.
  //
  // Para resetar quando o `dono` muda, o pai deve passar uma `key`
  // diferente (ex.: `key={dono.uid}`). Assim o React remonta o
  // componente e o lazy initializer é re-executado.
  const inicial = useMemo(() => estadoInicialDeDono(dono), [dono]);
  const [status, setStatus] = useState(() => inicial.status);
  const [limites, setLimites] = useState(() => inicial.limites);
  const [permissoes, setPermissoes] = useState(() => inicial.permissoes);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState(null);

  // Compara os valores editados com os originais para decidir se o
  // botão Salvar fica habilitado.
  const mudou = useMemo(() => {
    if (!dono) return false;
    if ((dono.status === "bloqueado" ? "bloqueado" : "ativo") !== status) return true;
    const origLim = {
      contratos: fmtNum(dono.limites?.contratos),
      clientes: fmtNum(dono.limites?.clientes),
      funcionarios: fmtNum(dono.limites?.funcionarios),
    };
    if (origLim.contratos !== limites.contratos) return true;
    if (origLim.clientes !== limites.clientes) return true;
    if (origLim.funcionarios !== limites.funcionarios) return true;
    const origPerm = {
      criarContratos: dono.permissoes?.criarContratos !== false,
      criarClientes: dono.permissoes?.criarClientes !== false,
      criarFuncionarios: dono.permissoes?.criarFuncionarios !== false,
    };
    if (origPerm.criarContratos !== permissoes.criarContratos) return true;
    if (origPerm.criarClientes !== permissoes.criarClientes) return true;
    if (origPerm.criarFuncionarios !== permissoes.criarFuncionarios) return true;
    return false;
  }, [dono, status, limites, permissoes]);

  if (!aberto || !dono) return null;

  async function handleSalvar() {
    if (!dono) return;
    setSalvando(true);
    setErro(null);
    const payload = {
      status,
      limites: {
        contratos: Number(limites.contratos) || 0,
        clientes: Number(limites.clientes) || 0,
        funcionarios: Number(limites.funcionarios) || 0,
      },
      permissoes: {
        criarContratos: !!permissoes.criarContratos,
        criarClientes: !!permissoes.criarClientes,
        criarFuncionarios: !!permissoes.criarFuncionarios,
      },
    };
    const resp = await onSalvar(dono.uid, payload);
    setSalvando(false);
    if (resp && resp.ok) {
      onFechar();
    } else {
      setErro(resp || { ok: false, erro: "Falha ao salvar." });
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex"
      role="dialog"
      aria-modal="true"
      aria-labelledby="drawer-title"
    >
      {/* Backdrop */}
      <button
        type="button"
        onClick={onFechar}
        aria-label="Fechar"
        className="flex-1 bg-black/60"
      />

      {/* Painel */}
      <div className="w-full max-w-md h-full bg-white dark:bg-slate-900 shadow-2xl overflow-y-auto">
        {/* Cabeçalho */}
        <div className="sticky top-0 z-10 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-5 py-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id="drawer-title" className="text-base font-bold text-slate-900 dark:text-white truncate">
              {dono.nome || "Sem nome"}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
              {dono.email || "—"}
            </p>
            <p className="text-[10px] font-mono text-slate-400 truncate">
              {dono.uid}
            </p>
          </div>
          <button
            type="button"
            onClick={onFechar}
            aria-label="Fechar"
            className="shrink-0 p-2 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-6">
          {/* Erro */}
          {erro && (
            <div className="rounded-xl border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10 p-3 text-xs text-red-700 dark:text-red-300">
              {erro.erro || "Não foi possível salvar."}
            </div>
          )}

          {/* Status */}
          <section>
            <h3 className="text-[11px] font-bold tracking-widest text-slate-500 uppercase">
              Status da conta
            </h3>
            <button
              type="button"
              onClick={() => setStatus(status === "ativo" ? "bloqueado" : "ativo")}
              className={`mt-2 w-full flex items-center gap-3 p-3 rounded-xl border transition ${
                status === "ativo"
                  ? "border-jurex/30 bg-emerald-50 dark:bg-emerald-500/10"
                  : "border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10"
              }`}
            >
              {status === "ativo" ? (
                <ShieldCheck className="w-5 h-5 text-jurex" />
              ) : (
                <ShieldOff className="w-5 h-5 text-red-500" />
              )}
              <div className="flex-1 text-left">
                <p className="text-sm font-bold text-slate-900 dark:text-white">
                  {status === "ativo" ? "Ativo" : "Bloqueado"}
                </p>
                <p className="text-[11px] text-slate-500">
                  {status === "ativo"
                    ? "O usuário acessa o sistema normalmente."
                    : "Acesso ao sistema fica bloqueado. Dados preservados."}
                </p>
              </div>
            </button>
          </section>

          {/* Limites */}
          <section>
            <h3 className="text-[11px] font-bold tracking-widest text-slate-500 uppercase">
              Limites de uso
            </h3>
            <div className="mt-3 grid grid-cols-1 gap-4">
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3">
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-purple-500" />
                  <p className="text-sm font-bold text-slate-800 dark:text-slate-100">
                    Contratos
                  </p>
                </div>
                <InputLimite
                  rotulo="Limite"
                  valor={limites.contratos}
                  onChange={(v) => setLimites((l) => ({ ...l, contratos: v }))}
                />
                <BarraUso usado={dono.contContratos} limite={limites.contratos} />
              </div>
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3">
                <div className="flex items-center gap-2">
                  <Briefcase className="w-4 h-4 text-amber-500" />
                  <p className="text-sm font-bold text-slate-800 dark:text-slate-100">
                    Clientes
                  </p>
                </div>
                <InputLimite
                  rotulo="Limite"
                  valor={limites.clientes}
                  onChange={(v) => setLimites((l) => ({ ...l, clientes: v }))}
                />
                <BarraUso usado={dono.contClientes} limite={limites.clientes} />
              </div>
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3">
                <div className="flex items-center gap-2">
                  <Users className="w-4 h-4 text-blue-500" />
                  <p className="text-sm font-bold text-slate-800 dark:text-slate-100">
                    Funcionários
                  </p>
                </div>
                <InputLimite
                  rotulo="Limite"
                  valor={limites.funcionarios}
                  onChange={(v) => setLimites((l) => ({ ...l, funcionarios: v }))}
                />
                <BarraUso usado={dono.contFuncionarios} limite={limites.funcionarios} />
              </div>
            </div>
          </section>

          {/* Permissões */}
          <section>
            <h3 className="text-[11px] font-bold tracking-widest text-slate-500 uppercase">
              Permissões
            </h3>
            <div className="mt-3 space-y-2">
              <Toggle
                rotulo="Criar contratos"
                icone={FileText}
                valor={permissoes.criarContratos}
                onChange={(v) =>
                  setPermissoes((p) => ({ ...p, criarContratos: v }))
                }
              />
              <Toggle
                rotulo="Criar clientes"
                icone={Briefcase}
                valor={permissoes.criarClientes}
                onChange={(v) =>
                  setPermissoes((p) => ({ ...p, criarClientes: v }))
                }
              />
              <Toggle
                rotulo="Criar funcionários"
                icone={Users}
                valor={permissoes.criarFuncionarios}
                onChange={(v) =>
                  setPermissoes((p) => ({ ...p, criarFuncionarios: v }))
                }
              />
            </div>
          </section>
        </div>

        {/* Rodapé fixo */}
        <div className="sticky bottom-0 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 px-5 py-3 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onFechar}
            disabled={salvando}
            className="h-10 px-4 rounded-xl text-sm font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSalvar}
            disabled={salvando || !mudou}
            className="h-10 px-4 rounded-xl bg-gradient-to-r from-jurex to-emerald-500 text-white text-sm font-bold flex items-center gap-2 shadow-md shadow-jurex/25 hover:brightness-105 active:scale-[0.98] transition disabled:opacity-50 disabled:pointer-events-none"
          >
            {salvando ? (
              <>
                <LoaderCircle className="w-4 h-4 animate-spin" />
                Salvando...
              </>
            ) : (
              <>
                <Save className="w-4 h-4" />
                Salvar alterações
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
