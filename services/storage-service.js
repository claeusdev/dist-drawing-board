import { MongoClient } from 'mongodb';
import { kafka } from '../config/kafka.js';

class StorageService {
    constructor() {
        this.mongodb = null;
        this.db = null;
        this.consumer = null;
    }

    async connect() {
        try {
            console.log('Connecting to MongoDB...');
            this.mongodb = await MongoClient.connect('mongodb://localhost:27017', {
                useUnifiedTopology: true
            });
            this.db = this.mongodb.db('whiteboard');
            console.log('Successfully connected to MongoDB');

            console.log('Connecting to Kafka...');
            this.consumer = kafka.consumer({
                groupId: 'storage-service'
            });
            await this.consumer.connect();
            console.log('Successfully connected to Kafka');

            // Subscribe to whiteboard events
            console.log('Subscribing to whiteboard-events topic...');
            await this.consumer.subscribe({
                topic: 'whiteboard-events',
                fromBeginning: true
            });
            console.log('Successfully subscribed to whiteboard-events topic');
        } catch (error) {
            console.error('Connection error:', error);
            throw error;
        }
    }

    async start() {
        try {
            await this.connect();

            console.log('Starting to consume messages...');
            await this.consumer.run({
                eachMessage: async ({ topic, partition, message }) => {
                    console.log('Received message:', {
                        topic,
                        partition,
                        offset: message.offset,
                        value: message.value.toString()
                    });

                    try {
                        const event = JSON.parse(message.value.toString());
                        console.log('Processing event:', event.type);
                        await this.processEvent(event);
                        console.log('Successfully processed event:', event.type);
                    } catch (error) {
                        console.error('Error processing message:', error);
                    }
                }
            });

            console.log('Storage Service is now running and consuming messages');
        } catch (error) {
            console.error('Failed to start storage service:', error);
            throw error;
        }
    }

    async processEvent(event) {
        try {
            console.log(`Storing event of type ${event.type} for room ${event.roomId}`);

            // Store the raw event
            await this.db.collection('events').insertOne({
                ...event,
                storedAt: new Date()
            });
            console.log('Event stored in events collection');

            // Process based on event type
            switch (event.type) {
                case 'draw':
                    await this.processDrawEvent(event);
                    break;
                case 'join':
                    await this.processJoinEvent(event);
                    break;
                case 'leave':
                    await this.processLeaveEvent(event);
                    break;
            }
        } catch (error) {
            console.error('Error processing event:', error);
        }
    }
    async processDrawEvent(event) {
        try {
            // Update room's last activity
            await this.db.collection('rooms').updateOne(
                { roomId: event.roomId },
                {
                    $set: {
                        lastActivity: new Date(event.timestamp),
                        lastDrawEvent: event
                    },
                    $inc: { drawCount: 1 }
                },
                { upsert: true }
            );

            // Store draw event in room history
            await this.db.collection('room_history').insertOne({
                roomId: event.roomId,
                userId: event.userId,
                type: 'draw',
                coordinates: event.coordinates,
                timestamp: new Date(event.timestamp)
            });
        } catch (error) {
            console.error('Error processing draw event:', error);
        }
    }

    async processJoinEvent(event) {
        try {
            await this.db.collection('rooms').updateOne(
                { roomId: event.roomId },
                {
                    $set: {
                        lastJoinActivity: new Date(event.timestamp)
                    },
                    $addToSet: { activeUsers: event.userId }
                },
                { upsert: true }
            );
        } catch (error) {
            console.error('Error processing join event:', error);
        }
    }

    async processLeaveEvent(event) {
        try {
            await this.db.collection('rooms').updateOne(
                { roomId: event.roomId },
                {
                    $pull: { activeUsers: event.userId },
                    $set: { lastLeaveActivity: new Date(event.timestamp) }
                }
            );
        } catch (error) {
            console.error('Error processing leave event:', error);
        }
    }

    // API methods for retrieving data
    async getRoomHistory(roomId) {
        try {
            return await this.db.collection('room_history')
                .find({ roomId })
                .sort({ timestamp: 1 })
                .toArray();
        } catch (error) {
            console.error('Error getting room history:', error);
            return [];
        }
    }

    async getRoomStats(roomId) {
        try {
            return await this.db.collection('rooms').findOne({ roomId });
        } catch (error) {
            console.error('Error getting room stats:', error);
            return null;
        }
    }

    async stop() {
        try {
            await this.consumer.disconnect();
            await this.mongodb.close();
            console.log('Storage Service stopped successfully');
        } catch (error) {
            console.error('Error stopping storage service:', error);
        }
    }
}

// Create and start storage service
const storageService = new StorageService();

// Handle process termination
process.on('SIGINT', async () => {
    console.log('Shutting down Storage Service...');
    await storageService.stop();
    process.exit(0);
});

// Start the service
storageService.start().catch(error => {
    console.error('Failed to start Storage Service:', error);
    process.exit(1);
});

export default StorageService;
