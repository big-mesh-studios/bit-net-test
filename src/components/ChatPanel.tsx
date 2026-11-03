import { For, Show } from "solid-js";
import type { ChatMessage, Draft } from "../lib/types";

interface ChatPanelProps {
  messages: ChatMessage[];
  draft: Draft | null;
  input: string;
  generating: boolean;
  canSend: boolean;
  liveTps: number;
  status: string;
  error: string;
  onInput: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  onClear: () => void;
  onScroller: (element: HTMLDivElement) => void;
}

const SUGGESTIONS = [
  "Explain 1.58-bit quantization like I'm five.",
  "Write a haiku about running an LLM on a CPU.",
  "What makes BitNet different from a normal transformer?",
];

export function ChatPanel(props: ChatPanelProps) {
  const submit = (event: KeyboardEvent) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      props.onSend();
    }
  };

  return (
    <section class="chat">
      <div class="chat-head">
        <div>
          <span class="eyebrow">Local chat</span>
          <h2>Talk to a 1.58-bit model</h2>
        </div>
        <div class="chat-actions">
          <Show when={props.liveTps > 0}>
            <span class="tps mono">{props.liveTps.toFixed(1)} tok/s</span>
          </Show>
          <button
            class="button ghost small"
            onClick={props.onClear}
            disabled={props.generating}
          >
            Clear
          </button>
        </div>
      </div>

      <div class="transcript" ref={props.onScroller}>
        <Show when={props.messages.length === 0 && !props.draft}>
          <div class="empty-state">
            <div class="empty-mark">1.58</div>
            <h3>No cloud. No GPU. Just ternary weights.</h3>
            <p>
              The model is loaded. Ask something and watch tokens arrive from the WebAssembly
              worker. First-token latency includes the prompt prefill.
            </p>
            <div class="suggestions">
              <For each={SUGGESTIONS}>
                {(suggestion) => (
                  <button class="suggestion" onClick={() => props.onInput(suggestion)}>
                    {suggestion}
                  </button>
                )}
              </For>
            </div>
          </div>
        </Show>

        <For each={props.messages}>
          {(message) => (
            <article class={`message ${message.role}`}>
              <div class="avatar">{message.role === "assistant" ? "1.58" : "you"}</div>
              <div class="bubble">
                <div class="bubble-head">
                  <span>{message.role}</span>
                </div>
                <div class="bubble-body">{message.content}</div>
              </div>
            </article>
          )}
        </For>

        <Show when={props.draft}>
          {(draft) => (
            <article class="message assistant streaming">
              <div class="avatar">1.58</div>
              <div class="bubble">
                <div class="bubble-head">
                  <span>assistant</span>
                  <span class="mono">{draft().tokens} tokens</span>
                </div>
                <div class="bubble-body">
                  {draft().content}
                  <span class="cursor" />
                </div>
              </div>
            </article>
          )}
        </Show>
      </div>

      <div class="composer-wrap">
        <Show when={props.error}>
          <div class="inline-error">{props.error}</div>
        </Show>

        <form
          class="composer"
          onSubmit={(event) => {
            event.preventDefault();
            props.onSend();
          }}
        >
          <textarea
            rows={1}
            placeholder="Ask the local model…"
            value={props.input}
            onInput={(event) => props.onInput(event.currentTarget.value)}
            onKeyDown={submit}
            disabled={props.generating}
          />
          <Show
            when={props.generating}
            fallback={
              <button class="button primary send" type="submit" disabled={!props.canSend}>
                Send
                <span class="key">↵</span>
              </button>
            }
          >
            <button class="button danger send" type="button" onClick={props.onStop}>
              Stop
            </button>
          </Show>
        </form>

        <div class="composer-foot">
          <span>{props.status || "Enter to send · Shift+Enter for a new line"}</span>
          <span class="mono">WASM SIMD · SharedArrayBuffer · OPFS</span>
        </div>
      </div>
    </section>
  );
}
