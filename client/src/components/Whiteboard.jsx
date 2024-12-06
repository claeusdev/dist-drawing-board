import React, { useEffect, useRef, useState } from 'react';

const Whiteboard = ({ roomId = 1, userId = 1 }) => {
  const canvasRef = useRef(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [ws, setWs] = useState(null);
  const [coordinates, setCoordinates] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const socket = new WebSocket('ws://localhost:8080');

    console.log({ socket })
    socket.onopen = () => {
      console.log('Connected to WebSocket server');
      socket.send(JSON.stringify({
        type: 'join',
        roomId,
        userId
      }));
    };

    socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          handleServerMessage(data);
        } catch (err) {
          console.error('Error processing server message:', err);
        }
      };
    setWs(socket);

    return () => {
      socket.close();
    };
  }, [roomId, userId]);

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

    ws.send(JSON.stringify({
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
