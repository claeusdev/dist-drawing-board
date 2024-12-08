# Distributed Whiteboard System

A scalable, distributed collaborative whiteboard system built with Node.js, Kafka, Redis, and MongoDB.

## Architecture

This system implements a distributed architecture with the following components:
- WebSocket servers for real-time communication
- Kafka for event streaming
- Redis for state management
- MongoDB for persistence
- Service discovery with etcd
- Monitoring with Prometheus and Grafana

## Setup

1. Install dependencies:
```bash
npm install
```

2. Start the infrastructure services:
```bash
docker-compose up -d
```

3. Start the application services:
```bash
npm run start        # WebSocket server
npm run start:storage    # Storage service
npm run start:presence   # Presence service
```

## Configuration

Edit the configuration files in the `config/` directory to customize:
- Kafka settings
- Redis cluster configuration
- MongoDB connection
- Service discovery options

## Deployment

Kubernetes manifests are provided in the `kubernetes/` directory for container orchestration.

```yaml
// docker-compose.yml
version: '3.8'
services:
  zookeeper:
    image: confluentinc/cp-zookeeper:latest
    environment:
      ZOOKEEPER_CLIENT_PORT: 2181
      ZOOKEEPER_TICK_TIME: 2000
    ports:
      - "2181:2181"

  kafka:
    image: confluentinc/cp-kafka:latest
    depends_on:
      - zookeeper
    ports:
      - "9092:9092"
    environment:
      KAFKA_BROKER_ID: 1
      KAFKA_ZOOKEEPER_CONNECT: zookeeper:2181
      KAFKA_ADVERTISED_LISTENERS: PLAINTEXT://localhost:9092
      KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR: 1

  redis-master:
    image: redis:latest
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    command: redis-server --appendonly yes

  mongodb:
    image: mongo:latest
    ports:
      - "27017:27017"
    volumes:
      - mongodb_data:/data/db

  etcd:
    image: quay.io/coreos/etcd:v3.5.0
    ports:
      - "2379:2379"
    command: 
      - etcd
      - --advertise-client-urls=http://0.0.0.0:2379
      - --listen-client-urls=http://0.0.0.0:2379

  prometheus:
    image: prom/prometheus:latest
    ports:
      - "9090:9090"
    volumes:
      - ./monitoring/prometheus.yml:/etc/prometheus/prometheus.yml

  grafana:
    image: grafana/grafana:latest
    ports:
      - "3000:3000"
    depends_on:
      - prometheus

volumes:
  redis_data:
  mongodb_data:
```
