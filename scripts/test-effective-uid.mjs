// Simula o hook useEffectiveUid com diferentes estados do AuthContext
// para garantir que retorna o UID correto.

function effectiveUid({ usuario, role, roleResolvido, ownerUid }) {
  if (!usuario) return null;
  if (!roleResolvido) return null;
  if (role === "funcionario") {
    if (!ownerUid) return null;
    return ownerUid;
  }
  if (role === "dono") return usuario.uid;
  return null;
}

const tests = [
  {
    nome: "DONO logado, role resolvida",
    input: { usuario: { uid: "D" }, role: "dono", roleResolvido: true, ownerUid: null },
    esperado: "D",
  },
  {
    nome: "FUNCIONÁRIO logado, role resolvida",
    input: { usuario: { uid: "F" }, role: "funcionario", roleResolvido: true, ownerUid: "D" },
    esperado: "D",
  },
  {
    nome: "FUNCIONÁRIO logado, role ainda NÃO resolvida (race condition)",
    input: { usuario: { uid: "F" }, role: null, roleResolvido: false, ownerUid: null },
    esperado: null,
  },
  {
    nome: "Sem usuário",
    input: { usuario: null, role: null, roleResolvido: false, ownerUid: null },
    esperado: null,
  },
  {
    nome: "FUNCIONÁRIO sem ownerUid (perfil corrompido)",
    input: { usuario: { uid: "F" }, role: "funcionario", roleResolvido: true, ownerUid: null },
    esperado: null,
  },
  {
    nome: "sem-perfil",
    input: { usuario: { uid: "X" }, role: "sem-perfil", roleResolvido: true, ownerUid: null },
    esperado: null,
  },
];

let ok = 0, fail = 0;
for (const t of tests) {
  const r = effectiveUid(t.input);
  const passou = r === t.esperado;
  console.log(`${passou ? "✓" : "✗"} ${t.nome}: retornou ${r}, esperado ${t.esperado}`);
  if (passou) ok++; else fail++;
}
console.log(`\n${ok} passou, ${fail} falhou`);
process.exit(fail > 0 ? 1 : 0);
