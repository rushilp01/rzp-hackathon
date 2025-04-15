#!/bin/bash

# Check if .env file exists
if [ ! -f .env ]; then
    echo "Creating .env file from example..."
    cp .env.example .env
    echo "Please edit .env file to add your OpenAI API key."
    exit 1
fi

# Function to check if a command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Check for required tools
if ! command_exists python3; then
    echo "Python 3 is required but not installed. Please install it."
    exit 1
fi

if ! command_exists npm; then
    echo "npm is required but not installed. Please install Node.js."
    exit 1
fi

# Install backend dependencies
echo "Installing Python dependencies..."
pip3 install -r requirements.txt

# Install frontend dependencies
echo "Installing Node.js dependencies..."
npm install

# Start backend in background
echo "Starting backend server..."
python3 app.py &
BACKEND_PID=$!

# Wait for backend to start
echo "Waiting for backend to start..."
sleep 3

# Start frontend
echo "Starting frontend..."
npm start

# When the frontend is closed, kill the backend
echo "Stopping backend..."
kill $BACKEND_PID 