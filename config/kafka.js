import { Kafka, Partitioners } from 'kafkajs';

const kafka = new Kafka({
  clientId: 'whiteboard-app',
  brokers: ['localhost:9092'],
  retry: {
    initialRetryTime: 100,
    retries: 8
  },
  createPartitioner: Partitioners.LegacyPartitioner
});

const createTopics = async () => {
  const admin = kafka.admin();
  try {
    await admin.connect();
    await admin.createTopics({
      topics: [{
        topic: 'whiteboard-events',
        numPartitions: 1,
        replicationFactor: 1
      }]
    });
  } catch (error) {
    if (!error.message.includes('Topic with this name already exists')) {
      console.error('Error creating topics:', error);
      throw error;
    }
  } finally {
    await admin.disconnect();
  }
};

export { kafka, createTopics };
