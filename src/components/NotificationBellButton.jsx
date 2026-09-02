// Botão do sino de notificações compartilhado pelo cabeçalho das páginas.
//
// Centraliza o comportamento: ao clicar, navega para `/notificacoes`.
// Preserva o visual de referência: círculo branco com `Bell` verde-água
// (`text-emerald-600`) e badge no canto superior direito.
//
// VARIANTE DO BADGE
//   - `naoLidas` (number, opcional): quando maior que zero, exibe o badge
//     dinâmico com a contagem (estilo do Dashboard). Quando `undefined` ou
//     `0`, exibe o ponto estático verde-água usado nos demais cabeçalhos.
//
// A rota de destino vem de um único lugar (`NOTIFICACOES_ROTA`) para que
// todas as páginas apontem para a mesma URL.

import { useNavigate } from "react-router-dom";
import { Bell } from "lucide-react";

// Rota única usada em todo o sistema. Mantida como constante para evitar
// divergências entre páginas e facilitar um futuro rename.
export const NOTIFICACOES_ROTA = "/notificacoes";

export default function NotificationBellButton({ naoLidas }) {
  const navigate = useNavigate();

  const mostrarContador = typeof naoLidas === "number" && naoLidas > 0;

  return (
    <button
      type="button"
      aria-label="Notificações"
      onClick={() => navigate(NOTIFICACOES_ROTA)}
      className="relative rounded-full p-2.5 bg-white dark:bg-slate-800 ring-1 ring-slate-200 dark:ring-slate-700 shadow-sm hover:bg-slate-50 dark:hover:bg-slate-700 transition"
    >
      <Bell className="w-5 h-5 text-emerald-600" />
      {mostrarContador ? (
        <span className="absolute -top-0.5 -right-0.5 min-w-5 h-5 px-1.5 inline-flex items-center justify-center rounded-full bg-emerald-500 text-white text-[10px] font-bold ring-2 ring-white dark:ring-slate-900">
          {naoLidas > 99 ? "99+" : naoLidas}
        </span>
      ) : (
        <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-jurex" />
      )}
    </button>
  );
}
