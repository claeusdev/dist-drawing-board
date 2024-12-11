import { MongoClient } from 'mongodb';
import { Kafka } from 'kafkajs';
import { mongodb, kafka as _kafka } from '../config/config';

class StorageService {
    constructor() {
        this.mongoClient = null;
        this.consumer = null;
    }

    async initialize() {
        // Initialize MongoDB
        this.mongoClient = new MongoClient(mongodb.uri);
        await this.mongoClient.connect();

        // Initialize Kafka consumer
        const kafka = new Kafka({
            clientId: 'storage-service',
            brokers: _kafka.brokers
        });

        this.consumer = kafka.consumer({ groupId: 'storage-group' });
        await this.consumer.connect();
        await this.consumer.subscribe({
            topic: _kafka.topics.events,
            fromBeginning: true
        });

        this.startConsumer();
    }

    async startConsumer() {
        const db = this.mongoClient.db(mongodb.database);
        const collection = db.collection('events');

        await this.consumer.run({
            eachMessage: async ({ topic, partition, message }) => {
                try {
                    const event = JSON.parse(message.value.toString());
                    await collection.insertOne({
                        ...event,
                        createdAt: new Date()
                    });
                } catch (error) {
                    console.error('Error processing message:', error);
                }
            }
        });
    }
}

export default StorageService;
