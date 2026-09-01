// Serviços de autenticação (Firebase Auth) + perfil no Firestore
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  sendEmailVerification,
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
};

function traduzirErro(erro) {
  return ERROS[erro?.code] ?? "Ocorreu um erro inesperado. Tente novamente.";
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

export async function esqueciSenha(email) {
  try {
    await sendPasswordResetEmail(auth, email);
    return { ok: true };
  } catch (erro) {
    return { ok: false, erro: traduzirErro(erro) };
  }
}

export async function sair() {
  await signOut(auth);
}

// Busca o perfil do usuário logado no Firestore
export async function buscarPerfil(uid) {
  const snap = await getDoc(doc(db, "usuarios", uid));
  return snap.exists() ? snap.data() : null;
}
