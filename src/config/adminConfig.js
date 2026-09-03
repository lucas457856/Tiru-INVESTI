// Configuração da conta administrativa principal do sistema.
//
// Esta é a ÚNICA conta que pode acessar o Painel Administrativo
// (/admin). A autorização é feita por UID, NÃO por e-mail ou role.
//
// Para trocar o ADMIN_UID no futuro:
//   1. Abra este arquivo.
//   2. Substitua o valor da constante abaixo pelo novo UID do
//      Firebase Authentication (você encontra em Firebase Console >
//      Authentication > Users).
//   3. Faça o deploy do frontend.
//   4. A nova conta passa a ter acesso; a antiga perde.
//
// IMPORTANTE: a segurança depende de que o `ADMIN_UID` aqui
// corresponda EXATAMENTE ao `user.uid` retornado pelo Firebase Auth.
// Como o UID é gerado pelo Firebase e nunca muda (a menos que a conta
// seja recriada), esta é uma chave estável.
//
// Defesa em camadas:
//   - Frontend: `RotaAdmin` e `Sidebar` consultam este mesmo UID
//     para decidir se mostram link/acesso.
//   - Backend:  `api/admin/overview.js` valida o idToken via Admin
//     SDK e compara o `decoded.uid` com este valor (via env var
//     ADMIN_UID no painel da Vercel). Se você trocar o UID aqui,
//     LEMBRE-SE de atualizar a env var ADMIN_UID na Vercel também.
//   - Firestore: o painel não lê Firestore direto pelo cliente —
//     usa o endpoint. Nenhuma regra foi enfraquecida.

export const ADMIN_UID = "hzfrWIuTXYgeasOTPD7pmKNxt1P2";

export function isAdminUid(uid) {
  return typeof uid === "string" && uid === ADMIN_UID;
}
