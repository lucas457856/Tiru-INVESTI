import { useMemo, useState } from "react";
import { NavLink } from "react-router-dom";
import {
  Home,
  FileText,
  Users,
  ChartLine,
  Bell,
  Settings,
  LifeBuoy,
  ChevronDown,
  Shield,
} from "lucide-react";
import { useAuth } from "../context/useAuth";
import { useIsAdmin } from "../hooks/useIsAdmin";

// Itens principais do menu lateral.
// "Notificações" é o segundo item para acesso rápido à página /notificacoes.
const itens = [
  { to: "/dashboard", label: "Início", icone: Home, fim: true },
  { to: "/notificacoes", label: "Notificações", icone: Bell },
  { to: "/emprestimos", label: "Contratos", icone: FileText },
  { to: "/clientes", label: "Clientes", icone: Users },
  { to: "/relatorios", label: "Relatórios", icone: ChartLine },
  { to: "/suporte", label: "Suporte", icone: LifeBuoy },
];

// Itens do submenu, agrupados
const subConfig = [
  {
    grupo: "Ferramentas",
    itens: [{ to: "/calendario", label: "Calendário" }],
  },
  {
    grupo: "Configurações",
    itens: [
      { to: "/perfil", label: "Perfil" },
      { to: "/configuracoes/meus-planos", label: "Meus Planos" },
      { to: "/configuracoes/funcionarios", label: "Funcionários" },
      { to: "/configuracoes/modelos-cobranca", label: "Modelos de cobrança" },
      { to: "/configuracoes/modelos-contrato", label: "Modelos de contrato" },
      { to: "/configuracoes/backup", label: "Backup de dados" },
      { to: "/configuracoes/ajuda", label: "Central de ajuda" },
      { to: "/configuracoes/privacidade", label: "Privacidade" },
      { to: "/configuracoes/sobre", label: "Sobre o Cred Facil" },
    ],
  },
];

const classeItem = ({ isActive }) =>
  `flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium transition ${
    isActive
      ? "bg-emerald-50 text-jurex dark:bg-emerald-500/10"
      : "text-slate-600 hover:bg-slate-50 hover:text-slate-800 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
  }`;

// Extrai as iniciais do nome do usuário (máx 2 letras) para o avatar da sidebar.
function iniciaisDoNome(nome) {
  if (!nome) return "?";
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return "?";
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
}

export default function Sidebar() {
  const [aberto, setAberto] = useState(false);
  const { usuario } = useAuth();
  const isAdmin = useIsAdmin();

  // Mesmo padrão do Dashboard: prioriza displayName, cai para o usuário
  // do email e por último "Usuário". Tudo em maiúsculas para o avatar.
  const nomeUsuario = useMemo(() => {
    const dn = usuario?.displayName?.trim();
    if (dn) return dn;
    if (usuario?.email) return usuario.email.split("@")[0];
    return "Usuário";
  }, [usuario]);

  // Saudação curta para a sidebar (primeiro nome). Não exibe nada
  // enquanto o usuário não estiver autenticado (evita flicker).
  const primeiroNome = useMemo(() => {
    if (!nomeUsuario) return "";
    return nomeUsuario.split(/\s+/)[0];
  }, [nomeUsuario]);

  const iniciais = useMemo(() => iniciaisDoNome(nomeUsuario), [nomeUsuario]);

  return (
    <aside className="hidden md:flex w-52 shrink-0 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex-col overflow-y-auto">
      {/* Usuário (no topo, sem o bloco da marca) */}
      <div className="px-4 py-4 border-b border-slate-100 dark:border-slate-800">
        {primeiroNome && (
          <div className="flex items-center gap-2.5">
            <span className="w-8 h-8 rounded-full bg-emerald-500 text-white text-xs font-bold flex items-center justify-center shrink-0">
              {iniciais}
            </span>
            <div className="min-w-0">
              <p className="text-[10px] tracking-widest text-slate-400 uppercase">
                Usuário
              </p>
              <p className="text-xs font-bold text-slate-700 dark:text-slate-200 truncate">
                {primeiroNome}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Navegação */}
      <nav className="px-3 mt-2 space-y-1 pb-6">
        {itens.map(({ to, label, icone: Item, fim }) => (
          <NavLink key={to} to={to} end={fim} className={classeItem}>
            <Item className="w-4.5 h-4.5" />
            {label}
          </NavLink>
        ))}

        {/* Link ADMIN — só aparece para o ADMIN_UID. Defesa em
            camadas: mesmo que alguém force a rota via URL,
            <RotaAdmin> redireciona. */}
        {isAdmin && (
          <NavLink
            to="/admin"
            end
            className={({ isActive }) =>
              `flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-bold transition ${
                isActive
                  ? "bg-jurex text-white shadow"
                  : "text-jurex hover:bg-emerald-50 dark:hover:bg-emerald-500/10"
              }`
            }
          >
            <Shield className="w-4.5 h-4.5" />
            Painel Admin
          </NavLink>
        )}

        {/* Configurações (expansível) */}
        <div>
          <button
            type="button"
            onClick={() => setAberto((v) => !v)}
            aria-expanded={aberto}
            className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-sm font-medium transition ${
              aberto
                ? "text-slate-800 dark:text-slate-100"
                : "text-slate-600 hover:bg-slate-50 hover:text-slate-800 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
            }`}
          >
            <span className="flex items-center gap-2.5">
              <Settings className="w-4.5 h-4.5" />
              Configurações
            </span>
            <ChevronDown
              className={`w-4 h-4 text-slate-400 transition-transform ${
                aberto ? "rotate-180" : ""
              }`}
            />
          </button>

          {aberto && (
            <div className="mt-1 ml-4 border-l border-slate-200 dark:border-slate-800 pl-2 space-y-2">
              {subConfig.map(({ grupo, itens }) => (
                <div key={grupo}>
                  <p className="px-3 pt-1 pb-0.5 text-[10px] font-bold tracking-widest text-slate-400 uppercase">
                    {grupo}
                  </p>
                  {itens.map(({ to, label }) => (
                    <NavLink
                      key={to}
                      to={to}
                      end
                      className={({ isActive }) =>
                        `block px-3 py-1.5 text-xs font-medium rounded-lg transition ${
                          isActive
                            ? "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600"
                            : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                        }`
                      }
                    >
                      {label}
                    </NavLink>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      </nav>
    </aside>
  );
}
