# Agent instructions

- Whenever `scripts/generate_grafana.ts` changes, regenerate the dashboard JSON with
  `./scripts/m-ai.sh generate-grafana`.
- Whenever `scripts/m-ai.sh` commands change, update `scripts/_m-ai` and
  `scripts/m-ai-completion.bash`.
- Whenever TypeScript code is finished, run `./scripts/m-ai.sh fix` and fix any errors it reports before finishing.
- To tell every connected minion to dig a range relative to its current position, use
  `:a_drh [-a|+a] <fromX> <toX> <fromY> <toY> <fromZ> <toZ>` in Minecraft chat.
