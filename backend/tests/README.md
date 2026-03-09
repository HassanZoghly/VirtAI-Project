# Backend Testing Guide

## Overview

The backend testing infrastructure uses pytest with support for async testing, property-based testing, and coverage reporting.

## Testing Framework

- **pytest**: Main testing framework
- **pytest-asyncio**: Async test support for FastAPI and async functions
- **hypothesis**: Property-based testing for generating test cases
- **pytest-cov**: Coverage reporting

## Installation

Install test dependencies:

```bash
pip install -r requirements-dev.txt
```

## Running Tests

### Run all tests
```bash
pytest tests/ -v
```

### Run specific test file
```bash
pytest tests/test_audio_endpoint.py -v
```

### Run tests matching a pattern
```bash
pytest tests/ -k "audio" -v
```

### Run with coverage
```bash
# Terminal report
pytest tests/ --cov=app --cov-report=term-missing

# HTML report (opens in browser)
pytest tests/ --cov=app --cov-report=html
# Report will be in htmlcov/index.html
```

### Run with short traceback
```bash
pytest tests/ -v --tb=short
```

## Test Organization

- `conftest.py`: Shared fixtures and test configuration
- `test_*.py`: Test files following pytest naming convention
- Tests are organized by feature/module

## Writing Tests

### Basic Test
```python
def test_example():
    assert 1 + 1 == 2
```

### Async Test
```python
import pytest

@pytest.mark.asyncio
async def test_async_function():
    result = await some_async_function()
    assert result is not None
```

### Property-Based Test
```python
from hypothesis import given, strategies as st

@given(st.integers(min_value=0, max_value=100))
def test_property(value):
    assert value >= 0
    assert value <= 100
```

## Test Markers

- `@pytest.mark.asyncio`: Mark test as async
- `@pytest.mark.integration`: Mark test as integration test

## Coverage Configuration

Coverage settings are in `pyproject.toml`:
- Source: `app/` directory
- Excludes: tests, cache, virtual environments
- Report shows missing lines

## CI/CD Integration

For CI/CD pipelines, use:
```bash
pytest tests/ -v --cov=app --cov-report=xml --cov-report=term
```

## Troubleshooting

### Tests fail with "api_key is required"
Some tests require API keys. Set them in environment variables or use the test fixtures in `conftest.py`.

### Async tests not running
Ensure `pytest-asyncio` is installed and `asyncio_mode = "auto"` is set in `pyproject.toml`.

### Coverage not working
Ensure `pytest-cov` is installed: `pip install pytest-cov`
