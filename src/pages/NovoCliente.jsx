import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  House,
  Camera,
  Plus,
  LoaderCircle,
  Lock,
} from "lucide-react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { doc, updateDoc, serverTimestamp } from "firebase/firestore";
import { db } from "../services/firebase";
import AppLayout from "../components/AppLayout";
import BackButton from "../components/BackButton";
import { useAuth } from "../context/useAuth";
import { useEffectiveUid } from "../hooks/useEffectiveUid";
import { useDonoAdmin } from "../hooks/useDonoAdmin";
import {
  validarFoto,
  enviarFoto,
  enviarDocumento,
} from "../services/fotoService";
import { criarCliente } from "../services/adminService";
import { obterDeviceIdLocal } from "../services/notificationEvents";

const SCORES = ["Baixo", "Médio", "Alto"];

// Máscara de CPF: 000.000.000-00
function formatarCpf(v) {
  const d = v.replace(/\D/g, "").slice(0, 11);
  return d
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d{1,2})$/, "$1-$2");
}

// Máscara de telefone: (00) 00000-0000
function formatarTelefone(v) {
  const d = v.replace(/\D/g, "").slice(0, 11);
  if (d.length <= 10) {
    return d.replace(/(\d{2})(\d)/, "($1) $2").replace(/(\d{4})(\d)/, "$1-$2");
  }
  return d.replace(/(\d{2})(\d)/, "($1) $2").replace(/(\d{5})(\d)/, "$1-$2");
}

export default function NovoCliente() {
  const navigate = useNavigate();
  const { usuario } = useAuth();
  const effectiveUid = useEffectiveUid();
  // Limites, permissões e status do DONO (defaults permissivos
  // aplicados automaticamente — ver useDonoAdmin). Usado para
  // bloquear o submit quando o limite de clientes foi atingido.
  // A defesa real continua no endpoint server-side
  // /api/admin/criar-cliente, que valida o limite no Admin SDK e
  // o Firestore Rules nega create direto do client SDK.
  const { permissoes, limites, status: statusDono, plan, loading: loadingDono } = useDonoAdmin();
  // Contagem atual de clientes do escopo efetivo (dono próprio ou
  // dono do funcionário). Mantida em tempo real pelo onSnapshot.
  // 0 = sem escopo / ainda não carregou.
  const [qtdClientes, setQtdClientes] = useState(0);

  const [nome, setNome] = useState("");
  const [foto, setFoto] = useState(null); // preview (data URL) apenas visual
  const [fotoFile, setFotoFile] = useState(null); // arquivo real p/ upload
  const [enviandoFoto, setEnviandoFoto] = useState(false);
  const [cpf, setCpf] = useState("");
  const [telefone, setTelefone] = useState("");
  const [email, setEmail] = useState("");
  const [endereco, setEndereco] = useState("");
  const [documentos, setDocumentos] = useState([]); // arquivos a enviar
  const [score, setScore] = useState("Médio");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [sucesso, setSucesso] = useState(false);

  // Acompanha a contagem atual de clientes para detectar
  // "limite atingido" em tempo real (entre o momento em que o
  // usuário abriu a página e o instante do submit). Quando não
  // há effectiveUid, o estado permanece em 0 (default) e nenhum
  // listener é aberto — sem setState dentro do effect.
  useEffect(() => {
    if (!effectiveUid) return undefined;
    const q = query(collection(db, "clientes"), where("ownerId", "==", effectiveUid));
    const unsub = onSnapshot(q, (snap) => setQtdClientes(snap.size));
    return unsub;
  }, [effectiveUid]);

  // Regra de bloqueio (espelha Clientes.jsx). limite.clientes = 0
  // significa "sem limite" — não bloqueia. permissoes.criarClientes
  // = false → bloqueia sempre. status = "bloqueado" → bloqueia sempre.
  // plan === "pro" → ilimitado (nunca bloqueia por limite).
  const ehPro = plan === "pro";
  const limiteClientes = limites.clientes;
  const contaBloqueada = statusDono === "bloqueado";
  const permissaoNegada = !contaBloqueada && permissoes.criarClientes === false;
  const limiteAtingido =
    !loadingDono &&
    !ehPro &&
    !contaBloqueada &&
    !permissaoNegada &&
    limiteClientes > 0 &&
    qtdClientes >= limiteClientes;
  const cadastroBloqueado = contaBloqueada || permissaoNegada || limiteAtingido;

  // Valida e mantém o arquivo selecionado no estado (upload só no salvar)
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

  // Seleção de documentos: valida e guarda os arquivos para upload no salvar
  function escolherDocumentos(e) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ""; // permite reselecionar os mesmos arquivos
    for (const file of files) {
      const erroValidacao = validarFoto(file);
      if (erroValidacao) {
        setErro(erroValidacao);
        return;
      }
    }
    setErro("");
    setDocumentos((prev) => [...prev, ...files]);
  }

  async function cadastrar(e) {
    e.preventDefault();
    setErro("");
    setSucesso(false);
    if (!nome.trim()) return setErro("Informe o nome completo do cliente.");
    if (!telefone.trim()) return setErro("Informe o telefone do cliente.");
    if (!usuario) return setErro("Usuário não autenticado.");
    if (!effectiveUid) return setErro("Sessão sem escopo de proprietário.");

    // Bloqueio de UX antes de chamar o endpoint. Se o limite já
    // foi atingido, não faz o request — exibe a mensagem
    // exata pedida e retorna. A defesa real está no servidor
    // (Admin SDK) e nas Firestore Rules, mas este early-return
    // evita round-trip e dá feedback imediato.
    if (cadastroBloqueado) {
      if (contaBloqueada) {
        return setErro("Conta bloqueada. Entre em contato com o administrador.");
      }
      if (permissaoNegada) {
        return setErro(
          "Seu plano não permite cadastrar clientes. Entre em contato com o administrador."
        );
      }
      return setErro(
        `Limite de clientes atingido. Seu limite atual é de ${limiteClientes} ${
          limiteClientes === 1 ? "cliente" : "clientes"
        }. Entre em contato com o administrador para aumentar seu limite.`
      );
    }
    try {
      setSalvando(true);

      // A criação do cliente é feita via endpoint server-side
      // (/api/admin/criar-cliente), que usa Admin SDK e valida
      // token, status, permissoes e LIMITE DE CLIENTES (com
      // getCountFromServer no Firestore) antes de gravar. Isso
      // garante que mesmo um addDoc direto do client SDK seja
      // bloqueado (as Firestore Rules negam create em /clientes
      // para o client SDK — apenas Admin SDK cria).
      //
      // O backend exige `deviceId` no body para registrar a
      // origem do evento de criação (Fase C / auditoria). O
      // deviceId é gerado UMA VEZ por browser pelo
      // useDeviceRegistration e persistido em
      // localStorage["jurex:device:id"]. Reutilizamos o helper
      // canônico `obterDeviceIdLocal()` (mesmo usado por
      // contractService.js e useNotificadorVencimentos.js) —
      // nunca geramos um novo aqui. Se o localStorage estiver
      // indisponível, o helper retorna null e o backend retorna
      // 400 com mensagem clara; sem fallback improvisado.
      const sourceDeviceId = obterDeviceIdLocal();
      const resp = await criarCliente({
        nomeCompleto: nome.trim(),
        cpf: cpf.replace(/\D/g, ""),
        telefone: telefone.replace(/\D/g, ""),
        email: email.trim(),
        endereco: endereco.trim(),
        scoreCredito: score,
        fotoUrl: "",
        documentos: [],
        deviceId: sourceDeviceId || "",
      });
      if (!resp || !resp.ok) {
        setSalvando(false);
        setErro(
          resp?.erro ||
            "Não foi possível salvar o cliente. Verifique o login e as regras do Firestore.",
        );
        return;
      }

      const clienteId = resp.id;

      // Foto: upload depois de ter o ID real do documento
      if (fotoFile) {
        try {
          setEnviandoFoto(true);
          const url = await enviarFoto(fotoFile);
          await updateDoc(doc(db, "clientes", clienteId), {
            fotoUrl: url,
            updatedAt: serverTimestamp(),
          });
        } catch (errFoto) {
          console.error("Erro ao enviar foto:", errFoto);
          setErro(
            errFoto?.message ??
              "Não foi possível enviar a foto. Tente novamente."
          );
          // cliente permanece salvo; usuário pode reenviar pela edição
        } finally {
          setEnviandoFoto(false);
        }
      }

      // Documentos: upload de cada arquivo e gravação dos objetos no array
      if (documentos.length > 0) {
        const objetosEnviados = [];
        try {
          for (const file of documentos) {
            const objeto = await enviarDocumento(file);
            objetosEnviados.push(objeto);
          }
          await updateDoc(doc(db, "clientes", clienteId), {
            documentos: objetosEnviados, // doc novo: array ainda vazio
            updatedAt: serverTimestamp(),
          });
        } catch (errDocs) {
          console.error("Erro ao enviar documentos:", errDocs);
          setErro(
            errDocs?.message ??
              "Não foi possível enviar os documentos. Tente novamente."
          );
          // cliente permanece salvo; documentos podem ser reenviados na edição
        }
      }

      setSucesso(true); // mensagem de sucesso antes de redirecionar
      setTimeout(() => navigate("/clientes"), 900); // onSnapshot atualiza a lista
    } catch (err) {
      console.error("Erro ao salvar cliente:", err);
      setErro(
        "Não foi possível salvar o cliente. Verifique o login e as regras do Firestore."
      );
      // não redireciona; dados permanecem no formulário
    } finally {
      setSalvando(false);
    }
  }

  const classeCampo =
    "mt-2 w-full h-12 px-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-semibold text-slate-800 dark:text-slate-100 placeholder-slate-400 outline-none transition focus:border-jurex focus:ring-2 focus:ring-jurex/20";
  const classeLabel =
    "block text-[10px] font-bold tracking-widest text-slate-500 uppercase";

  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto px-6 py-6">
        {/* Cabeçalho */}
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-gradient-to-r from-emerald-50 to-white dark:from-slate-900 dark:to-emerald-950/20 px-6 py-5">
          <div className="flex items-center gap-4">
            <BackButton to="/clientes" />
            <button
              type="button"
              onClick={() => navigate("/dashboard")}
              aria-label="Início"
              className="rounded-full p-2 bg-white dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700 shadow-[0_2px_4px_rgba(15,23,42,0.04)] hover:bg-slate-50 dark:hover:bg-slate-700 transition"
            >
              <House className="w-4.5 h-4.5 text-slate-600 dark:text-slate-300" />
            </button>
            <h1 className="text-xl font-bold text-slate-900 dark:text-white">
              Novo cliente
            </h1>
          </div>
        </div>

        <form onSubmit={cadastrar} className="mt-6 space-y-5 mb-24">
          {/* Banner de bloqueio (limite/permissão/status) */}
          {cadastroBloqueado && !loadingDono && (
            <div
              role="alert"
              className="rounded-2xl border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 px-4 py-3 flex items-start gap-3"
            >
              <span className="shrink-0 mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded-lg bg-amber-100 dark:bg-amber-500/20">
                <Lock className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
              </span>
              <p className="text-sm font-semibold text-amber-700 dark:text-amber-300 leading-relaxed">
                {contaBloqueada
                  ? "Conta bloqueada. Entre em contato com o administrador."
                  : permissaoNegada
                  ? "Seu plano não permite cadastrar clientes. Entre em contato com o administrador."
                  : `Limite de clientes atingido. Seu limite atual é de ${limiteClientes} ${
                      limiteClientes === 1 ? "cliente" : "clientes"
                    }. Entre em contato com o administrador para aumentar seu limite.`}
              </p>
            </div>
          )}

          {/* Nome completo */}
          <section>
            <label htmlFor="novo-cliente-nome" className={classeLabel}>
              Nome completo
            </label>
            <input
              id="novo-cliente-nome"
              type="text"
              placeholder="Ex: Roberto Silva"
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
              <span className="shrink-0 w-16 h-16 rounded-2xl bg-gradient-to-r from-jurex to-emerald-500 overflow-hidden flex items-center justify-center">
                {foto ? (
                  <img src={foto} alt="Foto do cliente" className="w-full h-full object-cover" />
                ) : (
                  <span className="text-white text-2xl font-bold">?</span>
                )}
              </span>
              <label
                htmlFor="novo-cliente-foto"
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
                    Adicionar foto
                  </>
                )}
              </label>
              <input
                id="novo-cliente-foto"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={escolherFoto}
                disabled={salvando}
                className="hidden"
              />
            </div>
          </section>

          {/* CPF opcional */}
          <section>
            <label htmlFor="novo-cliente-cpf" className={classeLabel}>
              CPF (opcional)
            </label>
            <input
              id="novo-cliente-cpf"
              inputMode="numeric"
              placeholder="000.000.000-00"
              value={cpf}
              onChange={(e) => setCpf(formatarCpf(e.target.value))}
              className={classeCampo}
            />
          </section>

          {/* Telefone */}
          <section>
            <label htmlFor="novo-cliente-telefone" className={classeLabel}>
              Telefone
            </label>
            <input
              id="novo-cliente-telefone"
              inputMode="numeric"
              placeholder="(00) 00000-0000"
              value={telefone}
              onChange={(e) => setTelefone(formatarTelefone(e.target.value))}
              required
              className={classeCampo}
            />
          </section>

          {/* E-mail */}
          <section>
            <label htmlFor="novo-cliente-email" className={classeLabel}>
              E-mail
            </label>
            <input
              id="novo-cliente-email"
              type="email"
              placeholder="email@dominio.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={classeCampo}
            />
          </section>

          {/* Endereço */}
          <section>
            <label htmlFor="novo-cliente-endereco" className={classeLabel}>
              Endereço
            </label>
            <input
              id="novo-cliente-endereco"
              type="text"
              placeholder="Rua, número, cidade"
              value={endereco}
              onChange={(e) => setEndereco(e.target.value)}
              className={classeCampo}
            />
          </section>

          {/* Documentos */}
          <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-5 py-4">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-bold tracking-widest text-slate-500 uppercase">
                Documentos
              </p>
              <label
                htmlFor="novo-cliente-documentos"
                className="inline-flex items-center gap-1 text-xs font-bold text-jurex cursor-pointer hover:brightness-105 transition select-none"
              >
                <Plus className="w-3.5 h-3.5" />
                Adicionar documento
              </label>
              <input
                id="novo-cliente-documentos"
                type="file"
                multiple
                accept="image/jpeg,image/png,image/webp,.pdf"
                onChange={escolherDocumentos}
                disabled={salvando}
                className="hidden"
              />
            </div>
            {documentos.length === 0 ? (
              <p className="mt-1 text-xs text-slate-400">Nenhum documento anexado.</p>
            ) : (
              <ul className="mt-2 space-y-1">
                {documentos.map((file, i) => (
                  <li key={`${file.name}-${i}`} className="text-xs font-medium text-slate-600 dark:text-slate-300 truncate">
                    📄 {file.name}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Score de crédito */}
          <section>
            <label htmlFor="novo-cliente-score" className={classeLabel}>
              Score de crédito
            </label>
            <select
              id="novo-cliente-score"
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
            <p className="rounded-xl bg-emerald-50 dark:bg-emerald-500/10 px-4 py-3 text-sm font-semibold text-jurex">
              Cliente cadastrado com sucesso!
            </p>
          )}

          {/* Cadastrar cliente */}
          <button
            type="submit"
            disabled={salvando || cadastroBloqueado}
            className={`w-full h-13 rounded-2xl text-base font-bold flex items-center justify-center transition ${
              cadastroBloqueado && !salvando
                ? "bg-slate-200 dark:bg-slate-800 text-slate-400 dark:text-slate-500 cursor-not-allowed"
                : "bg-gradient-to-r from-jurex to-emerald-500 text-white shadow-lg shadow-jurex/30 hover:brightness-105 active:scale-[0.99] disabled:opacity-60 disabled:pointer-events-none"
            }`}
          >
            {salvando
              ? "Salvando..."
              : cadastroBloqueado
              ? "Cadastro bloqueado"
              : "Cadastrar cliente"}
          </button>
        </form>
      </div>
    </AppLayout>
  );
}
