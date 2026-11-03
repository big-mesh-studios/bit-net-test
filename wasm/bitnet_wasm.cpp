// Minimal C ABI used by the browser worker.
//
// The heavy lifting (GGUF parsing, BitNet I2_S kernels, tokenizer, sampler)
// lives in bitnet.cpp / llama.cpp, which are compiled to WebAssembly with
// Emscripten.  This file only exposes the small, synchronous surface the JS
// side needs to stream tokens.

#include "llama.h"

#include <emscripten.h>

#include <cstdint>
#include <cstdio>
#include <cstring>
#include <string>

namespace {

llama_model   * g_model = nullptr;
llama_context * g_ctx   = nullptr;
llama_sampler * g_smpl  = nullptr;
const llama_vocab * g_vocab = nullptr;
std::string     g_error;
int32_t         g_n_past = 0;

void set_error(const char * msg) {
    g_error = msg ? msg : "unknown error";
}

void set_error(const std::string & msg) {
    g_error = msg;
}

void release_sampler() {
    if (g_smpl) {
        llama_sampler_free(g_smpl);
        g_smpl = nullptr;
    }
}

} // namespace

extern "C" {

EMSCRIPTEN_KEEPALIVE const char * bn_last_error(void) {
    return g_error.c_str();
}

EMSCRIPTEN_KEEPALIVE int bn_init(const char * model_path, int n_ctx, int n_batch, int n_threads) {
    g_error.clear();
    release_sampler();

    if (g_ctx) {
        llama_free(g_ctx);
        g_ctx = nullptr;
    }
    if (g_model) {
        llama_model_free(g_model);
        g_model = nullptr;
    }

    llama_backend_init();

    llama_model_params mparams = llama_model_default_params();
    // Emscripten has no mmap; WORKERFS reads through FileReaderSync in a worker.
    mparams.use_mmap     = false;
    mparams.use_mlock    = false;
    mparams.n_gpu_layers = 0;
    mparams.vocab_only   = false;
    mparams.check_tensors = false;

    g_model = llama_model_load_from_file(model_path, mparams);
    if (!g_model) {
        set_error("llama_model_load_from_file failed (out of memory or unsupported GGUF)");
        return 0;
    }

    g_vocab = llama_model_get_vocab(g_model);

    llama_context_params cparams = llama_context_default_params();
    cparams.n_ctx           = (uint32_t) n_ctx;
    cparams.n_batch         = (uint32_t) n_batch;
    cparams.n_ubatch        = (uint32_t) n_batch;
    cparams.n_threads       = n_threads;
    cparams.n_threads_batch = n_threads;
    cparams.no_perf         = false;
    cparams.flash_attn_type = LLAMA_FLASH_ATTN_TYPE_DISABLED;
    cparams.type_k          = GGML_TYPE_F16;
    cparams.type_v          = GGML_TYPE_F16;

    g_ctx = llama_init_from_model(g_model, cparams);
    if (!g_ctx) {
        set_error("llama_init_from_model failed (context too large for available WASM memory)");
        llama_model_free(g_model);
        g_model = nullptr;
        g_vocab = nullptr;
        return 0;
    }

    g_n_past = 0;
    return 1;
}

EMSCRIPTEN_KEEPALIVE void bn_free(void) {
    release_sampler();
    if (g_ctx) {
        llama_free(g_ctx);
        g_ctx = nullptr;
    }
    if (g_model) {
        llama_model_free(g_model);
        g_model = nullptr;
    }
    g_vocab = nullptr;
    g_n_past = 0;
    llama_backend_free();
}

EMSCRIPTEN_KEEPALIVE void bn_reset(void) {
    if (!g_ctx) return;
    llama_memory_clear(llama_get_memory(g_ctx), true);
    g_n_past = 0;
    if (g_smpl) llama_sampler_reset(g_smpl);
}

EMSCRIPTEN_KEEPALIVE int32_t bn_n_ctx(void) {
    return g_ctx ? (int32_t) llama_n_ctx(g_ctx) : 0;
}

EMSCRIPTEN_KEEPALIVE int32_t bn_n_past(void) {
    return g_n_past;
}

EMSCRIPTEN_KEEPALIVE int32_t bn_vocab_size(void) {
    return g_vocab ? llama_vocab_n_tokens(g_vocab) : 0;
}

EMSCRIPTEN_KEEPALIVE int32_t bn_model_desc(char * out, int32_t cap) {
    if (!g_model || cap <= 0) return 0;
    return llama_model_desc(g_model, out, (size_t) cap);
}

EMSCRIPTEN_KEEPALIVE int32_t bn_tokenize(const char * text, int add_special, int32_t * out, int32_t cap) {
    if (!g_vocab) return -1;
    const int32_t len = (int32_t) std::strlen(text);
    return llama_tokenize(g_vocab, text, len, out, cap, add_special != 0, true);
}

EMSCRIPTEN_KEEPALIVE int32_t bn_detokenize(const int32_t * tokens, int32_t n, char * out, int32_t cap) {
    if (!g_vocab) return -1;
    return llama_detokenize(g_vocab, tokens, n, out, cap, true, false);
}

// Decode a chunk of prompt tokens. Only the final token asks for logits.
EMSCRIPTEN_KEEPALIVE int32_t bn_decode(const int32_t * tokens, int32_t n_tokens, int32_t start_pos) {
    if (!g_ctx || n_tokens <= 0) return -1;

    llama_batch batch = llama_batch_init(n_tokens, 0, 1);
    if (!batch.token) {
        set_error("llama_batch_init failed");
        return -1;
    }

    for (int32_t i = 0; i < n_tokens; ++i) {
        batch.token[i]      = tokens[i];
        batch.pos[i]        = start_pos + i;
        batch.n_seq_id[i]   = 1;
        batch.seq_id[i][0]  = 0;
        batch.logits[i]     = (i == n_tokens - 1) ? 1 : 0;
    }
    batch.n_tokens = n_tokens;

    const int32_t rc = llama_decode(g_ctx, batch);
    llama_batch_free(batch);

    if (rc != 0) {
        set_error("llama_decode failed");
        return rc;
    }

    g_n_past = start_pos + n_tokens;
    return 0;
}

EMSCRIPTEN_KEEPALIVE int32_t bn_sampler_init(
        float temperature,
        float top_p,
        int32_t top_k,
        float repeat_penalty,
        int32_t repeat_last_n,
        uint32_t seed) {
    release_sampler();

    llama_sampler_chain_params params = llama_sampler_chain_default_params();
    params.no_perf = true;

    g_smpl = llama_sampler_chain_init(params);
    if (!g_smpl) {
        set_error("llama_sampler_chain_init failed");
        return 0;
    }

    if (repeat_penalty > 1.0f && repeat_last_n != 0) {
        llama_sampler_chain_add(g_smpl, llama_sampler_init_penalties(
                repeat_last_n, repeat_penalty, 0.0f, 0.0f));
    }
    if (temperature <= 0.0f) {
        llama_sampler_chain_add(g_smpl, llama_sampler_init_greedy());
    } else {
        llama_sampler_chain_add(g_smpl, llama_sampler_init_top_k(top_k > 0 ? top_k : -1));
        llama_sampler_chain_add(g_smpl, llama_sampler_init_top_p(top_p > 0.0f ? top_p : 1.0f, 1));
        llama_sampler_chain_add(g_smpl, llama_sampler_init_temp(temperature));
        llama_sampler_chain_add(g_smpl, llama_sampler_init_dist(seed));
    }

    return 1;
}

EMSCRIPTEN_KEEPALIVE int32_t bn_sample(void) {
    if (!g_ctx || !g_smpl) return -1;
    return llama_sampler_sample(g_smpl, g_ctx, -1);
}

EMSCRIPTEN_KEEPALIVE int32_t bn_is_eog(int32_t token) {
    return (g_vocab && llama_vocab_is_eog(g_vocab, token)) ? 1 : 0;
}

EMSCRIPTEN_KEEPALIVE int32_t bn_token_piece(int32_t token, char * out, int32_t cap) {
    if (!g_vocab) return -1;
    return llama_token_to_piece(g_vocab, token, out, cap, 0, false);
}

EMSCRIPTEN_KEEPALIVE float bn_prompt_ms(void) {
    if (!g_ctx) return 0.0f;
    return llama_perf_context(g_ctx).t_p_eval_ms;
}

EMSCRIPTEN_KEEPALIVE float bn_eval_ms(void) {
    if (!g_ctx) return 0.0f;
    return llama_perf_context(g_ctx).t_eval_ms;
}

EMSCRIPTEN_KEEPALIVE int32_t bn_prompt_tokens(void) {
    if (!g_ctx) return 0;
    return llama_perf_context(g_ctx).n_p_eval;
}

EMSCRIPTEN_KEEPALIVE int32_t bn_eval_tokens(void) {
    if (!g_ctx) return 0;
    return llama_perf_context(g_ctx).n_eval;
}

EMSCRIPTEN_KEEPALIVE void bn_perf_reset(void) {
    if (g_ctx) llama_perf_context_reset(g_ctx);
}

} // extern "C"
