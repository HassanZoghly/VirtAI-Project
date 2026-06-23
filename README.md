# VirtAI Project

VirtAI is an advanced web-based classroom and learning environment powered by a 3D avatar, real-time speech interaction, and cutting-edge RAG architecture.

## Features

- **3D Avatar & Real-time Voice**: Interact seamlessly with a real-time lip-synced 3D avatar using WebSockets.
- **Document-Augmented RAG**: Upload documents and interact naturally to ask questions, explore topics, or seek summaries.
- **NotebookLM-Style Quiz Generation**: Automatically generated interactive quizzes drawn directly from uploaded documents, complete with citations.
- **Dynamic Diagramming**: Powered by Mermaid.js, generate flowchart diagrams instantly from complex text.
- **Slide-by-Slide Explain Mode**: A specialized WebSocket Presentation state machine. Let the Avatar teach you the document slide-by-slide, allowing for pausing and contextual mid-presentation questions.
- **Napkin Visualization**: Automatically render complex code ideas or structures into beautiful visual graphics via Napkin API, handled gracefully using the Sentinel Pattern if unavailable.

## Setup & Configuration

Configure the following environment variables in your backend `.env` file:
```env
GROQ_API_KEY=your_groq_api_key
NAPKIN_API_KEY=your_napkin_api_key
```

## Running the Project

### Backend
Navigate to the `backend` directory and install dependencies:
```bash
pip install -r requirements.txt
uvicorn app.main:app --reload
```

### Frontend
Navigate to the `frontend` directory and start the Vite development server:
```bash
npm install
npm run dev
```

## Testing

The project uses robust testing mechanisms to ensure production reliability.

### Running Backend Tests (Pytest)
Execute the unit and integration tests (including the database testing layer):
```bash
pytest backend/tests/
```

### Running E2E UI Tests (Playwright)
Execute the Playwright end-to-end user flows targeting the UI:
```bash
cd frontend
npx playwright install
npx playwright test
```

### Running Load Tests (Locust)
Validate backend throughput and Map-Reduce concurrency capabilities:
```bash
cd backend
locust -f tests/load/test_rag_throughput.py --headless -u 10 -r 2 -t 1m
locust -f tests/load/test_summary_concurrent.py --headless -u 5 -r 1 -t 1m
```
