import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  House,
  Camera,
  LoaderCircle,
  UsersRound,
} from "lucide-react";
import { doc, getDoc, updateDoc, serverTimestamp } from "firebase/firestore";
import AppLayout from "../components/AppLayout";
import BackButton from "../components/BackButton";
import { useAuth } from "../context/useAuth";
import { db } from "../services/firebase";
import { validarFoto, enviarFoto } from "../services/fotoService";

const SCORES = ["Baixo", "Médio", "Alto"];

// Máscara de CPF: 000.000.000-00
function formatarCpfInput(v) {
  const d = v.replace(/\D/g, "").slice(0, 11);
  return d
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d{1,2})$/, "$1-$2");
}

// Máscara de telefone: (00) 00000-0000
function formatarTelefoneInput(v) {
  const d = v.replace(/\D/g, "").slice(0, 11);
  if (d.length <= 10) {
    return d.replace(/(\d{2})(\d)/, "($1) $2").replace(/(\d{4})(\d)/, "$1-$2");
  }
  return d.replace(/(\d{2})(\d)/, "($1) $2").replace(/(\d{5})(\d)/, "$1-$2");
}

export default function EditarCliente() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { usuario } = useAuth();

  // carregando | pronto | nao-encontrado | erro
  const [estado, setEstado] = useState("carregando");

  const [nome, setNome] = useState("");
  const [foto, setFoto] = useState(null); // URL atual (Firestore) ou preview
  const [fotoFile, setFotoFile] = useState(null); // arquivo novo a enviar
  const [enviandoFoto, setEnviandoFoto] = useState(false);
  const [cpf, setCpf] = useState("");
  const [telefone, setTelefone] = useState("");
  const [email, setEmail] = useState("");
  const [endereco, setEndereco] = useState("");
  const [score, setScore] = useState("Médio");
  const [documentosExistentes, setDocumentosExistentes] = useState([]);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [sucesso, setSucesso] = useState(false);

  // Carrega os dados atuais do cliente validando a posse (ownerId = uid)
  useEffect(() => {
    if (!usuario || !id) return;
    let ativo = true;
    getDoc(doc(db, "clientes", id))
      .then((snap) => {
        if (!ativo) return;
        if (!snap.exists() || snap.data().ownerId !== usuario.uid) {
          setEstado("nao-encontrado");
          return;
        }
        const dados = snap.data();
        setNome(dados.nomeCompleto ?? "");
        setCpf(
          formatarCpfInput(dados.cpf ?? "")
        );
        setTelefone(formatarTelefoneInput(dados.telefone ?? ""));
        setEmail(dados.email ?? "");
        setEndereco(dados.endereco ?? "");
        setScore(dados.scoreCredito ?? "Médio");
        setFoto(dados.fotoUrl || null);
        setDocumentosExistentes(
          Array.isArray(dados.documentos) ? dados.documentos : []
        );
        setEstado("pronto");
      })
      .catch(() => {
        if (ativo) setEstado("erro");
      });
    return () => {
      ativo = false;
    };
  }, [usuario, id]);

  // Valida e guarda o arquivo novo; preview imediato enquanto envia no salvar
  function escolherFoto(e) {
    const file = e.target.files?.[0];
    e.target.value = ""; // permite reselecionar o mesmo arquivo
    if (!file) return;
    const erroValidacao = validarFoto(file);
    if (erroValidacao) return setErro(erroValidacao);
    setErro("");
    setFotoFile(file);
    const reader = new FileReader();
    reader.onload = () => setFoto(reader.result);
    reader.readAsDataURL(file);
  }

  async function salvar(e) {
    e.preventDefault();
    setErro("");
    setSucesso(false);
    if (!nome.trim()) return setErro("Informe o nome completo do cliente.");
    if (!telefone.trim()) return setErro("Informe o telefone do cliente.");
    try {
      setSalvando(true);
      // Revalida a posse antes de gravar
      const ref = doc(db, "clientes", id);
      const snap = await getDoc(ref);
      if (!snap.exists() || snap.data().ownerId !== usuario?.uid) {
        setErro("Você não tem permissão para editar este cliente.");
        return;
      }

      // Foto nova: upload primeiro; só atualiza o Firestore com a URL final
      let urlFoto = foto ?? "";
      if (fotoFile) {
        try {
          setEnviandoFoto(true);
          urlFoto = await enviarFoto(fotoFile);
        } catch (errFoto) {
          console.error("Erro ao enviar foto:", errFoto);
          setErro(
            errFoto?.message ??
              "Não foi possível enviar a foto. Tente novamente."
          );
          return; // não salva com dados parciais
        } finally {
          setEnviandoFoto(false);
        }
      }

      await updateDoc(ref, {
        nomeCompleto: nome.trim(),
        cpf: cpf.replace(/\D/g, "") || "",
        telefone: telefone.replace(/\D/g, ""),
        email: email.trim(),
        endereco: endereco.trim(),
        scoreCredito: score,
        fotoUrl: urlFoto,
        updatedAt: serverTimestamp(),
      });
      setFotoFile(null);
      setSucesso(true);
      setTimeout(() => navigate(`/clientes/${id}`), 900);
    } catch (err) {
      console.error("Erro ao atualizar cliente:", err);
      setErro("Não foi possível salvar as alterações. Tente novamente.");
    } finally {
      setSalvando(false);
    }
  }

  const classeCampo =
    "mt-2 w-full h-12 px-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-semibold text-slate-800 dark:text-slate-100 placeholder-slate-400 outline-none transition focus:border-Cred Facil focus:ring-2 focus:ring-Cred Facil/20";
  const classeLabel =
    "block text-[10px] font-bold tracking-widest text-slate-500 uppercase";

  if (estado === "carregando") {
    return (
      <AppLayout>
        <div className="min-h-svh flex flex-col items-center justify-center gap-3 text-slate-500 dark:text-slate-400">
          <LoaderCircle className="w-7 h-7 text-Cred Facil animate-spin" />
          <p className="text-sm font-semibold">Carregando cliente...</p>
        </div>
      </AppLayout>
    );
  }

  if (estado !== "pronto") {
    return (
      <AppLayout>
        <div className="max-w-5xl mx-auto px-6 py-6">
          <section className="mt-16 mb-16 flex flex-col items-center text-center">
            <span className="rounded-2xl bg-slate-100 dark:bg-slate-800 p-4">
              <UsersRound className="w-7 h-7 text-slate-400" />
            </span>
            <h2 className="mt-4 text-base font-bold text-slate-900 dark:text-white">
              Cliente não encontrado.
            </h2>
            <button
              type="button"
              onClick={() => navigate("/clientes")}
              className="mt-5 h-11 px-5 rounded-xl bg-gradient-to-r from-Cred Facil to-emerald-500 text-white text-sm font-bold shadow-md shadow-Cred Facil/25 hover:brightness-105 active:scale-[0.98] transition"
            >
              Voltar para clientes
            </button>
          </section>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto px-6 py-6">
        {/* Cabeçalho */}
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-gradient-to-r from-emerald-50 to-white dark:from-slate-900 dark:to-emerald-950/20 px-6 py-5">
          <div className="flex items-center gap-4">
            <BackButton to={`/clientes/${id}`} />
            <button
              type="button"
              onClick={() => navigate("/dashboard")}
              aria-label="Início"
              className="rounded-full p-2 bg-white dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700 shadow-[0_2px_4px_rgba(15,23,42,0.04)] hover:bg-slate-50 dark:hover:bg-slate-700 transition"
            >
              <House className="w-4.5 h-4.5 text-slate-600 dark:text-slate-300" />
            </button>
            <h1 className="text-xl font-bold text-slate-900 dark:text-white">
              Editar cliente
            </h1>
          </div>
        </div>

        <form onSubmit={salvar} className="mt-6 space-y-5 mb-24">
          {/* Nome completo */}
          <section>
            <label htmlFor="editar-cliente-nome" className={classeLabel}>
              Nome completo
            </label>
            <input
              id="editar-cliente-nome"
              type="text"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              required
              className={classeCampo}
            />
          </section>

          {/* Foto do cliente */}
          <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
            <p className={classeLabel}>Foto do cliente</p>
            <div className="mt-3 flex items-center gap-4">
              <span className="shrink-0 w-16 h-16 rounded-2xl bg-gradient-to-r from-Cred Facil to-emerald-500 overflow-hidden flex items-center justify-center">
                {foto ? (
                  <img src={foto} alt="Foto do cliente" className="w-full h-full object-cover" />
                ) : (
                  <span className="text-white text-2xl font-bold">?</span>
                )}
              </span>
              <label
                htmlFor="editar-cliente-foto"
                className={`flex-1 h-12 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center gap-2 text-sm font-semibold text-slate-600 dark:text-slate-300 transition select-none ${
                  salvando
                    ? "opacity-60 pointer-events-none"
                    : "cursor-pointer hover:bg-slate-200 dark:hover:bg-slate-700"
                }`}
              >
                {enviandoFoto ? (
                  <>
                    <LoaderCircle className="w-4.5 h-4.5 animate-spin" />
                    Enviando foto...
                  </>
                ) : (
                  <>
                    <Camera className="w-4.5 h-4.5" />
                    Alterar foto
                  </>
                )}
              </label>
              <input
                id="editar-cliente-foto"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={escolherFoto}
                disabled={salvando}
                className="hidden"
              />
            </div>
          </section>

          {/* CPF */}
          <section>
            <label htmlFor="editar-cliente-cpf" className={classeLabel}>
              CPF (opcional)
            </label>
            <input
              id="editar-cliente-cpf"
              inputMode="numeric"
              placeholder="000.000.000-00"
              value={cpf}
              onChange={(e) => setCpf(formatarCpfInput(e.target.value))}
              className={classeCampo}
            />
          </section>

          {/* Telefone */}
          <section>
            <label htmlFor="editar-cliente-telefone" className={classeLabel}>
              Telefone
            </label>
            <input
              id="editar-cliente-telefone"
              inputMode="numeric"
              placeholder="(00) 00000-0000"
              value={telefone}
              onChange={(e) => setTelefone(formatarTelefoneInput(e.target.value))}
              required
              className={classeCampo}
            />
          </section>

          {/* E-mail */}
          <section>
            <label htmlFor="editar-cliente-email" className={classeLabel}>
              E-mail
            </label>
            <input
              id="editar-cliente-email"
              type="email"
              placeholder="email@dominio.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={classeCampo}
            />
          </section>

          {/* Endereço */}
          <section>
            <label htmlFor="editar-cliente-endereco" className={classeLabel}>
              Endereço
            </label>
            <input
              id="editar-cliente-endereco"
              type="text"
              placeholder="Rua, número, cidade"
              value={endereco}
              onChange={(e) => setEndereco(e.target.value)}
              className={classeCampo}
            />
          </section>

          {/* Documentos existentes (somente leitura por enquanto) */}
          <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-5 py-4">
            <p className="text-[10px] font-bold tracking-widest text-slate-500 uppercase">
              Documentos
            </p>
            {documentosExistentes.length === 0 ? (
              <p className="mt-1 text-xs text-slate-400">Nenhum documento anexado.</p>
            ) : (
              <ul className="mt-2 space-y-1">
                {documentosExistentes.map((docItem, i) => {
                  const docNome =
                    typeof docItem === "string" ? docItem : (docItem?.nome ?? "Documento");
                  return (
                    <li
                      key={`${docNome}-${i}`}
                      className="text-xs font-medium text-slate-600 dark:text-slate-300 truncate"
                    >
                      📄 {docNome}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* Score de crédito */}
          <section>
            <label htmlFor="editar-cliente-score" className={classeLabel}>
              Score de crédito
            </label>
            <select
              id="editar-cliente-score"
              value={score}
              onChange={(e) => setScore(e.target.value)}
              className={classeCampo}
            >
              {SCORES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </section>

          {/* Erro de validação/salvamento */}
          {erro && (
            <p className="rounded-xl bg-red-50 dark:bg-red-950/30 px-4 py-3 text-sm font-semibold text-red-500">
              {erro}
            </p>
          )}

          {/* Sucesso */}
          {sucesso && (
            <p className="rounded-xl bg-emerald-50 dark:bg-emerald-500/10 px-4 py-3 text-sm font-semibold text-Cred Facil">
              Alterações salvas com sucesso!
            </p>
          )}

          {/* Salvar alterações */}
          <button
            type="submit"
            disabled={salvando}
            className="w-full h-13 rounded-2xl bg-gradient-to-r from-Cred Facil to-emerald-500 text-white text-base font-bold flex items-center justify-center shadow-lg shadow-Cred Facil/30 hover:brightness-105 active:scale-[0.99] transition disabled:opacity-60 disabled:pointer-events-none"
          >
            {salvando ? "Salvando..." : "Salvar alterações"}
          </button>
        </form>
      </div>
    </AppLayout>
  );
}
