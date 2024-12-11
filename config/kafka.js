import { Kafka, Partitioners } from 'kafkajs';

const brokers = process.env.KAFKA_BROKERS ? process.env.KAFKA_BROKERS.split(',') : ['kafka:9092'];

const kafka = new Kafka({
  clientId: 'whiteboard-app',
  brokers,  // Changed from localhost
  retry: {
    initialRetryTime: 100,
    retries: 8
  },
  createPartitioner: Partitioners.LegacyPartitioner
});

export { kafka };
