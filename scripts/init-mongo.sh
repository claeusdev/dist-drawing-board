#!/bin/bash

# Wait for MongoDB to start up
echo "Waiting for MongoDB to start up..."
sleep 30

# Initialize the replica set
echo "Initializing replica set..."
mongosh --eval "
rs.initiate({
  _id: 'rs0',
  members: [
    { _id: 0, host: 'mongo1:27017' },
    { _id: 1, host: 'mongo2:27017' },
    { _id: 2, host: 'mongo3:27017' }
  ]
});
"

echo "MongoDB Replica Set initialization completed"
