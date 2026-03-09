"""Quick test script to check if backend is running"""
import requests

print("🔍 Testing backend connection...\n")

# Test health endpoint
try:
    response = requests.get('http://localhost:8000/api/v1/health', timeout=5)
    if response.status_code == 200:
        print(f"✅ Backend is running!")
        print(f"   Response: {response.json()}")
        print(f"\n✅ WebSocket should be available at: ws://localhost:8000/api/v1/ws/avatar1")
    else:
        print(f"⚠️  Backend responded but with status code: {response.status_code}")
except requests.exceptions.ConnectionError:
    print("❌ Backend is NOT running!")
    print("\n- To start backend:")
    print("   1. Open a new terminal")
    print("   2. cd backend")
    print("   3. python -m app.main")
    print("\n   OR")
    print("\n   uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload")
except requests.exceptions.Timeout:
    print("⚠️  Backend is slow to respond (timeout)")
except Exception as e:
    print(f"❌ Error: {e}")

print("\n" + "="*60)
print("Next steps:")
print("1. Make sure backend is running (see above)")
print("2. Refresh your frontend in the browser")
print("3. Check WebSocket connection status")
print("="*60)
