// Barra de navegação inferior FIXA no viewport mobile.
//
// Aparece SOMENTE em viewports mobile (`md:hidden` no pai). No desktop, o
// `Sidebar` lateral é a navegação principal (ver `AppLayout.jsx`).
//
// REGRA: links para rotas JÁ EXISTENTES em `routes/AppRoutes.jsx`. Sem
// criar rota nova. "Menu" aponta para `/configuracoes` (a tela "Menu"
// típica do app guarda as configurações agregadas).
//
// ITEM ATIVO: "Início" é destacado em verde (borda + ícone + texto) quando
// o usuário está em `/dashboard`. O destaque é puramente visual — não muda
// a rota. Os outros itens só mudam de cor (slate-500 → emerald-600) ao
// ficarem ativos.
//
// POSICIONAMENTO: `fixed bottom-3 left-3 right-3` (não `bottom-0`) para
// ficar com a margem/flutuação que aparece na referência, com sombra e
// bordas arredondadas. O `AppLayout` adiciona `pb-24` no `<main>` do
// mobile para que o conteúdo não fique escondido por baixo da nav.

import { NavLink } from "react-router-dom";
import { Home, FileText, Users, ChartLine, Menu as MenuIcon } from "lucide-react";

const itens = [
  { to: "/dashboard", label: "Início", icone: Home, end: true },
  { to: "/emprestimos", label: "Contratos", icone: FileText, end: true },
  { to: "/clientes", label: "Clientes", icone: Users, end: true },
  { to: "/relatorios", label: "Relatórios", icone: ChartLine, end: true },
  { to: "/configuracoes", label: "Menu", icone: MenuIcon, end: true },
];

// Classes por estado: item ativo = borda + texto + ícone verdes (jurex).
// Inativo = slate-500. Espelha a estética da Sidebar (emerald-50 de fundo
// em ativo), mas em formato horizontal mais compacto para a barra inferior.
const classeItem = ({ isActive }) =>
  `flex flex-col items-center justify-center gap-0.5 min-w-0 flex-1 py-2 rounded-2xl transition ${
    isActive
      ? "text-jurex"
      : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
  }`;

export default function BottomNav() {
  return (
    <nav
      aria-label="Navegação inferior"
      className="md:hidden fixed bottom-3 left-3 right-3 z-40 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-lg shadow-slate-900/5"
    >
      <ul className="flex items-stretch justify-between px-1.5 py-1">
        {itens.map(({ to, label, icone: Icone, end }) => (
          <li key={to} className="flex-1 min-w-0">
            <NavLink to={to} end={end} className={classeItem}>
              {({ isActive }) => (
                <>
                  {/* Wrapper do ícone: quando ativo, ganha fundo emerald-50
                      e borda emerald para combinar com a referência. */}
                  <span
                    className={`flex items-center justify-center w-10 h-10 rounded-xl transition ${
                      isActive
                        ? "bg-emerald-50 dark:bg-emerald-500/10 ring-1 ring-emerald-200 dark:ring-emerald-500/30"
                        : ""
                    }`}
                  >
                    <Icone
                      className={`w-5 h-5 ${isActive ? "text-jurex" : "text-slate-500 dark:text-slate-400"}`}
                      strokeWidth={isActive ? 2.25 : 2}
                    />
                  </span>
                  <span
                    className={`text-[10px] font-semibold tracking-wide truncate ${
                      isActive ? "text-jurex" : "text-slate-500 dark:text-slate-400"
                    }`}
                  >
                    {label}
                  </span>
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
