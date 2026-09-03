import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Plus,
  FileText,
  Pencil,
  Trash2,
} from "lucide-react";
import {
  collection,
  doc,
  addDoc,
  deleteDoc,
  onSnapshot,
} from "firebase/firestore";
import AppLayout from "../components/AppLayout";
import BackButton from "../components/BackButton";
import HomeButton from "../components/HomeButton";
import { useAuth } from "../context/useAuth";
import { db } from "../services/firebase";

// Modelo padrão do resumo de empréstimo
const MODELO_EMPRESTIMO = `Olá, {nome}! 👋 Segue o resumo do nosso *contrato de empréstimo*: 🤝

💰 *Valor emprestado:* {valorContrato}
📈 *Juros:* {taxaJurosLabel}
🔁 *Frequência:* {frequencia}
💵 *Parcelas:* {numeroParcelas}x de {valorParcela}
📅 *Início:* {dataInicio}
✅ *Total a pagar:* {totalReceber}

🗓️ *Cronograma de vencimentos:*
{cronograma}

Qualquer dúvida estou à disposição. Obrigado pela confiança! 🙏`;

// Modelo padrão do resumo de venda
const MODELO_VENDA = `Olá, {nome}! 👋 Segue o resumo do nosso *contrato de Venda*: 🤝

📦 *{nomeProduto}*
💰 Valor da venda: {valorVenda}
✅ Entrada: {entrada}
🔁 Frequência: {frequencia}
💵 Parcelas: {numeroParcelas}x de {valorParcela}
📅 Início: {dataInicio} 🗓️
✅ Total a pagar: {totalReceber}
🗓️ Cronograma de vencimentos: {cronograma}`;

const PADROES = [
  { id: "resumo-emprestimo", titulo: "Resumo do contrato", texto: MODELO_EMPRESTIMO },
  { id: "resumo-venda", titulo: "Resumo da venda", texto: MODELO_VENDA },
];

export default function ModelosContrato() {
  const navigate = useNavigate();
  const { usuario } = useAuth();
  const [modelos, setModelos] = useState([]);

  // Escuta os modelos salvos no Firestore em tempo real
  useEffect(() => {
    if (!usuario) return;
    const unsub = onSnapshot(
      collection(db, "usuarios", usuario.uid, "modelosContrato"),
      (snap) => {
        setModelos(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      }
    );
    return unsub;
  }, [usuario]);

  // Popula com os padrões na primeira visita
  async function criarPadroesIniciais() {
    for (const p of PADROES) {
      await addDoc(collection(db, "usuarios", usuario.uid, "modelosContrato"), {
        titulo: p.titulo,
        texto: p.texto,
      });
    }
  }

  async function criarNovo() {
    await addDoc(collection(db, "usuarios", usuario.uid, "modelosContrato"), {
      titulo: "Novo modelo",
      texto: "Olá, {nome}! 👋",
    });
  }

  async function excluir(id) {
    if (!window.confirm("Excluir este modelo?")) return;
    await deleteDoc(doc(db, "usuarios", usuario.uid, "modelosContrato", id));
  }

  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto px-6 py-6">
        {/* Cabeçalho */}
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-gradient-to-r from-emerald-50 to-white dark:from-slate-900 dark:to-emerald-950/20 px-6 py-5">
          <div className="flex items-center gap-4">
            <BackButton />
            <HomeButton />
            <div>
              <h1 className="text-xl font-bold text-slate-900 dark:text-white">
                Modelos de contrato
              </h1>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Mensagens para o envio de contrato
              </p>
            </div>
          </div>
        </div>

        {/* Criar novo modelo */}
        <button
          type="button"
          onClick={modelos.length === 0 ? criarPadroesIniciais : criarNovo}
          className="mt-6 w-full h-13 rounded-2xl bg-gradient-to-r from-jurex to-emerald-500 text-white text-base font-bold flex items-center justify-center gap-2 shadow-lg shadow-jurex/30 hover:brightness-105 active:scale-[0.99] transition"
        >
          <Plus className="w-5 h-5" />
          Criar novo modelo
        </button>

        {/* Lista de modelos */}
        <section className="mt-5 mb-12 space-y-4">
          {modelos.map(({ id, titulo, texto }) => (
            <article
              key={id}
              className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5"
            >
              <div className="flex items-start gap-3">
                <span className="shrink-0 rounded-xl bg-emerald-50 dark:bg-emerald-500/10 p-2.5">
                  <FileText className="w-5 h-5 text-jurex" />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-bold text-slate-900 dark:text-white">
                    {titulo}
                  </p>
                  <p className="mt-0.5 text-xs leading-relaxed text-slate-500 dark:text-slate-400 whitespace-pre-wrap line-clamp-3">
                    {texto}
                  </p>
                </div>
              </div>

              {/* Ações */}
              <div className="mt-4 grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() =>
                    navigate(`/configuracoes/modelos-contrato/${id}/editar`)
                  }
                  className="h-11 rounded-xl border border-jurex/60 text-sm font-bold text-jurex flex items-center justify-center gap-2 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 transition"
                >
                  <Pencil className="w-4 h-4" />
                  Editar
                </button>
                <button
                  type="button"
                  onClick={() => excluir(id)}
                  className="h-11 rounded-xl border border-red-300/70 text-sm font-bold text-red-500 flex items-center justify-center gap-2 hover:bg-red-50 dark:hover:bg-red-950/30 transition"
                >
                  <Trash2 className="w-4 h-4" />
                  Excluir
                </button>
              </div>
            </article>
          ))}

          {modelos.length === 0 && (
            <p className="text-center text-sm text-slate-400 py-6">
              Nenhum modelo ainda — clique em “Criar novo modelo”.
            </p>
          )}
        </section>
      </div>
    </AppLayout>
  );
}
