#!/usr/bin/env bash
#
# Build the BitNet I2_S kernels + llama.cpp to WebAssembly (wasm32 + SIMD +
# pthreads) and link the small C ABI wrapper in wasm/bitnet_wasm.cpp.
#
# Requirements:
#   - Emscripten SDK (emcc/em++/emcmake on PATH), e.g. `source ~/emsdk/emsdk_env.sh`
#   - cmake >= 3.20, git, node >= 22
#
# Output: public/wasm/bitnet.js + public/wasm/bitnet.wasm
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CACHE="$ROOT/.cache"
SRC="$CACHE/bitnet-src"
BUILD="$CACHE/llama-wasm-build"
OUT="$ROOT/public/wasm"

# Pinned upstream revisions. Keep these in sync with src/lib/model.ts when the
# model revision changes.
BITNET_COMMIT="0b341e582afbf9e1011f24744b554c96a3477eb5"
LLAMA_COMMIT="390c307752ab78fd8189f359d6954c9ba1be74af"
BITNET_REPO="https://github.com/microsoft/BitNet.git"

if ! command -v emcc >/dev/null 2>&1; then
  echo "error: emcc is not on PATH." >&2
  echo "       Install the Emscripten SDK and run: source /path/to/emsdk/emsdk_env.sh" >&2
  exit 1
fi

if ! command -v cmake >/dev/null 2>&1; then
  echo "error: cmake is not on PATH." >&2
  exit 1
fi

echo "==> Emscripten: $(emcc --version | head -n1)"

# ---------------------------------------------------------------------------
# 1. Check out the pinned BitNet tree (and its llama.cpp fork).
# ---------------------------------------------------------------------------
if [ ! -d "$SRC/.git" ]; then
  echo "==> Cloning BitNet"
  git clone "$BITNET_REPO" "$SRC"
fi

git -C "$SRC" fetch --depth 1 origin "$BITNET_COMMIT"
git -C "$SRC" checkout --detach "$BITNET_COMMIT"
git -C "$SRC" submodule update --init --recursive --depth 1

# The recorded submodule commit is what we want, but fetch it explicitly in
# case a shallow submodule clone stopped at a branch tip.
git -C "$SRC/3rdparty/llama.cpp" fetch --depth 1 origin "$LLAMA_COMMIT" || true
git -C "$SRC/3rdparty/llama.cpp" checkout --detach "$LLAMA_COMMIT"

# ---------------------------------------------------------------------------
# 2. Patch gemm-config.h so the BitNet kernels have block sizes for wasm SIMD.
# ---------------------------------------------------------------------------
if ! grep -q "__wasm_simd128__" "$SRC/include/gemm-config.h"; then
  echo "==> Applying patches/gemm-config-wasm.patch"
  git -C "$SRC" apply "$ROOT/patches/gemm-config-wasm.patch"
fi

if ! grep -q "__wasm_simd128__" "$SRC/3rdparty/llama.cpp/ggml/src/ggml-cpu/quants.c"; then
  echo "==> Applying patches/i2s-wasm-simd.patch"
  git -C "$SRC/3rdparty/llama.cpp" apply "$ROOT/patches/i2s-wasm-simd.patch"
fi

# ---------------------------------------------------------------------------
# 3. Configure and build llama.cpp as a static wasm32 library.
#
# LLAMA_WASM_MEM64 must stay OFF: wasm64 is not supported in every browser,
# and 4 GiB of wasm32 linear memory is enough for a 1.13 GB I2_S model plus
# the KV cache and compute buffers.
# ---------------------------------------------------------------------------
echo "==> Configuring llama.cpp (wasm32, SIMD, pthreads)"
rm -rf "$BUILD"
emcmake cmake -S "$SRC/3rdparty/llama.cpp" -B "$BUILD" \
  -DCMAKE_BUILD_TYPE=Release \
  -DLLAMA_WASM_MEM64=OFF \
  -DLLAMA_BUILD_TESTS=OFF \
  -DLLAMA_BUILD_EXAMPLES=OFF \
  -DLLAMA_BUILD_TOOLS=OFF \
  -DLLAMA_BUILD_SERVER=OFF \
  -DLLAMA_BUILD_COMMON=OFF \
  -DLLAMA_BUILD_APP=OFF \
  -DLLAMA_BUILD_UI=OFF \
  -DGGML_NATIVE=OFF \
  -DGGML_OPENMP=OFF \
  -DGGML_CCACHE=OFF \
  -DGGML_BACKEND_DL=OFF \
  -DGGML_CPU_ALL_VARIANTS=OFF \
  -DGGML_BLAS=OFF \
  -DGGML_RPC=OFF \
  -DGGML_VULKAN=OFF \
  -DGGML_CUDA=OFF \
  -DGGML_METAL=OFF \
  -DGGML_SYCL=OFF \
  -DCMAKE_C_FLAGS="-msimd128 -pthread -I$SRC/include" \
  -DCMAKE_CXX_FLAGS="-msimd128 -pthread -I$SRC/include"

echo "==> Building libllama.a (this takes a few minutes)"
cmake --build "$BUILD" -j"$(nproc)" --target llama

# ---------------------------------------------------------------------------
# 4. Compile the JS-facing wrapper and link the final module.
# ---------------------------------------------------------------------------
echo "==> Compiling wasm/bitnet_wasm.cpp"
mkdir -p "$OUT"
em++ "$ROOT/wasm/bitnet_wasm.cpp" -c -o "$CACHE/bitnet_wasm.o" \
  -std=c++17 -O3 -msimd128 -pthread \
  -I"$SRC/3rdparty/llama.cpp/include" \
  -I"$SRC/3rdparty/llama.cpp/ggml/include"

echo "==> Linking public/wasm/bitnet.{js,wasm}"
em++ "$CACHE/bitnet_wasm.o" \
  -Wl,--start-group \
  "$BUILD/src/libllama.a" \
  "$BUILD/ggml/src/libggml.a" \
  "$BUILD/ggml/src/libggml-cpu.a" \
  "$BUILD/ggml/src/libggml-base.a" \
  -Wl,--end-group \
  -o "$OUT/bitnet.js" \
  -O3 -msimd128 -pthread \
  -sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=createBitNetModule \
  -sENVIRONMENT=worker \
  -sALLOW_MEMORY_GROWTH=1 -sMAXIMUM_MEMORY=4GB -sINITIAL_MEMORY=268435456 \
  -sSTACK_SIZE=8388608 \
  -sFORCE_FILESYSTEM=1 -lworkerfs.js \
  -sPTHREAD_POOL_SIZE=8 -sPTHREAD_POOL_SIZE_STRICT=0 \
  -sEXIT_RUNTIME=0 \
  -sABORTING_MALLOC=0 \
  -sEXPORTED_FUNCTIONS=_malloc,_free,_bn_last_error,_bn_init,_bn_free,_bn_reset,_bn_n_ctx,_bn_n_past,_bn_vocab_size,_bn_model_desc,_bn_tokenize,_bn_detokenize,_bn_decode,_bn_sampler_init,_bn_sample,_bn_is_eog,_bn_token_piece,_bn_prompt_ms,_bn_eval_ms,_bn_prompt_tokens,_bn_eval_tokens,_bn_perf_reset \
  -sEXPORTED_RUNTIME_METHODS=FS,WORKERFS,HEAPU8,HEAP32,UTF8ToString,stringToUTF8,lengthBytesUTF8,getValue,setValue

ls -lh "$OUT/bitnet.js" "$OUT/bitnet.wasm"
echo "==> Done."
