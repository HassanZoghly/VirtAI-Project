"""
Pytest configuration and fixtures for backend tests.
"""

import os

# Set environment variables BEFORE any imports
os.environ.setdefault("GROQ_API_KEY", "test-api-key-12345")
os.environ.setdefault("ENVIRONMENT", "development")
os.environ.setdefault("DEBUG", "false")

import pytest


@pytest.fixture(scope="session", autouse=True)
def setup_test_env():
    """Set up test environment variables."""
    yield
    # Cleanup if needed
    pass
