# **VirtAI — Frontend**

React-based interactive UI for the VirtAI virtual teaching assistant, featuring 3D avatar rendering with real-time lip-sync, voice input/output, and streaming chat.

<div style="width: 100%; height: 30px; background: linear-gradient(to right, rgb(235, 238, 212), rgb(235, 238, 212));"></div>

## **Features**

- **3D Avatar**: Three.js-powered avatar with real-time viseme-based lip-sync animation
- **Streaming Chat**: Live LLM response streaming with typing indicator
- **Voice Input**: Browser-based speech recording sent to backend ASR
- **TTS Playback**: Automatic audio playback of AI responses
- **Avatar Selection**: Choose from multiple avatar characters
- **Voice Selection**: Pick neural voice (gender, accent, language)
- **Authentication**: JWT-based login/register with Google OAuth support
- **Responsive Design**: Dark-themed modern UI with smooth animations
- **Session Management**: Persistent sessions with automatic reconnection

<div style="width: 100%; height: 30px; background: linear-gradient(to right, rgb(235, 238, 212), rgb(235, 238, 212));"></div>

## **Tech Stack**

| Technology | Version | Purpose |
|---|---|---|
| React | 18.3 | UI framework |
| Vite | 7.3 | Build tool & dev server |
| Three.js | 0.160 | 3D rendering engine |
| React Three Fiber | 8.16 | React renderer for Three.js |
| React Three Drei | 9.105 | Useful helpers for R3F |
| TailwindCSS | 4.2 | Utility-first CSS |
| Zustand | 5.0 | Lightweight state management |
| Motion | 12.35 | Animation library (Framer Motion) |
| React Router | 6.26 | Client-side routing |
| React Hook Form | 7.71 | Form handling |
| Zod | 4.3 | Schema validation |
| Axios | 1.13 | HTTP client |
| Lottie React | 2.4 | Lottie animations |
| React Icons | 5.3 | Icon library |

<div style="width: 100%; height: 30px; background: linear-gradient(to right, rgb(235, 238, 212), rgb(235, 238, 212));"></div>

## **Prerequisites**

- Node.js 18.18 or higher
- npm (comes with Node.js)

<div style="width: 100%; height: 30px; background: linear-gradient(to right, rgb(235, 238, 212), rgb(235, 238, 212));"></div>

## **Quick Start**

### **1. Install Dependencies**

```bash
cd frontend
npm install
```

### **2. Start Dev Server**

```bash
npm run dev
```

The app will open at **[http://localhost:3000](http://localhost:3000)**.

> **Note:** The Vite dev server automatically proxies `/api` requests to `http://localhost:8000` (the backend). Make sure the backend is running.

### **3. Build for Production**

```bash
npm run build
npm run preview    # preview the production build
```

<div style="width: 100%; height: 30px; background: linear-gradient(to right, rgb(235, 238, 212), rgb(235, 238, 212));"></div>

## **Available Scripts**

| Command | Description |
|---|---|
| `npm run dev` | Start Vite dev server (port 3000) |
| `npm run build` | Build production bundle |
| `npm run preview` | Preview production build |
| `npm run test` | Run tests (Vitest) |
| `npm run test:watch` | Run tests in watch mode |
| `npm run lint` | Lint source code (ESLint) |
| `npm run lint:fix` | Auto-fix lint issues |
| `npm run format` | Format code (Prettier) |
| `npm run format:check` | Check code formatting |

<div style="width: 100%; height: 30px; background: linear-gradient(to right, rgb(235, 238, 212), rgb(235, 238, 212));"></div>

## **Project Structure**

The frontend follows a **Feature-Sliced Design (FSD)** architecture:

```
src/
├── app/                       # Application layer
│   ├── main.jsx               # Entry point (React root)
│   ├── App.jsx                # Root component with providers
│   ├── routes.jsx             # Route definitions
│   ├── App.css                # Global app styles
│   └── index.css              # TailwindCSS base + design tokens
│
├── features/                  # Feature modules (self-contained)
│   ├── auth/                  # Authentication (login, register, OAuth)
│   ├── avatar/                # 3D avatar rendering & lip-sync
│   │   ├── AvatarFaceController.js   # Viseme-driven face animation
│   │   ├── components/        # Avatar React components
│   │   ├── constants.js       # Viseme mappings & config
│   │   ├── data/              # Avatar model data
│   │   └── hooks/             # Avatar-related hooks
│   ├── chat/                  # Chat UI (message list, input, bubbles)
│   │   └── components/        # Chat components
│   ├── voice/                 # Voice input & TTS playback
│   │   ├── audio/             # Audio utilities
│   │   ├── components/        # Voice UI components
│   │   └── hooks/             # Voice-related hooks
│   ├── session/               # WebSocket session management
│   ├── setup/                 # Avatar & voice setup wizard
│   └── overview/              # Dashboard overview
│
├── pages/                     # Page-level components (routes)
│   ├── Classroom/             # Main classroom page
│   ├── Setup/                 # Setup wizard page
│   ├── NotFound/              # 404 page
│   ├── ClassroomPage.jsx
│   ├── SetupPage.jsx
│   ├── OverviewPage.jsx
│   ├── AuthPage.jsx
│   └── AuthCallbackPage.jsx
│
├── shared/                    # Shared/reusable code
│   ├── components/            # Generic UI components
│   ├── hooks/                 # Common hooks
│   ├── services/              # API services
│   ├── ui/                    # Design system primitives
│   └── utils/                 # Utility functions
│
└── widgets/                   # Composite UI widgets
    ├── Classroom/             # Classroom widget (avatar + chat)
    └── Overview/              # Overview dashboard widget
```

<div style="width: 100%; height: 30px; background: linear-gradient(to right, rgb(235, 238, 212), rgb(235, 238, 212));"></div>

## **Key Pages**

| Page | Route | Description |
|---|---|---|
| Auth | `/auth` | Login & registration |
| Auth Callback | `/auth/callback` | Google OAuth callback handler |
| Setup | `/setup` | Avatar & voice selection wizard |
| Classroom | `/classroom` | Main interactive classroom |
| Overview | `/overview` | Dashboard overview |

<div style="width: 100%; height: 30px; background: linear-gradient(to right, rgb(235, 238, 212), rgb(235, 238, 212));"></div>

## **3D Avatar System**

The avatar system uses **React Three Fiber** (R3F) to render a 3D character model:

1. **Model Loading**: GLTF/GLB models loaded via `@react-three/drei`
2. **Face Controller**: `AvatarFaceController.js` maps viseme IDs to morph targets
3. **Lip-Sync**: Real-time mouth animation driven by TTS viseme timeline
4. **Pipeline**:
   ```
   TTS generates viseme events →
   Backend sends visemes via WebSocket →
   Frontend schedules morph target animations →
   Three.js renders smooth lip movements
   ```

<div style="width: 100%; height: 30px; background: linear-gradient(to right, rgb(235, 238, 212), rgb(235, 238, 212));"></div>

## **API Proxy Configuration**

The Vite dev server proxies API requests to the backend:

```js
// vite.config.js
server: {
  port: 3000,
  proxy: {
    '/api': {
      target: process.env.VITE_API_TARGET || 'http://localhost:8000',
      changeOrigin: true,
      ws: true,  // WebSocket proxy support
    },
  },
}
```

In Docker, set `VITE_API_TARGET=http://backend:8000` to route to the backend container.

<div style="width: 100%; height: 30px; background: linear-gradient(to right, rgb(235, 238, 212), rgb(235, 238, 212));"></div>

## **Development**

### **Code Quality**

- **ESLint**: Configured with React, React Hooks, and TypeScript plugins
- **Prettier**: Consistent code formatting (single quotes, no semicolons, trailing commas)
- **TypeScript**: Type checking enabled

### **Testing**

- **Vitest**: Test runner (Vite-native)
- **Testing Library**: React component testing
- **Happy DOM**: Fast DOM environment for tests

```bash
npm run test           # Run all tests
npm run test:watch     # Watch mode
```

<div style="width: 100%; height: 30px; background: linear-gradient(to right, rgb(235, 238, 212), rgb(235, 238, 212));"></div>

## **Build Output**

Production builds are optimized with manual chunk splitting:

| Chunk | Contents |
|---|---|
| `three` | Three.js + React Three Fiber + Drei |
| `icons` | React Icons |
| `motion` | Motion (Framer) |

This ensures large libraries are cached independently by the browser.

<div style="width: 100%; height: 30px; background: linear-gradient(to right, rgb(235, 238, 212), rgb(235, 238, 212));"></div>
