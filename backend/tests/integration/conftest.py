import pytest
from unittest.mock import MagicMock

class FakeAsyncSession:
    def __init__(self):
        self.inserted = []
        
    def add(self, obj):
        self.inserted.append(obj)
        
    async def commit(self):
        pass
        
    async def execute(self, *args, **kwargs):
        result = MagicMock()
        def scalar_one_or_none():
            return self.inserted[-1] if self.inserted else None
        result.scalar_one_or_none.side_effect = scalar_one_or_none
        result.scalars.return_value.all.return_value = self.inserted
        return result

    async def scalar(self, *args, **kwargs):
        from unittest.mock import MagicMock
        return MagicMock(id=str(args[0])) if args else MagicMock()

@pytest.fixture
def mock_db_session():
    """
    Creates a fake DB session.
    """
    return FakeAsyncSession()
    
@pytest.fixture
def app_fixture():
    """
    Returns the FastAPI app object.
    """
    from app.main import app
    
    # Clear overrides if any
    app.dependency_overrides = {}
    return app
