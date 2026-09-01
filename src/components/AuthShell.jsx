import logo from "../assets/jurex-logo.png";

export default function AuthShell({ children }) {
  return (
    <div className="min-h-svh bg-gradient-to-b from-emerald-50 via-slate-50 to-white dark:from-slate-950 dark:via-slate-900 dark:to-slate-950 flex flex-col items-center px-4 py-10">
      {/* Logo + slogan */}
      <img
        src={logo}
        alt="Jurex"
        className="w-24 h-24 rounded-2xl shadow-lg shadow-emerald-900/20 object-cover"
      />
      <p className="mt-5 text-sm text-slate-500 dark:text-slate-400">
        Controle total dos seus empréstimos
      </p>

      {/* Card */}
      <div className="mt-8 w-full max-w-md bg-white/90 backdrop-blur rounded-3xl shadow-xl shadow-emerald-900/10 ring-1 ring-black/5 bg-white dark:bg-slate-900 dark:ring-white/10 p-6 sm:p-8">
        {children}
      </div>
    </div>
  );
}
