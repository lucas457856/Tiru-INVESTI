// Serviços de autenticação (Firebase Auth) + perfil no Firestore
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  sendEmailVerification,
  confirmPasswordReset,
  verifyPasswordResetCode,
  signOut,
} from "firebase/auth";
import { doc, setDoc, getDoc } from "firebase/firestore";
import { auth, db } from "./firebase";

// Mensagens de erro do Firebase traduzidas para pt-BR
const ERROS = {
  "auth/invalid-credential": "E-mail ou senha incorretos.",
  "auth/user-not-found": "Nenhuma conta encontrada com este e-mail.",
  "auth/wrong-password": "Senha incorreta.",
  "auth/email-already-in-use": "Este e-mail já está cadastrado.",
  "auth/weak-password": "A senha deve ter no mínimo 6 caracteres.",
  "auth/invalid-email": "E-mail inválido.",
  "auth/too-many-requests":
    "Muitas tentativas. Tente novamente em alguns minutos.",
  "auth/network-request-failed": "Falha de conexão. Verifique sua internet.",
  "auth/configuration-not-found":
    "Cadastro indisponível: o login por e-mail/senha não está ativado no projeto Firebase. Ative em Authentication > Sign-in method.",
  "auth/expired-action-code":
    "Este link expirou ou já foi usado. Solicite um novo link de recuperação.",
  "auth/invalid-action-code":
    "Link inválido. Solicite um novo link de recuperação.",
};

function traduzirErro(erro) {
  return ERROS[erro?.code] ?? "Ocorreu um erro inesperado. Tente novamente.";
}

// Validação local de e-mail (mesma regra que o input `type=email` aplica
// no client, mas reforça antes de chamar o Firebase para evitar round-trips
// desnecessários e dar feedback mais claro).
export function emailValido(email) {
  if (typeof email !== "string") return false;
  const e = email.trim();
  if (!e) return false;
  // RFC 5322 simplificado — suficiente para feedback de UI.
  // Não é exaustivo, mas cobre o caso comum.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

// URL de produção do Cred Facil (canônico).
// Domínio REAL de produção: https://tiru-investi.vercel.app/
// Em dev (localhost), usamos a origin atual para o link do e-mail apontar
// para o app local. Em produção, usamos o domínio real.
const PRODUCAO_ORIGEM = "https://tiru-investi.vercel.app";

function origemReset() {
  if (typeof window === "undefined") return PRODUCAO_ORIGEM;
  const o = window.location.origin;
  if (!o || o.startsWith("http://localhost") || o.startsWith("http://127.")) {
    return PRODUCAO_ORIGEM;
  }
  return o;
}

// URL para a qual o Firebase redireciona após o usuário clicar no link
// do e-mail e concluir a redefinição. Aponta para a página /nova-senha
// deste app, passando o token (oobCode) como query param (?oobCode=...).
//
// IMPORTANTE — CONFIGURAÇÃO NECESSÁRIA NO CONSOLE FIREBASE:
//
// 1) Authentication > Sign-in method > Authorized domains
//    Adicione `tiru-investi.vercel.app` à lista de domínios autorizados.
//    SEM isso, o Firebase rejeita o `continueUrl` e o link volta para o
//    domínio padrão `<projectId>.firebaseapp.com` (com erro "auth/unauthorized-
//    domain" no console). A lista padrão já inclui `localhost` e o domínio
//    do projeto Firebase (`agt-controller3.firebaseapp.com`), mas o domínio
//    customizado de produção precisa ser adicionado manualmente.
//
// 2) Authentication > Templates > Password reset
//    - Customize o template do e-mail com a marca Cred Facil (logo verde,
//      "GESTÃO FINANCEIRA", card centralizado, etc.). O HTML do template
//      é gerenciado pelo console e injetado em `actionCodeSettings.url`.
//    - O botão/link do e-mail aponta para `continueUrl` passado abaixo.
//
// Sem essas configurações, o link do e-mail aponta para
// `<projectId>.firebaseapp.com/__/auth/action` (padrão Firebase) e o
// redirect após o clique volta pro domínio Firebase, não pro seu app.
function actionCodeSettingsReset() {
  const url = `${origemReset()}/nova-senha`;
  return {
    url,
    // handleCodeInApp=true faz o app lidar com o oobCode na URL (a página
    // /nova-senha lê o token da query string e chama confirmPasswordReset).
    handleCodeInApp: true,
  };
}

// Cria a conta e grava o perfil no Firestore
export async function cadastrar({ nome, email, telefone, senha }) {
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, senha);
    await sendEmailVerification(cred.user);
    await setDoc(doc(db, "usuarios", cred.user.uid), {
      nome,
      email,
      telefone,
      criadoEm: new Date().toISOString(),
    });
    return { ok: true };
  } catch (erro) {
    return { ok: false, erro: traduzirErro(erro) };
  }
}

export async function entrar({ email, senha }) {
  try {
    const cred = await signInWithEmailAndPassword(auth, email, senha);
    return { ok: true, usuario: cred.user };
  } catch (erro) {
    return { ok: false, erro: traduzirErro(erro) };
  }
}

// Envia o e-mail de recuperação de senha para o endereço informado.
// Valida o e-mail localmente antes de chamar o Firebase, e usa
// `actionCodeSettings` para que o link do e-mail aponte para a página
// /nova-senha do Cred Facil com o `oobCode` na URL.
export async function esqueciSenha(email) {
  try {
    const e = (email || "").trim();
    if (!emailValido(e)) {
      return { ok: false, erro: "Informe um e-mail válido." };
    }
    const actionSettings = actionCodeSettingsReset();
    // Log do payload enviado para o Firebase — ajuda a diagnosticar
    // problemas com `continueUrl` (auth/unauthorized-continue-uri-domain
    // ou auth/invalid-continue-uri).
    console.log("[esqueciSenha] actionCodeSettings enviado:", actionSettings);
    await sendPasswordResetEmail(auth, e, actionSettings);
    return { ok: true };
  } catch (erro) {
    // DEBUG TEMPORÁRIO: expõe o erro real do Firebase para diagnóstico.
    // Não esconde atrás de mensagens genéricas. Será ajustado depois que
    // identificarmos o código exato.
    console.error("FIREBASE PASSWORD RESET ERROR:", {
      code: erro?.code,
      message: erro?.message,
      customData: erro?.customData,
      fullError: erro,
    });
    // Tenta extrair a resposta HTTP original do Firebase (quando
    // disponível via FirebaseError interno).
    try {
      const http = erro?._baseMessage || erro?.serverResponse || null;
      if (http) console.error("FIREBASE PASSWORD RESET HTTP RESPONSE:", http);
    } catch (_) {
      // ignore
    }
    return { ok: false, erro: traduzirErro(erro) };
  }
}

// Verifica se o `oobCode` da URL é válido e ainda não expirou.
// Retorna o e-mail associado em caso de sucesso.
//
// Tokens de password reset do Firebase expiram em 1 HORA por padrão
// (configurável no console Firebase: Authentication > Templates >
// Password reset > "Customize expiration time"). O fluxo atual
// (chamada `sendPasswordResetEmail` + 1 hora de expiração) é exatamente
// o que a tarefa pede — não introduzimos token próprio nem lógica
// de expiração custom. Apenas consumimos o que o Firebase já oferece.
export async function verificarCodigoReset(oobCode) {
  if (!oobCode) {
    return { ok: false, erro: "Link inválido. Solicite um novo link de recuperação." };
  }
  try {
    const email = await verifyPasswordResetCode(auth, oobCode);
    return { ok: true, email };
  } catch (erro) {
    return { ok: false, erro: traduzirErro(erro) };
  }
}

// Confirma a nova senha usando o `oobCode` da URL.
// Após sucesso, o usuário é redirecionado para /login pelo chamador.
export async function redefinirSenha(oobCode, novaSenha) {
  if (!oobCode) {
    return { ok: false, erro: "Link inválido. Solicite um novo link de recuperação." };
  }
  if (typeof novaSenha !== "string" || novaSenha.length < 6) {
    return { ok: false, erro: "A senha deve ter no mínimo 6 caracteres." };
  }
  try {
    await confirmPasswordReset(auth, oobCode, novaSenha);
    return { ok: true };
  } catch (erro) {
    return { ok: false, erro: traduzirErro(erro) };
  }
}

export async function sair() {
  await signOut(auth);
}

// Chama a API serverless da Vercel que gera o link de redefinição via
// Firebase Admin e envia o e-mail HTML personalizado pelo Resend.
// Usado pelo botão "Trocar senha" da página /Perfil.
//
// Esta rota NÃO é usada em /esqueci-senha — a página pública continua
// usando `esqueciSenha()` (Firebase Client SDK + template padrão do
// console Firebase). A diferença:
//   - /esqueci-senha (público): `sendPasswordResetEmail` direto, layout
//     padrão Firebase, sem customização visual.
//   - /Perfil > "Trocar senha" (logado): e-mail HTML da Cred Facil, link
//     aponta para /nova-senha, sem expor o oobCode no console do user.
export async function solicitarRedefinicaoSenha(email) {
  const e = (email || "").trim();
  if (!emailValido(e)) {
    return { ok: false, erro: "Informe um e-mail válido." };
  }
  try {
    const resp = await fetch("/api/auth/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: e }),
    });
    let data = null;
    try {
      data = await resp.json();
    } catch {
      /* ignore */
    }
    if (!resp.ok) {
      return {
        ok: false,
        erro:
          data?.erro ||
          "Não foi possível enviar o e-mail. Tente novamente em alguns minutos.",
      };
    }
    return { ok: true };
  } catch {
    return {
      ok: false,
      erro: "Falha de conexão. Verifique sua internet e tente novamente.",
    };
  }
}

// Busca o perfil do usuário logado no Firestore
export async function buscarPerfil(uid) {
  const snap = await getDoc(doc(db, "usuarios", uid));
  return snap.exists() ? snap.data() : null;
}
