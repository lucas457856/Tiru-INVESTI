import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Save,
  RotateCcw,
} from "lucide-react";
import { doc, getDoc, setDoc } from "firebase/firestore";
import AppLayout from "../components/AppLayout";
import BackButton from "../components/BackButton";
import HomeButton from "../components/HomeButton";
import { useEffectiveUid } from "../hooks/useEffectiveUid";
import { db } from "../services/firebase";

const VARIAVEIS = [
  "nome", "nomeProduto", "valorContrato", "valorVenda", "taxaJurosLabel",
  "frequencia", "numeroParcelas", "valorParcela", "dataInicio", "entrada",
  "totalReceber", "cronograma",
];

export default function ModeloContratoEditor() {
  const navigate = useNavigate();
  const { id } = useParams();
  const effectiveUid = useEffectiveUid();

  const [titulo, setTitulo] = useState("");
  const [texto, setTexto] = useState("");
  const [carregando, setCarregando] = useState(true);
  const [salvo, setSalvo] = useState(false);

  // Carrega o modelo do Firestore
  useEffect(() => {
    if (!effectiveUid || !id) return;
    getDoc(doc(db, "usuarios", effectiveUid, "modelosContrato", id)).then(
      (snap) => {
        if (snap.exists()) {
          setTitulo(snap.data().titulo ?? "");
          setTexto(snap.data().texto ?? "");
        }
        setCarregando(false);
      }
    );
  }, [effectiveUid, id]);

  async function salvar(e) {
    e.preventDefault();
    await setDoc(
      doc(db, "usuarios", effectiveUid, "modelosContrato", id),
      { titulo, texto },
      { merge: true }
    );
    setSalvo(true);
    setTimeout(() => navigate("/configuracoes/modelos-contrato"), 700);
  }

  function inserirVariavel(nome) {
    const el = document.getElementById("editor-contrato");
    if (!el) return;
    const inicio = el.selectionStart ?? texto.length;
    const fim = el.selectionEnd ?? texto.length;
    setTexto(texto.slice(0, inicio) + `{${nome}}` + texto.slice(fim));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(inicio + nome.length + 2, inicio + nome.length + 2);
    });
  }

  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto px-6 py-6">
        {/* Cabeçalho */}
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-gradient-to-r from-emerald-50 to-white dark:from-slate-900 dark:to-emerald-950/20 px-6 py-5">
          <div className="flex items-center gap-4">
            <BackButton to="/configuracoes/modelos-contrato" />
            <HomeButton />
            <div>
              <h1 className="text-xl font-bold text-slate-900 dark:text-white">
                Editar modelo
              </h1>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Personalize o texto enviado com o contrato
              </p>
            </div>
          </div>
        </div>

        {carregando ? null : (
          <form onSubmit={salvar} className="mt-6 space-y-5">
            {/* Título */}
            <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
              <label
                htmlFor="titulo-modelo"
                className="block text-[10px] font-bold tracking-widest text-slate-400 uppercase"
              >
                Título
              </label>
              <input
                id="titulo-modelo"
                value={titulo}
                onChange={(e) => setTitulo(e.target.value)}
                required
                className="mt-2 w-full h-12 px-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-semibold text-slate-800 dark:text-slate-100 outline-none transition focus:border-jurex focus:ring-2 focus:ring-jurex/20"
              />
            </section>

            {/* Texto */}
            <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
              <p className="text-[10px] font-bold tracking-widest text-slate-400 uppercase">
                Mensagem
              </p>
              <textarea
                id="editor-contrato"
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                rows={14}
                required
                className="mt-3 w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-950/40 p-4 text-sm leading-relaxed text-slate-800 dark:text-slate-100 outline-none resize-y transition focus:border-jurex focus:ring-2 focus:ring-jurex/20"
              />

              {/* Variáveis */}
              <p className="mt-4 text-[10px] font-bold tracking-widest text-slate-400 uppercase">
                Variáveis disponíveis
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
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

            {/* Ações */}
            <div className="flex gap-3 mb-12">
              <button
                type="submit"
                className="flex-1 h-12 rounded-xl bg-gradient-to-r from-jurex to-emerald-500 text-white text-base font-bold flex items-center justify-center gap-2 shadow-lg shadow-jurex/30 hover:brightness-105 active:scale-[0.99] transition"
              >
                <Save className="w-5 h-5" />
                Salvar
              </button>
              <button
                type="button"
                onClick={() => navigate("/configuracoes/modelos-contrato")}
                className="h-12 px-5 rounded-xl bg-white dark:bg-slate-800 ring-1 ring-slate-200 dark:ring-slate-700 text-sm font-bold text-slate-700 dark:text-slate-200 flex items-center gap-2 hover:bg-slate-50 dark:hover:bg-slate-700 transition"
              >
                <RotateCcw className="w-4 h-4" />
                Cancelar
              </button>
            </div>
            {salvo && (
              <p className="-mt-8 mb-10 text-xs font-semibold text-jurex">Salvo!</p>
            )}
          </form>
        )}
      </div>
    </AppLayout>
  );
}
