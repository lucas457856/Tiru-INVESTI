// Página temporária de DIAGNÓSTICO — testa TODOS os caminhos de dados
// que o funcionário precisa acessar. Mostra status (ok/erro) e count
// de cada query.

import { useEffect, useState } from "react";
import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import { useAuth } from "../context/useAuth";
import { useEffectiveUid } from "../hooks/useEffectiveUid";
import { db } from "../services/firebase";
import AppLayout from "../components/AppLayout";
import BackButton from "../components/BackButton";

const SEM = "—";

async function testarCaminho(label, operacao) {
  try {
    const result = await operacao();
    return { label, ok: true, count: result?.count, detalhe: result?.detalhe };
  } catch (err) {
    return { label, ok: false, code: err.code, message: err.message };
  }
}

export default function DebugAuth() {
  const authCtx = useAuth();
  const effectiveUid = useEffectiveUid();
  const [authUid, setAuthUid] = useState(null);
  const [resultados, setResultados] = useState([]);
  const [perfilProprio, setPerfilProprio] = useState(null);
  const [perfilDono, setPerfilDono] = useState(null);

  // authUid atual
  useEffect(() => {
    import("firebase/auth").then(({ getAuth }) => {
      setAuthUid(getAuth().currentUser?.uid || null);
    });
  }, []);

  // Testa TODOS os caminhos quando effectiveUid muda
  useEffect(() => {
    if (!effectiveUid) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setResultados([]);
      return;
    }
    let cancelado = false;
    (async () => {
      const testes = [];

      // 1. Perfil do usuário autenticado (usuarios/{authUid})
      testes.push(
        await testarCaminho("usuarios/{authUid} (perfil próprio)", async () => {
          const a = await import("firebase/auth");
          const uid = a.getAuth().currentUser?.uid;
          if (!uid) throw new Error("sem auth uid");
          const snap = await getDoc(doc(db, "usuarios", uid));
          if (!snap.exists()) return { count: 0, detalhe: "não existe" };
          return { count: 1, detalhe: `role=${snap.data().role || "dono"}` };
        }),
      );

      // 2. Perfil do dono (se funcionário)
      if (authCtx.role === "funcionario" && authCtx.ownerUid) {
        testes.push(
          await testarCaminho("usuarios/{ownerUid} (perfil do dono)", async () => {
            const snap = await getDoc(doc(db, "usuarios", authCtx.ownerUid));
            return snap.exists()
              ? { count: 1, detalhe: `nome=${snap.data().nome || "?"}` }
              : { count: 0, detalhe: "não existe" };
          }),
        );
      }

      // 3. Subcoleção funcionarios (se funcionário, lê o seu próprio)
      if (authCtx.funcionarioId) {
        testes.push(
          await testarCaminho(
            "usuarios/{ownerUid}/funcionarios/{funcionarioId} (próprio doc)",
            async () => {
              const snap = await getDoc(
                doc(db, "usuarios", authCtx.ownerUid, "funcionarios", authCtx.funcionarioId),
              );
              return snap.exists()
                ? { count: 1, detalhe: `status=${snap.data().status || "?"}` }
                : { count: 0, detalhe: "não existe" };
            },
          ),
        );
      }

      // 4. Lista de funcionários (se funcionário, deve falhar — não tem acesso)
      testes.push(
        await testarCaminho("usuarios/{ownerUid}/funcionarios (lista)", async () => {
          const snap = await getDocs(
            collection(db, "usuarios", effectiveUid, "funcionarios"),
          );
          return { count: snap.size, detalhe: "lista de funcionários do dono" };
        }),
      );

      // 5. Clientes top-level (com where ownerId)
      testes.push(
        await testarCaminho("clientes where ownerId == effectiveUid", async () => {
          const snap = await getDocs(
            query(collection(db, "clientes"), where("ownerId", "==", effectiveUid)),
          );
          return { count: snap.size, detalhe: `1º ownerId=${snap.docs[0]?.data()?.ownerId || SEM}` };
        }),
      );

      // 6. Contratos
      testes.push(
        await testarCaminho("usuarios/{effectiveUid}/contratos", async () => {
          const snap = await getDocs(collection(db, "usuarios", effectiveUid, "contratos"));
          return { count: snap.size, detalhe: "contratos" };
        }),
      );

      // 7. Notificações
      testes.push(
        await testarCaminho("usuarios/{effectiveUid}/notificacoes", async () => {
          const snap = await getDocs(collection(db, "usuarios", effectiveUid, "notificacoes"));
          return { count: snap.size, detalhe: "notificações" };
        }),
      );

      // 8. Config (deve falhar para funcionário)
      testes.push(
        await testarCaminho("usuarios/{effectiveUid}/config/modelosCobranca", async () => {
          const snap = await getDoc(
            doc(db, "usuarios", effectiveUid, "config", "modelosCobranca"),
          );
          return snap.exists() ? { count: 1, detalhe: "config existe" } : { count: 0, detalhe: "vazio" };
        }),
      );

      // 9. ModelosContrato (deve falhar para funcionário)
      testes.push(
        await testarCaminho("usuarios/{effectiveUid}/modelosContrato", async () => {
          const snap = await getDocs(collection(db, "usuarios", effectiveUid, "modelosContrato"));
          return { count: snap.size, detalhe: "modelos de contrato" };
        }),
      );

      // 10. Subcoleção clientes (legada, deve falhar para funcionário)
      testes.push(
        await testarCaminho("usuarios/{effectiveUid}/clientes (legada)", async () => {
          const snap = await getDocs(collection(db, "usuarios", effectiveUid, "clientes"));
          return { count: snap.size, detalhe: "subcoleção legada" };
        }),
      );

      if (!cancelado) setResultados(testes);
    })();
    return () => {
      cancelado = true;
    };
  }, [effectiveUid, authCtx.role, authCtx.ownerUid, authCtx.funcionarioId]);

  // Lê perfil próprio e do dono (separado, para mostrar dados)
  useEffect(() => {
    if (!authUid) return;
    (async () => {
      const snap = await getDoc(doc(db, "usuarios", authUid));
      if (snap.exists()) setPerfilProprio({ id: authUid, ...snap.data() });
    })();
    if (authCtx.ownerUid && authCtx.ownerUid !== authUid) {
      (async () => {
        const snap = await getDoc(doc(db, "usuarios", authCtx.ownerUid));
        if (snap.exists()) setPerfilDono({ id: authCtx.ownerUid, ...snap.data() });
      })();
    }
  }, [authUid, authCtx.ownerUid]);

  return (
    <AppLayout>
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-4">
        <div className="flex items-center gap-3">
          <BackButton />
          <h1 className="text-xl font-bold">Debug Auth (temporário)</h1>
        </div>

        <section className="rounded-2xl border border-slate-200 p-4 bg-white">
          <h2 className="font-bold text-sm mb-2">AuthContext</h2>
          <pre className="text-xs whitespace-pre-wrap break-all">
{JSON.stringify({
  authUid,
  role: authCtx.role,
  roleResolvido: authCtx.roleResolvido,
  ownerUid: authCtx.ownerUid,
  funcionarioId: authCtx.funcionarioId,
  effectiveUid,
}, null, 2)}
          </pre>
        </section>

        {perfilProprio && (
          <section className="rounded-2xl border border-slate-200 p-4 bg-white">
            <h2 className="font-bold text-sm mb-2">Perfil próprio (lido do Firestore)</h2>
            <pre className="text-xs whitespace-pre-wrap break-all">
{JSON.stringify(perfilProprio, null, 2)}
            </pre>
          </section>
        )}

        {perfilDono && (
          <section className="rounded-2xl border border-slate-200 p-4 bg-white">
            <h2 className="font-bold text-sm mb-2">Perfil do Dono</h2>
            <pre className="text-xs whitespace-pre-wrap break-all">
{JSON.stringify(perfilDono, null, 2)}
            </pre>
          </section>
        )}

        <section className="rounded-2xl border border-slate-200 p-4 bg-white">
          <h2 className="font-bold text-sm mb-2">Teste de TODOS os caminhos</h2>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left border-b">
                <th className="py-2">Caminho</th>
                <th className="py-2">Status</th>
                <th className="py-2">Count</th>
                <th className="py-2">Detalhe</th>
              </tr>
            </thead>
            <tbody>
              {resultados.map((r, i) => (
                <tr key={i} className="border-b">
                  <td className="py-2 pr-2 font-mono">{r.label}</td>
                  <td className={`py-2 font-bold ${r.ok ? "text-emerald-600" : "text-rose-600"}`}>
                    {r.ok ? "✓ OK" : "✗ ERRO"}
                  </td>
                  <td className="py-2">{r.count ?? SEM}</td>
                  <td className="py-2 text-slate-600">
                    {r.detalhe || r.code || r.message || ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {resultados.length === 0 && (
            <p className="text-xs text-slate-500 mt-2">aguardando effectiveUid...</p>
          )}
        </section>
      </div>
    </AppLayout>
  );
}
