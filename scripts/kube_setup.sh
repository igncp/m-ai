#!/usr/bin/env bash

set -euo pipefail

mkdir -p ~/.kube
sudo cp /etc/rancher/k3s/k3s.yaml ~/.kube/config
sudo chown $(whoami):$(id -gn) ~/.kube/config
chmod 600 ~/.kube/config
kubectl apply --server-side -f 'https://raw.githubusercontent.com/prometheus-operator/prometheus-operator/refs/tags/v0.93.1/bundle.yaml'

echo "Setup finished successfully"
