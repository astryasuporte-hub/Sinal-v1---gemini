/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Supabase Edge Function: Ingest News & Run AI Synthesis
// Endpoint preparado para orquestração automática com Deno / TypeScript no Supabase

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { batchKeyword = "tecnologia", dryRun = false } = await req.json().catch(() => ({}));

    // Simulação do pipeline de coleta e síntese de inteligência
    const summaryResult = {
      status: "success",
      pipeline: "Sinal News Ingestion & AI Synthesis V1",
      keyword: batchKeyword,
      sourcesChecked: ["Reuters", "Bloomberg", "Valor Econômico", "Folha de S.Paulo"],
      deduplicatedCount: 8,
      clustersIdentified: 2,
      dryRun,
      generatedAt: new Date().toISOString()
    };

    return new Response(JSON.stringify(summaryResult), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
