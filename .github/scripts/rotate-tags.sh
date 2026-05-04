#!/bin/bash
# rotate-tags-template.sh
# Universal ACR image tag rotation script (latest → latest_v1, etc.)
#
# Usage:
#   ./rotate-tags-template.sh <acr-name> <repository-name> <max-images>
#
# Arguments:
#   acr-name: Name of your Azure Container Registry
#   repository-name: Name of the repository in ACR
#   max-images: Total number of images to maintain (default: 4)
#
# Example:
#   ./rotate-tags-template.sh myacr myapp 5

set -e

ACR_NAME=$1
REPOSITORY=$2
MAX_IMAGES=${3:-4}
MAX_BACKUP_VERSION=$((MAX_IMAGES - 1))

if [ -z "$ACR_NAME" ] || [ -z "$REPOSITORY" ]; then
    echo "Usage: $0 <acr-name> <repository-name> [max-images]"
    exit 1
fi

echo "Rotating tags in $ACR_NAME/$REPOSITORY (keeping $MAX_IMAGES versions)"

# Print digests BEFORE rotation
echo "--- Tag digests BEFORE rotation ---"
for tag in latest $(seq 1 $MAX_BACKUP_VERSION | xargs -I{} echo latest_v{}); do
  digest=$(az acr repository show-manifests --name "$ACR_NAME" --repository "$REPOSITORY" --query "[?tags[?@=='$tag']].digest" -o tsv 2>/dev/null || echo "not found")
  echo "$tag: $digest"
done

# Rotate existing latest_vN tags (in reverse order)
for ((i=MAX_BACKUP_VERSION-1; i>=1; i--)); do
  current_tag="latest_v$i"
  next_tag="latest_v$((i+1))"
  tag_exists=$(az acr repository show-tags --name "$ACR_NAME" --repository "$REPOSITORY" --output tsv 2>/dev/null | grep -x "$current_tag" || true)
  if [ ! -z "$tag_exists" ]; then
    echo "Rotating: $current_tag → $next_tag"
    az acr import --name "$ACR_NAME" --source "$ACR_NAME.azurecr.io/$REPOSITORY:$current_tag" --image "$REPOSITORY:$next_tag" --force
  fi
done

# Rotate latest → latest_v1 (backup before new image is pushed)
tag_exists=$(az acr repository show-tags --name "$ACR_NAME" --repository "$REPOSITORY" --output tsv 2>/dev/null | grep -x "latest" || true)
if [ ! -z "$tag_exists" ]; then
  echo "Backing up: latest → latest_v1"
  az acr import --name "$ACR_NAME" --source "$ACR_NAME.azurecr.io/$REPOSITORY:latest" --image "$REPOSITORY:latest_v1" --force
fi

# Print digests AFTER rotation
echo "--- Tag digests AFTER rotation ---"
for tag in latest $(seq 1 $MAX_BACKUP_VERSION | xargs -I{} echo latest_v{}); do
  digest=$(az acr repository show-manifests --name "$ACR_NAME" --repository "$REPOSITORY" --query "[?tags[?@=='$tag']].digest" -o tsv 2>/dev/null || echo "not found")
  echo "$tag: $digest"
done

echo "✅ Tag rotation complete!"
