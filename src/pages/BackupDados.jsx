import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  FileText,
  Users,
  Download,
} from "lucide-react";
import jsPDF from "jspdf";
import { collection, onSnapshot, query, orderBy } from "firebase/firestore";
import AppLayout from "../components/AppLayout";
import BackButton from "../components/BackButton";
import HomeButton from "../components/HomeButton";
import { useAuth } from "../context/useAuth";
import { db } from "../services/firebase";

const STATUS = ["Todos", "Ativos", "Quitados"];

function formatarMoeda(v) {
  return (v ?? 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function formatarData(iso) {
  if (!iso) return "-";
  const d = new Date(iso);
  return isNaN(d) ? "-" : d.toLocaleDateString("pt-BR");
}

export default function BackupDados() {
  const navigate = useNavigate();
  const { usuario } = useAuth();

  const [aba, setAba] = useState("contratos");
  const [status, setStatus] = useState("Todos");
  const [de, setDe] = useState("");
  const [ate, setAte] = useState("");
  const [contratos, setContratos] = useState([]);
  const [clientes, setClientes] = useState([]);
  const [gerando, setGerando] = useState(false);

  // Escuta contratos e clientes em tempo real
  useEffect(() => {
    if (!usuario) return;
    const unsubC = onSnapshot(
      query(collection(db, "usuarios", usuario.uid, "contratos"), orderBy("criadoEm", "asc")),
      (snap) => setContratos(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
    );
    const unsubL = onSnapshot(
      query(collection(db, "usuarios", usuario.uid, "clientes"), orderBy("nome", "asc")),
      (snap) => setClientes(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
    );
    return () => { unsubC(); unsubL(); };
  }, [usuario]);

  const filtrados = useMemo(() => {
    if (aba === "clientes") return clientes;

    return contratos.filter((c) => {
      if (status === "Ativos" && c.quitado) return false;
      if (status === "Quitados" && !c.quitado) return false;
      const dataRef = c.criadoEm ? new Date(c.criadoEm) : null;
      if (de && dataRef && dataRef < new Date(de)) return false;
      if (ate && dataRef) {
        const limite = new Date(ate);
        limite.setHours(23, 59, 59);
        if (dataRef > limite) return false;
      }
      return true;
    });
  }, [aba, contratos, clientes, status, de, ate]);

  async function gerarPdf() {
    setGerando(true);
    try {
      const pdf = new jsPDF();
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(16);
      pdf.text(
        aba === "clientes" ? "Relatório de Clientes — Cred Facil" : "Relatório de Contratos — Cred Facil",
        14, 18
      );
      pdf.setFontSize(9);
      pdf.setFont("helvetica", "normal");
      pdf.text(`Gerado em ${new Date().toLocaleString("pt-BR")}`, 14, 25);

      let y = 36;
      if (aba === "clientes") {
        pdf.setFont("helvetica", "bold");
        pdf.text("Nome", 14, y);
        pdf.text("Telefone", 90, y);
        pdf.text("E-mail", 135, y);
        pdf.setFont("helvetica", "normal");
        y += 6;
        for (const c of filtrados) {
          pdf.text(String(c.nome ?? "-").slice(0, 40), 14, y);
          pdf.text(String(c.telefone ?? "-"), 90, y);
          pdf.text(String(c.email ?? "-").slice(0, 30), 135, y);
          y += 6;
          if (y > 280) { pdf.addPage(); y = 20; }
        }
      } else {
        for (const c of filtrados) {
          pdf.setFont("helvetica", "bold");
          pdf.text(String(c.nome ?? "Contrato"), 14, y);
          pdf.setFont("helvetica", "normal");
          pdf.text(c.quitado ? "Quitado" : "Ativo", 170, y);
          y += 6;
          pdf.text(`Valor: ${formatarMoeda(c.valor)}`, 18, y);
          pdf.text(`Parcelas: ${c.numeroParcelas ?? "-"}`, 80, y);
          pdf.text(`Início: ${formatarData(c.dataInicio)}`, 130, y);
          y += 10;
          if (y > 270) { pdf.addPage(); y = 20; }
        }
      }

      pdf.save(aba === "clientes" ? "clientes-Cred Facil.pdf" : "contratos-Cred Facil.pdf");
    } finally {
      setGerando(false);
    }
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
                Backup de dados
              </h1>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Exporte contratos e clientes em PDF
              </p>
            </div>
          </div>
        </div>

        {/* Abas Contratos / Clientes */}
        <div className="mt-6 grid grid-cols-2 gap-1 rounded-full bg-slate-100 dark:bg-slate-800 p-1">
          {[
            { id: "contratos", label: "Contratos", icone: FileText },
            { id: "clientes", label: "Clientes", icone: Users },
          ].map(({ id, label, icone: Icone }) => (
            <button
              key={id}
              type="button"
              onClick={() => setAba(id)}
              className={`flex items-center justify-center gap-2 h-11 rounded-full text-sm font-bold transition ${
                aba === id
                  ? "bg-emerald-500 text-white shadow"
                  : "text-slate-500 hover:text-slate-700 dark:text-slate-400"
              }`}
            >
              <Icone className="w-4 h-4" />
              {label}
            </button>
          ))}
        </div>

        {aba === "contratos" && (
          <>
            {/* Status */}
            <div className="mt-6">
              <p className="text-[10px] font-bold tracking-widest text-slate-400 uppercase">
                Status
              </p>
              <div className="mt-2 flex gap-2">
                {STATUS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setStatus(s)}
                    className={`h-8 px-4 rounded-full text-xs font-bold transition ${
                      status === s
                        ? "bg-emerald-500 text-white shadow"
                        : "bg-white dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-700 text-slate-500 dark:text-slate-400 hover:border-Cred Facil/40"
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>

            {/* Período opcional */}
            <div className="mt-5">
              <p className="text-[10px] font-bold tracking-widest text-slate-400 uppercase">
                Período (opcional)
              </p>
              <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="backup-de" className="block text-xs text-slate-500 mb-1.5">De</label>
                  <input
                    id="backup-de"
                    type="date"
                    value={de}
                    onChange={(e) => setDe(e.target.value)}
                    className="w-full h-12 px-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-semibold text-slate-800 dark:text-slate-100 outline-none transition focus:border-Cred Facil focus:ring-2 focus:ring-Cred Facil/20"
                  />
                </div>
                <div>
                  <label htmlFor="backup-ate" className="block text-xs text-slate-500 mb-1.5">Até</label>
                  <input
                    id="backup-ate"
                    type="date"
                    value={ate}
                    onChange={(e) => setAte(e.target.value)}
                    className="w-full h-12 px-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-semibold text-slate-800 dark:text-slate-100 outline-none transition focus:border-Cred Facil focus:ring-2 focus:ring-Cred Facil/20"
                  />
                </div>
              </div>
            </div>
          </>
        )}

        {/* Contador do filtro */}
        <div className="mt-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-5 py-4">
          <p className="text-sm text-slate-600 dark:text-slate-300">
            <span className="font-extrabold text-slate-900 dark:text-white tabular-nums">
              {filtrados.length}
            </span>{" "}
            {aba === "clientes" ? "cliente(s)" : "contrato(s)"} serão exportados com esse filtro.
          </p>
        </div>

        {/* Botão de exportação */}
        <button
          type="button"
          disabled={gerando || filtrados.length === 0}
          onClick={gerarPdf}
          className="mt-5 w-full h-13 rounded-2xl bg-gradient-to-r from-Cred Facil to-emerald-500 text-white text-base font-bold flex items-center justify-center gap-2 shadow-lg shadow-Cred Facil/30 hover:brightness-105 active:scale-[0.99] transition disabled:opacity-60 disabled:pointer-events-none"
        >
          <Download className="w-5 h-5" />
          Gerar PDF de{" "}
          {aba === "clientes" ? "clientes" : "contratos"}
        </button>

        <div className="mb-12" />
      </div>
    </AppLayout>
  );
}
