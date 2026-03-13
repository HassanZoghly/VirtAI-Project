# **VirtAI — Virtual AI Teaching Assistant**

An interactive AI-powered virtual classroom assistant that combines real-time chat, speech recognition, text-to-speech, and 3D avatar lip-sync to create an immersive educational experience.

<div style="width: 100%; height: 30px; background: linear-gradient(to right, rgb(235, 238, 212), rgb(235, 238, 212));"></div>

## **Overview**

VirtAI is a full-stack application that allows students to interact with an AI teaching assistant through text or voice. The assistant responds with natural language, generates realistic speech audio, and drives a 3D avatar with lip-sync viseme animations — all in real-time through WebSockets.

### **How It Works**

```
User speaks / types
       ↓
  ┌──────────┐      WebSocket      ┌──────────────┐
  │ Frontend │  ←───────────────→  │   Backend    │
  │ React    │                     │   FastAPI    │
  │ Three.js │                     │              │
  └──────────┘                     └──────┬───────┘
       ↑                                  │
  3D Avatar                    ┌──────────┼──────────┐
  lip-sync                     ↓          ↓          ↓
                            Groq ASR   Groq LLM   Edge TTS
                           (Whisper)  (Llama 3.3) (Neural)
```

<div style="width: 100%; height: 30px; background: linear-gradient(to right, rgb(235, 238, 212), rgb(235, 238, 212));"></div>

## **Features**

- **Real-Time Chat**: WebSocket-based streaming LLM responses with typing indicator
- **Voice Input**: Speech-to-text via Groq Whisper API
- **Text-to-Speech**: Natural voice output using Microsoft Edge TTS neural voices
- **3D Avatar Lip-Sync**: Viseme-driven mouth animation on Three.js avatar (React Three Fiber)
- **Session Management**: Isolated sessions per user with automatic cleanup
- **Authentication**: JWT-based auth with Google OAuth support
- **Multiple Avatars**: Choose from different avatar characters
- **Voice Selection**: Pick from multiple neural voice options
- **Responsive UI**: Modern dark-themed interface with animations (Motion/Framer)
- **Docker Ready**: One-command deployment with Docker Compose

<div style="width: 100%; height: 30px; background: linear-gradient(to right, rgb(235, 238, 212), rgb(235, 238, 212));"></div>

## **Tech Stack**

### **Frontend**

| Technology | Purpose |
|---|---|
| React 18 | UI framework |
| Vite 7 | Build tool & dev server |
| Three.js / React Three Fiber | 3D avatar rendering |
| TailwindCSS 4 | Styling |
| Zustand | State management |
| Motion (Framer) | Animations |
| React Router 6 | Routing |
| React Hook Form + Zod | Form handling & validation |
| TypeScript | Type safety |

### **Backend**

| Technology | Purpose |
|---|---|
| FastAPI | Web framework + WebSocket |
| Groq API (Llama 3.3 70B) | LLM for conversational AI |
| Groq Whisper | Speech-to-text (ASR) |
| Edge TTS | Text-to-speech (neural voices) |
| SQLAlchemy + SQLite | Database (user accounts) |
| Pydantic v2 | Data validation & settings |
| Loguru | Structured logging |

### **Infrastructure**

| Technology | Purpose |
|---|---|
| Docker Compose | Container orchestration |
| Nginx (via Vite proxy) | API proxying in dev |

<div style="width: 100%; height: 30px; background: linear-gradient(to right, rgb(235, 238, 212), rgb(235, 238, 212));"></div>

## **Prerequisites**

- [Docker Desktop](https://www.docker.com/products/docker-desktop) (recommended)
- OR manually:
  - Python 3.10+
  - Node.js 18.18+
- [Groq API Key](https://console.groq.com/keys)

<div style="width: 100%; height: 30px; background: linear-gradient(to right, rgb(235, 238, 212), rgb(235, 238, 212));"></div>

## **Quick Start (Docker)**

### **1. Clone the Repository**

```bash
git clone https://github.com/Abdelrhman941/VirtAI-Project.git
cd VirtAI-Project
```

### **2. Configure Environment**

Create the backend `.env` file:

**Windows (CMD):**
```cmd
copy backend\.env.example backend\.env
```

**macOS/Linux:**
```bash
cp backend/.env.example backend/.env
```

Edit `backend/.env` and set your Groq API key:
```env
GROQ_API_KEY=your_groq_api_key_here
```

### **3. Start with Docker**

**Windows:**
```cmd
scripts\start_docker.bat
```

**macOS/Linux:**
```bash
chmod +x scripts/start_docker.sh
./scripts/start_docker.sh
```

This will:
- Build frontend and backend Docker images
- Start all services with Docker Compose
- Backend → `http://localhost:8000`
- Frontend → `http://localhost:3000`

### **4. Open the App**

Visit **[http://localhost:3000](http://localhost:3000)** in your browser.

<div style="width: 100%; height: 30px; background: linear-gradient(to right, rgb(235, 238, 212), rgb(235, 238, 212));"></div>

## **Docker Scripts**

| Script | Description |
|---|---|
| `scripts/start_docker.bat` / `.sh` | Start Docker & launch all services |
| `scripts/stop_docker.bat` / `.sh` | Stop all running containers |
| `scripts/rebuild_docker.bat` / `.sh` | Full rebuild with no cache |

<div style="width: 100%; height: 30px; background: linear-gradient(to right, rgb(235, 238, 212), rgb(235, 238, 212));"></div>

## **Project Structure**

```
VirtAI-Project/
├── frontend/                  # React + Vite + Three.js
│   ├── src/
│   │   ├── app/               # App entry, routes, global styles
│   │   ├── features/          # Feature modules
│   │   │   ├── auth/          # Authentication
│   │   │   ├── avatar/        # 3D avatar rendering & lip-sync
│   │   │   ├── chat/          # Chat UI components
│   │   │   ├── voice/         # Voice input/output
│   │   │   ├── session/       # Session management
│   │   │   ├── setup/         # Avatar & voice setup
│   │   │   └── overview/      # Dashboard overview
│   │   ├── pages/             # Page-level components
│   │   ├── shared/            # Shared components, hooks, utils
│   │   └── widgets/           # Composite UI widgets
│   ├── Dockerfile
│   └── package.json
│
├── backend/                   # FastAPI + WebSocket
│   ├── app/
│   │   ├── domain/            # Business entities & ports
│   │   │   ├── chat/          # Chat entities (history, LLM types)
│   │   │   ├── voice/         # Voice entities (ASR, TTS, visemes)
│   │   │   └── user/          # User entities
│   │   ├── application/       # Use cases & orchestration
│   │   │   ├── chat/          # Session management
│   │   │   └── voice/         # Conversation pipeline
│   │   ├── infrastructure/    # External service adapters
│   │   │   ├── asr/           # Groq Whisper ASR
│   │   │   ├── llm/           # Groq LLM provider
│   │   │   ├── tts/           # Edge TTS provider
│   │   │   ├── auth/          # Auth service (JWT, Google OAuth)
│   │   │   ├── db/            # SQLAlchemy + SQLite
│   │   │   └── storage/       # Audio file storage
│   │   ├── presentation/      # API layer
│   │   │   ├── http/v1/       # REST endpoints
│   │   │   └── ws/            # WebSocket gateway
│   │   ├── shared/            # Config, errors, logging
│   │   └── main.py            # Application entry point
│   ├── Dockerfile
│   └── pyproject.toml
│
├── scripts/                   # Docker management scripts
│   ├── start_docker.bat/.sh
│   ├── stop_docker.bat/.sh
│   └── rebuild_docker.bat/.sh
│
├── docker-compose.yml         # Container orchestration
└── README.md                  # This file
```

<div style="width: 100%; height: 30px; background: linear-gradient(to right, rgb(235, 238, 212), rgb(235, 238, 212));"></div>

## **Architecture**

### **Backend — Domain-Driven Design (DDD)**

The backend follows a **Clean Architecture / DDD** pattern:

- **Domain Layer**: Pure business entities and port interfaces (no external dependencies)
- **Application Layer**: Use cases and orchestration (session management, conversation pipeline)
- **Infrastructure Layer**: External service adapters (Groq, Edge TTS, SQLite)
- **Presentation Layer**: HTTP/WebSocket API endpoints

### **Frontend — Feature-Sliced Design (FSD)**

The frontend is organized by feature:

- **Features**: Self-contained modules (auth, avatar, chat, voice, session, setup)
- **Pages**: Route-level components composing features
- **Shared**: Reusable components, hooks, services, and utilities
- **Widgets**: Composite UI building blocks

### **Communication Flow**

```
┌─────────────┐  WebSocket  ┌─────────────────────────────────────┐
│   Browser   │←───────────→│           FastAPI Backend           │
│             │             │                                     │
│  React UI   │             │  ┌───────────────────────────────┐  │
│  Three.js   │             │  │   Conversation Pipeline       │  │
│  Avatar     │             │  │                               │  │
│             │             │  │  Audio → ASR → LLM → TTS      │  │
│             │             │  │                    ↓          │  │
│             │             │  │              Visemes + Audio  │  │
│             │             │  └───────────────────────────────┘  │
└─────────────┘             └─────────────────────────────────────┘
```

<div style="width: 100%; height: 30px; background: linear-gradient(to right, rgb(235, 238, 212), rgb(235, 238, 212));"></div>

## **For Developers**

For detailed setup instructions, API documentation, and inner workings, please refer to the specific README files:

- [**Backend Documentation**](./backend/README.md)
- [**Frontend Documentation**](./frontend/README.md)

<div style="width: 100%; height: 30px; background: linear-gradient(to right, rgb(235, 238, 212), rgb(235, 238, 212));"></div>

## **Contributing**

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Commit your changes: `git commit -m "Add my feature"`
4. Push to the branch: `git push origin feature/my-feature`
5. Open a Pull Request

<div style="width: 100%; height: 30px; background: linear-gradient(to right, rgb(235, 238, 212), rgb(235, 238, 212));"></div>

## **License**

This project is part of a graduation project.

<div style="width: 100%; height: 30px; background: linear-gradient(to right, rgb(235, 238, 212), rgb(235, 238, 212));"></div>
