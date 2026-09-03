// Botão "Voltar" compartilhado pelo cabeçalho das páginas.
//
// Centraliza o comportamento padrão (`navigate(-1)`) e a identidade
// visual do botão: círculo branco, borda cinza bem clara, sombra
// extremamente suave.
//
// Aceita props opcionais:
//   - `to`        : quando informado, navega para essa rota fixa em
//                   vez de `navigate(-1)` (ex.: "voltar para lista").
//   - `onClick`   : handler extra a ser executado antes da navegação.
//   - `className` : classes extras para variações de tamanho/padding
//                   usadas em algumas páginas (p-2.5, w-[42px] etc.).
//   - `iconSize`  : tamanho do `ArrowLeft` (ex.: "w-[18px] h-[18px]").

import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

const BASE =
  "rounded-full bg-white dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700 shadow-[0_2px_4px_rgba(15,23,42,0.04)] hover:bg-slate-50 dark:hover:bg-slate-700 transition flex items-center justify-center";

export default function BackButton({
  to,
  onClick,
  className = "p-2",
  iconSize = "w-4.5 h-4.5",
}) {
  const navigate = useNavigate();

  function handleClick(e) {
    if (onClick) onClick(e);
    if (to) navigate(to);
    else navigate(-1);
  }

  return (
    <button
      type="button"
      aria-label="Voltar"
      onClick={handleClick}
      className={`${BASE} ${className}`}
    >
      <ArrowLeft className={`${iconSize} text-slate-700 dark:text-slate-200`} />
    </button>
  );
}
