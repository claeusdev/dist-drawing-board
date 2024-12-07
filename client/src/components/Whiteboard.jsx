import React, { useEffect, useCallback, useRef, useState } from 'react';

const Whiteboard = ({ roomId = 1, userId = 1 }) => {
  const canvasRef = useRef(null);
  const wsRef = useRef(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [coordinates, setCoordinates] = useState({ x: 0, y: 0 });
  const [isConnected, setIsConnected] = useState(false);
  const reconnectAttempts = useRef(0);
  const maxReconnectAttempts = 5;

  const handleServerMessage = (data) => {
    switch (data.type) {
      case 'init_state':
        applyInitialState(data.events);
        break;
      case 'draw':
        if (data.userId !== userId) {
          drawLine(data.coordinates);
        }
        break;
      // ... other cases ...
    }
  };

  const connectWebSocket = useCallback(() => {
    console.log('Attempting to connect to WebSocket...');
    const ws = new WebSocket('ws://localhost:8000');
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('Connected to WebSocket server');
      setIsConnected(true);
      reconnectAttempts.current = 0;

      // Join room
      ws.send(JSON.stringify({
        type: 'join',
        roomId,
        userId
      }));
    };

    ws.onclose = () => {
      console.log('Disconnected from WebSocket server');
      setIsConnected(false);

      // Attempt to reconnect
      if (reconnectAttempts.current < maxReconnectAttempts) {
        reconnectAttempts.current += 1;
        const timeout = Math.min(1000 * Math.pow(2, reconnectAttempts.current), 10000);
        console.log(`Attempting to reconnect in ${timeout}ms...`);
        setTimeout(connectWebSocket, timeout);
      }
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        handleServerMessage(data);
      } catch (err) {
        console.error('Error processing server message:', err);
      }
    };
  }, [roomId, userId]);

  useEffect(() => {
    connectWebSocket();

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [connectWebSocket, roomId, userId]);


  const applyInitialState = (events) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');

    // Clear the canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Replay all events in order
    events.forEach(event => {
      if (event.type === 'draw') {
        drawLine(event.coordinates);
      }
    });
  };

  const drawLine = (coords) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    ctx.beginPath();
    ctx.moveTo(coords.x0, coords.y0);
    ctx.lineTo(coords.x1, coords.y1);
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.closePath();
  };

  const startDrawing = (e) => {
    const { offsetX, offsetY } = e.nativeEvent;
    setIsDrawing(true);
    setCoordinates({ x: offsetX, y: offsetY });
  };

  const draw = (e) => {
    if (!isDrawing) return;

    const { offsetX, offsetY } = e.nativeEvent;
    const newCoordinates = {
      x0: coordinates.x,
      y0: coordinates.y,
      x1: offsetX,
      y1: offsetY
    };

    drawLine(newCoordinates);
    setCoordinates({ x: offsetX, y: offsetY });

    wsRef.current.send(JSON.stringify({
      type: 'draw',
      roomId,
      userId,
      coordinates: newCoordinates
    }));
  };
  return (
    <canvas
      ref={canvasRef}
      width={800}
      height={600}
      onMouseDown={startDrawing}
      onMouseMove={draw}
      onMouseUp={() => setIsDrawing(false)}
      onMouseOut={() => setIsDrawing(false)}
      style={{ border: '1px solid #000' }}
    />
  );
};

export default Whiteboard;
