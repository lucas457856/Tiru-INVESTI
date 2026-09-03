// Botão de "Início/Home" compartilhado pelo cabeçalho das páginas.
//
// Centraliza o comportamento: ao clicar, navega para a tela inicial do
// sistema (`/dashboard`, mesma rota usada pela `Sidebar` e `BottomNav`).
//
// Visual padrão aplicado em todas as páginas:
//   - círculo branco;
//   - borda cinza bem clara;
//   - sombra extremamente suave;
//   - ícone `House` em cinza-escuro.
//
// A rota de destino vem de um único lugar (`HOME_ROTA`) para que todas
// as páginas apontem para a mesma URL e para facilitar um futuro rename.

import { useNavigate } from "react-router-dom";
import { House } from "lucide-react";

// Rota única usada em todo o sistema. Mantida como constante para
// evitar divergências entre páginas.
export const HOME_ROTA = "/dashboard";

export default function HomeButton() {
  const navigate = useNavigate();

  return (
    <button
      type="button"
      aria-label="Início"
      onClick={() => navigate(HOME_ROTA)}
      className="rounded-full p-2 bg-white dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700 shadow-[0_2px_4px_rgba(15,23,42,0.04)] hover:bg-slate-50 dark:hover:bg-slate-700 transition"
    >
      <House className="w-4.5 h-4.5 text-slate-600 dark:text-slate-300" />
    </button>
  );
}
