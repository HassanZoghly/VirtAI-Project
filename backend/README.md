# AI Avatar Chat - Backend

FastAPI backend providing WebSocket-based streaming chat with LLM integration, TTS audio generation, and viseme timeline generation for 3D avatar lip synchronization.

## Features

- **Real-time WebSocket Communication**: Bidirectional streaming with heartbeat monitoring
- **LLM Integration**: Streaming chat responses via Groq API (Llama 3.3 70B)
- **Text-to-Speech**: Audio generation using Edge TTS with multiple voice options
- **Lip Sync**: Automatic viseme timeline generation for realistic avatar animations
- **Session Management**: Automatic cleanup of idle sessions with configurable timeouts
- **Rate Limiting**: Protection against abuse with per-session and per-IP limits
- **Robust Error Handling**: Comprehensive error messages and graceful degradation

## Prerequisites

- Python 3.11 or higher
- Groq API key (get one at [console.groq.com](https://console.groq.com/keys))
- Windows, macOS, or Linux

## Quick Start

### 1. Clone and Navigate

```bash
cd backend
```

### 2. Create Virtual Environment

**Windows (CMD)**:
```cmd
python -m venv venv
venv\Scripts\activate
```

**Windows (PowerShell)**:
```powershell
python -m venv venv
.\venv\Scripts\Activate.ps1
```

**macOS/Linux**:
```bash
python3 -m venv venv
source venv/bin/activate
```

### 3. Install Dependencies

```bash
pip install -r requirements.txt
```

For development (includes testing and linting tools):
```bash
pip install -r requirements-dev.txt
```

### 4. Configure Environment

Copy the example environment file:

**Windows (CMD)**:
```cmd
copy .env.example .env
```

**macOS/Linux**:
```bash
cp .env.example .env
```

Edit `.env` and add your Groq API key:
```env
GROQ_API_KEY=your_actual_api_key_here
```

### 5. Run the Server

```bash
python -m app.main
```

Or using uvicorn directly:
```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

The server will start at `http://localhost:8000`

## Environment Variables

All configuration is managed through environment variables. See `.env.example` for a complete reference with descriptions.

### Required Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `GROQ_API_KEY` | Your Groq API key for LLM and ASR | `gsk_...` |

### Application Settings

| Variable | Default | Description |
|----------|---------|-------------|
| `APP_NAME` | `Avatar AI Backend` | Application name |
| `APP_VERSION` | `1.0.0` | Application version |
| `DEBUG` | `True` | Enable debug mode (set to `False` in production) |
| `ENVIRONMENT` | `development` | Environment mode (`development` or `production`) |
| `HOST` | `0.0.0.0` | Server host |
| `PORT` | `8000` | Server port |

### LLM Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `LLM_MODEL` | `llama-3.3-70b-versatile` | Groq model to use |
| `LLM_MAX_TOKENS` | `512` | Maximum tokens in response |
| `LLM_TEMPERATURE` | `0.7` | Generation temperature (0.0-2.0) |
| `LLM_SYSTEM_PROMPT` | See `.env.example` | System prompt defining AI behavior |

### TTS Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `TTS_VOICE` | `en-US-AriaNeural` | Edge TTS voice name |
| `TTS_RATE` | `+0%` | Speech rate adjustment (-50% to +100%) |
| `TTS_VOLUME` | `+0%` | Volume adjustment (-50% to +100%) |
| `TTS_PITCH` | `+0Hz` | Pitch adjustment (-50Hz to +50Hz) |

Available voices include:
- `en-US-AriaNeural` (Female, US English)
- `en-US-GuyNeural` (Male, US English)
- `en-GB-SoniaNeural` (Female, British English)
- `en-GB-RyanNeural` (Male, British English)

See [Microsoft Voice Gallery](https://speech.microsoft.com/portal/voicegallery) for full list.

### WebSocket Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `WS_HEARTBEAT_INTERVAL` | `30` | Seconds between heartbeat pings |
| `WS_HEARTBEAT_TIMEOUT` | `90` | Seconds before connection timeout |
| `WS_MAX_MESSAGE_SIZE` | `10485760` | Maximum message size (10 MB) |

### Session Management

| Variable | Default | Description |
|----------|---------|-------------|
| `SESSION_TIMEOUT_SEC` | `300` | Idle session timeout (5 minutes) |
| `SESSION_CLEANUP_INTERVAL` | `60` | Cleanup task interval (seconds) |

### Storage Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `AUDIO_STORAGE_PATH` | `backend/.data/sessions` | Directory for audio files |
| `AUDIO_FILE_TTL_HOURS` | `24` | Audio file retention time |

### Rate Limiting

| Variable | Default | Description |
|----------|---------|-------------|
| `RATE_LIMIT_MESSAGES_PER_MINUTE` | `60` | Max messages per session per minute |
| `RATE_LIMIT_CONNECTIONS_PER_IP` | `5` | Max concurrent connections per IP |

### CORS Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `ALLOWED_ORIGINS` | `["http://localhost:3000", "http://localhost:5173"]` | Allowed frontend origins (JSON array) |

## API Endpoints

### HTTP Endpoints

#### Health Check
```
GET /api/v1/health
```

Returns server status and version information.

**Response**:
```json
{
  "status": "ok",
  "app": "Avatar AI Backend",
  "version": "1.0.0",
  "environment": "development"
}
```

#### Session Statistics (Development Only)
```
GET /api/v1/health/sessions
```

Returns active session statistics. Only available in development mode.

**Response**:
```json
{
  "active_sessions": 2,
  "total_created": 15,
  "sessions": [
    {
      "session_id": "abc-123",
      "avatar_id": "avatar1",
      "created_at": "2024-01-15T10:30:00Z",
      "last_activity": "2024-01-15T10:35:00Z"
    }
  ]
}
```

#### Audio File Serving
```
GET /api/v1/audio/{session_id}/{message_id}.mp3
```

Serves generated audio files for TTS playback.

**Parameters**:
- `session_id`: Session identifier (UUID format)
- `message_id`: Message identifier (UUID format)

**Response**: Audio file (audio/mpeg)

**Security Features**:
- Path validation to prevent directory traversal
- Only serves files from configured storage directory
- Returns 404 if file doesn't exist

### WebSocket Endpoint

```
WS /api/v1/ws/{avatar_id}
```

Real-time bidirectional communication for chat, audio, and viseme data.

**Parameters**:
- `avatar_id`: Avatar identifier (`avatar1`, `avatar2`, or `avatar3`)

**Connection Example**:
```javascript
const ws = new WebSocket('ws://localhost:8000/api/v1/ws/avatar1');
```

See [PROTOCOL.md](docs/PROTOCOL.md) for complete WebSocket protocol documentation.

## WebSocket Protocol Overview

### Client → Server Messages

#### User Message
```json
{
  "type": "chat.user_message",
  "data": {
    "session_id": "optional-uuid",
    "message_id": "unique-uuid",
    "text": "Hello, how are you?"
  }
}
```

#### Abort Generation
```json
{
  "type": "chat.abort",
  "data": {
    "session_id": "session-uuid",
    "message_id": "message-uuid"
  }
}
```

### Server → Client Messages

#### LLM Token Streaming
```json
{
  "type": "chat.delta",
  "data": {
    "session_id": "session-uuid",
    "message_id": "message-uuid",
    "delta": "Hello"
  }
}
```

#### Complete Response
```json
{
  "type": "chat.final",
  "data": {
    "session_id": "session-uuid",
    "message_id": "message-uuid",
    "text": "Hello! I'm doing well, thank you for asking."
  }
}
```

#### Pipeline State
```json
{
  "type": "pipeline.state",
  "data": {
    "session_id": "session-uuid",
    "state": "thinking"
  }
}
```

States: `idle`, `thinking`, `speaking`, `error`

#### TTS Audio Ready
```json
{
  "type": "tts.ready",
  "data": {
    "session_id": "session-uuid",
    "message_id": "message-uuid",
    "audio": {
      "url": "/api/v1/audio/session-uuid/message-uuid.mp3",
      "mime": "audio/mpeg",
      "duration_ms": 3500
    }
  }
}
```

#### Viseme Timeline
```json
{
  "type": "visemes.ready",
  "data": {
    "session_id": "session-uuid",
    "message_id": "message-uuid",
    "format": "mouthCues",
    "mouthCues": [
      {
        "start": 0.0,
        "end": 0.15,
        "value": "viseme_PP"
      }
    ]
  }
}
```

#### Error Message
```json
{
  "type": "error",
  "data": {
    "session_id": "session-uuid",
    "message_id": "message-uuid",
    "code": "PIPELINE_ERROR",
    "message": "Failed to generate response",
    "details": {}
  }
}
```

Error codes: `INVALID_MESSAGE`, `PIPELINE_ERROR`, `SESSION_ERROR`, `TIMEOUT`

## Project Structure

```
backend/
├── app/
│   ├── api/
│   │   └── v1/
│   │       ├── endpoints/
│   │       │   ├── websocket.py      # WebSocket handler
│   │       │   ├── audio.py          # Audio file serving
│   │       │   └── health.py         # Health checks
│   │       ├── dependencies.py       # Dependency injection
│   │       └── router.py             # API router
│   ├── core/
│   │   ├── config.py                 # Configuration management
│   │   ├── errors.py                 # Custom exceptions
│   │   └── logging.py                # Logging setup
│   ├── schemas/
│   │   ├── ws_messages.py            # WebSocket message schemas
│   │   └── audio.py                  # Audio data schemas
│   ├── services/
│   │   ├── asr/
│   │   │   └── groq_whisper.py       # Speech recognition
│   │   ├── llm/
│   │   │   └── groq_provider.py      # LLM service
│   │   ├── tts/
│   │   │   ├── edge_tts_provider.py  # TTS service
│   │   │   ├── viseme_generator.py   # Viseme generation
│   │   │   └── viseme_map.py         # Phoneme mapping
│   │   └── pipeline/
│   │       ├── session_manager.py    # Session lifecycle
│   │       ├── conversation.py       # Pipeline orchestration
│   │       └── events.py             # Event bus
│   └── main.py                       # Application entry point
├── .data/
│   └── sessions/                     # Generated audio files
├── tests/                            # Test suite
├── .env                              # Environment variables (create from .env.example)
├── .env.example                      # Example configuration
├── requirements.txt                  # Production dependencies
├── requirements-dev.txt              # Development dependencies
├── pyproject.toml                    # Tool configuration
└── README.md                         # This file
```

## Development

### Running Tests

```bash
# Run all tests
pytest

# Run with coverage
pytest --cov=app --cov-report=html

# Run specific test file
pytest tests/test_websocket.py

# Run with verbose output
pytest -v
```

### Code Quality

The project uses several tools for code quality:

**Linting** (Ruff):
```bash
ruff check app/
```

**Formatting** (Black):
```bash
black app/
```

**Type Checking** (MyPy):
```bash
mypy app/
```

**Run all checks**:
```bash
ruff check app/ && black --check app/ && mypy app/
```

### Logging

Logs are written to:
- Console (stdout) with colored output
- `logs/app.log` (rotating file, 10 MB max, 5 backups)

Log levels:
- `DEBUG`: Detailed information for debugging
- `INFO`: General informational messages
- `WARNING`: Warning messages
- `ERROR`: Error messages
- `CRITICAL`: Critical errors

Configure log level via `DEBUG` environment variable.

## Troubleshooting

### Connection Issues

**Problem**: WebSocket connection fails
- Check that the server is running on the correct port
- Verify CORS settings in `.env` include your frontend URL
- Check firewall settings

**Problem**: "Invalid avatar ID" error
- Ensure avatar_id is one of: `avatar1`, `avatar2`, `avatar3`
- Check WebSocket URL format: `ws://localhost:8000/api/v1/ws/avatar1`

### API Key Issues

**Problem**: "Invalid API key" error
- Verify `GROQ_API_KEY` is set correctly in `.env`
- Check that the key is active at [console.groq.com](https://console.groq.com)
- Ensure no extra spaces or quotes in the `.env` file

### Audio Issues

**Problem**: Audio files not found (404)
- Check that `AUDIO_STORAGE_PATH` directory exists
- Verify session_id and message_id are valid UUIDs
- Check file permissions on storage directory

**Problem**: TTS generation fails
- Verify internet connection (Edge TTS requires network access)
- Check TTS voice name is valid
- Review logs for detailed error messages

### Performance Issues

**Problem**: Slow response times
- Check Groq API rate limits (60 requests/minute on free tier)
- Reduce `LLM_MAX_TOKENS` for faster responses
- Monitor session count with `/api/v1/health/sessions`

**Problem**: High memory usage
- Reduce `SESSION_TIMEOUT_SEC` to clean up sessions faster
- Check for session leaks with health endpoint
- Restart server to clear memory

## Production Deployment

### Security Checklist

- [ ] Set `DEBUG=False` in production
- [ ] Set `ENVIRONMENT=production`
- [ ] Use strong, unique `GROQ_API_KEY`
- [ ] Configure `ALLOWED_ORIGINS` to only include production domains
- [ ] Enable HTTPS/WSS for encrypted connections
- [ ] Set up proper firewall rules
- [ ] Configure rate limiting appropriately
- [ ] Set up log rotation and monitoring
- [ ] Regularly update dependencies

### Recommended Settings

```env
DEBUG=False
ENVIRONMENT=production
ALLOWED_ORIGINS=["https://yourdomain.com"]
SESSION_TIMEOUT_SEC=300
RATE_LIMIT_MESSAGES_PER_MINUTE=30
RATE_LIMIT_CONNECTIONS_PER_IP=3
```

### Running with Gunicorn

For production, use Gunicorn with Uvicorn workers:

```bash
gunicorn app.main:app \
  --workers 4 \
  --worker-class uvicorn.workers.UvicornWorker \
  --bind 0.0.0.0:8000 \
  --access-logfile logs/access.log \
  --error-logfile logs/error.log
```

## License

[Your License Here]

## Support

For issues and questions:
- Check the [troubleshooting section](#troubleshooting)
- Review logs in `logs/app.log`
- See [PROTOCOL.md](docs/PROTOCOL.md) for WebSocket protocol details
