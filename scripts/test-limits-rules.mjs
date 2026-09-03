// Teste integrado: verifica que:
//   1) As Firestore Rules BLOQUEIAM create direto via client SDK
//      em /clientes, /usuarios/{uid}/contratos, /usuarios/{uid}/funcionarios.
//   2) O Admin SDK (que é como o endpoint server-side grava)
//      CONSEGUE criar (porque bypassa as Rules).
//
// Requer `firebase emulators:exec` rodando.
//
// Roda com:
//   cd agt-controller3
//   npx firebase-tools@14.5.0 emulators:exec --only firestore \
//     --project demo-test "node scripts/test-limits-rules.mjs"

import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import {
  doc, setDoc, getDoc, addDoc, collection, query, where, getDocs,
} from 'firebase/firestore';

const PROJECT_ID = 'demo-test';

const env = await initializeTestEnvironment({
  projectId: PROJECT_ID,
  firestore: { rules: 'firestore.rules' },
});

let falhas = 0;
let sucessos = 0;

function ok(msg) { console.log(`  ✓ ${msg}`); sucessos++; }
function falha(msg, err) { console.error(`  ✗ ${msg}`, err?.message || err); falhas++; }

async function run() {
  // ============ SETUP ============
  const donoAUid = 'donoA';
  const funcFUid = 'funcF';

  await env.withSecurityRulesDisabled(async (ctx) => {
    const adminDb = ctx.firestore();
    // Perfil do dono A — sem limites (defaults permissivos 5/5/5)
    await adminDb.doc(`usuarios/${donoAUid}`).set({
      nome: 'Dono A', email: 'a@a.com', criadoEm: new Date().toISOString(),
    });
    // Perfil do funcionário F — vinculado a donoA
    await adminDb.doc(`usuarios/${funcFUid}`).set({
      nome: 'Func F', email: 'f@f.com', role: 'funcionario', ownerUid: donoAUid, funcionarioId: 'fid',
    });
  });

  const ctxDonoA = env.authenticatedContext(donoAUid);
  const dbDonoA = ctxDonoA.firestore();

  // ============ CLIENTES: create direto via client SDK DEVE FALHAR ============
  console.log('\n[CLIENTES — create direto do client SDK]');
  await assertFails(
    addDoc(collection(dbDonoA, 'clientes'), {
      ownerId: donoAUid, createdBy: donoAUid, nome: 'cliA1',
    }),
  );
  ok('DonoA NÃO conseguiu criar cliente via client SDK (bloqueado pelas Rules)');

  // ============ CONTRATOS: create direto via client SDK DEVE FALHAR ============
  console.log('\n[CONTRATOS — create direto do client SDK]');
  await assertFails(
    addDoc(collection(dbDonoA, 'usuarios', donoAUid, 'contratos'), {
      clienteId: 'x', valor: 100, createdBy: donoAUid,
    }),
  );
  ok('DonoA NÃO conseguiu criar contrato via client SDK (bloqueado pelas Rules)');

  // ============ FUNCIONÁRIOS: create direto via client SDK DEVE FALHAR ============
  console.log('\n[FUNCIONÁRIOS — create direto do client SDK]');
  await assertFails(
    addDoc(collection(dbDonoA, 'usuarios', donoAUid, 'funcionarios'), {
      nome: 'F1', email: 'f1@a.com', authUid: 'authF1', status: 'ativo', limiteContratos: 5,
    }),
  );
  ok('DonoA NÃO conseguiu criar funcionário via client SDK (bloqueado pelas Rules)');

  // ============ READ/UPDATE/DELETE em clientes (já existentes) continuam OK ============
  console.log('\n[READ/UPDATE/DELETE — preserva UX]');
  // Admin SDK cria um cliente pré-existente
  await env.withSecurityRulesDisabled(async (ctx) => {
    const adminDb = ctx.firestore();
    await adminDb.collection('clientes').add({
      ownerId: donoAUid, createdBy: donoAUid, nome: 'cliExistente',
    });
  });
  // DonoA consegue LER
  const snap = await getDocs(query(collection(dbDonoA, 'clientes'), where('ownerId', '==', donoAUid)));
  if (snap.size !== 1) {
    falha(`Esperado 1 cliente, achou ${snap.size}`);
  } else {
    ok('DonoA consegue LER clientes existentes (UX preservada)');
  }
  // DonoA consegue ATUALIZAR
  const clienteId = snap.docs[0].id;
  await assertSucceeds(
    setDoc(doc(dbDonoA, 'clientes', clienteId), {
      ownerId: donoAUid, createdBy: donoAUid, nome: 'cliAtualizado',
    }, { merge: true }),
  );
  ok('DonoA consegue ATUALIZAR cliente existente (UX preservada)');

  // ============ SEGURANÇA: dono NÃO pode alterar limites/permissoes/status ============
  console.log('\n[SEGURANÇA ADMINISTRATIVA — update do próprio doc]');
  const donoARef = doc(dbDonoA, 'usuarios', donoAUid);
  await assertFails(
    setDoc(donoARef, {
      limites: { contratos: 999, clientes: 999, funcionarios: 999 },
    }, { merge: true }),
  );
  ok('DonoA bloqueado ao tentar alterar limites via update');

  await assertFails(
    setDoc(donoARef, {
      permissoes: { criarFuncionarios: true },
    }, { merge: true }),
  );
  ok('DonoA bloqueado ao tentar alterar permissoes via update');

  await assertFails(
    setDoc(donoARef, { status: 'bloqueado' }, { merge: true }),
  );
  ok('DonoA bloqueado ao tentar alterar status via update');

  // ============ ADMIN SDK CONSEGUE CRIAR (simula o endpoint server-side) ============
  console.log('\n[ADMIN SDK — simula endpoint server-side]');
  await env.withSecurityRulesDisabled(async (ctx) => {
    const adminDb = ctx.firestore();
    await adminDb.collection('clientes').add({
      ownerId: donoAUid, createdBy: donoAUid, nome: 'criadoPorAdmin',
    });
    await adminDb.collection('usuarios').doc(donoAUid).collection('contratos').add({
      clienteId: 'x', valor: 100, createdBy: donoAUid,
    });
    await adminDb.collection('usuarios').doc(donoAUid).collection('funcionarios').add({
      nome: 'Fadmin', email: 'fadm@a.com', authUid: 'authFadm', status: 'ativo', limiteContratos: 5,
    });
  });
  ok('Admin SDK criou cliente/contrato/funcionário (bypassa Rules)');
}

try {
  await run();
  console.log(`\n========\nResultado: ${sucessos} OK, ${falhas} falhas`);
  if (falhas > 0) process.exit(1);
} catch (err) {
  console.error('ERRO INESPERADO:', err);
  process.exit(2);
} finally {
  await env.cleanup();
}
