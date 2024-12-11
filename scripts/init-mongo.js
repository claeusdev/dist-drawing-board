// Initialize MongoDB Replica Set
const config = {
	_id: "rs0",
	members: [
		{ _id: 0, host: "mongo1:27017", priority: 2 },
		{ _id: 1, host: "mongo2:27017", priority: 1 },
		{ _id: 2, host: "mongo3:27017", priority: 1 }
	]
};

// Initialize replica set
rs.initiate(config);

// Wait for replica set to be initialized
while (rs.status().ok !== 1) {
	sleep(1000);
}

// Wait for primary to be elected
while (rs.status().myState !== 1) {
	sleep(1000);
}

print("Replica set initialized successfully");
