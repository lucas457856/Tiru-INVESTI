import { useState } from "react";
import { NavLink } from "react-router-dom";
import {
  Home,
  FileText,
  Users,
  ChartLine,
  Settings,
  ChevronDown,
} from "lucide-react";

const itens = [
  { to: "/dashboard", label: "Início", icone: Home, fim: true },
  { to: "/emprestimos", label: "Contratos", icone: FileText },
  { to: "/clientes", label: "Clientes", icone: Users },
  { to: "/relatorios", label: "Relatórios", icone: ChartLine },
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
      { to: "/configuracoes/sobre", label: "Sobre o Jurex" },
    ],
  },
];

const classeItem = ({ isActive }) =>
  `flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium transition ${
    isActive
      ? "bg-emerald-50 text-jurex dark:bg-emerald-500/10"
      : "text-slate-600 hover:bg-slate-50 hover:text-slate-800 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
  }`;

export default function Sidebar() {
  const [aberto, setAberto] = useState(false);

  return (
    <aside className="w-52 shrink-0 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col overflow-y-auto">
      {/* Marca */}
      <div className="flex items-center gap-2.5 px-4 py-4">
        <img
          src="/logo.png"
          alt="Jurex"
          className="w-9 h-9 rounded-lg object-cover"
        />
        <div className="leading-tight">
          <p className="text-sm font-bold text-slate-800 dark:text-slate-100">Jurex</p>
          <p className="text-[10px] tracking-wide text-emerald-600 font-semibold uppercase">
            Controle de empréstimos
          </p>
        </div>
      </div>

      {/* Navegação */}
      <nav className="px-3 mt-2 space-y-1 pb-6">
        {itens.map(({ to, label, icone: Item, fim }) => (
          <NavLink key={to} to={to} end={fim} className={classeItem}>
            <Item className="w-4.5 h-4.5" />
            {label}
          </NavLink>
        ))}

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
