_mai() {
	local commands="build-image deploy-image list-image-tags use-latest-image build-deploy-image setup-buildx docker-prune start-registry get-commands-history restart-daemon sync-main-player d export-world import-world new-world fix generate-grafana setup kube-setup"

	COMPREPLY=($(compgen -W "$commands" -- "${COMP_WORDS[COMP_CWORD]}"))
}

complete -F _mai mai ./mai ./scripts/m-ai.sh scripts/m-ai.sh
