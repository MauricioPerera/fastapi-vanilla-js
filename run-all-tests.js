const { spawn } = require('child_process');

function runSuite(name, script) {
    return new Promise((resolve) => {
        console.log(`\n\x1b[1m\x1b[35m========================================================\x1b[0m`);
        console.log(`\x1b[1m\x1b[35m▶ EJECUTANDO SUITE: ${name}\x1b[0m`);
        console.log(`\x1b[1m\x1b[35m========================================================\x1b[0m\n`);
        
        // Spawn el proceso hijo con stdio heredado para ver colores nativos de Node.js test runner
        const proc = spawn('node', [script], { stdio: 'inherit' });
        
        proc.on('close', (code) => {
            resolve(code === 0);
        });
    });
}

// Variante para suites basadas en el test runner nativo (node --test <archivos>).
function runNodeTest(name, files) {
    return new Promise((resolve) => {
        console.log(`\n\x1b[1m\x1b[35m========================================================\x1b[0m`);
        console.log(`\x1b[1m\x1b[35m▶ EJECUTANDO SUITE: ${name}\x1b[0m`);
        console.log(`\x1b[1m\x1b[35m========================================================\x1b[0m\n`);

        const proc = spawn('node', ['--test', ...files], { stdio: 'inherit' });
        proc.on('close', (code) => resolve(code === 0));
    });
}

async function start() {
    console.log(`\n\x1b[1m\x1b[36m🚀 INICIANDO BATERÍA DE PRUEBAS COMPLETAS (FASTAPI VANILLA HÍBRIDO) 🚀\x1b[0m`);
    
    // 1. Ejecutar Suite de Servidor Node.js
    const nodeSuccess = await runSuite('NODE.JS SERVER INTEGRATION (PORT: 8999)', 'test.js');
    
    // 2. Ejecutar Suite de Cloudflare Workers (Edge)
    const edgeSuccess = await runSuite('CLOUDFLARE WORKERS EDGE INTEGRATION (V8 MOCKS)', 'test-edge.js');

    // 3. Ejecutar Suite del Servidor MCP
    const mcpSuccess = await runSuite('MODEL CONTEXT PROTOCOL (FastMCP) STDIO', 'test-mcp.js');

    // 3b. Suite unitaria del Document Store (caminos no cubiertos por integración)
    const docStoreSuccess = await runNodeTest('DOCUMENT STORE (unitario)', ['test-docstore.js']);

    // 3c. Suite unitaria del Vector Store (backends, BM25, híbrido, IVF, math)
    const vectorStoreSuccess = await runNodeTest('VECTOR STORE (unitario)', ['test-vectorstore.js']);

    // 3d. Suite de features MCP del sistema (tools/resources/prompts en proceso)
    const mcpFeaturesSuccess = await runNodeTest('MCP FEATURES (in-process)', ['test-mcp-features.js']);

    // 3e. Suite de routers HTTP (users CRUD + chat)
    const routersSuccess = await runNodeTest('ROUTERS HTTP (users + chat)', ['test-routers.js']);

    // 3f. Suite del transporte SSE de FastMCP
    const sseSuccess = await runNodeTest('FastMCP SSE (transporte de red)', ['test-sse.js']);

    // 3g. Suite de controles de seguridad/coste del MCP edge (auth, rate-limit, cap, kill switch)
    const mcpGuardSuccess = await runNodeTest('MCP EDGE GUARD (auth + rate-limit + cap)', ['test-mcp-edge-guard.js']);

    // 4. Ejecutar Suite de Validación tipada + response_model (verificada con gate CCDD)
    const validationSuccess = await runNodeTest('VALIDATION + response_model (CCDD GATE + pipeline)', [
        'ccdd/validation/test_validate.js',
        'ccdd/serialize/test_serialize.js',
        'ccdd/coerce/test_coerce.js',
        'ccdd/flat-array-coercer/test_flat_array_coercer.js',
        'ccdd/validation/test_pipeline.js',
        'ccdd/validation/test_pipeline_edge.js',
    ]);

    // 4b. Suite CCDD de la alternativa-local-a-GitHub (repos + issues + actions + pulls), gateada por contrato.
    const localGithubSuccess = await runNodeTest('LOCAL GITHUB — repos+issues+actions+pulls (CCDD GATE)', [
        'ccdd/repo-sanitize-name/test_sanitize_name.js',
        'ccdd/repo-parse-branches/test_parse_branches.js',
        'ccdd/repo-parse-last-commit/test_parse_last_commit.js',
        'ccdd/repo-create-bare/test_create_bare_repo.js',
        'ccdd/repo-list/test_list_repos.js',
        'ccdd/repo-delete/test_delete_repo.js',
        'ccdd/repo-info/test_get_repo_info.js',
        'ccdd/issue-create/test_issue_create.js',
        'ccdd/issue-list/test_issue_list.js',
        'ccdd/issue-get/test_issue_get.js',
        'ccdd/issue-update/test_issue_update.js',
        'ccdd/issue-state/test_issue_state.js',
        'ccdd/issue-comment-add/test_issue_comment_add.js',
        'ccdd/issue-comment-list/test_issue_comment_list.js',
        'ccdd/action-validate-workflow/test_validate_workflow.js',
        'ccdd/action-save-workflow/test_save_workflow.js',
        'ccdd/action-list-workflows/test_list_workflows.js',
        'ccdd/action-select-by-event/test_select_by_event.js',
        'ccdd/action-run-step/test_run_step.js',
        'ccdd/action-run-workflow/test_run_workflow.js',
        'ccdd/action-dispatch-workflow/test_dispatch_workflow.js',
        'ccdd/action-dispatch-event/test_dispatch_event.js',
        'ccdd/action-list-runs/test_list_runs.js',
        'ccdd/action-get-run/test_get_run.js',
        'ccdd/pr-sanitize-branch/test_sanitize_branch.js',
        'ccdd/pr-parse-commits/test_parse_commits.js',
        'ccdd/pr-parse-diff-stat/test_parse_diff_stat.js',
        'ccdd/pr-validate-pull-data/test_validate_pull_data.js',
        'ccdd/pr-validate-branches/test_pr_validate_branches.js',
        'ccdd/pr-create/test_pr_create.js',
        'ccdd/pr-list/test_pr_list.js',
        'ccdd/pr-get/test_pr_get.js',
        'ccdd/pr-state/test_pr_state.js',
        'ccdd/pr-comment-add/test_pr_comment_add.js',
        'ccdd/pr-comment-list/test_pr_comment_list.js',
        'ccdd/pr-commits/test_pr_commits.js',
        'ccdd/pr-diff-stat/test_pr_diff_stat.js',
        'ccdd/pr-merge-branches/test_pr_merge_branches.js',
        'ccdd/pr-merge/test_pr_merge.js',
    ]);

    // 4c. Suite CCDD de la capa POSTAL (memoria de proyecto / interaccion entre agentes), gateada por contrato.
    const postalSuccess = await runNodeTest('POSTAL — event log + projector (CCDD GATE)', [
        'ccdd/postal-canonical/test_canonical.js',
        'ccdd/postal-event-hash/test_event_hash.js',
        'ccdd/postal-make-event-id/test_make_event_id.js',
        'ccdd/postal-event-file-path/test_event_file_path.js',
        'ccdd/postal-validate-event-input/test_validate_event_input.js',
        'ccdd/postal-read-chain-tip/test_read_chain_tip.js',
        'ccdd/postal-append-event/test_append_event.js',
        'ccdd/postal-list-events/test_list_events.js',
        'ccdd/postal-verify-author-chain/test_verify_author_chain.js',
        'ccdd/postal-verify-chains/test_verify_chains.js',
        'ccdd/postal-apply-body/test_apply_body.js',
        'ccdd/postal-fold-event/test_fold_event.js',
        'ccdd/postal-build-timeline/test_build_timeline.js',
        'ccdd/postal-replay-events/test_replay_events.js',
        'ccdd/postal-derive-agent-id/test_derive_agent_id.js',
        'ccdd/postal-verify-event-signature/test_verify_event_signature.js',
        'ccdd/postal-register-identity/test_register_identity.js',
        'ccdd/postal-verify-event-provenance/test_verify_event_provenance.js',
        'ccdd/postal-apply-rotation/test_apply_rotation.js',
        'ccdd/postal-apply-revocation/test_apply_revocation.js',
        'ccdd/postal-resolve-active-key-at/test_resolve_active_key_at.js',
        'ccdd/postal-verify-temporal-key/test_verify_temporal_key.js',
        'ccdd/postal-fold-identity-events/test_fold_identity_events.js',
        'ccdd/postal-build-key-ledger/test_build_key_ledger.js',
        'ccdd/postal-verify-temporal-provenance/test_verify_temporal_provenance.js',
        'ccdd/postal-verify-group-temporal-provenance/test_verify_group_temporal_provenance.js',
    ]);

    // 5. Imprimir reporte consolidado
    console.log('\n\x1b[1m\x1b[36m========================================================\x1b[0m');
    console.log(`\x1b[1m\x1b[36m📊 REPORTE DE RESULTADOS CONSOLIDADOS\x1b[0m`);
    console.log('\x1b[1m\x1b[36m========================================================\x1b[0m');
    
    if (nodeSuccess) {
        console.log(`🟢 \x1b[1mSuite Node.js Server (test.js)\x1b[0m   : \x1b[32m✓ PASSED (23/23 pruebas exitosas)\x1b[0m`);
    } else {
        console.log(`🔴 \x1b[1mSuite Node.js Server (test.js)\x1b[0m   : \x1b[31m✗ FAILED (revisar logs superiores)\x1b[0m`);
    }

    if (edgeSuccess) {
        console.log(`🟢 \x1b[1mSuite CF Workers Edge (test-edge.js)\x1b[0m: \x1b[32m✓ PASSED (19/19 pruebas exitosas)\x1b[0m`);
    } else {
        console.log(`🔴 \x1b[1mSuite CF Workers Edge (test-edge.js)\x1b[0m: \x1b[31m✗ FAILED (revisar logs superiores)\x1b[0m`);
    }

    if (mcpSuccess) {
        console.log(`🟢 \x1b[1mSuite FastMCP Server (test-mcp.js)\x1b[0m  : \x1b[32m✓ PASSED (12/12 pruebas exitosas)\x1b[0m`);
    } else {
        console.log(`🔴 \x1b[1mSuite FastMCP Server (test-mcp.js)\x1b[0m  : \x1b[31m✗ FAILED (revisar logs superiores)\x1b[0m`);
    }

    if (validationSuccess) {
        console.log(`🟢 \x1b[1mSuite Validación CCDD (validation.js)\x1b[0m: \x1b[32m✓ PASSED (42/42 pruebas exitosas)\x1b[0m`);
    } else {
        console.log(`🔴 \x1b[1mSuite Validación CCDD (validation.js)\x1b[0m: \x1b[31m✗ FAILED (revisar logs superiores)\x1b[0m`);
    }

    if (localGithubSuccess) {
        console.log(`🟢 \x1b[1mSuite Local GitHub CCDD (repos+issues+actions+pulls)\x1b[0m: \x1b[32m✓ PASSED\x1b[0m`);
    } else {
        console.log(`🔴 \x1b[1mSuite Local GitHub CCDD (repos+issues+actions+pulls)\x1b[0m: \x1b[31m✗ FAILED (revisar logs superiores)\x1b[0m`);
    }

    if (postalSuccess) {
        console.log(`🟢 \x1b[1mSuite Postal CCDD (event log + projector)\x1b[0m: \x1b[32m✓ PASSED\x1b[0m`);
    } else {
        console.log(`🔴 \x1b[1mSuite Postal CCDD (event log + projector)\x1b[0m: \x1b[31m✗ FAILED (revisar logs superiores)\x1b[0m`);
    }

    if (docStoreSuccess) {
        console.log(`🟢 \x1b[1mSuite Document Store (test-docstore.js)\x1b[0m: \x1b[32m✓ PASSED (14/14 pruebas exitosas)\x1b[0m`);
    } else {
        console.log(`🔴 \x1b[1mSuite Document Store (test-docstore.js)\x1b[0m: \x1b[31m✗ FAILED (revisar logs superiores)\x1b[0m`);
    }

    if (vectorStoreSuccess) {
        console.log(`🟢 \x1b[1mSuite Vector Store (test-vectorstore.js)\x1b[0m: \x1b[32m✓ PASSED (10/10 pruebas exitosas)\x1b[0m`);
    } else {
        console.log(`🔴 \x1b[1mSuite Vector Store (test-vectorstore.js)\x1b[0m: \x1b[31m✗ FAILED (revisar logs superiores)\x1b[0m`);
    }

    if (mcpFeaturesSuccess) {
        console.log(`🟢 \x1b[1mSuite MCP Features (test-mcp-features.js)\x1b[0m: \x1b[32m✓ PASSED (6/6 pruebas exitosas)\x1b[0m`);
    } else {
        console.log(`🔴 \x1b[1mSuite MCP Features (test-mcp-features.js)\x1b[0m: \x1b[31m✗ FAILED (revisar logs superiores)\x1b[0m`);
    }

    if (routersSuccess) {
        console.log(`🟢 \x1b[1mSuite Routers HTTP (test-routers.js)\x1b[0m  : \x1b[32m✓ PASSED (6/6 pruebas exitosas)\x1b[0m`);
    } else {
        console.log(`🔴 \x1b[1mSuite Routers HTTP (test-routers.js)\x1b[0m  : \x1b[31m✗ FAILED (revisar logs superiores)\x1b[0m`);
    }

    if (sseSuccess) {
        console.log(`🟢 \x1b[1mSuite FastMCP SSE (test-sse.js)\x1b[0m       : \x1b[32m✓ PASSED (2/2 pruebas exitosas)\x1b[0m`);
    } else {
        console.log(`🔴 \x1b[1mSuite FastMCP SSE (test-sse.js)\x1b[0m       : \x1b[31m✗ FAILED (revisar logs superiores)\x1b[0m`);
    }

    if (mcpGuardSuccess) {
        console.log(`🟢 \x1b[1mSuite MCP Edge Guard (test-mcp-edge-guard.js)\x1b[0m: \x1b[32m✓ PASSED (13/13 pruebas exitosas)\x1b[0m`);
    } else {
        console.log(`🔴 \x1b[1mSuite MCP Edge Guard (test-mcp-edge-guard.js)\x1b[0m: \x1b[31m✗ FAILED (revisar logs superiores)\x1b[0m`);
    }

    console.log('\x1b[1m\x1b[36m--------------------------------------------------------\x1b[0m');

    if (nodeSuccess && edgeSuccess && mcpSuccess && validationSuccess && localGithubSuccess && postalSuccess && docStoreSuccess && vectorStoreSuccess && mcpFeaturesSuccess && routersSuccess && sseSuccess && mcpGuardSuccess) {
        console.log(`\n\x1b[1m\x1b[32m🏆 ¡ÉXITO TOTAL DE LA BATERÍA DE PRUEBAS! 🏆\x1b[0m`);
        console.log(`\x1b[32mTodas las APIs, Edge Workers, herramientas y recursos MCP funcionan de forma excelente.\x1b[0m\n`);
        process.exit(0);
    } else {
        console.log(`\n\x1b[1m\x1b[31m❌ ALGUNAS PRUEBAS FALLARON. Revisa la consola superior. ❌\x1b[0m\n`);
        process.exit(1);
    }
}

start();
