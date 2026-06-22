// Verificacion end-to-end contra el server en vivo (slice 4 Pull Requests).
// Flujo: crear repo -> 2 ramas con commits (git directo) -> crear PR -> ver commits/diff
// -> comentar -> close/reopen -> merge real -> verificar avance del ref en git -> estado merged.
// Ademas: auto-trigger pull_request al crear PR y pr_merged al mergear.
const http = require('http');
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');

const PORT = process.env.E2E_PORT || 8012;
const BASE = `http://localhost:${PORT}`;
const REPO = 'e2e-prs-' + Date.now().toString(36);
const BARE = path.join(process.cwd(), '.data', 'repos', REPO + '.git');

function req(method, pathStr, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request(BASE + pathStr, {
      method,
      headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), 'Authorization': 'Bearer super-secret-token' } : { 'Authorization': 'Bearer super-secret-token' }
    }, (res) => {
      let buf = '';
      res.on('data', (c) => buf += c);
      res.on('end', () => {
        let json;
        try { json = JSON.parse(buf); } catch (e) { json = buf; }
        resolve({ status: res.statusCode, body: json });
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

function git(args, cwd) {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd }, (err, stdout, stderr) => err ? reject(err) : resolve(stdout));
  });
}

async function waitForServer() {
  for (let i = 0; i < 40; i++) {
    try { await req('GET', '/'); return; } catch (e) { await new Promise((r) => setTimeout(r, 250)); }
  }
  throw new Error('server no arranca');
}

// Puebla el bare con main (1 commit) y feat (1 commit extra) via clone + push.
async function setupBranches() {
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'e2e-prs-clone-'));
  try {
    await git(['clone', BARE, tmp]);
    await git(['-C', tmp, 'config', 'user.email', 'e2e@local']);
    await git(['-C', tmp, 'config', 'user.name', 'E2E']);
    // main: commit inicial
    await fs.promises.writeFile(path.join(tmp, 'f.txt'), 'base');
    await git(['-C', tmp, 'add', '.']);
    await git(['-C', tmp, 'commit', '-m', 'init']);
    await git(['-C', tmp, 'branch', '-M', 'main']);
    await git(['-C', tmp, 'push', 'origin', 'main']);
    // feat: commit extra sobre main
    await git(['-C', tmp, 'checkout', '-b', 'feat']);
    await fs.promises.writeFile(path.join(tmp, 'g.txt'), 'nuevo');
    await git(['-C', tmp, 'add', '.']);
    await git(['-C', tmp, 'commit', '-m', 'feat change']);
    await git(['-C', tmp, 'push', 'origin', 'feat']);
  } finally {
    await fs.promises.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

async function main() {
  await waitForServer();
  console.log(`[e2e] server listo en ${BASE}`);

  // 1. Crear repo
  let r = await req('POST', '/repos', { name: REPO });
  assert.strictEqual(r.status, 200, 'crear repo');
  console.log(`[e2e] repo creado: ${REPO}`);

  // 2. Poblar ramas main y feat con commits
  await setupBranches();
  console.log('[e2e] ramas main + feat con commits listas');

  // 3. Definir workflow auto-trigger pull_request (debe dispararse al crear PR)
  r = await req('POST', `/repos/${REPO}/workflows`, {
    name: 'on-pr-open', trigger: 'pull_request',
    steps: ['echo pr-opened']
  });
  assert.strictEqual(r.status, 200, 'definir on-pr-open');

  // 4. Definir workflow auto-trigger pr_merged (debe dispararse al mergear)
  r = await req('POST', `/repos/${REPO}/workflows`, {
    name: 'on-pr-merged', trigger: 'pr_merged',
    steps: ['echo pr-merged']
  });
  assert.strictEqual(r.status, 200, 'definir on-pr-merged');

  // 5. Error: crear PR con rama inexistente -> 400 (branch_not_found)
  r = await req('POST', `/repos/${REPO}/pulls`, { title: 'T', head: 'nope', base: 'main' });
  assert.strictEqual(r.status, 400, 'PR con rama inexistente -> 400');
  assert.strictEqual(r.body.code, 'branch_not_found', 'codigo branch_not_found');
  console.log('[e2e] PR con rama inexistente -> 400 branch_not_found OK');

  // 6. Crear PR valido -> 200, number 1, state open
  r = await req('POST', `/repos/${REPO}/pulls`, { title: 'Agrega g.txt', body: 'cambia X', head: 'feat', base: 'main' });
  assert.strictEqual(r.status, 200, 'crear PR');
  const pull = r.body.pull;
  assert.strictEqual(pull.number, 1, 'number 1');
  assert.strictEqual(pull.state, 'open', 'state open');
  assert.strictEqual(pull.head, 'feat', 'head feat');
  assert.strictEqual(pull.base, 'main', 'base main');
  assert.strictEqual(pull.mergeCommitSha, null, 'sin mergeCommitSha');
  console.log('[e2e] PR creado: #' + pull.number, 'state', pull.state);

  // 7. Auto-trigger pull_request: esperar run extra
  let runsAfterPr = 0;
  for (let i = 0; i < 20; i++) {
    await new Promise((res) => setTimeout(res, 300));
    const lr = await req('GET', `/repos/${REPO}/runs`);
    runsAfterPr = lr.body.total;
    if (runsAfterPr >= 1) break;
  }
  assert.ok(runsAfterPr >= 1, 'auto-trigger pull_request debe generar un run (total=' + runsAfterPr + ')');
  console.log('[e2e] auto-trigger pull_request OK, runs:', runsAfterPr);

  // 8. Listar PRs ?state=open -> 1
  r = await req('GET', `/repos/${REPO}/pulls?state=open`);
  assert.strictEqual(r.status, 200, 'listar PRs');
  assert.strictEqual(r.body.total, 1, '1 PR open');
  console.log('[e2e] PRs open listados:', r.body.total);

  // 9. Obtener PR
  r = await req('GET', `/repos/${REPO}/pulls/1`);
  assert.strictEqual(r.status, 200, 'get PR');
  assert.strictEqual(r.body.pull.number, 1, 'mismo PR');

  // 10. Commits del PR -> 1 (feat change)
  r = await req('GET', `/repos/${REPO}/pulls/1/commits`);
  assert.strictEqual(r.status, 200, 'commits PR');
  assert.strictEqual(r.body.total, 1, '1 commit en head no en base');
  assert.ok(r.body.commits[0].message.includes('feat change'), 'mensaje del commit');
  console.log('[e2e] commits del PR:', r.body.total, '->', r.body.commits[0].message);

  // 11. Diff del PR -> 1 file (g.txt), 1 addition
  r = await req('GET', `/repos/${REPO}/pulls/1/diff`);
  assert.strictEqual(r.status, 200, 'diff PR');
  assert.strictEqual(r.body.diff.filesChanged, 1, '1 file changed');
  assert.strictEqual(r.body.diff.files[0].file, 'g.txt', 'archivo g.txt');
  assert.ok(r.body.diff.totalAdditions > 0, 'additions > 0');
  console.log('[e2e] diff del PR: files', r.body.diff.filesChanged, 'additions', r.body.diff.totalAdditions);

  // 12. Comentar el PR
  r = await req('POST', `/repos/${REPO}/pulls/1/comments`, { author: 'Ana', body: 'lgtm' });
  assert.strictEqual(r.status, 200, 'comentar PR');
  assert.strictEqual(r.body.comment.author, 'Ana', 'author Ana');

  // 13. Listar comentarios -> 1
  r = await req('GET', `/repos/${REPO}/pulls/1/comments`);
  assert.strictEqual(r.status, 200, 'listar comentarios');
  assert.strictEqual(r.body.total, 1, '1 comentario');
  console.log('[e2e] comentarios del PR:', r.body.total);

  // 14. Cerrar PR -> state closed
  r = await req('POST', `/repos/${REPO}/pulls/1/state`, { state: 'closed' });
  assert.strictEqual(r.status, 200, 'cerrar PR');
  assert.strictEqual(r.body.pull.state, 'closed', 'state closed');

  // 15. Mergear PR cerrado -> 400 (invalid_state, solo open)
  r = await req('POST', `/repos/${REPO}/pulls/1/merge`);
  assert.strictEqual(r.status, 400, 'merge PR cerrado -> 400');
  assert.strictEqual(r.body.code, 'invalid_state', 'codigo invalid_state');
  console.log('[e2e] merge PR cerrado -> 400 invalid_state OK');

  // 16. Reabrir PR -> state open
  r = await req('POST', `/repos/${REPO}/pulls/1/state`, { state: 'open' });
  assert.strictEqual(r.body.pull.state, 'open', 'reabierto');

  // 17. Mergear PR real -> 200, state merged, mergeCommitSha no vacio
  const beforeMain = (await git(['rev-parse', 'refs/heads/main'], BARE)).trim();
  r = await req('POST', `/repos/${REPO}/pulls/1/merge`);
  assert.strictEqual(r.status, 200, 'merge PR');
  const merged = r.body.pull;
  assert.strictEqual(merged.state, 'merged', 'state merged');
  assert.ok(merged.mergeCommitSha && merged.mergeCommitSha.length > 0, 'mergeCommitSha no vacio');
  assert.ok(merged.mergedAt, 'mergedAt set');
  console.log('[e2e] PR mergeado: state', merged.state, 'sha', merged.mergeCommitSha.slice(0, 10));

  // 18. Verificar avance del ref en git: refs/heads/main == mergeCommitSha
  const afterMain = (await git(['rev-parse', 'refs/heads/main'], BARE)).trim();
  assert.strictEqual(afterMain, merged.mergeCommitSha, 'refs/heads/main avanza al merge commit');
  assert.notStrictEqual(afterMain, beforeMain, 'main avanzo respecto de antes');
  console.log('[e2e] git: refs/heads/main avanza al merge commit OK');

  // 19. Auto-trigger pr_merged: esperar run extra
  let runsAfterMerge = 0;
  for (let i = 0; i < 20; i++) {
    await new Promise((res) => setTimeout(res, 300));
    const lr = await req('GET', `/repos/${REPO}/runs`);
    runsAfterMerge = lr.body.total;
    if (runsAfterMerge >= runsAfterPr + 1) break;
  }
  assert.ok(runsAfterMerge >= runsAfterPr + 1, 'auto-trigger pr_merged debe generar un run extra (total=' + runsAfterMerge + ')');
  console.log('[e2e] auto-trigger pr_merged OK, runs totales:', runsAfterMerge);

  // 20. Re-merge -> 400 (ya merged, invalid_state)
  r = await req('POST', `/repos/${REPO}/pulls/1/merge`);
  assert.strictEqual(r.status, 400, 're-merge -> 400');
  assert.strictEqual(r.body.code, 'invalid_state', 'ya merged invalid_state');

  // 21. GET PR -> merged persistido
  r = await req('GET', `/repos/${REPO}/pulls/1`);
  assert.strictEqual(r.body.pull.state, 'merged', 'persistido merged');
  assert.strictEqual(r.body.pull.mergeCommitSha, merged.mergeCommitSha, 'persistido sha');

  // 22. Error: PR inexistente -> 404
  r = await req('GET', `/repos/${REPO}/pulls/99`);
  assert.strictEqual(r.status, 404, 'PR inexistente -> 404');

  // Limpieza
  r = await req('DELETE', `/repos/${REPO}`);
  assert.strictEqual(r.status, 200, 'borrar repo');
  console.log('[e2e] repo borrado, TODO VERDE ✓');
}

main().catch((e) => { console.error('[e2e] FAIL:', e.message); process.exit(1); });