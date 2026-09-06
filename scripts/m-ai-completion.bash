_mai() {
	local commands="build-image deploy-image list-image-tags build-deploy-image setup-buildx docker-prune get-commands-history restart-daemon fix check-ts generate-grafana setup kube-setup"

	COMPREPLY=($(compgen -W "$commands" -- "${COMP_WORDS[COMP_CWORD]}"))
}

complete -F _mai mai ./mai ./scripts/m-ai.sh scripts/m-ai.sh
