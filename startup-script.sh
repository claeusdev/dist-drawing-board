# #!/bin/bash

# Install Docker and Docker Compose
apt-get update
apt-get install -y apt-transport-https ca-certificates curl software-properties-common
curl -fsSL https://download.docker.com/linux/debian/gpg | apt-key add -
add-apt-repository "deb [arch=amd64] https://download.docker.com/linux/debian $(lsb_release -cs) stable"
apt-get update
apt-get install -y docker-ce docker-compose

# Configure Docker to use GCR
gcloud auth configure-docker

# Create application directory
mkdir -p /opt/whiteboard
cd /opt/whiteboard

# Copy configuration files
# gsutil cp gs://whiteboard-445202/config/* config/
# gsutil cp gs://whiteboard-445202/monitoring/* monitoring/
# gsutil cp gs://whiteboard-445202/docker-compose.prod.yml .

# Pull images and start containers
docker-compose -f docker-compose.prod.yml pull
docker-compose -f docker-compose.prod.yml up -d
