#!/bin/bash

# Navigate to the frontend directory
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR/../frontend"

echo "============================================"
echo "  Starting VirtAI Frontend Development"
echo "============================================"
echo ""

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo "📦 node_modules not found. Installing dependencies..."
    echo ""
    npm install
    
    if [ $? -eq 0 ]; then
        echo ""
        echo "✅ Dependencies installed successfully!"
        echo ""
    else
        echo ""
        echo "❌ Failed to install dependencies. Please check your npm installation."
        exit 1
    fi
else
    echo "✅ Dependencies already installed. Skipping npm install..."
    echo ""
fi

# Start the development server
echo "[*] Starting Vite development server..."
echo ""
npm run dev
