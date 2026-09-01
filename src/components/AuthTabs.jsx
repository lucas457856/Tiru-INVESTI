import { Link } from "react-router-dom";

export default function AuthTabs({ ativa }) {
  const base =
    "py-2.5 rounded-xl text-sm font-semibold text-center transition-all";
  const on = "bg-jurex text-white shadow-md shadow-jurex/30";
  const off = "text-slate-600 hover:text-slate-800 dark:text-slate-300 dark:hover:text-white";

  return (
    <div className="grid grid-cols-2 gap-2 bg-slate-100/80 dark:bg-slate-800/80 rounded-2xl p-1.5">
      <Link
        to="/login"
        className={`${base} ${ativa === "entrar" ? on : off}`}
      >
        Entrar
      </Link>
      <Link
        to="/cadastro"
        className={`${base} ${ativa === "criar" ? on : off}`}
      >
        Criar conta
      </Link>
    </div>
  );
}
