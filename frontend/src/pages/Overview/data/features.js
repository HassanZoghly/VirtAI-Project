export const features = [
  {
    id: "streaming",
    size: "large",
    icon: "streaming",
    title: "Real-time Streaming Chat",
    description:
      "Responses flow in token by token over a persistent WebSocket connection — no waiting, no page refreshes. The avatar reacts the moment inference begins.",
  },
  {
    id: "rag",
    size: "large",
    icon: "doc",
    title: "RAG from Your Documents",
    description:
      "Upload a PDF or text file and the avatar grounds its answers in your material — NotebookLM-style retrieval, without leaving the chat.",
  },
  {
    id: "voice",
    size: "medium",
    icon: "mic",
    title: "Voice-First Experience",
    description: `Speak naturally. ASR transcribes your words in real time; TTS plays the avatar's reply back — a complete speech-in, speech-out loop.`,
  },
  {
    id: "avatar",
    size: "medium",
    icon: "avatar",
    title: "Synchronized Avatar States",
    description: `Idle → Thinking → Talking → Greeting. The avatar's state machine stays in lock-step with every stage of the inference pipeline.`,
  },
  {
    id: "learning",
    size: "medium",
    icon: "book",
    title: "Learning-Centric UX",
    description:
      "Step-by-step breakdowns, on-demand summaries, and a distraction-free focus mode designed around how students actually learn.",
  },
];
