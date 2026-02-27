# AI Avatar Chat - Frontend

React + Vite + React Three Fiber frontend for real-time 3D avatar chat with lip synchronization and smooth animations.

## Features

- **3D Avatar Rendering**: Ready Player Me compatible avatars with React Three Fiber
- **Real-time Lip Sync**: Morph target-based lip synchronization with viseme timelines
- **Smooth Animations**: FBX animation support with seamless state transitions
- **WebSocket Client**: Auto-reconnecting WebSocket with exponential backoff
- **State Management**: Clean reducer pattern for conversation state
- **Responsive UI**: Modern chat interface with message history
- **Audio Playback**: Synchronized audio with avatar animations

## Prerequisites

- Node.js 18.18 or higher
- npm or yarn
- Backend server running (see `backend/README.md`)

## Quick Start

### 1. Navigate to Frontend

```bash
cd frontend
```

### 2. Install Dependencies

```bash
npm install
```

Or with yarn:
```bash
yarn install
```

### 3. Configure Environment (Optional)

Create `.env` file for custom configuration:

```env
# Backend API URL
VITE_API_BASE_URL=http://localhost:8000

# WebSocket URL
VITE_WS_URL=ws://localhost:8000/api/v1/ws
```

Default values work with the backend running on `localhost:8000`.

### 4. Run Development Server

```bash
npm run dev
```

The app will be available at `http://localhost:5173`

## Available Scripts

### Development

```bash
npm run dev
```

Starts the Vite development server with hot module replacement (HMR).
- Opens at `http://localhost:5173`
- Auto-reloads on file changes
- Fast refresh for React components

### Build

```bash
npm run build
```

Creates an optimized production build in the `dist/` directory.
- Minifies JavaScript and CSS
- Optimizes assets
- Generates source maps
- Ready for deployment

### Preview

```bash
npm run preview
```

Previews the production build locally.
- Serves the `dist/` directory
- Tests production build before deployment
- Opens at `http://localhost:4173`

### Linting

```bash
# Check for linting errors
npm run lint

# Fix linting errors automatically
npm run lint:fix
```

Uses ESLint to check code quality and enforce coding standards.

### Formatting

```bash
# Check code formatting
npm run format:check

# Format code automatically
npm run format
```

Uses Prettier to ensure consistent code formatting.

## Project Structure

```
frontend/
├── public/
│   ├── models/
│   │   ├── avatar1.glb               # Ready Player Me avatar
│   │   └── animations/
│   │       ├── Idle/
│   │       │   └── Idle.fbx          # Idle animation
│   │       ├── Greeting/
│   │       │   └── Greeting.fbx      # Greeting animation
│   │       ├── Think/
│   │       │   └── Think.fbx         # Thinking animation
│   │       └── Talk/
│   │           └── Talk.fbx          # Speaking animation
│   └── assets/
│       └── icons/
├── src/
│   ├── pages/
│   │   └── Classroom/
│   │       ├── Classroom.jsx         # Page entry point
│   │       ├── Classroom.css         # Page styles
│   │       └── components/
│   │           ├── ClassroomShell.jsx    # Main UI container
│   │           ├── AvatarController.jsx  # Animation + lip sync logic
│   │           ├── AvatarScene.jsx       # R3F 3D rendering
│   │           └── CopyButton.jsx        # Utility component
│   ├── hooks/
│   │   ├── useWSClient.js            # WebSocket client hook
│   │   ├── useConversationReducer.js # State management hook
│   │   └── useLipSync.js             # Lip sync utilities
│   ├── utils/
│   │   └── toast.js                  # Toast notifications
│   ├── data/
│   │   └── avatars.js                # Avatar configuration
│   ├── App.jsx                       # App root component
│   ├── App.css                       # Global app styles
│   ├── main.jsx                      # Application entry point
│   └── index.css                     # Global CSS reset
├── .env.example                      # Example environment variables
├── package.json                      # Dependencies and scripts
├── vite.config.js                    # Vite configuration
├── .eslintrc.json                    # ESLint configuration
├── .prettierrc                       # Prettier configuration
└── README.md                         # This file
```

## Component Architecture

### Core Components

#### ClassroomShell
**Location**: `src/pages/Classroom/components/ClassroomShell.jsx`

Main UI container that orchestrates the entire application.

**Responsibilities**:
- Manages WebSocket connection via `useWSClient`
- Handles conversation state via `useConversationReducer`
- Registers message handlers for all server events
- Coordinates between chat UI and avatar controller
- Handles user input and message sending

**Key Features**:
- Auto-reconnecting WebSocket with exponential backoff
- Message queue for offline messages
- Error handling and display
- Session management

#### AvatarController
**Location**: `src/pages/Classroom/components/AvatarController.jsx`

Controls avatar animations, audio playback, and lip synchronization.

**Responsibilities**:
- Maps pipeline state to animation state (idle/thinking/speaking)
- Manages audio playback when TTS is ready
- Drives lip sync from viseme timeline
- Updates morph targets on avatar meshes
- Ensures smooth animation transitions

**Key Features**:
- State machine for animation control
- Real-time morph target updates (60 FPS)
- Audio synchronization
- Smooth transitions between states

#### AvatarScene
**Location**: `src/pages/Classroom/components/AvatarScene.jsx`

Pure rendering component for 3D avatar using React Three Fiber.

**Responsibilities**:
- Load GLB avatar model
- Load FBX animations
- Apply morph target influences
- Render with proper lighting and shadows
- Handle camera and scene setup

**Key Features**:
- Optimized rendering with R3F
- Support for Ready Player Me avatars
- Mixamo FBX animation support
- Morph target-based lip sync

### Custom Hooks

#### useWSClient
**Location**: `src/hooks/useWSClient.js`

WebSocket client with automatic reconnection and message queue.

**API**:
```javascript
const { isConnected, send, onMessage, disconnect } = useWSClient(url);
```

**Features**:
- Exponential backoff reconnection (1s, 2s, 4s, 8s, 16s, 30s max)
- Message queue for offline messages
- Type-safe message handlers
- Development mode warnings for unknown message types

**Usage**:
```javascript
const ws = useWSClient('ws://localhost:8000/api/v1/ws/avatar1');

// Register message handler
ws.onMessage('chat.delta', (data) => {
  console.log('Received token:', data.delta);
});

// Send message
ws.send({
  type: 'chat.user_message',
  data: { message_id: 'uuid', text: 'Hello' }
});
```

#### useConversationReducer
**Location**: `src/hooks/useConversationReducer.js`

State management for conversation with reducer pattern.

**API**:
```javascript
const [state, dispatch] = useConversationReducer();
```

**State Shape**:
```javascript
{
  messages: [],           // Message history
  currentMessage: '',     // Streaming message buffer
  pipelineState: 'idle',  // idle | thinking | speaking | error
  activeMessageId: null,  // Current message ID
  error: null            // Error message
}
```

**Actions**:
- `CHAT_DELTA`: Append streaming token
- `CHAT_FINAL`: Finalize assistant message
- `PIPELINE_STATE`: Update pipeline state
- `USER_MESSAGE`: Add user message
- `ERROR`: Set error state

**Usage**:
```javascript
const [state, dispatch] = useConversationReducer();

// Handle incoming delta
dispatch({
  type: 'CHAT_DELTA',
  payload: { delta: 'Hello' }
});

// Add user message
dispatch({
  type: 'USER_MESSAGE',
  payload: { message_id: 'uuid', text: 'Hi' }
});
```

#### useLipSync
**Location**: `src/hooks/useLipSync.js`

Utilities for lip synchronization with morph targets.

**Features**:
- Find active viseme cue at current time
- Update morph targets on avatar meshes
- Smooth interpolation between visemes
- Support for Ready Player Me viseme names

## Development Workflow

### 1. Start Backend

First, ensure the backend is running:

```bash
cd backend
python -m app.main
```

Backend should be available at `http://localhost:8000`

### 2. Start Frontend

In a new terminal:

```bash
cd frontend
npm run dev
```

Frontend will be available at `http://localhost:5173`

### 3. Development Cycle

1. Make changes to source files
2. Vite automatically reloads the page
3. Check browser console for errors
4. Test WebSocket connection and avatar animations
5. Run linting: `npm run lint`
6. Format code: `npm run format`

### 4. Testing

**Manual Testing Checklist**:
- [ ] WebSocket connects successfully
- [ ] Can send messages and receive responses
- [ ] Avatar animates correctly (idle → thinking → speaking → idle)
- [ ] Lip sync matches audio playback
- [ ] Audio plays without issues
- [ ] Reconnection works after disconnect
- [ ] Error messages display properly
- [ ] Message history persists during session

### 5. Building for Production

```bash
# Create production build
npm run build

# Preview production build
npm run preview
```

## Configuration

### Environment Variables

Create `.env` file in the frontend directory:

```env
# Backend API base URL
VITE_API_BASE_URL=http://localhost:8000

# WebSocket URL
VITE_WS_URL=ws://localhost:8000/api/v1/ws

# Avatar model path (relative to public/)
VITE_AVATAR_MODEL_PATH=/models/avatar1.glb

# Enable debug mode
VITE_DEBUG=true
```

### Avatar Configuration

Edit `src/data/avatars.js` to configure available avatars:

```javascript
export const avatars = [
  {
    id: 'avatar1',
    name: 'Aria',
    modelPath: '/models/avatar1.glb',
    animations: {
      idle: '/models/animations/Idle/Idle.fbx',
      thinking: '/models/animations/Think/Think.fbx',
      speaking: '/models/animations/Talk/Talk.fbx',
      greeting: '/models/animations/Greeting/Greeting.fbx'
    }
  }
];
```

### Vite Configuration

Edit `vite.config.js` for build and dev server settings:

```javascript
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true
      }
    }
  }
});
```

## Troubleshooting

### WebSocket Connection Issues

**Problem**: "WebSocket connection failed"
- Ensure backend is running on `http://localhost:8000`
- Check `VITE_WS_URL` in `.env` matches backend URL
- Verify CORS settings in backend allow frontend origin
- Check browser console for detailed error messages

**Problem**: Constant reconnection attempts
- Backend may be rejecting connections (check backend logs)
- Invalid avatar_id in WebSocket URL
- Network connectivity issues

### Avatar Rendering Issues

**Problem**: Avatar doesn't appear
- Check that GLB model exists at specified path
- Verify model is Ready Player Me compatible
- Check browser console for Three.js errors
- Ensure WebGL is supported in browser

**Problem**: Animations don't play
- Verify FBX animation files exist
- Check animation paths in avatar configuration
- Ensure animations are Mixamo compatible
- Check browser console for loading errors

### Lip Sync Issues

**Problem**: Mouth doesn't move during speech
- Verify viseme timeline is received from backend
- Check that avatar has morph targets (Wolf3D_Head, Wolf3D_Teeth)
- Ensure audio is playing
- Check browser console for morph target errors

**Problem**: Lip sync out of sync with audio
- Audio playback may be delayed (browser autoplay policy)
- Check audio element timing in browser DevTools
- Verify viseme timeline timestamps are correct

### Performance Issues

**Problem**: Low frame rate
- Reduce scene complexity (lighting, shadows)
- Check for memory leaks in browser DevTools
- Disable debug mode in production
- Use production build (`npm run build`)

**Problem**: High memory usage
- Check for WebSocket message accumulation
- Clear message history periodically
- Dispose Three.js objects properly
- Monitor with browser DevTools

### Build Issues

**Problem**: Build fails with dependency errors
- Delete `node_modules` and `package-lock.json`
- Run `npm install` again
- Check Node.js version (requires 18.18+)
- Clear npm cache: `npm cache clean --force`

**Problem**: "Cannot find module" errors
- Check import paths are correct
- Verify file extensions (.js, .jsx)
- Ensure case-sensitive paths on Linux/macOS

## Browser Support

- Chrome 90+ (recommended)
- Firefox 88+
- Safari 15+
- Edge 90+

**Requirements**:
- WebGL 2.0 support
- WebSocket support
- ES6+ JavaScript support
- Audio playback support

## Performance Tips

1. **Use Production Build**: Always use `npm run build` for production
2. **Optimize Assets**: Compress GLB models and textures
3. **Lazy Load**: Load animations on demand
4. **Reduce Poly Count**: Use optimized avatar models
5. **Limit Message History**: Clear old messages periodically
6. **Disable Debug Mode**: Set `VITE_DEBUG=false` in production

## Deployment

### Static Hosting (Netlify, Vercel, etc.)

1. Build the project:
```bash
npm run build
```

2. Deploy the `dist/` directory to your hosting provider

3. Configure environment variables on hosting platform:
```
VITE_API_BASE_URL=https://your-backend-url.com
VITE_WS_URL=wss://your-backend-url.com/api/v1/ws
```

4. Ensure backend CORS allows your frontend domain

### Docker Deployment

Create `Dockerfile`:

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN npm run build
RUN npm install -g serve
EXPOSE 3000
CMD ["serve", "-s", "dist", "-l", "3000"]
```

Build and run:
```bash
docker build -t avatar-chat-frontend .
docker run -p 3000:3000 avatar-chat-frontend
```

## Contributing

1. Follow the existing code style
2. Run linting before committing: `npm run lint:fix`
3. Format code: `npm run format`
4. Test thoroughly in development mode
5. Ensure production build works: `npm run build && npm run preview`

## License

[Your License Here]

## Support

For issues and questions:
- Check the [troubleshooting section](#troubleshooting)
- Review browser console for errors
- Check backend logs for WebSocket issues
- See backend [PROTOCOL.md](../backend/docs/PROTOCOL.md) for message format
