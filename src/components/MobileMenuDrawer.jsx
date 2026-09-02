// Drawer lateral do menu mobile.
//
// Acionado pelo botão "Menu" do `BottomNav` (mobile only). Reproduz o
// design de referência: drawer vindo da esquerda, ~75% da largura,
// header com logo + "Jurex" + nome do usuário, seções FERRAMENTAS e
// CONFIGURAÇÕES, itens com ícone verde dentro de chip cinza claro,
// seta à direita e destaque cinza-claro nos itens destacados
// ("Modelos de cobrança" e "Central de ajuda").
//
// MOBILE ONLY: o contêiner raiz usa `md:hidden`, então em `>=md` nada
// é renderizado (o `Sidebar` desktop continua sendo a navegação
// principal — ver `AppLayout.jsx`).
//
// COMPORTAMENTO:
//   - overlay cobre o restante da tela com `bg-black/55`; clique no
//     overlay fecha o drawer.
//   - `<body>` fica com `overflow: hidden` enquanto o drawer está
//     aberto para impedir scroll da página por baixo.
//   - ao tocar num item, navega para a rota e fecha o drawer.
//   - X no canto superior direito também fecha.
//
// ANIMAÇÃO: CSS-only via `transition-transform`. Renderiza fora da
// árvore (-translate-x-full) no primeiro frame e em seguida aplica
// translate-x-0 dentro de um requestAnimationFrame, evitando o "flash"
// de conteúdo já visível antes da transição iniciar.

import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  X,
  Calendar,
  User,
  CreditCard,
  Users,
  MessageSquare,
  FileText,
  Database,
  LifeBuoy,
  Shield,
  ScrollText,
  Info,
  ChevronRight,
} from "lucide-react";
import { useAuth } from "../context/useAuth";

// Lista de seções/itens do drawer. `destaque: true` aplica o fundo
// cinza-claro arredondado conforme a referência (Modelos de cobrança
// e Central de ajuda). "Meus Planos" e "Termos de Uso" reaproveitam
// rotas já existentes (não há `/configuracoes/meus-planos` no sistema;
// o usuário pediu para NÃO criar rotas novas).
const secoes = [
  {
    titulo: "Ferramentas",
    itens: [
      { label: "Calendário", to: "/calendario", icone: Calendar },
    ],
  },
  {
    titulo: "Configurações",
    itens: [
      { label: "Perfil", to: "/perfil", icone: User },
      { label: "Meus Planos", to: "/perfil", icone: CreditCard },
      { label: "Funcionários", to: "/configuracoes/funcionarios", icone: Users },
      {
        label: "Modelos de cobrança",
        to: "/configuracoes/modelos-cobranca",
        icone: MessageSquare,
        destaque: true,
      },
      {
        label: "Modelos de contrato",
        to: "/configuracoes/modelos-contrato",
        icone: FileText,
      },
      {
        label: "Backup de dados",
        to: "/configuracoes/backup",
        icone: Database,
      },
      {
        label: "Central de ajuda",
        to: "/configuracoes/ajuda",
        icone: LifeBuoy,
        destaque: true,
      },
      {
        label: "Privacidade",
        to: "/configuracoes/privacidade",
        icone: Shield,
      },
      {
        label: "Termos de Uso",
        to: "/configuracoes/privacidade",
        icone: ScrollText,
      },
      {
        label: "Sobre o Jurex",
        to: "/configuracoes/sobre",
        icone: Info,
      },
    ],
  },
];

// Extrai o nome "bonito" para o header (mesma estratégia da
// `Sidebar` desktop — displayName, fallback email, fallback "Usuário").
function resolverNomeHeader(usuario) {
  const dn = usuario?.displayName?.trim();
  if (dn) return dn;
  if (usuario?.email) return usuario.email.split("@")[0];
  return "Usuário";
}

export default function MobileMenuDrawer({ aberto, onFechar }) {
  const navigate = useNavigate();
  const { usuario } = useAuth();
  const nomeHeader = useMemo(() => resolverNomeHeader(usuario), [usuario]);
  // `montado` controla se o nó está no DOM. Mantemos montado durante o
  // exit-animation para a transição de saída rodar; depois desmontamos.
  const [montado, setMontado] = useState(false);
  // `entrando` alterna a classe de translate (entra/sai).
  const [entrando, setEntrando] = useState(false);
  const timeoutSaidaRef = useRef(null);

  // Trava o scroll do <body> enquanto o drawer está aberto. Restaurado
  // no cleanup para não contaminar outras páginas após fechar.
  useEffect(() => {
    if (!aberto) return;
    const overflowOriginal = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflowOriginal;
    };
  }, [aberto]);

  // Gerencia montagem + animação de entrada/saída. Quando `aberto`
  // muda para `true`, montamos e aplicamos a classe de "aberto" no
  // próximo frame para a transition rodar. Quando muda para `false`,
  // invertemos primeiro e só depois desmontamos.
  useEffect(() => {
    if (aberto) {
      setMontado(true);
      // próximo frame: aplica a transformação de entrada
      const id = requestAnimationFrame(() => setEntrando(true));
      return () => cancelAnimationFrame(id);
    }
    // Saindo: marca como "fechado" para iniciar a transição reversa
    setEntrando(false);
    if (timeoutSaidaRef.current) clearTimeout(timeoutSaidaRef.current);
    timeoutSaidaRef.current = setTimeout(() => setMontado(false), 300);
    return () => {
      if (timeoutSaidaRef.current) clearTimeout(timeoutSaidaRef.current);
    };
  }, [aberto]);

  // Fecha no ESC.
  useEffect(() => {
    if (!aberto) return;
    const onKey = (e) => {
      if (e.key === "Escape") onFechar();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [aberto, onFechar]);

  if (!montado) return null;

  const aoClicarItem = (to) => {
    onFechar();
    if (to) navigate(to);
  };

  return (
    <div
      className="md:hidden fixed inset-0 z-[60]"
      aria-modal="true"
      role="dialog"
      aria-label="Menu"
    >
      {/* Overlay: cobre o resto da tela, fecha no clique. */}
      <button
        type="button"
        aria-label="Fechar menu"
        onClick={onFechar}
        className={`absolute inset-0 bg-black/55 transition-opacity duration-300 ${
          entrando ? "opacity-100" : "opacity-0"
        }`}
        tabIndex={-1}
      />

      {/* Drawer: 75% da largura, no máximo 320px (não estourar em
          tablets). Sombra à direita, sem cantos arredondados à
          esquerda. */}
      <aside
        className={`absolute top-0 left-0 h-full w-[75%] max-w-[320px] bg-white dark:bg-slate-900 shadow-2xl shadow-black/30 flex flex-col transform transition-transform duration-300 ease-out ${
          entrando ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Header (altura 88px conforme referência) */}
        <header className="relative h-[88px] shrink-0 bg-emerald-50/60 dark:bg-emerald-500/10 border-b border-slate-200 dark:border-slate-800 px-6 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-slate-900 dark:bg-slate-800 flex items-center justify-center shrink-0 overflow-hidden">
            <img
              src="/logo.png"
              alt="Jurex"
              className="w-7 h-7 object-contain"
            />
          </div>
          <div className="min-w-0 leading-tight">
            <p className="text-base font-bold text-slate-800 dark:text-slate-100">Jurex</p>
            <p className="text-[11px] tracking-[0.18em] text-slate-500 dark:text-slate-400 font-semibold uppercase truncate">
              {nomeHeader}
            </p>
          </div>

          {/* Botão X: canto superior direito, círculo com borda. */}
          <button
            type="button"
            onClick={onFechar}
            aria-label="Fechar menu"
            className="absolute top-3 right-3 w-9 h-9 rounded-full border border-emerald-300 dark:border-emerald-500/40 bg-white dark:bg-slate-800 flex items-center justify-center hover:bg-emerald-50 dark:hover:bg-slate-700 transition"
          >
            <X className="w-4 h-4 text-jurex" strokeWidth={2.25} />
          </button>
        </header>

        {/* Conteúdo scrollável. Scrollbar fina para combinar com a
            referência (discreta no extremo direito). */}
        <nav className="flex-1 overflow-y-auto px-4 py-5 space-y-5 scrollbar-thin">
          {secoes.map((secao) => (
            <div key={secao.titulo}>
              <p className="px-1 pb-2 text-[11px] font-semibold tracking-[0.18em] text-slate-500 dark:text-slate-400 uppercase">
                {secao.titulo}
              </p>
              <ul className="space-y-1.5">
                {secao.itens.map(({ label, to, icone: Icone, destaque }) => (
                  <li key={label}>
                    <button
                      type="button"
                      onClick={() => aoClicarItem(to)}
                      className={`w-full flex items-center gap-3 px-3 h-12 rounded-2xl text-left transition ${
                        destaque
                          ? "bg-slate-100 hover:bg-slate-200/70 dark:bg-slate-800 dark:hover:bg-slate-700"
                          : "hover:bg-slate-50 dark:hover:bg-slate-800/60"
                      }`}
                    >
                      <span
                        className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                          destaque ? "bg-white dark:bg-slate-700" : "bg-slate-100 dark:bg-slate-800"
                        }`}
                      >
                        <Icone
                          className="w-[18px] h-[18px] text-jurex"
                          strokeWidth={2}
                        />
                      </span>
                      <span className="text-sm font-medium text-slate-700 dark:text-slate-200 truncate">
                        {label}
                      </span>
                      <ChevronRight className="w-4 h-4 text-slate-400 dark:text-slate-500 ml-auto shrink-0" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </aside>
    </div>
  );
}
