import Sidebar from "./Sidebar";
import BottomNav from "./BottomNav";

// Layout raiz do app autenticado.
//
// Responsivo:
//   - `md+` (≥768px): mostra `Sidebar` lateral e `<main>` com padding
//     natural. A `BottomNav` está oculta (`md:hidden`).
//   - `<md` (mobile): esconde `Sidebar` (`hidden md:flex` no Sidebar) e
//     mostra a `BottomNav` fixa. O `<main>` ganha `pb-24` para que o
//     conteúdo da última seção não seja coberto pela nav.
//
// `min-h-svh` (não `100vh`) cobre o caso de barras dinâmicas do browser
// mobile (URL bar / bottom bar) sem clipping do conteúdo.

export default function AppLayout({ children }) {
  return (
    <div className="min-h-svh bg-slate-50 dark:bg-slate-950 flex">
      <Sidebar />
      <main className="flex-1 min-w-0 pb-24 md:pb-0">
        {children}
      </main>
      <BottomNav />
    </div>
  );
}
