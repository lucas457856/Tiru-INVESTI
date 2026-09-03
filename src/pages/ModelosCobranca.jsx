import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Save,
  RotateCcw,
  BellRing,
  CalendarDays,
  TriangleAlert,
  CircleCheck,
  HandCoins,
} from "lucide-react";
import AppLayout from "../components/AppLayout";
import HomeButton from "../components/HomeButton";
import { useAuth } from "../context/useAuth";
import { db } from "../services/firebase";
import { doc, setDoc, getDoc } from "firebase/firestore";

// Abas de modelos
const MODELOS = [
  {
    id: "lembrete",
    label: "Lembrete amigável",
    icone: BellRing,
    padrao: `Olá, {nome}! 👋

Passando para lembrar com carinho que sua *parcela {numero}/{totalParcelas}* no valor de *{valor}* vence em *{vencimento}*{diasRestantesTexto}.

Se já efetuou o pagamento, por favor desconsidere esta mensagem. 🙏

Qualquer dúvida estou à disposição!`,
  },
  {
    id: "vence-hoje",
    label: "Vence hoje",
    icone: CalendarDays,
    padrao: `Olá, {nome}! ⏰

Sua *parcela {numero}/{totalParcelas}* no valor de *{valor}* vence *hoje*!

Se já efetuou o pagamento, por favor desconsidere esta mensagem. 🙏

Qualquer dúvida estou à disposição!`,
  },
  {
    id: "atraso",
    label: "Cobrança de atraso",
    icone: TriangleAlert,
    padrao: `Olá, {nome}! ⚠️

Notamos que sua *parcela {numero}/{totalParcelas}* no valor de *{valor}* venceu em *{vencimento}* e está em atraso há *{diasAtraso}* dias.{acrescimo}

Assim que possível, realize o pagamento para regularizar. 🙏

Qualquer dúvida estou à disposição!`,
  },
  {
    id: "agradecimento",
    label: "Agradecimento",
    icone: CircleCheck,
    padrao: `Olá, {nome}! ✅

Recebemos o pagamento da *parcela {numero}/{totalParcelas}* no valor de *{valor}*. Obrigado pela confiança! 🤝

Qualquer dúvida estou à disposição!`,
  },
  {
    id: "renegociacao",
    label: "Proposta de renegociação",
    icone: HandCoins,
    padrao: `Olá, {nome}! 🤝

Sabemos que imprevistos acontecem. Sua *parcela {numero}/{totalParcelas}* no valor de *{valor}* está em aberto desde *{vencimento}*.

Podemos renegociar com condições especiais. Podemos conversar?

Qualquer dúvida estou à disposição!`,
  },
];

// Variáveis disponíveis para inserir no texto
const VARIAVEIS = [
  "nome", "nomeCompleto", "numero", "totalParcelas", "valor", "total",
  "acrescimo", "vencimento", "diasAtraso", "diasRestantes", "diasRestantesTexto",
];

function substituir(texto, exemplo) {
  return texto.replace(/\{(\w+)\}/g, (_, chave) => exemplo[chave] ?? `{${chave}}`);
}

export default function ModelosCobranca() {
  const navigate = useNavigate();
  const { usuario } = useAuth();
  const [ativo, setAtivo] = useState(MODELOS[0].id);
  const [textos, setTextos] = useState(
    Object.fromEntries(MODELOS.map((m) => [m.id, m.padrao]))
  );
  const [salvo, setSalvo] = useState(false);

  // Carrega textos salvos no Firestore
  useEffect(() => {
    if (!usuario) return;
    getDoc(doc(db, "usuarios", usuario.uid, "config", "modelosCobranca")).then(
      (snap) => {
        if (snap.exists()) {
          setTextos((t) => ({ ...t, ...snap.data() }));
        }
      }
    );
  }, [usuario]);

  const modeloAtual = MODELOS.find((m) => m.id === ativo);
  const textoAtual = textos[ativo];

  function inserirVariavel(nome) {
    const el = document.getElementById("editor-modelo");
    if (!el) return;
    const inicio = el.selectionStart ?? textoAtual.length;
    const fim = el.selectionEnd ?? textoAtual.length;
    const novo =
      textoAtual.slice(0, inicio) + `{${nome}}` + textoAtual.slice(fim);
    setTextos((t) => ({ ...t, [ativo]: novo }));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(inicio + nome.length + 2, inicio + nome.length + 2);
    });
  }

  async function salvar() {
    await setDoc(
      doc(db, "usuarios", usuario.uid, "config", "modelosCobranca"),
      textos,
      { merge: true }
    );
    setSalvo(true);
    setTimeout(() => setSalvo(false), 2500);
  }

  function restaurarPadrao() {
    setTextos((t) => ({ ...t, [ativo]: modeloAtual.padrao }));
  }

  // Dados de exemplo para a pré-visualização
  const exemplo = {
    nome: (usuario?.displayName ?? "Cliente").split(" ")[0],
    nomeCompleto: usuario?.displayName ?? "Cliente Completo",
    numero: "1",
    totalParcelas: "12",
    valor: "R$ 250,00",
    total: "R$ 3.000,00",
    acrescimo: "",
    vencimento: "22/08/2026",
    diasAtraso: "3",
    diasRestantes: "5",
    diasRestantesTexto: " (faltam 5 dias)",
  };

  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto px-6 py-6">
        {/* Cabeçalho */}
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-gradient-to-r from-emerald-50 to-white dark:from-slate-900 dark:to-emerald-950/20 px-6 py-5">
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => navigate(-1)}
              aria-label="Voltar"
              className="rounded-full p-2 ring-1 ring-slate-200 dark:ring-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 transition"
            >
              <ArrowLeft className="w-4.5 h-4.5 text-slate-700 dark:text-slate-200" />
            </button>
            <HomeButton />
            <div>
              <h1 className="text-xl font-bold text-slate-900 dark:text-white">
                Mensagens
              </h1>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Edite seus modelos de cobrança
              </p>
            </div>
          </div>
        </div>

        {/* Abas de modelo */}
        <div className="mt-6 flex flex-wrap items-center gap-2">
          <span className="mr-1 text-[10px] font-bold tracking-widest text-slate-400 uppercase">
            Modelo
          </span>
          {MODELOS.map(({ id, label, icone: Icone }) => (
            <button
              key={id}
              type="button"
              onClick={() => setAtivo(id)}
              className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-bold border transition ${
                ativo === id
                  ? "bg-jurex text-white border-jurex shadow-md shadow-jurex/25"
                  : "bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-jurex/40"
              }`}
            >
              <Icone className={`w-3.5 h-3.5 ${ativo === id ? "" : "text-jurex"}`} />
              {label}
            </button>
          ))}
        </div>

        {/* Editor */}
        <section className="mt-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
          <p className="text-[10px] font-bold tracking-widest text-slate-400 uppercase">
            Mensagem
          </p>
          <textarea
            id="editor-modelo"
            value={textoAtual}
            onChange={(e) =>
              setTextos((t) => ({ ...t, [ativo]: e.target.value }))
            }
            rows={12}
            className="mt-3 w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-950/40 p-4 text-sm leading-relaxed text-slate-800 dark:text-slate-100 outline-none resize-y transition focus:border-jurex focus:ring-2 focus:ring-jurex/20"
          />
          <div className="mt-4 flex gap-3">
            <button
              type="button"
              onClick={salvar}
              className="flex-1 h-12 rounded-xl bg-gradient-to-r from-jurex to-emerald-500 text-white text-base font-bold flex items-center justify-center gap-2 shadow-lg shadow-jurex/30 hover:brightness-105 active:scale-[0.99] transition"
            >
              <Save className="w-5 h-5" />
              Salvar
            </button>
            <button
              type="button"
              onClick={restaurarPadrao}
              className="h-12 px-5 rounded-xl bg-white dark:bg-slate-800 ring-1 ring-slate-200 dark:ring-slate-700 text-sm font-bold text-slate-700 dark:text-slate-200 flex items-center gap-2 hover:bg-slate-50 dark:hover:bg-slate-700 transition"
            >
              <RotateCcw className="w-4 h-4" />
              Padrão
            </button>
          </div>
          {salvo && (
            <p className="mt-2 text-xs font-semibold text-jurex">
              Salvo!
            </p>
          )}
        </section>

        {/* Variáveis disponíveis */}
        <section className="mt-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
          <p className="text-[10px] font-bold tracking-widest text-slate-400 uppercase">
            Variáveis disponíveis
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Toque em uma variável para inseri-la na posição final do texto.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {VARIAVEIS.map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => inserirVariavel(v)}
                className="inline-flex items-center gap-1 rounded-full bg-slate-100 dark:bg-slate-800 px-3 py-1.5 font-mono text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 hover:text-jurex transition"
              >
                + &#123;{v}&#125;
              </button>
            ))}
          </div>
        </section>

        {/* Pré-visualização */}
        <section className="mt-5 mb-12 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
          <p className="text-[10px] font-bold tracking-widest text-slate-400 uppercase">
            Pré-visualização
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Usando dados do primeiro contrato como exemplo.
          </p>
          <div className="mt-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-950/40 p-4 text-sm leading-relaxed whitespace-pre-wrap text-slate-800 dark:text-slate-100">
            {substituir(textoAtual, exemplo)}
          </div>
        </section>
      </div>
    </AppLayout>
  );
}
