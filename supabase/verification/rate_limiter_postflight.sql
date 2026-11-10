-- ==============================================================================
-- FATOSBR — SCRIPT DE PÓS-VALIDAÇÃO (POSTFLIGHT) — RATE LIMITER V1.7
-- ==============================================================================
-- Entregável 3: Verificação pós-migração para execução pelo ChatGPT no Supabase.
-- Executa testes funcionais com chaves isoladas e realiza limpeza automática.
--
-- Projeto Supabase: zopbitgtexefmqfvwgzj
-- ==============================================================================

SELECT '==================================================================' AS etapa,
       'INÍCIO DOS TESTES POSTFLIGHT: RATE LIMITER V1.7' AS descricao;

-- PARTE 1: VERIFICAÇÃO ESTRUTURAL DE CATÁLOGO (READ-ONLY)

-- 1.1 Confirmação da função no catálogo pg_proc
SELECT 
  n.nspname AS schema,
  p.proname AS funcao,
  pg_get_function_identity_arguments(p.oid) AS argumentos,
  pg_get_function_result(p.oid) AS retorno,
  p.prosecdef AS security_definer
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public' 
  AND p.proname = 'check_and_increment_rate_limit';

-- 1.2 Auditoria estrita de permissões (DCL)
-- Esperado: anon e authenticated NÃO devem ter 'X' (EXECUTE)
SELECT 
  p.proname,
  CASE 
    WHEN p.proacl IS NULL THEN 'ALERTA: proacl padrão (verificar permissões)'
    WHEN p.proacl::TEXT ~* '(anon|authenticated)=X' THEN 'VIOLAÇÃO: anon ou authenticated com EXECUTE'
    ELSE 'OK: Permissões restritas'
  END AS status_permissao,
  p.proacl AS acl_completa
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public' 
  AND p.proname = 'check_and_increment_rate_limit';

-- PARTE 2: TESTES FUNCIONAIS ISOLADOS (COM LIMPEZA AUTOMÁTICA)

DO $$
DECLARE
  v_test_key TEXT := 'test:postflight:key_' || floor(extract(epoch from clock_timestamp()))::TEXT;
  v_res1 JSONB;
  v_res2 JSONB;
  v_res3 JSONB;
  v_res_blocked JSONB;
  v_err_caught BOOLEAN := FALSE;
BEGIN
  RAISE NOTICE '--- Iniciando Bateria Funcional com Chave de Teste: % ---', v_test_key;

  -- Teste 1: Primeira requisição (tokens = 1, allowed = true, remaining = 2)
  v_res1 := public.check_and_increment_rate_limit(v_test_key, 3, 60000);
  IF (v_res1 ->> 'allowed')::BOOLEAN IS NOT TRUE OR (v_res1 ->> 'current')::INT <> 1 THEN
    RAISE EXCEPTION 'TESTE 1 FALHOU: Resposta inesperada na 1a chamada: %', v_res1;
  END IF;
  RAISE NOTICE '  ✅ Teste 1 APROVADO: 1a requisicao permitida (tokens: %, remaining: %)', 
    v_res1 ->> 'current', v_res1 ->> 'remaining';

  -- Teste 2: Segunda requisição (tokens = 2, allowed = true, remaining = 1)
  v_res2 := public.check_and_increment_rate_limit(v_test_key, 3, 60000);
  IF (v_res2 ->> 'allowed')::BOOLEAN IS NOT TRUE OR (v_res2 ->> 'current')::INT <> 2 THEN
    RAISE EXCEPTION 'TESTE 2 FALHOU: Resposta inesperada na 2a chamada: %', v_res2;
  END IF;
  RAISE NOTICE '  ✅ Teste 2 APROVADO: 2a requisicao permitida (tokens: %, remaining: %)', 
    v_res2 ->> 'current', v_res2 ->> 'remaining';

  -- Teste 3: Terceira requisição (tokens = 3, allowed = true, remaining = 0 - no limite)
  v_res3 := public.check_and_increment_rate_limit(v_test_key, 3, 60000);
  IF (v_res3 ->> 'allowed')::BOOLEAN IS NOT TRUE OR (v_res3 ->> 'current')::INT <> 3 THEN
    RAISE EXCEPTION 'TESTE 3 FALHOU: Resposta inesperada na 3a chamada: %', v_res3;
  END IF;
  RAISE NOTICE '  ✅ Teste 3 APROVADO: 3a requisicao permitida no limite (tokens: %, remaining: %)', 
    v_res3 ->> 'current', v_res3 ->> 'remaining';

  -- Teste 4: Quarta requisição (tokens = 4 > limite 3, allowed = false, retry_after > 0)
  v_res_blocked := public.check_and_increment_rate_limit(v_test_key, 3, 60000);
  IF (v_res_blocked ->> 'allowed')::BOOLEAN IS NOT FALSE OR (v_res_blocked ->> 'retry_after')::INT <= 0 THEN
    RAISE EXCEPTION 'TESTE 4 FALHOU: Requisição excedente deveria ser bloqueada: %', v_res_blocked;
  END IF;
  RAISE NOTICE '  ✅ Teste 4 APROVADO: 4a requisicao bloqueada corretamente (allowed: %, retry_after: %s)', 
    v_res_blocked ->> 'allowed', v_res_blocked ->> 'retry_after';

  -- Teste 5: Rejeição defensiva de parâmetros inválidos
  BEGIN
    PERFORM public.check_and_increment_rate_limit('', 10, 60000);
  EXCEPTION WHEN OTHERS THEN
    v_err_caught := TRUE;
    RAISE NOTICE '  ✅ Teste 5 APROVADO: Parâmetro chave vazia rejeitado com código SQL %', SQLSTATE;
  END;
  IF NOT v_err_caught THEN
    RAISE EXCEPTION 'TESTE 5 FALHOU: Parâmetro inválido não lançou exceção.';
  END IF;

  -- LIMPEZA OBRIGATÓRIA DA CHAVE DE TESTE
  DELETE FROM internal.rate_limit_counters WHERE key LIKE 'test:postflight:%';
  RAISE NOTICE '🧹 Limpeza pós-teste concluída com sucesso.';
  RAISE NOTICE '==================================================================';
  RAISE NOTICE '🎉 TODOS OS TESTES POSTFLIGHT DO RATE LIMITER PASSARAM COM SUCESSO!';
  RAISE NOTICE '==================================================================';
EXCEPTION WHEN OTHERS THEN
  -- Garante limpeza mesmo em caso de falha no bloco
  DELETE FROM internal.rate_limit_counters WHERE key LIKE 'test:postflight:%';
  RAISE;
END $$;
