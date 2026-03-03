#!/bin/bash

# Exit immediately if any command fails
set -e

echo "Cloning repository: $GIT_REPOSITORY__URL"

# The quotes around the variable prevent errors if the URL somehow contains spaces
git clone "$GIT_REPOSITORY__URL" /home/app/output

echo "Starting deployment script..."
exec node script.js